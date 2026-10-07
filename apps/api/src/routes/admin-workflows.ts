import {
  AdminStats,
  AdminWorkflowQuery,
  AdminWorkflowRow,
  paginated,
  type AdminSort,
} from '@docflow/shared';
import { and, asc, count, desc, eq, gte, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { z } from 'zod';
import { companies, employees, workflows } from '../db/schema.js';
import { requirePermission } from '../plugins/auth.js';
import type { RouteDeps } from './deps.js';
import { containsPattern } from './query-helpers.js';

type Query = z.output<typeof AdminWorkflowQuery>;

// Names of everyone whose decision is awaited right now (several for a parallel step)
const currentWith = sql<string[]>`coalesce((
  select array_agg(s."employee_name" order by s."employee_name")
  from "workflow_steps" s
  where s."workflow_id" = "workflows"."id" and s."status" = 'PENDING'
), '{}')`;

const SORT_COLUMN: Record<AdminSort, SQL> = {
  submitted: sql`${workflows.submittedAt}`,
  updated: sql`${workflows.updatedAt}`,
  document: sql`lower(${workflows.fileName})`,
  company: sql`lower(${companies.name})`,
  status: sql`${workflows.status}`,
};

/** Every filter from URS §5.8, combinable. */
function whereFor(q: Query) {
  const pattern = q.q ? containsPattern(q.q) : undefined;
  return and(
    q.status ? eq(workflows.status, q.status) : undefined,
    q.position !== undefined ? eq(workflows.currentPosition, q.position) : undefined,
    q.companyId ? eq(workflows.companyId, q.companyId) : undefined,
    q.createdBy ? eq(workflows.createdBy, q.createdBy) : undefined,
    q.submittedFrom ? gte(workflows.submittedAt, new Date(q.submittedFrom)) : undefined,
    q.submittedTo ? lte(workflows.submittedAt, new Date(q.submittedTo)) : undefined,
    pattern
      ? or(
          sql`lower(${workflows.fileName}) like ${pattern}`,
          sql`lower(${workflows.invoiceNumber}) like ${pattern}`,
          sql`lower(${workflows.vendorName}) like ${pattern}`,
        )
      : undefined,
  );
}

/** Admin Dashboard (screen 02): read-only view across every document. */
export const adminWorkflowRoutes: FastifyPluginAsyncZod<RouteDeps> = async (app, { db }) => {
  app.addHook('onRequest', requirePermission('ADMIN'));

  app.get(
    '/',
    { schema: { querystring: AdminWorkflowQuery, response: { 200: paginated(AdminWorkflowRow) } } },
    async ({ query }) => {
      const where = whereFor(query);
      const order = query.dir === 'asc' ? asc : desc;
      const [rows, [totals]] = await Promise.all([
        db
          .select({
            id: workflows.id,
            fileName: workflows.fileName,
            companyName: companies.name,
            createdByName: employees.name,
            status: workflows.status,
            currentPosition: workflows.currentPosition,
            currentWith,
            submittedAt: workflows.submittedAt,
            updatedAt: workflows.updatedAt,
            invoiceNumber: workflows.invoiceNumber,
            amount: workflows.amount,
            currency: workflows.currency,
          })
          .from(workflows)
          .innerJoin(companies, eq(companies.id, workflows.companyId))
          .innerJoin(employees, eq(employees.id, workflows.createdBy))
          .where(where)
          // id breaks ties so pages never overlap or skip rows
          .orderBy(order(SORT_COLUMN[query.sort]), order(workflows.id))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        db
          .select({ total: count() })
          .from(workflows)
          .innerJoin(companies, eq(companies.id, workflows.companyId))
          .where(where),
      ]);
      return {
        items: rows.map((r) => ({
          ...r,
          submittedAt: r.submittedAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
        total: totals?.total ?? 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    },
  );

  app.get('/stats', { schema: { response: { 200: AdminStats } } }, async () => {
    const [row] = await db
      .select({
        total: count(),
        pendingApprover: sql<number>`count(*) filter (where ${workflows.status} = 'PENDING_APPROVER')::int`,
        pendingCfo: sql<number>`count(*) filter (where ${workflows.status} = 'PENDING_CFO')::int`,
        completed: sql<number>`count(*) filter (where ${workflows.status} = 'COMPLETED')::int`,
        rejected: sql<number>`count(*) filter (where ${workflows.status} = 'REJECTED')::int`,
      })
      .from(workflows);
    return row ?? { total: 0, pendingApprover: 0, pendingCfo: 0, completed: 0, rejected: 0 };
  });
};
