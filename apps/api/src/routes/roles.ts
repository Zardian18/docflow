import { IdParam, ListQuery, paginated, Role, RoleCreate, RoleUpdate } from '@docflow/shared';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Db } from '../db/client.js';
import { roles } from '../db/schema.js';
import { conflict, isUniqueViolation, notFound } from '../errors.js';
import { requirePermission } from '../plugins/auth.js';
import type { RouteDeps } from './deps.js';
import { containsPattern, pageOffset, statusCondition } from './query-helpers.js';

const activeEmployeeCount = sql<number>`(
  select count(*)::int from "employees" e
  where e."role_id" = "roles"."id" and e."is_active"
)`;

const roleColumns = {
  id: roles.id,
  name: roles.name,
  permission: roles.permission,
  isSystem: roles.isSystem,
  isActive: roles.isActive,
  activeEmployeeCount,
};

async function getRole(db: Db, id: string) {
  const [role] = await db.select(roleColumns).from(roles).where(eq(roles.id, id));
  if (!role) throw notFound('Role');
  return role;
}

const nameTaken = () => conflict('ROLE_NAME_TAKEN', 'A role with this name already exists');

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
      try {
        const [created] = await db
          .insert(roles)
          .values({ name: request.body.name, permission: request.body.permission })
          .returning({ id: roles.id });
        return reply.code(201).send(await getRole(db, created!.id));
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
      const existing = await getRole(db, params.id);
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
      try {
        await db
          .update(roles)
          .set({ name: body.name, isActive: body.isActive, updatedAt: new Date() })
          .where(eq(roles.id, params.id));
      } catch (err) {
        if (isUniqueViolation(err, 'roles_name_lower_unique')) throw nameTaken();
        throw err;
      }
      return getRole(db, params.id);
    },
  );
};
