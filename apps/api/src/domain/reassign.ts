import type { ReassignRequest } from '@docflow/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { auditEvents, employees, roles, workflowSteps, workflows } from '../db/schema.js';
import { AppError, conflict, notFound } from '../errors.js';
import { activeCfo } from './chain.js';
import { yourTurnForPosition } from './decide.js';

/**
 * Admin hands a not-yet-decided step to someone else (decisions.md D9): an approver who left
 * or is away, or the CFO step after the CFO is replaced. Locks the workflow like a decision,
 * updates the snapshot, and records who changed what and why. Returns outbox rows to deliver.
 */
export async function reassignStep(
  db: Db,
  adminId: string,
  workflowId: string,
  stepId: string,
  input: ReassignRequest,
): Promise<string[]> {
  return db.transaction(async (tx) => {
    const [wf] = await tx
      .select({ status: workflows.status, createdBy: workflows.createdBy })
      .from(workflows)
      .where(eq(workflows.id, workflowId))
      .for('update');
    if (!wf) throw notFound('Document');
    if (wf.status === 'COMPLETED' || wf.status === 'REJECTED') {
      throw conflict(
        'WORKFLOW_CLOSED',
        'This document is already finished; nothing can be reassigned.',
      );
    }
    const [step] = await tx
      .select()
      .from(workflowSteps)
      .where(and(eq(workflowSteps.id, stepId), eq(workflowSteps.workflowId, workflowId)));
    if (!step) throw notFound('Step');
    if (step.status !== 'PENDING' && step.status !== 'WAITING') {
      throw conflict('STEP_DECIDED', 'This step has already been decided and can’t be reassigned.');
    }

    let target: { id: string; name: string; email: string };
    if (step.isCfo) {
      // The CFO step can only move to whoever is the active CFO now (invariant 4)
      const cfo = await activeCfo(tx);
      if (!cfo || cfo.id !== input.employeeId) {
        throw new AppError(
          400,
          'INELIGIBLE_APPROVER',
          'The CFO step can only be given to the current active CFO.',
        );
      }
      target = cfo;
    } else {
      const [person] = await tx
        .select({ id: employees.id, name: employees.name, email: employees.email })
        .from(employees)
        .innerJoin(roles, eq(roles.id, employees.roleId))
        .where(
          and(
            eq(employees.id, input.employeeId),
            eq(employees.isActive, true),
            eq(roles.isActive, true),
            eq(roles.permission, 'APPROVER'),
          ),
        );
      if (!person || person.id === wf.createdBy) {
        throw new AppError(
          400,
          'INELIGIBLE_APPROVER',
          'Choose an active employee with an Approver role.',
        );
      }
      target = person;
    }
    const [already] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(workflowSteps)
      .where(
        and(eq(workflowSteps.workflowId, workflowId), eq(workflowSteps.employeeId, target.id)),
      );
    if ((already?.n ?? 0) > 0) {
      throw conflict(
        'ALREADY_IN_CHAIN',
        `${target.name} is already in this document’s approval chain.`,
      );
    }

    await tx
      .update(workflowSteps)
      .set({ employeeId: target.id, employeeName: target.name, employeeEmail: target.email })
      .where(eq(workflowSteps.id, step.id));
    await tx.insert(auditEvents).values({
      workflowId,
      actorId: adminId,
      eventType: 'REASSIGNED',
      payload: {
        stepId: step.id,
        position: step.position,
        from: { id: step.employeeId, name: step.employeeName },
        to: { id: target.id, name: target.name },
        reason: input.reason,
      },
    });
    await tx.update(workflows).set({ updatedAt: new Date() }).where(eq(workflows.id, workflowId));

    if (step.status !== 'PENDING') return [];
    return yourTurnForPosition(tx, workflowId, step.position, [
      { ...step, employeeId: target.id, employeeName: target.name, employeeEmail: target.email },
    ]);
  });
}
