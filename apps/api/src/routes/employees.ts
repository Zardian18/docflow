import {
  CfoInfo,
  Employee,
  EmployeeCreate,
  EmployeeUpdate,
  IdParam,
  ListQuery,
  paginated,
  PasswordLink,
  Permission,
  byPriority,
} from '@docflow/shared';
import { and, asc, count, eq, ne, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { issuePasswordLink } from '../auth/password-links.js';
import { revokeEmployeeSessions } from '../auth/sessions.js';
import type { DbOrTx, Tx } from '../db/client.js';
import { companies, companyDefaultApprovers, employees } from '../db/schema.js';
import { conflict, isUniqueViolation, notFound } from '../errors.js';
import { currentUser, requirePermission } from '../plugins/auth.js';
import { deleteEmployee } from '../domain/deletion.js';
import { checkRoleSet, heldRoles, holdsPermission, setRoles } from '../domain/roles.js';
import type { StorageService } from '../storage/storage.js';
import type { RouteDeps } from './deps.js';
import { containsPattern, pageOffset, statusCondition } from './query-helpers.js';

const employeeColumns = {
  id: employees.id,
  name: employees.name,
  email: employees.email,
  employeeCode: employees.employeeCode,
  roles: heldRoles({ activeOnly: false }),
  isActive: employees.isActive,
  hasPassword: sql<boolean>`${employees.passwordHash} is not null`,
};

const sortRoles = <T extends { roles: Employee['roles'] }>(row: T): T => ({
  ...row,
  roles: byPriority(row.roles),
});

async function getEmployee(db: DbOrTx, id: string) {
  const [row] = await db.select(employeeColumns).from(employees).where(eq(employees.id, id));
  if (!row) throw notFound('Employee');
  return sortRoles(row);
}

/** Companies whose default chain includes the employee (decisions.md D17). */
async function chainCompanies(tx: Tx, employeeId: string) {
  return tx
    .select({ id: companies.id, name: companies.name })
    .from(companyDefaultApprovers)
    .innerJoin(companies, eq(companies.id, companyDefaultApprovers.companyId))
    .where(eq(companyDefaultApprovers.employeeId, employeeId))
    .orderBy(asc(companies.name));
}

async function otherActiveAdmins(tx: Tx, employeeId: string) {
  const [row] = await tx
    .select({ n: count() })
    .from(employees)
    .where(
      and(ne(employees.id, employeeId), eq(employees.isActive, true), holdsPermission('ADMIN')),
    );
  return row?.n ?? 0;
}

/** Maps unique-index violations on employees to friendly 409s. */
async function translateUniqueErrors<T>(db: DbOrTx, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isUniqueViolation(err, 'employees_email_unique')) {
      throw conflict('EMAIL_TAKEN', 'Another employee already uses this email');
    }
    if (isUniqueViolation(err, 'employees_code_unique')) {
      throw conflict('CODE_TAKEN', 'Another employee already uses this employee code');
    }
    if (isUniqueViolation(err, 'employees_one_active_cfo')) {
      const [cfo] = await db
        .select({ name: employees.name })
        .from(employees)
        .where(and(eq(employees.isCfo, true), eq(employees.isActive, true)));
      throw conflict(
        'CFO_EXISTS',
        `${cfo?.name ?? 'Another employee'} is already the active CFO. Deactivate them or change their roles first.`,
      );
    }
    throw err;
  }
}

export const employeeRoutes: FastifyPluginAsyncZod<
  RouteDeps & { storage: StorageService }
