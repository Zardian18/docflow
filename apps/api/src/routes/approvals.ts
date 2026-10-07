import { DecisionHistoryItem, paginated, PendingApprovalsResponse } from '@docflow/shared';
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
        },
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
