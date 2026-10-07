import {
  DecisionRequest,
  NOTIFY_ON,
  type DecisionResult,
  type WorkflowStatus,
} from '@docflow/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, Tx } from '../db/client.js';
import { auditEvents, companies, employees, workflowSteps, workflows } from '../db/schema.js';
import { conflict, notFound } from '../errors.js';
import { enqueue, type OutboxMessage } from '../notify/outbox.js';

type Decision = z.output<typeof DecisionRequest>;
type Step = typeof workflowSteps.$inferSelect;

/** Shared payload for every email about a workflow (links only, never the file: invariant 8). */
async function messageContext(tx: Tx, workflowId: string) {
  const [row] = await tx
    .select({
      fileName: workflows.fileName,
      companyName: companies.name,
      creatorId: employees.id,
      creatorName: employees.name,
      creatorEmail: employees.email,
    })
    .from(workflows)
    .innerJoin(companies, eq(companies.id, workflows.companyId))
    .innerJoin(employees, eq(employees.id, workflows.createdBy))
    .where(eq(workflows.id, workflowId));
  return row!;
}

/** "Your turn" messages for everyone now pending at one position (one person or a parallel step). */
export function yourTurnMessages(
  workflowId: string,
  position: number,
  pending: Pick<Step, 'employeeId' | 'employeeEmail' | 'isCfo'>[],
  context: { fileName: string; companyName: string },
): OutboxMessage[] {
  return pending.map((s) => ({
    workflowId,
    recipientId: s.employeeId,
    toEmail: s.employeeEmail,
    template: 'your-turn' as const,
    payload: { ...context, workflowId, position, isCfo: s.isCfo },
    dedupeKey: `wf:${workflowId}:pos:${position}:your-turn:${s.employeeId}`,
  }));
}

export async function yourTurnForPosition(
  tx: Tx,
  workflowId: string,
  position: number,
  rows: Step[],
) {
  const ctx = await messageContext(tx, workflowId);
  return enqueue(
    tx,
    yourTurnMessages(workflowId, position, rows, {
      fileName: ctx.fileName,
      companyName: ctx.companyName,
    }),
  );
}

/** Completion/rejection messages to the people D2 names (Creator and CFO). */
async function outcomeMessages(
  tx: Tx,
  workflowId: string,
  template: 'completed' | 'rejected',
  steps: Step[],
  extra: Record<string, unknown>,
): Promise<OutboxMessage[]> {
  const ctx = await messageContext(tx, workflowId);
  const cfo = steps.find((s) => s.isCfo)!;
  const people = {
    creator: { id: ctx.creatorId, email: ctx.creatorEmail },
    cfo: { id: cfo.employeeId, email: cfo.employeeEmail },
  };
  const seen = new Set<string>();
  return NOTIFY_ON[template]
    .map((who) => people[who])
    .filter((p) => !seen.has(p.id) && seen.add(p.id))
    .map((p) => ({
      workflowId,
      recipientId: p.id,
      toEmail: p.email,
      template,
      payload: { fileName: ctx.fileName, companyName: ctx.companyName, workflowId, ...extra },
      dedupeKey: `wf:${workflowId}:${template}:${p.id}`,
    }));
}

/**
 * Records one approver's decision (plan.md §4.8). Everything happens in one transaction
 * that first locks the workflow row, so concurrent decisions on the same document, including
 * two members of one parallel step clicking at the same instant, are applied one after the
 * other and the workflow advances exactly once. Returns the new state and the outbox rows
 * to deliver after commit.
 */
