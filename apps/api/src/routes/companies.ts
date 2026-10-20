import {
  Company,
  CompanyUpsert,
  IdParam,
  ListQuery,
  paginated,
  SLOT_INFO,
  SLOTS,
  type Gate,
  type Slot,
  type SlotAssignment,
} from '@docflow/shared';
import { and, asc, count, eq, inArray, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { z } from 'zod';
import type { DbOrTx } from '../db/client.js';
import { companies, companySlotGates, companySlotPeople, employees } from '../db/schema.js';
import { deleteCompany } from '../domain/deletion.js';
import { checkSlots } from '../engine/engine.js';
import { conflict, isUniqueViolation, notFound } from '../errors.js';
import { currentUser, requireCapability } from '../plugins/auth.js';
import type { RouteDeps } from './deps.js';
import { containsPattern, pageOffset, statusCondition } from './query-helpers.js';

const companyColumns = {
  id: companies.id,
  name: companies.name,
  code: companies.code,
  isActive: companies.isActive,
};

/** Named people and gates for a set of companies, every slot listed (empty when not set) */
export async function slotsFor(db: DbOrTx, companyIds: string[]) {
  const result = new Map<string, SlotAssignment[]>();
  if (companyIds.length === 0) return result;
  const [people, gates] = await Promise.all([
    db
      .select({
        companyId: companySlotPeople.companyId,
        slot: companySlotPeople.slot,
        id: employees.id,
        name: employees.name,
        email: employees.email,
      })
      .from(companySlotPeople)
      .innerJoin(employees, eq(employees.id, companySlotPeople.employeeId))
      .where(inArray(companySlotPeople.companyId, companyIds))
      .orderBy(asc(companySlotPeople.ordinal)),
    db.select().from(companySlotGates).where(inArray(companySlotGates.companyId, companyIds)),
  ]);
  for (const id of companyIds) {
    result.set(
      id,
      SLOTS.map((slot) => ({
        slot,
        people: people
          .filter((p) => p.companyId === id && p.slot === slot)
          .map(({ id: pid, name, email }) => ({ id: pid, name, email })),
        gate: SLOT_INFO[slot].hasGate
          ? (gates.find((g) => g.companyId === id && g.slot === slot)?.gate ?? 'ALL')
          : null,
      })),
    );
  }
  return result;
}

async function getCompany(db: DbOrTx, id: string) {
  const [row] = await db.select(companyColumns).from(companies).where(eq(companies.id, id));
  if (!row) throw notFound('Company');
  return { ...row, slots: (await slotsFor(db, [id])).get(id)! };
}

async function translateUniqueErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isUniqueViolation(err, 'companies_name_lower_unique')) {
      throw conflict('NAME_TAKEN', 'A company with this name already exists');
    }
    if (isUniqueViolation(err, 'companies_code_unique')) {
      throw conflict('CODE_TAKEN', 'Another company already uses this code');
    }
    throw err;
  }
}

export const companyRoutes: FastifyPluginAsyncZod<RouteDeps> = async (app, { db }) => {
  app.addHook('onRequest', requireCapability('ADMIN'));

  app.get(
    '/',
    { schema: { querystring: ListQuery, response: { 200: paginated(Company) } } },
    async ({ query }) => {
      const pattern = query.q ? containsPattern(query.q) : undefined;
      const where = and(
        pattern
          ? or(
              sql`lower(${companies.name}) like ${pattern}`,
              sql`lower(${companies.code}) like ${pattern}`,
            )
          : undefined,
        statusCondition(companies.isActive, query.status),
      );
      const [rows, [totals]] = await Promise.all([
        db
          .select(companyColumns)
          .from(companies)
          .where(where)
          .orderBy(asc(sql`lower(${companies.name})`))
          .limit(query.pageSize)
          .offset(pageOffset(query)),
        db.select({ total: count() }).from(companies).where(where),
      ]);
      const slots = await slotsFor(
        db,
        rows.map((r) => r.id),
      );
      return {
        items: rows.map((r) => ({ ...r, slots: slots.get(r.id)! })),
        total: totals?.total ?? 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    },
  );

  app.get('/:id', { schema: { params: IdParam, response: { 200: Company } } }, async ({ params }) =>
    getCompany(db, params.id),
  );

  /**
   * Saving a company's named people checks them like an order would (Q6), but allows gaps:
   * the people can be chosen later, and an order can't be created until they are.
   * Orders already created keep their own copy (D24).
   */
  async function save(id: string | null, body: z.output<typeof CompanyUpsert>) {
    return translateUniqueErrors(() =>
      db.transaction(async (tx) => {
        const slots = new Map<Slot, string[]>(body.slots.map((s) => [s.slot, s.employeeIds]));
        await checkSlots(tx, slots, false);
        let companyId = id;
        if (companyId) {
          await tx
            .update(companies)
            .set({
              name: body.name,
              code: body.code,
              isActive: body.isActive,
              updatedAt: new Date(),
            })
            .where(eq(companies.id, companyId));
        } else {
          const [created] = await tx
            .insert(companies)
            .values({ name: body.name, code: body.code, isActive: body.isActive })
            .returning({ id: companies.id });
          companyId = created!.id;
        }
        await tx.delete(companySlotPeople).where(eq(companySlotPeople.companyId, companyId));
        await tx.delete(companySlotGates).where(eq(companySlotGates.companyId, companyId));
        const people = body.slots.flatMap((s) =>
          s.employeeIds.map((employeeId, ordinal) => ({
            companyId: companyId!,
            slot: s.slot,
            employeeId,
            ordinal,
          })),
        );
        if (people.length > 0) await tx.insert(companySlotPeople).values(people);
        const gates = body.slots
          .filter((s) => SLOT_INFO[s.slot].hasGate && s.gate)
          .map((s) => ({ companyId: companyId!, slot: s.slot, gate: s.gate as Gate }));
        if (gates.length > 0) await tx.insert(companySlotGates).values(gates);
        return companyId;
      }),
    );
  }

  app.post(
    '/',
    { schema: { body: CompanyUpsert, response: { 201: Company } } },
    async (request, reply) => {
      const id = await save(null, request.body);
      request.log.info({ companyId: id, actorId: currentUser(request).id }, 'company created');
      return reply.code(201).send(await getCompany(db, id));
    },
  );

  app.put(
    '/:id',
    { schema: { params: IdParam, body: CompanyUpsert, response: { 200: Company } } },
    async (request) => {
      await getCompany(db, request.params.id);
      await save(request.params.id, request.body);
      request.log.info(
        { companyId: request.params.id, actorId: currentUser(request).id },
        'company updated',
      );
      return getCompany(db, request.params.id);
    },
  );

  // Only for companies with no orders (D21)
  app.delete('/:id', { schema: { params: IdParam } }, async (request, reply) => {
    await deleteCompany(db, request.params.id);
    request.log.info(
      { companyId: request.params.id, actorId: currentUser(request).id },
      'company deleted',
    );
    return reply.code(204).send();
  });
};
