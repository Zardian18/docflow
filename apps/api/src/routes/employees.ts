import {
  Employee,
  EmployeeCreate,
  EmployeeListQuery,
  EmployeeUpdate,
  IdParam,
  paginated,
  PasswordLink,
  SLOT_INFO,
  type Capability,
  type Team,
} from '@docflow/shared';
import { and, asc, count, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { issuePasswordLink } from '../auth/password-links.js';
import { capabilitiesOf, revokeEmployeeSessions, teamsOf } from '../auth/sessions.js';
import type { DbOrTx, Tx } from '../db/client.js';
import {
  buyers,
  buyerSlotPeople,
  employeeCapabilities,
  employees,
  teamMembers,
} from '../db/schema.js';
import { deleteEmployee } from '../domain/deletion.js';
import { conflict, isUniqueViolation, notFound } from '../errors.js';
import { currentUser, requireCapability } from '../plugins/auth.js';
import type { StorageService } from '../storage/storage.js';
import type { RouteDeps } from './deps.js';
import { containsPattern, pageOffset, statusCondition } from './query-helpers.js';

const employeeColumns = {
  id: employees.id,
  name: employees.name,
  email: employees.email,
  employeeCode: employees.employeeCode,
  teams: teamsOf,
  capabilities: capabilitiesOf,
  isActive: employees.isActive,
  hasPassword: sql<boolean>`${employees.passwordHash} is not null`,
};

async function getEmployee(db: DbOrTx, id: string) {
  const [row] = await db.select(employeeColumns).from(employees).where(eq(employees.id, id));
  if (!row) throw notFound('Employee');
  return row;
}

async function setMemberships(tx: Tx, id: string, teams: Team[], capabilities: Capability[]) {
  await tx.delete(teamMembers).where(eq(teamMembers.employeeId, id));
  await tx.delete(employeeCapabilities).where(eq(employeeCapabilities.employeeId, id));
  const uniqueTeams = [...new Set(teams)];
  const uniqueCaps = [...new Set(capabilities)];
  if (uniqueTeams.length > 0) {
    await tx.insert(teamMembers).values(uniqueTeams.map((team) => ({ employeeId: id, team })));
  }
  if (uniqueCaps.length > 0) {
    await tx
      .insert(employeeCapabilities)
      .values(uniqueCaps.map((capability) => ({ employeeId: id, capability })));
  }
}

async function otherActiveAdmins(tx: Tx, employeeId: string) {
  const [row] = await tx
    .select({ n: count() })
    .from(employees)
    .innerJoin(employeeCapabilities, eq(employeeCapabilities.employeeId, employees.id))
    .where(
      and(
        ne(employees.id, employeeId),
        eq(employees.isActive, true),
        eq(employeeCapabilities.capability, 'ADMIN'),
      ),
    );
  return row?.n ?? 0;
}

/** Buyers that name this person in a slot needing a capability they would lose */
async function slotsBlocking(
  tx: Tx,
  employeeId: string,
  losing: Capability[],
  deactivating: boolean,
) {
  const rows = await tx
    .selectDistinct({ name: buyers.name, slot: buyerSlotPeople.slot })
    .from(buyerSlotPeople)
    .innerJoin(buyers, eq(buyers.id, buyerSlotPeople.buyerId))
    .where(eq(buyerSlotPeople.employeeId, employeeId))
    .orderBy(asc(buyers.name));
  return rows.filter((r) => deactivating || losing.includes(SLOT_INFO[r.slot].capability));
}

/** Maps unique-index violations on employees to friendly 409s. */
async function translateUniqueErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isUniqueViolation(err, 'employees_email_unique')) {
      throw conflict('EMAIL_TAKEN', 'Another employee already uses this email');
    }
    if (isUniqueViolation(err, 'employees_code_unique')) {
      throw conflict('CODE_TAKEN', 'Another employee already uses this employee code');
    }
    throw err;
  }
}

export const employeeRoutes: FastifyPluginAsyncZod<
  RouteDeps & { storage: StorageService }
> = async (app, { db, env, storage }) => {
  app.addHook('onRequest', requireCapability('ADMIN'));

  app.get(
    '/',
    { schema: { querystring: EmployeeListQuery, response: { 200: paginated(Employee) } } },
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
        query.team
          ? inArray(
              employees.id,
              db
                .select({ id: teamMembers.employeeId })
                .from(teamMembers)
                .where(eq(teamMembers.team, query.team)),
            )
          : undefined,
        query.capability
          ? inArray(
              employees.id,
              db
                .select({ id: employeeCapabilities.employeeId })
                .from(employeeCapabilities)
                .where(eq(employeeCapabilities.capability, query.capability)),
            )
          : undefined,
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
      return { items, total: totals?.total ?? 0, page: query.page, pageSize: query.pageSize };
    },
  );

  app.post(
    '/',
    { schema: { body: EmployeeCreate, response: { 201: Employee } } },
    async (request, reply) => {
      const body = request.body;
      const id = await translateUniqueErrors(() =>
        db.transaction(async (tx) => {
          const [created] = await tx
            .insert(employees)
            .values({ name: body.name, email: body.email, employeeCode: body.employeeCode })
            .returning({ id: employees.id });
          await setMemberships(tx, created!.id, body.teams, body.capabilities);
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
      await translateUniqueErrors(() =>
        db.transaction(async (tx) => {
          const existing = await getEmployee(tx, params.id);
          const deactivating = existing.isActive && !body.isActive;
          const losing = existing.capabilities.filter((c) => !body.capabilities.includes(c));
          const losingAdmin = existing.isActive && (deactivating || losing.includes('ADMIN'));
          if (params.id === actor.id && (deactivating || losing.includes('ADMIN'))) {
            throw conflict(
              'CANNOT_CHANGE_SELF',
              'You cannot deactivate yourself or remove your own Admin access',
            );
          }
          if (
            existing.capabilities.includes('ADMIN') &&
            losingAdmin &&
            (await otherActiveAdmins(tx, params.id)) === 0
          ) {
            throw conflict('LAST_ADMIN', 'This is the last active Admin and must stay one');
          }
          // Like D17: nobody silently drops out of a buyer's named people
          const blocking = await slotsBlocking(tx, params.id, losing, deactivating);
          if (blocking.length > 0) {
            const names = [...new Set(blocking.map((b) => b.name))];
            throw conflict(
              'EMPLOYEE_NAMED',
              `${existing.name} is named in ${names.join(', ')}. Change those buyers first.`,
              { buyers: names },
            );
          }
          await tx
            .update(employees)
            .set({
              name: body.name,
              email: body.email,
              employeeCode: body.employeeCode,
              isActive: body.isActive,
              updatedAt: new Date(),
            })
            .where(eq(employees.id, params.id));
          await setMemberships(tx, params.id, body.teams, body.capabilities);
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
