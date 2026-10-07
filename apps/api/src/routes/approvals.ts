import {
  DecisionHistoryItem,
  paginated,
  PendingApprovalsResponse,
  RejectedBeforeFinalItem,
} from '@docflow/shared';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUser, requirePermission } from '../plugins/auth.js';
import type { RouteDeps } from './deps.js';

const iso = (d: Date | string) => new Date(d).toISOString();

const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Screens 06 and 09 (what is waiting for me) plus the History pages. */
export const approvalRoutes: FastifyPluginAsyncZod<RouteDeps> = async (app, { db }) => {
  app.addHook('onRequest', requirePermission('APPROVER', 'CFO'));

  app.get(
    '/pending',
    { schema: { response: { 200: PendingApprovalsResponse } } },
    async (request) => {
      const user = currentUser(request);
      const period: 'week' | 'month' = user.permission === 'CFO' ? 'month' : 'week';

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
       where s.employee_id = ${user.id}
         and s.status = 'PENDING'
         and w.status in ('PENDING_APPROVER', 'PENDING_CFO')
       order by waiting_since asc
    `);

      const { rows: counts } = await db.execute<{ approved: number; rejected: number }>(sql`
      select count(*) filter (where status = 'APPROVED')::int as approved,
             count(*) filter (where status = 'REJECTED')::int as rejected
        from workflow_steps
       where employee_id = ${user.id}
         and decided_at >= date_trunc(${period}, now())
    `);

      // CFO only: rejected before reaching me (my final step was skipped)
      const { rows: early } =
        user.permission === 'CFO'
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
        stats: {
          awaiting: rows.length,
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
      schema: { querystring: PageQuery, response: { 200: paginated(RejectedBeforeFinalItem) } },
    },
    async (request) => {
      const user = currentUser(request);
      const { page, pageSize } = request.query;
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
          from workflow_steps mine
          join workflows w on w.id = mine.workflow_id
          join companies c on c.id = w.company_id
          join workflow_steps r on r.workflow_id = w.id and r.status = 'REJECTED'
         where mine.employee_id = ${user.id} and mine.is_cfo and mine.status = 'SKIPPED'
         order by r.decided_at desc
         limit ${pageSize} offset ${(page - 1) * pageSize}
      `);
      const { rows: totals } = await db.execute<{ n: number }>(sql`
        select count(*)::int as n from workflow_steps
         where employee_id = ${user.id} and is_cfo and status = 'SKIPPED'
      `);
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
      };
    },
  );

  app.get(
    '/history',
    { schema: { querystring: PageQuery, response: { 200: paginated(DecisionHistoryItem) } } },
    async (request) => {
      const user = currentUser(request);
      const { page, pageSize } = request.query;
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
          from workflow_steps s
          join workflows w on w.id = s.workflow_id
          join companies c on c.id = w.company_id
         where s.employee_id = ${user.id} and s.status in ('APPROVED', 'REJECTED')
         order by s.decided_at desc
         limit ${pageSize} offset ${(page - 1) * pageSize}
      `);
      const { rows: totals } = await db.execute<{ n: number }>(sql`
        select count(*)::int as n from workflow_steps
         where employee_id = ${user.id} and status in ('APPROVED', 'REJECTED')
      `);
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
      };
    },
  );
};
