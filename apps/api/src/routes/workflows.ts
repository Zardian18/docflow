import {
  DecisionRequest,
  DecisionResult,
  FileLink,
  IdParam,
  paginated,
  ReassignRequest,
  WorkflowCreate,
  WorkflowDetail,
  WorkflowSummary,
} from '@docflow/shared';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthUser } from '../auth/sessions.js';
import type { Db } from '../db/client.js';
import { auditEvents, companies, employees, workflowSteps, workflows } from '../db/schema.js';
import { decide } from '../domain/decide.js';
import { summarizeEvent } from '../domain/events.js';
import { reassignStep } from '../domain/reassign.js';
import { submitWorkflow } from '../domain/submit.js';
import { notFound } from '../errors.js';
import { deliver, type EmailProvider } from '../notify/outbox.js';
import { currentUser, requirePermission } from '../plugins/auth.js';
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
 * Who may see a workflow (plan.md §4.2, invariant 1): its Creator; Admin (read-only); and an
 * approver or the CFO only once their step has been reached, or after they decided. Anyone
 * else gets 404, not 403, so document ids reveal nothing.
 */
async function visibleWorkflow(db: Db, user: AuthUser, id: string) {
  const [row] = await db
    .select({
      id: workflows.id,
      createdBy: workflows.createdBy,
      currentPosition: workflows.currentPosition,
      fileKey: workflows.fileKey,
      fileName: workflows.fileName,
      fileMime: workflows.fileMime,
    })
    .from(workflows)
    .where(eq(workflows.id, id));
  if (!row) throw notFound('Document');
  if (user.permission === 'ADMIN' || row.createdBy === user.id) return row;
  if (user.permission === 'APPROVER' || user.permission === 'CFO') {
    const [step] = await db
      .select({ position: workflowSteps.position, decidedAt: workflowSteps.decidedAt })
      .from(workflowSteps)
      .where(and(eq(workflowSteps.workflowId, id), eq(workflowSteps.employeeId, user.id)));
    if (step && (step.position <= row.currentPosition || step.decidedAt)) return row;
  }
  throw notFound('Document');
}

const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const StepParams = z.object({ id: z.uuid(), stepId: z.uuid() });

export const workflowRoutes: FastifyPluginAsyncZod<
  RouteDeps & { storage: StorageService; email: EmailProvider | null }
> = async (app, { db, storage, email }) => {
  app.post(
    '/',
    {
      onRequest: requirePermission('CREATOR'),
      schema: { body: WorkflowCreate, response: { 201: z.object({ id: z.uuid() }) } },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { id, outboxIds } = await submitWorkflow(db, storage, user.id, request.body);
      request.log.info({ workflowId: id, actorId: user.id }, 'workflow submitted');
      await deliver(db, email, outboxIds, request.log);
      return reply.code(201).send({ id });
    },
  );

  app.get(
    '/mine',
    {
      onRequest: requirePermission('CREATOR'),
      schema: { querystring: PageQuery, response: { 200: paginated(WorkflowSummary) } },
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
    { schema: { params: IdParam, response: { 200: WorkflowDetail } } },
    async (request) => {
      const user = currentUser(request);
      const id = request.params.id;
      await visibleWorkflow(db, user, id);
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
            activatedAt: workflowSteps.activatedAt,
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
            payload: auditEvents.payload,
            actorName: employees.name,
            createdAt: auditEvents.createdAt,
          })
          .from(auditEvents)
          .leftJoin(employees, eq(employees.id, auditEvents.actorId))
          .where(eq(auditEvents.workflowId, id))
          .orderBy(asc(auditEvents.createdAt)),
      ]);
      const open = w!.status === 'PENDING_APPROVER' || w!.status === 'PENDING_CFO';
      const mine = steps.find((s) => s.employeeId === user.id);
      return {
        ...w!,
        submittedAt: iso(w!.submittedAt),
        updatedAt: iso(w!.updatedAt),
        totalPositions: new Set(steps.filter((s) => !s.isCfo).map((s) => s.position)).size,
        myStep: mine
          ? {
              stepId: mine.id,
              position: mine.position,
              isCfo: mine.isCfo,
              status: mine.status,
              canAct: open && mine.status === 'PENDING' && mine.position === w!.currentPosition,
            }
          : null,
        steps: steps.map((s) => ({
          ...s,
          activatedAt: s.activatedAt ? iso(s.activatedAt) : null,
          decidedAt: s.decidedAt ? iso(s.decidedAt) : null,
        })),
        events: events.map(({ payload, ...e }) => ({
          ...e,
          summary: summarizeEvent(e.type, payload),
          createdAt: iso(e.createdAt),
        })),
      };
    },
  );

  // A short-lived link, issued only after the visibility check (plan.md §4.2).
  // mode=view opens a PDF in the browser tab; anything else, or mode=download, saves it.
  app.get(
    '/:id/file',
    {
      schema: {
        params: IdParam,
        querystring: z.object({ mode: z.enum(['view', 'download']).default('download') }),
        response: { 200: FileLink },
      },
    },
    async (request) => {
      const w = await visibleWorkflow(db, currentUser(request), request.params.id);
      // Browsers can only display PDFs; a DOCX is always downloaded
      const inline = request.query.mode === 'view' && w.fileMime === 'application/pdf';
      const link = await storage.presignGet(w.fileKey, {
        fileName: w.fileName,
        expiresInSeconds: FILE_LINK_SECONDS,
        disposition: inline ? 'inline' : 'attachment',
        contentType: inline ? 'application/pdf' : undefined,
      });
      return { url: link.url, expiresAt: iso(link.expiresAt) };
    },
  );

  // Approve or reject (plan.md §4.8). Emails are attempted right after the commit, in this
  // same request (invariant 10); the cron tick only retries failures.
  app.post(
    '/:id/decision',
    {
      onRequest: requirePermission('APPROVER', 'CFO'),
      schema: { params: IdParam, body: DecisionRequest, response: { 200: DecisionResult } },
    },
    async (request) => {
      const user = currentUser(request);
      const result = await decide(
        db,
        { id: user.id, name: user.name },
        request.params.id,
        request.body,
      );
      request.log.info(
        {
          workflowId: request.params.id,
          actorId: user.id,
          decision: request.body.decision,
          status: result.status,
        },
        'decision recorded',
      );
      await deliver(db, email, result.outboxIds, request.log);
      return { status: result.status, currentPosition: result.currentPosition };
    },
  );

  // Admin hands an undecided step to someone else (D9). The button arrives with Phase 6.
  app.post(
    '/:id/steps/:stepId/reassign',
    {
      onRequest: requirePermission('ADMIN'),
      schema: { params: StepParams, body: ReassignRequest },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const outboxIds = await reassignStep(
        db,
        user.id,
        request.params.id,
        request.params.stepId,
        request.body,
      );
      request.log.info(
        { workflowId: request.params.id, stepId: request.params.stepId, actorId: user.id },
        'step reassigned',
      );
      await deliver(db, email, outboxIds, request.log);
      return reply.code(204).send();
    },
  );
};
