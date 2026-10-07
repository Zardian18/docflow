import { REMARKS_MAX_LENGTH, type WorkflowDetail } from '@docflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useId, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { FormError } from '@/components/forms';
import { useMe } from '@/lib/auth';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/States';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApprovalTimeline } from '@/components/workflow/ApprovalTimeline';
import { DocumentCard, InvoiceCard } from '@/components/workflow/DocumentCards';
import { WorkflowStatusPill } from '@/components/WorkflowStatusPill';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { REVIEWER, type ReviewerKind } from './reviewer';

type Decision = 'APPROVE' | 'REJECT';

const CONFIRM: Record<
  ReviewerKind,
  Record<Decision, { title: string; body: string; action: string }>
> = {
  approver: {
    APPROVE: {
      title: 'Approve this document?',
      body: 'It moves on in the approval chain. Your decision can’t be changed afterwards.',
      action: 'Approve',
    },
    REJECT: {
      title: 'Reject this document?',
      body: 'The approval ends immediately for everyone. The Creator and the CFO see your reason. This can’t be undone.',
      action: 'Reject',
    },
  },
  cfo: {
    APPROVE: {
      title: 'Give final approval?',
      body: 'The document is marked Completed and the Creator is told. This can’t be undone.',
      action: 'Approve & Complete',
    },
    REJECT: {
      title: 'Reject this document?',
      body: 'The approval ends immediately and the Creator sees your reason. This can’t be undone.',
      action: 'Reject',
    },
  },
};

