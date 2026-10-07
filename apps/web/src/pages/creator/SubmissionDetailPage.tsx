import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/States';
import { Skeleton } from '@/components/ui/skeleton';
import { ApprovalTimeline } from '@/components/workflow/ApprovalTimeline';
import { DocumentCard, InvoiceCard } from '@/components/workflow/DocumentCards';
import { WorkflowStatusPill } from '@/components/WorkflowStatusPill';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

/** Not in Figma: a Creator's view of one submission, styled like screens 07/08. */
export function SubmissionDetailPage() {
  const { id } = useParams();
  const detail = useQuery({
    queryKey: ['workflows', 'detail', id],
    queryFn: ({ signal }) => api.workflows.get(id!, signal),
  });
  const w = detail.data;

  return (
    <>
      <PageHeader
        title={w ? w.fileName : 'Submission'}
        description={
          <Link to="/submissions" className="hover:text-foreground inline-flex items-center gap-1">
            <ChevronLeft className="size-3.5" aria-hidden />
            My Submissions
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
                aria-labelledby="history-heading"
              >
                <h2 id="history-heading" className="mb-4 text-sm font-semibold">
                  Approval History
                </h2>
                <ApprovalTimeline workflow={w} />
              </section>
              <InvoiceCard workflow={w} />
            </div>
            <aside className="bg-card rounded-xl border p-5 text-[13px] leading-relaxed">
              <h2 className="mb-2 text-sm font-semibold">About this approval</h2>
              <ul className="text-muted-foreground flex list-disc flex-col gap-2 pl-4">
                <li>
                  Submitted {formatDate(w.submittedAt)} for {w.companyName}.
                </li>
                <li>
                  {w.chainCustomised
                    ? 'You customised the approval chain for this document.'
                    : 'This document follows the company’s default approval chain.'}
                </li>
                <li>This page shows each decision as approvers act on it.</li>
              </ul>
            </aside>
          </div>
        )}
      </PageBody>
    </>
  );
}
