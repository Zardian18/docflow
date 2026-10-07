import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/States';
import { Skeleton } from '@/components/ui/skeleton';
import { ApprovalTimeline } from '@/components/workflow/ApprovalTimeline';
import { DocumentCard, InvoiceCard } from '@/components/workflow/DocumentCards';
import { WorkflowStatusPill } from '@/components/WorkflowStatusPill';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { ReassignButton } from './ReassignDialog';

/**
 * Not in Figma: Admin's drill-down from the dashboard (URS §5.5/§5.8). The full audit trail,
 * readable after completion or rejection, plus Reassign on steps not yet decided (D9).
 */
export function AdminWorkflowPage() {
  const { id } = useParams();
  const location = useLocation();
  const back = `/admin${(location.state as { from?: string } | null)?.from ? `?${(location.state as { from: string }).from}` : ''}`;
  const detail = useQuery({
    queryKey: ['workflows', 'detail', id],
    queryFn: ({ signal }) => api.workflows.get(id!, signal),
  });
  const w = detail.data;
  const open = w && (w.status === 'PENDING_APPROVER' || w.status === 'PENDING_CFO');

  return (
    <>
      <PageHeader
        title={w ? w.fileName : 'Document'}
        description={
          <Link to={back} className="hover:text-foreground inline-flex items-center gap-1">
            <ChevronLeft className="size-3.5" aria-hidden />
            Admin Dashboard
          </Link>
        }
        actions={w && <WorkflowStatusPill status={w.status} position={w.currentPosition} />}
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
                aria-labelledby="trail-heading"
              >
                <h2 id="trail-heading" className="mb-4 text-sm font-semibold">
                  Approval chain
                </h2>
                <ApprovalTimeline
                  workflow={w}
                  stepAction={(step) =>
                    open && (step.status === 'PENDING' || step.status === 'WAITING') ? (
                      <ReassignButton workflowId={w.id} step={step} />
                    ) : null
                  }
                />
              </section>
              <InvoiceCard workflow={w} />
              <section
                className="bg-card rounded-xl border p-4 sm:p-5"
                aria-labelledby="activity-heading"
              >
                <h2 id="activity-heading" className="mb-3 text-sm font-semibold">
                  Activity log
                </h2>
                <ol className="divide-y text-sm">
                  {w.events.map((e) => (
                    <li
                      key={e.id}
                      className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:gap-4"
                    >
                      <time
                        className="text-muted-foreground shrink-0 text-xs sm:w-40 sm:pt-0.5"
                        dateTime={e.createdAt}
                      >
                        {formatDateTime(e.createdAt)}
                      </time>
                      <p className="min-w-0 break-words">
                        <span className="font-medium">{e.actorName ?? 'System'}</span> · {e.summary}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
            <aside className="bg-card rounded-xl border p-5 text-[13px] leading-relaxed">
              <h2 className="mb-3 text-sm font-semibold">Summary</h2>
              <dl className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-x-3 gap-y-2">
                <dt className="text-muted-foreground">Company</dt>
                <dd className="break-words">{w.companyName}</dd>
                <dt className="text-muted-foreground">Created by</dt>
                <dd className="break-words">{w.createdByName}</dd>
                <dt className="text-muted-foreground">Submitted</dt>
                <dd>{formatDate(w.submittedAt)}</dd>
                <dt className="text-muted-foreground">Last updated</dt>
                <dd>{formatDate(w.updatedAt)}</dd>
                <dt className="text-muted-foreground">Chain</dt>
                <dd>{w.chainCustomised ? 'Customised for this document' : 'Company default'}</dd>
              </dl>
            </aside>
          </div>
        )}
      </PageBody>
    </>
  );
}
