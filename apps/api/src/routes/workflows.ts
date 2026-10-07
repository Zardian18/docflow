import {
  FileLink,
  IdParam,
  paginated,
  WorkflowCreate,
  WorkflowDetail,
  WorkflowSummary,
} from '@docflow/shared';
import { asc, count, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { auditEvents, companies, employees, workflowSteps, workflows } from '../db/schema.js';
import { submitWorkflow } from '../domain/submit.js';
import { notFound } from '../errors.js';
import { currentUser, requirePermission } from '../plugins/auth.js';
import type { AuthUser } from '../auth/sessions.js';
import type { StorageService } from '../storage/storage.js';
import type { RouteDeps } from './deps.js';

const FILE_LINK_SECONDS = 5 * 60;

// Names of everyone whose decision is awaited right now (several for a parallel step)
const currentWith = sql<string[]>`coalesce((
  select array_agg(s."employee_name" order by s."employee_name")
  from "workflow_steps" s
  where s."workflow_id" = "workflows"."id" and s."status" = 'PENDING'
), '{}')`;

const summaryColumns = {
  id: workflows.id,
  fileName: workflows.fileName,
  companyName: companies.name,
  status: workflows.status,
  currentPosition: workflows.currentPosition,
  currentWith,
  submittedAt: workflows.submittedAt,
  updatedAt: workflows.updatedAt,
};

const iso = (d: Date) => d.toISOString();

/**
 * Who may see a workflow (plan.md §4.2). Phase 3: its Creator and Admin. Phase 4 adds
 * approvers/CFO once their step is reached. Anyone else gets 404, not 403, so ids don't leak.
 */
async function visibleWorkflow(db: Db, user: AuthUser, id: string) {
  const [row] = await db
    .select({
      id: workflows.id,
      createdBy: workflows.createdBy,
      fileKey: workflows.fileKey,
      fileName: workflows.fileName,
    })
    .from(workflows)
    .where(eq(workflows.id, id));
  if (!row) throw notFound('Document');
  if (user.permission === 'ADMIN' || row.createdBy === user.id) return row;
  throw notFound('Document');
}

const ListMineQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const workflowRoutes: FastifyPluginAsyncZod<
  RouteDeps & { storage: StorageService }
> = async (app, { db, storage }) => {
  app.post(
    '/',
    {
      onRequest: requirePermission('CREATOR'),
      schema: { body: WorkflowCreate, response: { 201: z.object({ id: z.uuid() }) } },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const id = await submitWorkflow(db, storage, user.id, request.body);
      request.log.info({ workflowId: id, actorId: user.id }, 'workflow submitted');
      return reply.code(201).send({ id });
    },
  );

  app.get(
    '/mine',
    {
      onRequest: requirePermission('CREATOR'),
      schema: { querystring: ListMineQuery, response: { 200: paginated(WorkflowSummary) } },
    },
    async (request) => {
      const user = currentUser(request);
      const { page, pageSize } = request.query;
      const mine = eq(workflows.createdBy, user.id);
      const [rows, [totals]] = await Promise.all([
        db
          .select(summaryColumns)
          .from(workflows)
          .innerJoin(companies, eq(companies.id, workflows.companyId))
          .where(mine)
          .orderBy(desc(workflows.submittedAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db.select({ total: count() }).from(workflows).where(mine),
      ]);
      return {
        items: rows.map((r) => ({
          ...r,
          submittedAt: iso(r.submittedAt),
          updatedAt: iso(r.updatedAt),
        })),
        total: totals?.total ?? 0,
        page,
        pageSize,
      };
    },
  );

  app.get(
    '/:id',
    {
      onRequest: requirePermission('CREATOR', 'ADMIN'),
      schema: { params: IdParam, response: { 200: WorkflowDetail } },
    },
    async (request) => {
      await visibleWorkflow(db, currentUser(request), request.params.id);
      const id = request.params.id;
      const [w] = await db
        .select({
          ...summaryColumns,
          companyId: companies.id,
          companyCode: companies.code,
          createdByName: employees.name,
          fileMime: workflows.fileMime,
          fileSize: workflows.fileSize,
          chainCustomised: workflows.chainCustomised,
          invoiceNumber: workflows.invoiceNumber,
          vendorName: workflows.vendorName,
          invoiceDate: workflows.invoiceDate,
          amount: workflows.amount,
          currency: workflows.currency,
          notes: workflows.notes,
        })
        .from(workflows)
        .innerJoin(companies, eq(companies.id, workflows.companyId))
        .innerJoin(employees, eq(employees.id, workflows.createdBy))
        .where(eq(workflows.id, id));
      const [steps, events] = await Promise.all([
        db
          .select({
            id: workflowSteps.id,
            position: workflowSteps.position,
            employeeId: workflowSteps.employeeId,
            name: workflowSteps.employeeName,
            isCfo: workflowSteps.isCfo,
            status: workflowSteps.status,
            decidedAt: workflowSteps.decidedAt,
            remarks: workflowSteps.remarks,
          })
          .from(workflowSteps)
          .where(eq(workflowSteps.workflowId, id))
          .orderBy(asc(workflowSteps.position), asc(workflowSteps.employeeName)),
        db
          .select({
            id: auditEvents.id,
            type: auditEvents.eventType,
            actorName: employees.name,
            createdAt: auditEvents.createdAt,
          })
          .from(auditEvents)
          .leftJoin(employees, eq(employees.id, auditEvents.actorId))
          .where(eq(auditEvents.workflowId, id))
          .orderBy(asc(auditEvents.createdAt)),
      ]);
      return {
        ...w!,
        submittedAt: iso(w!.submittedAt),
        updatedAt: iso(w!.updatedAt),
        steps: steps.map((s) => ({ ...s, decidedAt: s.decidedAt ? iso(s.decidedAt) : null })),
        events: events.map((e) => ({ ...e, createdAt: iso(e.createdAt) })),
      };
    },
  );

  // A short-lived download link, issued only after the visibility check (plan.md §4.2)
  app.get(
    '/:id/file',
    {
      onRequest: requirePermission('CREATOR', 'ADMIN'),
      schema: { params: IdParam, response: { 200: FileLink } },
    },
    async (request) => {
      const w = await visibleWorkflow(db, currentUser(request), request.params.id);
      const link = await storage.presignGet(w.fileKey, {
        fileName: w.fileName,
        expiresInSeconds: FILE_LINK_SECONDS,
      });
      return { url: link.url, expiresAt: iso(link.expiresAt) };
    },
  );
};
