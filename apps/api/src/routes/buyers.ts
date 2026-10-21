import {
  Buyer,
  BuyerUpsert,
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
import { buyers, buyerSlotGates, buyerSlotPeople, employees } from '../db/schema.js';
import { deleteBuyer } from '../domain/deletion.js';
import { checkSlots } from '../engine/engine.js';
import { conflict, forbidden, isUniqueViolation, notFound } from '../errors.js';
import { currentUser, requireCapability } from '../plugins/auth.js';
import type { RouteDeps } from './deps.js';
import { containsPattern, pageOffset, statusCondition } from './query-helpers.js';

const columns = {
  id: buyers.id,
  name: buyers.name,
  code: buyers.code,
  country: buyers.country,
  address: buyers.address,
  contact: buyers.contact,
  isActive: buyers.isActive,
};

/** Named people and gates for a set of buyers, every slot listed (empty when not set) */
export async function slotsFor(db: DbOrTx, buyerIds: string[]) {
  const result = new Map<string, SlotAssignment[]>();
  if (buyerIds.length === 0) return result;
  const [people, gates] = await Promise.all([
    db
      .select({
        buyerId: buyerSlotPeople.buyerId,
        slot: buyerSlotPeople.slot,
        id: employees.id,
        name: employees.name,
        email: employees.email,
      })
      .from(buyerSlotPeople)
      .innerJoin(employees, eq(employees.id, buyerSlotPeople.employeeId))
      .where(inArray(buyerSlotPeople.buyerId, buyerIds))
      .orderBy(asc(buyerSlotPeople.ordinal)),
    db.select().from(buyerSlotGates).where(inArray(buyerSlotGates.buyerId, buyerIds)),
  ]);
  for (const id of buyerIds) {
    result.set(
      id,
      SLOTS.map((slot) => ({
        slot,
        people: people
          .filter((p) => p.buyerId === id && p.slot === slot)
          .map(({ id: pid, name, email }) => ({ id: pid, name, email })),
        gate: SLOT_INFO[slot].hasGate
          ? (gates.find((g) => g.buyerId === id && g.slot === slot)?.gate ?? 'ALL')
          : null,
      })),
    );
  }
  return result;
}

async function getBuyer(db: DbOrTx, id: string) {
  const [row] = await db.select(columns).from(buyers).where(eq(buyers.id, id));
  if (!row) throw notFound('Buyer');
  return { ...row, slots: (await slotsFor(db, [id])).get(id)! };
}

async function translateUniqueErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isUniqueViolation(err, 'buyers_name_lower_unique')) {
      throw conflict('NAME_TAKEN', 'A buyer with this name already exists');
    }
    if (isUniqueViolation(err, 'buyers_code_unique')) {
      throw conflict('CODE_TAKEN', 'Another buyer already uses this code');
    }
    throw err;
  }
}

/**
 * Buyer Master (Q3). The buyer is the company the order is for, and holds its default chain
 * (D27). Admin and Marketing keep the details up to date; only Admin sets the chain.
 */
export const buyerRoutes: FastifyPluginAsyncZod<RouteDeps> = async (app, { db }) => {
  app.addHook('onRequest', requireCapability('ADMIN', 'MARKETING'));

  app.get(
    '/',
    { schema: { querystring: ListQuery, response: { 200: paginated(Buyer) } } },
    async ({ query }) => {
      const pattern = query.q ? containsPattern(query.q) : undefined;
      const where = and(
        pattern
          ? or(
              sql`lower(${buyers.name}) like ${pattern}`,
              sql`lower(${buyers.code}) like ${pattern}`,
              sql`lower(${buyers.country}) like ${pattern}`,
            )
          : undefined,
        statusCondition(buyers.isActive, query.status),
      );
      const [rows, [totals]] = await Promise.all([
        db
          .select(columns)
          .from(buyers)
          .where(where)
          .orderBy(asc(sql`lower(${buyers.name})`))
          .limit(query.pageSize)
          .offset(pageOffset(query)),
        db.select({ total: count() }).from(buyers).where(where),
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

  app.get('/:id', { schema: { params: IdParam, response: { 200: Buyer } } }, async ({ params }) =>
    getBuyer(db, params.id),
  );

  /**
   * Saving a buyer's named people checks them like an order would, but allows gaps: the
   * people can be chosen later, or by Marketing on the order. Orders already created keep
   * their own copy (D24).
   */
  async function save(id: string | null, body: z.output<typeof BuyerUpsert>) {
    const { slots: slotInput, ...details } = body;
    return translateUniqueErrors(() =>
      db.transaction(async (tx) => {
        let buyerId = id;
        if (buyerId) {
          await tx
            .update(buyers)
            .set({ ...details, updatedAt: new Date() })
            .where(eq(buyers.id, buyerId));
        } else {
          const [created] = await tx.insert(buyers).values(details).returning({ id: buyers.id });
          buyerId = created!.id;
        }
        if (slotInput) {
          const slots = new Map<Slot, string[]>(slotInput.map((s) => [s.slot, s.employeeIds]));
          await checkSlots(tx, slots, false);
          await tx.delete(buyerSlotPeople).where(eq(buyerSlotPeople.buyerId, buyerId));
          await tx.delete(buyerSlotGates).where(eq(buyerSlotGates.buyerId, buyerId));
          const people = slotInput.flatMap((s) =>
            s.employeeIds.map((employeeId, ordinal) => ({
              buyerId: buyerId!,
              slot: s.slot,
              employeeId,
              ordinal,
            })),
          );
          if (people.length > 0) await tx.insert(buyerSlotPeople).values(people);
          const gates = slotInput
            .filter((s) => SLOT_INFO[s.slot].hasGate && s.gate)
            .map((s) => ({ buyerId: buyerId!, slot: s.slot, gate: s.gate as Gate }));
          if (gates.length > 0) await tx.insert(buyerSlotGates).values(gates);
        }
        return buyerId;
      }),
    );
  }

  const chainOnlyForAdmin = (
    user: ReturnType<typeof currentUser>,
    body: z.output<typeof BuyerUpsert>,
  ) => {
    if (body.slots && !user.capabilities.includes('ADMIN')) throw forbidden();
  };

  app.post(
    '/',
    { schema: { body: BuyerUpsert, response: { 201: Buyer } } },
    async (request, reply) => {
      const user = currentUser(request);
      chainOnlyForAdmin(user, request.body);
      const id = await save(null, request.body);
      request.log.info({ buyerId: id, actorId: user.id }, 'buyer created');
      return reply.code(201).send(await getBuyer(db, id));
    },
  );

  app.put(
    '/:id',
    { schema: { params: IdParam, body: BuyerUpsert, response: { 200: Buyer } } },
    async (request) => {
      const user = currentUser(request);
      chainOnlyForAdmin(user, request.body);
      await getBuyer(db, request.params.id);
      await save(request.params.id, request.body);
      request.log.info({ buyerId: request.params.id, actorId: user.id }, 'buyer updated');
      return getBuyer(db, request.params.id);
    },
  );

  // Only for buyers with no orders (D21)
  app.delete('/:id', { schema: { params: IdParam } }, async (request, reply) => {
    await deleteBuyer(db, request.params.id);
    return reply.code(204).send();
  });
};