function DecisionPanel({ workflow, kind }: { workflow: WorkflowDetail; kind: ReviewerKind }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const remarksId = useId();
  const [remarks, setRemarks] = useState('');
  const [confirming, setConfirming] = useState<Decision | null>(null);
  const [reasonMissing, setReasonMissing] = useState(false);

  const decide = useMutation({
    mutationFn: (decision: Decision) =>
      api.workflows.decide(
        workflow.id,
        decision === 'REJECT' ? { decision, remarks } : { decision, remarks: remarks || undefined },
      ),
    onSuccess: (result, decision) => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setConfirming(null);
      toast.success(
        decision === 'REJECT'
          ? 'Rejected. The Creator can see your reason.'
          : result.status === 'COMPLETED'
            ? 'Approved. The document is complete.'
            : 'Approved',
      );
      navigate(REVIEWER[kind].base);
    },
    onError: (err) => {
      setConfirming(null);
      // Someone else's action changed the document: show its current state
      if (err instanceof ApiError && err.status === 409) {
        queryClient.invalidateQueries({ queryKey: ['workflows', 'detail', workflow.id] });
      }
    },
  });

  const ask = (decision: Decision) => {
    decide.reset();
    if (decision === 'REJECT' && remarks.trim() === '') {
      setReasonMissing(true);
      document.getElementById(remarksId)?.focus();
      return;
    }
    setConfirming(decision);
  };

  const copy = confirming ? CONFIRM[kind][confirming] : null;

  return (
    <section className="bg-card rounded-xl border p-4 sm:p-5" aria-labelledby="decision-heading">
      <h2 id="decision-heading" className="mb-3 text-sm font-semibold">
        {kind === 'cfo' ? 'Final Decision' : 'Your Decision'}
      </h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={remarksId} className="text-muted-foreground text-[13px] font-normal">
          Remarks (optional for approval, required for rejection)
        </Label>
        <Textarea
          id={remarksId}
          rows={3}
          maxLength={REMARKS_MAX_LENGTH}
          placeholder="Add a note…"
          value={remarks}
          aria-invalid={reasonMissing}
          aria-describedby={reasonMissing ? `${remarksId}-error` : undefined}
          onChange={(e) => {
            setRemarks(e.target.value);
            if (e.target.value.trim()) setReasonMissing(false);
          }}
          className="bg-surface-subtle"
        />
        {reasonMissing && (
          <p id={`${remarksId}-error`} className="text-destructive text-xs">
            Give a reason before rejecting. The Creator will see it.
          </p>
        )}
      </div>
      <FormError message={decide.error ? errorMessage(decide.error) : undefined} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Button className="h-10" onClick={() => ask('APPROVE')} disabled={decide.isPending}>
          {kind === 'cfo' ? 'Approve & Complete' : 'Approve'}
        </Button>
        <Button
          variant="destructive"
          className="h-10"
          onClick={() => ask('REJECT')}
          disabled={decide.isPending}
        >
          Reject
        </Button>
      </div>

      <Dialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto">
          {copy && confirming && (
            <>
              <DialogHeader>
                <DialogTitle>{copy.title}</DialogTitle>
                <DialogDescription>{copy.body}</DialogDescription>
              </DialogHeader>
              {remarks.trim() && (
                <blockquote className="bg-surface-subtle rounded-lg px-3 py-2 text-sm break-words whitespace-pre-line">
                  “{remarks.trim()}”
                </blockquote>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirming(null)}>
                  Go back
                </Button>
                <Button
                  variant={confirming === 'REJECT' ? 'destructive' : 'default'}
                  onClick={() => decide.mutate(confirming)}
                  disabled={decide.isPending}
                >
                  {decide.isPending ? 'Saving…' : copy.action}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Shown instead of the decision panel once there's nothing for this person to do. */
function OutcomeCard({ workflow }: { workflow: WorkflowDetail }) {
  const mine = workflow.steps.find((s) => s.id === workflow.myStep?.stepId);
  let text = 'This document is no longer waiting for your decision.';
  if (mine?.status === 'APPROVED' && mine.decidedAt)
    text = `You approved this on ${formatDateTime(mine.decidedAt)}.`;
  if (mine?.status === 'REJECTED' && mine.decidedAt)
    text = `You rejected this on ${formatDateTime(mine.decidedAt)}.`;
  if (mine?.status === 'SKIPPED') text = 'Someone rejected this before it reached you.';
  return (
    <section className="bg-card flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <p className="text-sm">{text}</p>
      <span className="self-start sm:self-auto">
        <WorkflowStatusPill status={workflow.status} position={workflow.currentPosition} />
      </span>
    </section>
  );
}

function SideNote({ kind }: { kind: ReviewerKind }) {
  return kind === 'cfo' ? (
    <aside className="bg-card rounded-xl border p-5 text-[13px] leading-relaxed">
      <h2 className="mb-2 text-sm font-semibold">Note</h2>
      <p className="text-muted-foreground">
        You are the final and mandatory approver for every workflow. Approving here marks the
        document Completed and notifies the Creator. Rejecting ends the workflow immediately.
      </p>
    </aside>
  ) : (
    <aside className="bg-card rounded-xl border p-5 text-[13px] leading-relaxed">
      <h2 className="mb-2 text-sm font-semibold">Rules</h2>
      <ul className="text-muted-foreground flex list-disc flex-col gap-2 pl-4">
        <li>A rejection needs a reason. You can’t reject without one.</li>
        <li>Approving moves the document to the next position in the chain.</li>
        <li>If you are the last approver, it goes to the CFO next.</li>
        <li>In a parallel step, everyone in it must approve before it moves on.</li>
      </ul>
    </aside>
  );
}

/** Screens 07 (approver) and 08 (CFO); also the read-only view from History. */
export function ReviewPage({ kind }: { kind: ReviewerKind }) {
  const { id } = useParams();
  const me = useMe();
  const detail = useQuery({
    queryKey: ['workflows', 'detail', id],
    queryFn: ({ signal }) => api.workflows.get(id!, signal),
  });
  const w = detail.data;
  const base = REVIEWER[kind].base;

  const subtitle = w
    ? kind === 'cfo'
      ? `Final Step · ${w.companyName}`
      : `Position ${w.myStep?.position ?? w.currentPosition} of ${w.totalPositions} · ${w.companyName}`
    : undefined;

  return (
    <>
      <PageHeader
        title="Review Document"
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link to={base} className="hover:text-foreground inline-flex items-center gap-1">
              <ChevronLeft className="size-3.5" aria-hidden />
              {REVIEWER[kind].pendingTitle}
            </Link>
            {subtitle && <span>{subtitle}</span>}
          </span>
        }
        actions={
          kind === 'cfo' && w?.myStep?.canAct ? (
            <StatusPill tone="blue">Final Approval Step</StatusPill>
          ) : undefined
        }
      />
      <PageBody>
        {detail.isPending ? (
          <div className="flex flex-col gap-5" aria-busy="true">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-56 rounded-xl" />
          </div>
        ) : detail.error || !w ? (
          <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="flex min-w-0 flex-col gap-5">
              <DocumentCard workflow={w} />
              <section
                className="bg-card rounded-xl border p-4 sm:p-5"
                aria-labelledby="history-heading"
              >
                <h2 id="history-heading" className="mb-4 text-sm font-semibold">
                  {kind === 'cfo' ? 'Complete Approval History' : 'Approval History'}
                </h2>
                <ApprovalTimeline workflow={w} viewerId={me.data?.id} />
              </section>
              <InvoiceCard workflow={w} />
              {w.myStep?.canAct ? (
                <DecisionPanel workflow={w} kind={kind} />
              ) : (
                <OutcomeCard workflow={w} />
              )}
            </div>
            <SideNote kind={kind} />
          </div>
        )}
      </PageBody>
    </>
  );
}
