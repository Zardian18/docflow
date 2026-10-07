import { workflowStatusLabel, type WorkflowStatus } from '@docflow/shared';
import { StatusPill, type PillTone } from './StatusPill';

const TONE: Record<WorkflowStatus, PillTone> = {
  PENDING_APPROVER: 'amber',
  PENDING_CFO: 'blue',
  COMPLETED: 'green',
  REJECTED: 'red',
};

/** "Pending Approver (Position 2)" etc., coloured as in screens 02 and 05. */
export function WorkflowStatusPill({
  status,
  position,
}: {
  status: WorkflowStatus;
  position: number;
}) {
  return <StatusPill tone={TONE[status]}>{workflowStatusLabel(status, position)}</StatusPill>;
}
