import { Company, CompanyUpsert, IdParam, ListQuery, paginated } from '@docflow/shared';
import { and, asc, count, eq, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { DbOrTx } from '../db/client.js';
import { companies, companyDefaultApprovers } from '../db/schema.js';
import { checkChain, defaultApproversFor } from '../domain/chain.js';
import { conflict, isUniqueViolation, notFound } from '../errors.js';
import { currentUser, requirePermission } from '../plugins/auth.js';
import { deleteCompany } from '../domain/deletion.js';
import type { RouteDeps } from './deps.js';
import { containsPattern, pageOffset, statusCondition } from './query-helpers.js';

const companyColumns = {
  id: companies.id,
  name: companies.name,
  code: companies.code,
  isActive: companies.isActive,
};

async function getCompany(db: DbOrTx, id: string) {
  const [row] = await db.select(companyColumns).from(companies).where(eq(companies.id, id));
  if (!row) throw notFound('Company');
  return { ...row, approvers: (await defaultApproversFor(db, [id])).get(id) ?? [] };
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
  // onRequest, so unauthorised callers are refused before any input validation
  app.addHook('onRequest', requirePermission('ADMIN'));

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
      const approvers = await defaultApproversFor(
        db,
        rows.map((r) => r.id),
      );
      return {
        items: rows.map((r) => ({ ...r, approvers: approvers.get(r.id) ?? [] })),
        total: totals?.total ?? 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    },
  );

  app.get('/:id', { schema: { params: IdParam, response: { 200: Company } } }, async ({ params }) =>
    getCompany(db, params.id),
  );

  app.post(
    '/',
    { schema: { body: CompanyUpsert, response: { 201: Company } } },
    async (request, reply) => {
      const body = request.body;
      const chain = (await checkChain(db, body.approvers)).map(({ employeeId, position }) => ({
        employeeId,
        position,
      }));
      const id = await translateUniqueErrors(() =>
        db.transaction(async (tx) => {
          const [created] = await tx
            .insert(companies)
            .values({ name: body.name, code: body.code, isActive: body.isActive })
            .returning({ id: companies.id });
          await tx
            .insert(companyDefaultApprovers)
            .values(chain.map((a) => ({ ...a, companyId: created!.id })));
          return created!.id;
        }),
      );
      request.log.info({ companyId: id, actorId: currentUser(request).id }, 'company created');
      return reply.code(201).send(await getCompany(db, id));
    },
  );

  app.put(
    '/:id',
    { schema: { params: IdParam, body: CompanyUpsert, response: { 200: Company } } },
    async (request) => {
      const { params, body } = request;
      await getCompany(db, params.id);
      const chain = (await checkChain(db, body.approvers)).map(({ employeeId, position }) => ({
        employeeId,
        position,
      }));
      await translateUniqueErrors(() =>
        db.transaction(async (tx) => {
          await tx
            .update(companies)
            .set({
              name: body.name,
              code: body.code,
              isActive: body.isActive,
              updatedAt: new Date(),
            })
            .where(eq(companies.id, params.id));
          // Replacing the default chain never touches existing workflows: they hold a snapshot (invariant 2)
          await tx
            .delete(companyDefaultApprovers)
            .where(eq(companyDefaultApprovers.companyId, params.id));
          await tx
            .insert(companyDefaultApprovers)
            .values(chain.map((a) => ({ ...a, companyId: params.id })));
        }),
      );
      request.log.info(
        { companyId: params.id, actorId: currentUser(request).id },
        'company updated',
      );
      return getCompany(db, params.id);
    },
  );

  // Only for companies no document was ever submitted for (D21)
  app.delete('/:id', { schema: { params: IdParam } }, async (request, reply) => {
    await deleteCompany(db, request.params.id);
    request.log.info(
      { companyId: request.params.id, actorId: currentUser(request).id },
      'company deleted',
    );
    return reply.code(204).send();
  });
};
