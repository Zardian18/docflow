import { FILE_TYPES, type FileMime, type WorkflowDetail } from '@docflow/shared';
import { useMutation } from '@tanstack/react-query';
import { Download, Eye, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api';
import { formatAmount, formatDate, formatFileSize } from '@/lib/format';

/**
 * The document row from screens 07/08: file, company, size, and View / Download.
 * View opens a PDF in a new tab without saving it; browsers can't display Word files,
 * so a DOCX only offers Download.
 */
export function DocumentCard({ workflow }: { workflow: WorkflowDetail }) {
  const viewable = workflow.fileMime === 'application/pdf';

  // Links expire after 5 minutes, so fetch one on click rather than on page load
  const download = useMutation({
    mutationFn: () => api.workflows.fileLink(workflow.id, 'download'),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const view = useMutation({
    // The tab is opened synchronously on click (so pop-up blockers allow it), then pointed
    // at the link once it arrives.
    mutationFn: async (tab: Window | null) => ({
      tab,
      link: await api.workflows.fileLink(workflow.id, 'view'),
    }),
    onSuccess: ({ tab, link }) => {
      if (tab) tab.location.href = link.url;
      else window.location.assign(link.url);
    },
    onError: (err, tab) => {
      tab?.close();
      toast.error(errorMessage(err));
    },
  });
  const openView = () => {
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    view.mutate(tab);
  };

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
          {!viewable && ' · Word files open after downloading'}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {viewable && (
          <Button onClick={openView} disabled={view.isPending}>
            <Eye aria-hidden />
            {view.isPending ? 'Opening…' : 'View'}
          </Button>
        )}
        <Button variant="outline" onClick={() => download.mutate()} disabled={download.isPending}>
          <Download aria-hidden />
          {download.isPending ? 'Preparing…' : 'Download'}
        </Button>
      </div>
    </section>
  );
}

/** Optional invoice fields (D6); renders nothing when none were filled in. */
export function InvoiceCard({ workflow: w }: { workflow: WorkflowDetail }) {
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
