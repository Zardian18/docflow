import { IdParam, ListQuery, paginated, Role, RoleCreate, RoleUpdate } from '@docflow/shared';
import { isCombinable, type Permission } from '@docflow/shared';
import { and, asc, count, eq, inArray, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { DbOrTx, Tx } from '../db/client.js';
import { employeeRoles, employees, roleExclusions, roles } from '../db/schema.js';
import { AppError, conflict, isUniqueViolation, notFound } from '../errors.js';
import { requirePermission } from '../plugins/auth.js';
import { deleteRole } from '../domain/deletion.js';
import { currentUser } from '../plugins/auth.js';
import type { RouteDeps } from './deps.js';
import { containsPattern, pageOffset, statusCondition } from './query-helpers.js';

const activeEmployeeCount = sql<number>`(
  select count(*)::int from ${employeeRoles} er join ${employees} e on e.id = er.employee_id
  where er.role_id = "roles"."id" and e.is_active
)`;

const excludedRoleIds = sql<string[]>`coalesce(
  (select array_agg(x.excluded_role_id order by x.excluded_role_id)
     from ${roleExclusions} x where x.role_id = "roles"."id"),
  '{}'::uuid[])`;

const roleColumns = {
  id: roles.id,
  name: roles.name,
  permission: roles.permission,
  isSystem: roles.isSystem,
  isActive: roles.isActive,
  activeEmployeeCount,
  excludedRoleIds,
};

async function getRole(db: DbOrTx, id: string) {
  const [role] = await db.select(roleColumns).from(roles).where(eq(roles.id, id));
  if (!role) throw notFound('Role');
  return role;
}

const nameTaken = () => conflict('ROLE_NAME_TAKEN', 'A role with this name already exists');

/**
 * Exclusions (D23) are only meaningful between a Creator role and an Approver role: Admin and
 * CFO roles never combine with anything, and two roles of the same kind can't be held together.
 */
async function checkExclusions(tx: Tx, permission: Permission, excluded: string[]) {
  if (excluded.length === 0) return;
  if (!isCombinable(permission)) {
    throw new AppError(
      400,
      'INVALID_EXCLUSION',
      'Admin and CFO roles are never combined with other roles, so they need no exclusions',
    );
  }
  const found = await tx
    .select({ id: roles.id, permission: roles.permission })
    .from(roles)
    .where(inArray(roles.id, excluded));
  if (found.length !== new Set(excluded).size) {
    throw new AppError(400, 'ROLE_NOT_FOUND', 'Choose valid roles to exclude');
  }
  if (found.some((r) => !isCombinable(r.permission) || r.permission === permission)) {
    throw new AppError(
      400,
      'INVALID_EXCLUSION',
      'A Creator role can only exclude Approver roles, and an Approver role only Creator roles',
    );
  }
}

/** Saves a role's exclusions in both directions (they are mutual). */
async function saveExclusions(tx: Tx, roleId: string, excluded: string[]) {
  await tx
    .delete(roleExclusions)
    .where(or(eq(roleExclusions.roleId, roleId), eq(roleExclusions.excludedRoleId, roleId)));
  const unique = [...new Set(excluded)];
  if (unique.length === 0) return;
  await tx
    .insert(roleExclusions)
    .values([
      ...unique.map((other) => ({ roleId, excludedRoleId: other })),
      ...unique.map((other) => ({ roleId: other, excludedRoleId: roleId })),
    ]);
}

/** People who already hold this role together with one it would exclude. */
async function peopleBreaking(tx: Tx, roleId: string, excluded: string[]) {
  if (excluded.length === 0) return [];
  return tx
    .selectDistinct({ name: employees.name })
    .from(employeeRoles)
    .innerJoin(employees, eq(employees.id, employeeRoles.employeeId))
    .where(
      and(
        eq(employeeRoles.roleId, roleId),
        sql`exists (select 1 from ${employeeRoles} o
                     where o.employee_id = "employee_roles"."employee_id"
                       and ${inArray(sql`o.role_id`, excluded)})`,
      ),
    )
    .orderBy(asc(employees.name));
}

export const roleRoutes: FastifyPluginAsyncZod<RouteDeps> = async (app, { db }) => {
  // onRequest, so unauthorised callers are refused before any input validation
  app.addHook('onRequest', requirePermission('ADMIN'));

  app.get(
    '/',
    { schema: { querystring: ListQuery, response: { 200: paginated(Role) } } },
    async ({ query }) => {
      const where = and(
        query.q ? sql`lower(${roles.name}) like ${containsPattern(query.q)}` : undefined,
        statusCondition(roles.isActive, query.status),
      );
      const [items, [totals]] = await Promise.all([
        db
          .select(roleColumns)
          .from(roles)
          .where(where)
          .orderBy(asc(sql`lower(${roles.name})`))
          .limit(query.pageSize)
          .offset(pageOffset(query)),
        db.select({ total: count() }).from(roles).where(where),
      ]);
      return { items, total: totals?.total ?? 0, page: query.page, pageSize: query.pageSize };
    },
  );

  app.post(
    '/',
    { schema: { body: RoleCreate, response: { 201: Role } } },
    async (request, reply) => {
      const { name, permission, excludedRoleIds: excluded } = request.body;
      try {
        const id = await db.transaction(async (tx) => {
          await checkExclusions(tx, permission, excluded);
          const [created] = await tx
            .insert(roles)
            .values({ name, permission })
            .returning({ id: roles.id });
          await saveExclusions(tx, created!.id, excluded);
          return created!.id;
        });
        return reply.code(201).send(await getRole(db, id));
      } catch (err) {
        if (isUniqueViolation(err, 'roles_name_lower_unique')) throw nameTaken();
        throw err;
      }
    },
  );

  // Permission is deliberately not editable: changing it would silently change every
  // holder's access and could break company chains. Create a new role instead.
  app.put(
    '/:id',
    { schema: { params: IdParam, body: RoleUpdate, response: { 200: Role } } },
    async ({ params, body }) => {
      try {
        await db.transaction(async (tx) => {
          const existing = await getRole(tx, params.id);
          if (existing.isActive && !body.isActive) {
            if (existing.isSystem) {
              throw conflict('SYSTEM_ROLE', 'Built-in roles cannot be deactivated');
            }
            if (existing.activeEmployeeCount > 0) {
              throw conflict(
                'ROLE_IN_USE',
                `${existing.activeEmployeeCount} active employee(s) still have this role. Move them to another role first.`,
                { activeEmployeeCount: existing.activeEmployeeCount },
              );
            }
          }
          await checkExclusions(tx, existing.permission, body.excludedRoleIds);
          const breaking = await peopleBreaking(tx, params.id, body.excludedRoleIds);
          if (breaking.length > 0) {
            const names = breaking.map((p) => p.name);
            throw conflict(
              'ROLES_HELD_TOGETHER',
              `${names.join(', ')} already ${names.length === 1 ? 'holds' : 'hold'} this role together with one you want to exclude. Change their roles first.`,
              { employees: names },
            );
          }
          await tx
            .update(roles)
            .set({ name: body.name, isActive: body.isActive, updatedAt: new Date() })
            .where(eq(roles.id, params.id));
          await saveExclusions(tx, params.id, body.excludedRoleIds);
        });
      } catch (err) {
        if (isUniqueViolation(err, 'roles_name_lower_unique')) throw nameTaken();
        throw err;
      }
      return getRole(db, params.id);
    },
  );

  // Only for custom roles nobody holds (D21)
  app.delete('/:id', { schema: { params: IdParam } }, async (request, reply) => {
    await deleteRole(db, request.params.id);
    request.log.info(
      { roleId: request.params.id, actorId: currentUser(request).id },
      'role deleted',
    );
    return reply.code(204).send();
  });
};