> = async (app, { db, env, storage }) => {
  // onRequest, so unauthorised callers are refused before any input validation
  app.addHook('onRequest', requirePermission('ADMIN'));

  app.get(
    '/',
    {
      schema: {
        // permission narrows the list, e.g. Creators for the dashboard's Created By filter
        querystring: ListQuery.extend({ permission: Permission.optional() }),
        response: { 200: paginated(Employee) },
      },
    },
    async ({ query }) => {
      const pattern = query.q ? containsPattern(query.q) : undefined;
      const where = and(
        pattern
          ? or(
              sql`lower(${employees.name}) like ${pattern}`,
              sql`${employees.email} like ${pattern}`,
              sql`lower(${employees.employeeCode}) like ${pattern}`,
            )
          : undefined,
        statusCondition(employees.isActive, query.status),
        query.permission ? holdsPermission(query.permission) : undefined,
      );
      const [items, [totals]] = await Promise.all([
        db
          .select(employeeColumns)
          .from(employees)
          .where(where)
          .orderBy(asc(sql`lower(${employees.name})`))
          .limit(query.pageSize)
          .offset(pageOffset(query)),
        db.select({ total: count() }).from(employees).where(where),
      ]);
      return {
        items: items.map(sortRoles),
        total: totals?.total ?? 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    },
  );

  app.get('/cfo', { schema: { response: { 200: CfoInfo } } }, async () => {
    const [cfo] = await db
      .select({ id: employees.id, name: employees.name, email: employees.email })
      .from(employees)
      .where(and(eq(employees.isCfo, true), eq(employees.isActive, true)));
    return { cfo: cfo ?? null };
  });

  app.post(
    '/',
    { schema: { body: EmployeeCreate, response: { 201: Employee } } },
    async (request, reply) => {
      const body = request.body;
      const id = await translateUniqueErrors(db, () =>
        db.transaction(async (tx) => {
          const held = await checkRoleSet(tx, body.roleIds);
          const [created] = await tx
            .insert(employees)
            .values({
              name: body.name,
              email: body.email,
              employeeCode: body.employeeCode,
              isCfo: held.some((r) => r.permission === 'CFO'),
            })
            .returning({ id: employees.id });
          await setRoles(tx, created!.id, held);
          return created!.id;
        }),
      );
      request.log.info({ employeeId: id, actorId: currentUser(request).id }, 'employee created');
      return reply.code(201).send(await getEmployee(db, id));
    },
  );

  app.put(
    '/:id',
    { schema: { params: IdParam, body: EmployeeUpdate, response: { 200: Employee } } },
    async (request) => {
      const { params, body } = request;
      const actor = currentUser(request);

      await translateUniqueErrors(db, () =>
        db.transaction(async (tx) => {
          const existing = await getEmployee(tx, params.id);
          const before = existing.roles.map((r) => r.permission);
          const held = await checkRoleSet(
            tx,
            body.roleIds,
            existing.roles.map((r) => r.id),
          );
          const after = held.map((r) => r.permission);
          const rolesChanged =
            [...body.roleIds].sort().join() !==
            existing.roles
              .map((r) => r.id)
              .sort()
              .join();
          const deactivating = existing.isActive && !body.isActive;
          const losing = (p: Permission) =>
            before.includes(p) && (deactivating || !after.includes(p));
          const losingAdmin = existing.isActive && losing('ADMIN');

          if (params.id === actor.id && (deactivating || !after.includes('ADMIN'))) {
            throw conflict(
              'CANNOT_CHANGE_SELF',
              'You cannot deactivate yourself or remove your own Admin access',
            );
          }
          if (losingAdmin && (await otherActiveAdmins(tx, params.id)) === 0) {
            throw conflict('LAST_ADMIN', 'This is the last active Admin and must stay one');
          }
          // D17: nobody leaves a company's default chain by losing their Approver role
          if (deactivating || losing('APPROVER')) {
            const blocking = await chainCompanies(tx, params.id);
            if (blocking.length > 0) {
              throw conflict(
                'EMPLOYEE_IN_CHAINS',
                `${existing.name} is a default approver for ${blocking.map((c) => c.name).join(', ')}. Remove them from those approval chains first.`,
                { companies: blocking },
              );
            }
          }

          await tx
            .update(employees)
            .set({
              name: body.name,
              email: body.email,
              employeeCode: body.employeeCode,
              isActive: body.isActive,
              isCfo: after.includes('CFO'),
              updatedAt: new Date(),
            })
            .where(eq(employees.id, params.id));
          if (rolesChanged) await setRoles(tx, params.id, held);
          if (deactivating) await revokeEmployeeSessions(tx, params.id);
        }),
      );
      request.log.info({ employeeId: params.id, actorId: actor.id }, 'employee updated');
      return getEmployee(db, params.id);
    },
  );

  // One-time link the Admin copies to the employee (D16). Never logged.
  app.post(
    '/:id/password-link',
    { schema: { params: IdParam, response: { 200: PasswordLink } } },
    async ({ params }) => {
      const employee = await getEmployee(db, params.id);
      if (!employee.isActive) {
        throw conflict('EMPLOYEE_INACTIVE', 'Reactivate this employee before issuing a link');
      }
      const link = await issuePasswordLink(db, env.WEB_ORIGIN, employee.id, 'SET');
      return { url: link.url, expiresAt: link.expiresAt.toISOString() };
    },
  );

  // Only for employees with no history (D21); everyone else is deactivated
  app.delete('/:id', { schema: { params: IdParam } }, async (request, reply) => {
    const actor = currentUser(request);
    await deleteEmployee(db, storage, actor.id, request.params.id);
    request.log.info({ employeeId: request.params.id, actorId: actor.id }, 'employee deleted');
    return reply.code(204).send();
  });
};
