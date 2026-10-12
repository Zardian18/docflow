import {
  DecisionHistoryItem,
  DecisionHistoryQuery,
  filteredPage,
  PendingApprovalsResponse,
  PendingQuery,
  RejectedBeforeFinalItem,
  RejectedBeforeFinalQuery,
  type CompanyFacet,
  type HistorySort,
  type PendingSort,
  type RejectedSort,
} from '@docflow/shared';
import { sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { currentUser, requirePermission } from '../plugins/auth.js';
import type { RouteDeps } from './deps.js';
import { containsPattern } from './query-helpers.js';

const iso = (d: Date | string) => new Date(d).toISOString();

// Filters for the raw queries below, where `w` is the workflow and `c` its company
const optional = (condition: SQL | false) => (condition === false ? sql`` : sql` and ${condition}`);
const companyIs = (companyId: string | undefined) =>
  optional(companyId !== undefined && sql`w.company_id = ${companyId}`);
/** File name, invoice number or vendor, like the Admin Dashboard search */
function searchFor(q: string | undefined) {
  if (!q) return sql``;
  const p = containsPattern(q);
  return sql` and (lower(w.file_name) like ${p} or lower(w.invoice_number) like ${p}
                   or lower(w.vendor_name) like ${p})`;
}
const direction = (dir: 'asc' | 'desc') => sql.raw(dir === 'asc' ? 'asc' : 'desc');

const PENDING_SORT: Record<PendingSort, SQL> = {
  waiting: sql`coalesce(s.activated_at, w.submitted_at)`,
  document: sql`lower(w.file_name)`,
  company: sql`lower(c.name)`,
};
const HISTORY_SORT: Record<HistorySort, SQL> = {
  decided: sql`s.decided_at`,
  document: sql`lower(w.file_name)`,
  company: sql`lower(c.name)`,
  status: sql`w.status`,
};
const REJECTED_SORT: Record<RejectedSort, SQL> = {
  rejected: sql`r.decided_at`,
  document: sql`lower(w.file_name)`,
  company: sql`lower(c.name)`,
};

/** Screens 06 and 09 (what is waiting for me) plus the History pages. */
export const approvalRoutes: FastifyPluginAsyncZod<RouteDeps> = async (app, { db }) => {
  app.addHook('onRequest', requirePermission('APPROVER', 'CFO'));

  app.get(
    '/pending',
    { schema: { querystring: PendingQuery, response: { 200: PendingApprovalsResponse } } },
    async (request) => {
      const user = currentUser(request);
      const query = request.query;
      const waitingForMe = sql`s.employee_id = ${user.id} and s.status = 'PENDING'
         and w.status in ('PENDING_APPROVER', 'PENDING_CFO')`;
      const period: 'week' | 'month' = user.permissions.includes('CFO') ? 'month' : 'week';

      const { rows } = await db.execute<{
        workflow_id: string;
        file_name: string;
        company_name: string;
        position: number;
        is_cfo: boolean;
        waiting_since: Date;
        total_positions: number;
        cleared_by: string[] | null;
      }>(sql`
      select s.workflow_id, w.file_name, c.name as company_name, s.position, s.is_cfo,
             coalesce(s.activated_at, w.submitted_at) as waiting_since,
             (select count(distinct x.position)::int from workflow_steps x
               where x.workflow_id = w.id and not x.is_cfo) as total_positions,
             -- One entry per step, parallel approvers joined: ['A. Nair & R. Shah', 'P. Kulkarni']
             (select array_agg(g.names order by g.position)
                from (select x.position,
                             string_agg(x.employee_name, ' & ' order by x.employee_name) as names
                        from workflow_steps x
                       where x.workflow_id = w.id and x.status = 'APPROVED'
                       group by x.position) g) as cleared_by
        from workflow_steps s
        join workflows w on w.id = s.workflow_id
        join companies c on c.id = w.company_id
       where ${waitingForMe}${companyIs(query.companyId)}${searchFor(query.q)}
       order by ${PENDING_SORT[query.sort]} ${direction(query.dir)}, w.id
    `);
      // The cards and the Company filter cover everything waiting, whatever is filtered
      const { rows: everything } = await db.execute<CompanyFacet & { n: number }>(sql`
      select c.id, c.name, count(*)::int as n
        from workflow_steps s
        join workflows w on w.id = s.workflow_id
        join companies c on c.id = w.company_id
       where ${waitingForMe}
       group by c.id, c.name order by c.name
    `);

      const { rows: counts } = await db.execute<{ approved: number; rejected: number }>(sql`
      select count(*) filter (where status = 'APPROVED')::int as approved,
             count(*) filter (where status = 'REJECTED')::int as rejected
        from workflow_steps
       where employee_id = ${user.id}
         and decided_at >= date_trunc(${period}, now())
    `);

      // CFO only: rejected before reaching me (my final step was skipped)
      const { rows: early } = user.permissions.includes('CFO')
        ? await db.execute<{ n: number }>(sql`
              select count(*)::int as n from workflow_steps
               where employee_id = ${user.id} and is_cfo and status = 'SKIPPED'
            `)
        : { rows: [{ n: 0 }] };

      return {
        items: rows.map((r) => ({
          workflowId: r.workflow_id,
          fileName: r.file_name,
          companyName: r.company_name,
          position: r.position,
          totalPositions: Math.max(1, r.total_positions),
          isCfo: r.is_cfo,
          waitingSince: iso(r.waiting_since),
          clearedBy: r.cleared_by ?? [],
        })),
        companies: everything.map(({ id, name }) => ({ id, name })),
        stats: {
          awaiting: everything.reduce((sum, c) => sum + c.n, 0),
          approved: counts[0]?.approved ?? 0,
          rejected: counts[0]?.rejected ?? 0,
          period,
          rejectedBeforeFinal: early[0]?.n ?? 0,
        },
      };
    },
  );

  // CFO dashboard tab (D22): documents an approver rejected before they reached the CFO.
  // The CFO is notified of every rejection, so they can also see each one, read-only.
  app.get(
    '/rejected-before-final',
    {
      onRequest: requirePermission('CFO'),
      schema: {
        querystring: RejectedBeforeFinalQuery,
        response: { 200: filteredPage(RejectedBeforeFinalItem) },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const { page, pageSize, ...query } = request.query;
      const from = sql`
          from workflow_steps mine
          join workflows w on w.id = mine.workflow_id
          join companies c on c.id = w.company_id
          join workflow_steps r on r.workflow_id = w.id and r.status = 'REJECTED'
         where mine.employee_id = ${user.id} and mine.is_cfo and mine.status = 'SKIPPED'`;
      const filters = sql`${companyIs(query.companyId)}${searchFor(query.q)}`;
      const { rows } = await db.execute<{
        workflow_id: string;
        file_name: string;
        company_name: string;
        rejected_by: string;
        position: number;
        reason: string | null;
        rejected_at: Date;
      }>(sql`
        select w.id as workflow_id, w.file_name, c.name as company_name,
               r.employee_name as rejected_by, r.position, r.remarks as reason,
               r.decided_at as rejected_at
        ${from}${filters}
         order by ${REJECTED_SORT[query.sort]} ${direction(query.dir)}, w.id
         limit ${pageSize} offset ${(page - 1) * pageSize}
      `);
      const { rows: totals } = await db.execute<{ n: number }>(
        sql`select count(*)::int as n ${from}${filters}`,
      );
      const { rows: facets } = await db.execute<CompanyFacet>(
        sql`select distinct c.id, c.name ${from} order by c.name`,
      );
      return {
        items: rows.map((r) => ({
          workflowId: r.workflow_id,
          fileName: r.file_name,
          companyName: r.company_name,
          rejectedBy: r.rejected_by,
          position: r.position,
          reason: r.reason,
          rejectedAt: iso(r.rejected_at),
        })),
        total: totals[0]?.n ?? 0,
        page,
        pageSize,
        companies: facets,
      };
    },
  );

  app.get(
    '/history',
    {
      schema: {
        querystring: DecisionHistoryQuery,
        response: { 200: filteredPage(DecisionHistoryItem) },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const { page, pageSize, ...query } = request.query;
      const from = sql`
          from workflow_steps s
          join workflows w on w.id = s.workflow_id
          join companies c on c.id = w.company_id
         where s.employee_id = ${user.id} and s.status in ('APPROVED', 'REJECTED')`;
      const decidedFrom = query.decidedFrom ? new Date(query.decidedFrom) : undefined;
      const decidedTo = query.decidedTo ? new Date(query.decidedTo) : undefined;
      const filters = sql.join([
        optional(query.decision !== undefined && sql`s.status = ${query.decision}`),
        optional(query.status !== undefined && sql`w.status = ${query.status}`),
        companyIs(query.companyId),
        optional(decidedFrom !== undefined && sql`s.decided_at >= ${decidedFrom}`),
        optional(decidedTo !== undefined && sql`s.decided_at <= ${decidedTo}`),
        searchFor(query.q),
      ]);
      const { rows } = await db.execute<{
        workflow_id: string;
        file_name: string;
        company_name: string;
        my_decision: 'APPROVED' | 'REJECTED';
        decided_at: Date;
        status: DecisionHistoryItem['status'];
        current_position: number;
      }>(sql`
        select s.workflow_id, w.file_name, c.name as company_name, s.status as my_decision,
               s.decided_at, w.status, w.current_position
        ${from}${filters}
         order by ${HISTORY_SORT[query.sort]} ${direction(query.dir)}, s.id
         limit ${pageSize} offset ${(page - 1) * pageSize}
      `);
      const { rows: totals } = await db.execute<{ n: number }>(
        sql`select count(*)::int as n ${from}${filters}`,
      );
      const { rows: facets } = await db.execute<CompanyFacet>(
        sql`select distinct c.id, c.name ${from} order by c.name`,
      );
      return {
        items: rows.map((r) => ({
          workflowId: r.workflow_id,
          fileName: r.file_name,
          companyName: r.company_name,
          myDecision: r.my_decision,
          decidedAt: iso(r.decided_at),
          status: r.status,
          currentPosition: r.current_position,
        })),
        total: totals[0]?.n ?? 0,
        page,
        pageSize,
        companies: facets,
      };
    },
  );
};
