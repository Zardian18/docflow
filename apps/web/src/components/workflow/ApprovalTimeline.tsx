import {
  groupBySteps,
  type StepStatus,
  type WorkflowDetail,
  type WorkflowStep,
} from '@docflow/shared';
import { formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const DOT: Record<StepStatus | 'CREATED', string> = {
  CREATED: 'bg-status-green',
  APPROVED: 'bg-status-green',
  PENDING: 'bg-status-amber',
  REJECTED: 'bg-status-red',
  WAITING: 'bg-border',
  SKIPPED: 'bg-border',
};

function Dot({ status }: { status: StepStatus | 'CREATED' }) {
  return <span aria-hidden className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', DOT[status])} />;
}

function decisionDetail(step: WorkflowStep) {
  return [step.remarks && `“${step.remarks}”`, step.decidedAt && formatDateTime(step.decidedAt)]
    .filter(Boolean)
    .join(' · ');
}

function stepLine(
  step: WorkflowStep,
  position: number,
  viewerId: string | undefined,
): { title: string; detail?: string } {
  const who = step.isCfo ? `CFO · ${step.name}` : step.name;
  const where = step.isCfo ? '' : ` (Position ${position})`;
  switch (step.status) {
    case 'APPROVED':
      return { title: `Approved by ${who}${where}`, detail: decisionDetail(step) };
    case 'REJECTED':
      return { title: `Rejected by ${who}${where}`, detail: decisionDetail(step) };
    case 'PENDING': {
      const since = step.activatedAt ? `Waiting since ${formatDate(step.activatedAt)}` : undefined;
      if (step.employeeId === viewerId) {
        return {
          title: step.isCfo ? 'Pending your final approval' : `Pending your review${where}`,
          detail: since,
        };
      }
      return { title: `Pending with ${who}${where}`, detail: since };
    }
    case 'SKIPPED':
      return { title: `${who}${where}`, detail: 'Skipped after the rejection' };
    case 'WAITING':
      return { title: `${who}${where}`, detail: 'Not yet reached' };
  }
}

/**
 * The accumulated history from screens 07/08, built from the document's own snapshot chain
 * (not the company default). Parallel steps are grouped under one position. Pass the
 * viewer's id to phrase their own pending step as "Pending your review".
 */
export function ApprovalTimeline({
  workflow,
  viewerId,
}: {
  workflow: WorkflowDetail;
  viewerId?: string;
}) {
  const groups = groupBySteps(workflow.steps);
  return (
    <ol className="flex flex-col gap-4" aria-label="Approval history">
      <li className="flex gap-3">
        <Dot status="CREATED" />
        <div className="min-w-0">
          <p className="text-sm">Created by {workflow.createdByName}</p>
          <p className="text-muted-foreground text-xs">{formatDateTime(workflow.submittedAt)}</p>
        </div>
      </li>
      {groups.map((group) => {
        const position = group[0]!.position;
        if (group.length === 1) {
          const step = group[0]!;
          const line = stepLine(step, position, viewerId);
          return (
            <li key={step.id} className="flex gap-3">
              <Dot status={step.status} />
              <div className="min-w-0">
                <p className="text-sm break-words">{line.title}</p>
                {line.detail && (
                  <p className="text-muted-foreground text-xs break-words">{line.detail}</p>
                )}
              </div>
            </li>
          );
        }
        return (
          <li key={position} className="flex gap-3">
            <Dot
              status={group.some((s) => s.status === 'PENDING') ? 'PENDING' : group[0]!.status}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                Position {position}{' '}
                <span className="text-muted-foreground">· parallel, all must approve</span>
              </p>
              <ul className="border-primary-soft mt-1.5 flex flex-col gap-2 border-l-2 pl-3">
                {group.map((step) => {
                  const line = stepLine(step, position, viewerId);
                  return (
                    <li key={step.id} className="flex gap-2">
                      <Dot status={step.status} />
                      <div className="min-w-0">
                        <p className="text-sm break-words">
                          {line.title.replace(` (Position ${position})`, '')}
                        </p>
                        {line.detail && (
                          <p className="text-muted-foreground text-xs break-words">{line.detail}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