export async function decide(
  db: Db,
  actor: { id: string; name: string },
  workflowId: string,
  input: Decision,
): Promise<DecisionResult & { outboxIds: string[] }> {
  return db.transaction(async (tx) => {
    const [wf] = await tx
      .select({
        id: workflows.id,
        status: workflows.status,
        currentPosition: workflows.currentPosition,
      })
      .from(workflows)
      .where(eq(workflows.id, workflowId))
      .for('update');
    if (!wf) throw notFound('Document');

    const steps = await tx
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowId, workflowId));
    const mine = steps.find((s) => s.employeeId === actor.id);
    // Not in this chain, or their step isn't reached yet: the document doesn't exist for them
    if (!mine || (mine.position > wf.currentPosition && !mine.decidedAt))
      throw notFound('Document');

    const open = wf.status === 'PENDING_APPROVER' || wf.status === 'PENDING_CFO';
    if (!open || mine.status !== 'PENDING' || mine.position !== wf.currentPosition) {
      throw conflict(
        mine.decidedAt ? 'ALREADY_DECIDED' : 'NOT_PENDING',
        mine.decidedAt
          ? 'You have already recorded your decision on this document.'
          : 'This document is no longer waiting for your decision.',
        { status: wf.status, currentPosition: wf.currentPosition },
      );
    }

    const now = new Date();
    const outboxIds: string[] = [];
    let status: WorkflowStatus = wf.status;
    let currentPosition = wf.currentPosition;

    if (input.decision === 'REJECT') {
      // Invariant 5: any rejection ends the whole workflow and skips every open step
      await tx
        .update(workflowSteps)
        .set({ status: 'REJECTED', decidedAt: now, remarks: input.remarks })
        .where(eq(workflowSteps.id, mine.id));
      const open = steps.filter(
        (s) => s.id !== mine.id && (s.status === 'PENDING' || s.status === 'WAITING'),
      );
      if (open.length > 0) {
        await tx
          .update(workflowSteps)
          .set({ status: 'SKIPPED' })
          .where(
            inArray(
              workflowSteps.id,
              open.map((s) => s.id),
            ),
          );
      }
      status = 'REJECTED';
      await tx.insert(auditEvents).values({
        workflowId,
        actorId: actor.id,
        eventType: 'REJECTED',
        payload: { position: mine.position, isCfo: mine.isCfo, remarks: input.remarks },
      });
      outboxIds.push(
        ...(await enqueue(
          tx,
          await outcomeMessages(tx, workflowId, 'rejected', steps, {
            rejectorName: actor.name,
            reason: input.remarks,
          }),
        )),
      );
    } else {
      await tx
        .update(workflowSteps)
        .set({ status: 'APPROVED', decidedAt: now, remarks: input.remarks })
        .where(eq(workflowSteps.id, mine.id));
      await tx.insert(auditEvents).values({
        workflowId,
        actorId: actor.id,
        eventType: 'APPROVED',
        payload: { position: mine.position, isCfo: mine.isCfo, remarks: input.remarks },
      });

      if (mine.isCfo) {
        status = 'COMPLETED';
        await tx
          .insert(auditEvents)
          .values({ workflowId, actorId: actor.id, eventType: 'COMPLETED', payload: {} });
        outboxIds.push(
          ...(await enqueue(tx, await outcomeMessages(tx, workflowId, 'completed', steps, {}))),
        );
      } else {
        // Advance only once EVERY approver in this step has approved (D1)
        const group = steps.filter((s) => s.position === mine.position);
        const stepDone = group.every((s) => s.id === mine.id || s.status === 'APPROVED');
        if (stepDone) {
          const next = Math.min(
            ...steps.filter((s) => s.position > mine.position).map((s) => s.position),
          );
          const nextRows = steps.filter((s) => s.position === next);
          await tx
            .update(workflowSteps)
            .set({ status: 'PENDING', activatedAt: now })
            .where(
              inArray(
                workflowSteps.id,
                nextRows.map((s) => s.id),
              ),
            );
          currentPosition = next;
          status = nextRows.some((s) => s.isCfo) ? 'PENDING_CFO' : 'PENDING_APPROVER';
          await tx.insert(auditEvents).values({
            workflowId,
            actorId: actor.id,
            eventType: 'ADVANCED',
            payload: { from: mine.position, to: next },
          });
          outboxIds.push(...(await yourTurnForPosition(tx, workflowId, next, nextRows)));
        }
      }
    }

    await tx
      .update(workflows)
      .set({ status, currentPosition, updatedAt: now, version: sql`${workflows.version} + 1` })
      .where(eq(workflows.id, workflowId));

    return { status, currentPosition, outboxIds };
  });
}
