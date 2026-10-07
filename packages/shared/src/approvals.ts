import { z } from 'zod';
import { WorkflowStatus } from './enums.js';

// ---- Decisions (plan.md §4.8) ---------------------------------------------

export const REMARKS_MAX_LENGTH = 1000;

export const DecisionRequest = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('APPROVE'),
    remarks: z
      .string()
      .trim()
      .max(REMARKS_MAX_LENGTH, `Use at most ${REMARKS_MAX_LENGTH} characters`)
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional()
      .default(null),
  }),
  z.object({
    decision: z.literal('REJECT'),
    // Invariant 5: a rejection always carries a reason
    remarks: z
      .string()
      .trim()
      .min(1, 'Give a reason for rejecting')
      .max(REMARKS_MAX_LENGTH, `Use at most ${REMARKS_MAX_LENGTH} characters`),
  }),
]);
export type DecisionRequest = z.input<typeof DecisionRequest>;

export const DecisionResult = z.object({
  status: WorkflowStatus,
  currentPosition: z.number().int().positive(),
});
export type DecisionResult = z.infer<typeof DecisionResult>;

// ---- Admin reassign (decisions.md D9) ---------------------------------------

export const ReassignRequest = z.object({
  employeeId: z.uuid('Choose who takes over this step'),
  reason: z.string().trim().min(1, 'Say why the step is being reassigned').max(500),
});
export type ReassignRequest = z.infer<typeof ReassignRequest>;

// ---- Reviewer lists ---------------------------------------------------------

export const PendingApproval = z.object({
  workflowId: z.uuid(),
  fileName: z.string(),
  companyName: z.string(),
  position: z.number().int().positive(),
  /** Approver positions in the chain (the CFO step is not counted). */
  totalPositions: z.number().int().positive(),
  isCfo: z.boolean(),
  waitingSince: z.iso.datetime({ offset: true }),
  /** Steps already approved, in order; a parallel step is one entry (“A & B”). Shown on the CFO dashboard. */
  clearedBy: z.array(z.string()),
});
export type PendingApproval = z.infer<typeof PendingApproval>;

export const ApprovalStats = z.object({
  awaiting: z.number().int().nonnegative(),
  /** Approver: this week. CFO: this month (screens 06 and 09). */
  approved: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  period: z.enum(['week', 'month']),
});
export type ApprovalStats = z.infer<typeof ApprovalStats>;

export const PendingApprovalsResponse = z.object({
  items: z.array(PendingApproval),
  stats: ApprovalStats,
});
export type PendingApprovalsResponse = z.infer<typeof PendingApprovalsResponse>;

export const DecisionHistoryItem = z.object({
  workflowId: z.uuid(),
  fileName: z.string(),
  companyName: z.string(),
  myDecision: z.enum(['APPROVED', 'REJECTED']),
  decidedAt: z.iso.datetime({ offset: true }),
  status: WorkflowStatus,
  currentPosition: z.number().int().positive(),
});
export type DecisionHistoryItem = z.infer<typeof DecisionHistoryItem>;

// ---- Notification recipients (decisions.md D2) ------------------------------

export type NotificationTemplate = 'your-turn' | 'completed' | 'rejected';

/**
 * Who is emailed for each event. One place, so changing D2 is a one-line edit.
 * "your-turn" always goes to everyone newly pending (one person, or a whole parallel step).
 */
export const NOTIFY_ON: Record<'completed' | 'rejected', ReadonlyArray<'creator' | 'cfo'>> = {
  completed: ['creator', 'cfo'],
  rejected: ['creator', 'cfo'],
};
