import { FILE_TYPES, type FileMime, type WorkflowDetail } from '@docflow/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronLeft, Download, FileText } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApprovalTimeline } from '@/components/workflow/ApprovalTimeline';
import { WorkflowStatusPill } from '@/components/WorkflowStatusPill';
import { api, errorMessage } from '@/lib/api';
import { formatAmount, formatDate, formatFileSize } from '@/lib/format';

function DocumentCard({ workflow }: { workflow: WorkflowDetail }) {
  // Links expire after 5 minutes, so fetch one on click rather than on page load
  const open = useMutation({
    mutationFn: () => api.workflows.fileLink(workflow.id),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const kind = FILE_TYPES[workflow.fileMime as FileMime]?.label ?? 'File';
  return (
    <section className="bg-card flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:p-5">
      <span className="bg-primary-soft text-primary inline-flex size-10 shrink-0 items-center justify-center rounded-lg">
        <FileText className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium break-all">{workflow.fileName}</p>
        <p className="text-muted-foreground text-[13px]">
          {workflow.companyName} · {kind}, {formatFileSize(workflow.fileSize)}
        </p>
      </div>
      <Button
        variant="outline"
        onClick={() => open.mutate()}
        disabled={open.isPending}
        className="self-start sm:self-auto"
      >
        <Download aria-hidden />
        {open.isPending ? 'Preparing…' : 'View File'}
      </Button>
    </section>
  );
}

function InvoiceCard({ workflow: w }: { workflow: WorkflowDetail }) {
  const rows: Array<[string, string | null]> = [
    ['Invoice number', w.invoiceNumber],
    ['Vendor', w.vendorName],
    ['Invoice date', w.invoiceDate ? formatDate(w.invoiceDate) : null],
    ['Amount', w.amount ? formatAmount(w.amount, w.currency) : null],
    ['Notes', w.notes],
  ];
  if (rows.every(([, v]) => !v)) return null;
  return (
    <section className="bg-card rounded-xl border p-4 sm:p-5" aria-labelledby="invoice-heading">
      <h2 id="invoice-heading" className="mb-3 text-sm font-semibold">
        Invoice details
      </h2>
      <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        {rows
          .filter(([, v]) => v)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words whitespace-pre-line">{value}</dd>
            </div>
          ))}
      </dl>
    </section>
  );
}

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
