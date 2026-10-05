import { z } from 'zod';

/** Every role must carry exactly one of these (decisions.md D3). */
export const PERMISSIONS = ['ADMIN', 'CREATOR', 'APPROVER', 'CFO'] as const;
export const Permission = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof Permission>;

/** Workflow lifecycle (plan.md §4.1). */
export const WORKFLOW_STATUSES = [
  'PENDING_APPROVER',
  'PENDING_CFO',
  'COMPLETED',
  'REJECTED',
] as const;
export const WorkflowStatus = z.enum(WORKFLOW_STATUSES);
export type WorkflowStatus = z.infer<typeof WorkflowStatus>;
