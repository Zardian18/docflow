import {
  Company,
  CompanyUpsert,
  IdParam,
  ListQuery,
  normalizePositions,
  paginated,
  validateChain,
  type CompanyApprover,
} from '@docflow/shared';
import { and, asc, count, eq, inArray, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { z } from 'zod';
import type { DbOrTx } from '../db/client.js';
import { companies, companyDefaultApprovers, employees, roles } from '../db/schema.js';
import { AppError, conflict, isUniqueViolation, notFound } from '../errors.js';
import { currentUser, requirePermission } from '../plugins/auth.js';
import type { RouteDeps } from './deps.js';
import { containsPattern, pageOffset, statusCondition } from './query-helpers.js';

type CompanyInput = z.output<typeof CompanyUpsert>;

async function approversFor(db: DbOrTx, companyIds: string[]) {
  const byCompany = new Map<string, CompanyApprover[]>();
  if (companyIds.length === 0) return byCompany;
  const rows = await db
    .select({
      companyId: companyDefaultApprovers.companyId,
      employeeId: companyDefaultApprovers.employeeId,
      position: companyDefaultApprovers.position,
      name: employees.name,
      isActive: employees.isActive,
    })
    .from(companyDefaultApprovers)
    .innerJoin(employees, eq(employees.id, companyDefaultApprovers.employeeId))
    .where(inArray(companyDefaultApprovers.companyId, companyIds))
    .orderBy(asc(companyDefaultApprovers.position), asc(employees.name));
  for (const { companyId, ...approver } of rows) {
    const list = byCompany.get(companyId) ?? [];
    list.push(approver);
    byCompany.set(companyId, list);
  }
  return byCompany;
}

const companyColumns = {
  id: companies.id,
  name: companies.name,
  code: companies.code,
  isActive: companies.isActive,
};

async function getCompany(db: DbOrTx, id: string) {
  const [row] = await db.select(companyColumns).from(companies).where(eq(companies.id, id));
  if (!row) throw notFound('Company');
  return { ...row, approvers: (await approversFor(db, [id])).get(id) ?? [] };
}

/** Structural rules (shared with the web form) plus eligibility: every approver must be an active APPROVER (D3). */
async function checkChain(db: DbOrTx, input: CompanyInput) {
  const errors = validateChain(input.approvers);
  if (errors.length > 0) {
    throw new AppError(400, 'INVALID_CHAIN', 'The approval chain is not valid', { errors });
  }
  const ids = input.approvers.map((a) => a.employeeId);
  const eligible = await db
    .select({ id: employees.id })
    .from(employees)
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .where(
      and(
        inArray(employees.id, ids),
        eq(employees.isActive, true),
        eq(roles.isActive, true),
        eq(roles.permission, 'APPROVER'),
      ),
    );
  const eligibleIds = new Set(eligible.map((e) => e.id));
  const ineligible = ids.filter((id) => !eligibleIds.has(id));
  if (ineligible.length > 0) {
    throw new AppError(
      400,
      'INELIGIBLE_APPROVER',
      'Only active employees with an Approver role can be in an approval chain',
      { employeeIds: ineligible },
    );
  }
  return normalizePositions(input.approvers);
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
      const approvers = await approversFor(
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
      const chain = await checkChain(db, body);
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
      const chain = await checkChain(db, body);
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
};
