import { Buyer, BuyerUpsert, IdParam, ListQuery, paginated } from '@docflow/shared';
import { and, asc, count, eq, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { buyers } from '../db/schema.js';
import { deleteBuyer } from '../domain/deletion.js';
import { conflict, isUniqueViolation, notFound } from '../errors.js';
import { currentUser, requireCapability } from '../plugins/auth.js';
import type { RouteDeps } from './deps.js';
import { containsPattern, pageOffset, statusCondition } from './query-helpers.js';

const columns = {
  id: buyers.id,
  name: buyers.name,
  country: buyers.country,
  address: buyers.address,
  contact: buyers.contact,
  isActive: buyers.isActive,
};

async function translateUniqueErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isUniqueViolation(err, 'buyers_name_lower_unique')) {
      throw conflict('NAME_TAKEN', 'A buyer with this name already exists');
    }
    throw err;
  }
}

/** Buyer Master (Q3): Admin and Marketing keep it up to date. */
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
              sql`lower(${buyers.country}) like ${pattern}`,
            )
          : undefined,
        statusCondition(buyers.isActive, query.status),
      );
      const [items, [totals]] = await Promise.all([
        db
          .select(columns)
          .from(buyers)
          .where(where)
          .orderBy(asc(sql`lower(${buyers.name})`))
          .limit(query.pageSize)
          .offset(pageOffset(query)),
        db.select({ total: count() }).from(buyers).where(where),
      ]);
      return { items, total: totals?.total ?? 0, page: query.page, pageSize: query.pageSize };
    },
  );

  app.post(
    '/',
    { schema: { body: BuyerUpsert, response: { 201: Buyer } } },
    async (request, reply) => {
      const [row] = await translateUniqueErrors(() =>
        db.insert(buyers).values(request.body).returning(columns),
      );
      request.log.info({ buyerId: row!.id, actorId: currentUser(request).id }, 'buyer created');
      return reply.code(201).send(row!);
    },
  );

  app.put(
    '/:id',
    { schema: { params: IdParam, body: BuyerUpsert, response: { 200: Buyer } } },
    async (request) => {
      const [row] = await translateUniqueErrors(() =>
        db
          .update(buyers)
          .set({ ...request.body, updatedAt: new Date() })
          .where(eq(buyers.id, request.params.id))
          .returning(columns),
      );
      if (!row) throw notFound('Buyer');
      return row;
    },
  );

  app.delete('/:id', { schema: { params: IdParam } }, async (request, reply) => {
    await deleteBuyer(db, request.params.id);
    return reply.code(204).send();
  });
};
