import { DOC_KIND_LABEL, type ReviewDoc } from '@docflow/shared';
import { Download, Eye, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { canView, openDocument } from '@/lib/documents';
import { cn } from '@/lib/utils';

/** View and Download for one document; the accessible names say which document (D27) */
export function DocumentButtons({
  doc,
  size = 'sm',
}: {
  doc: Pick<ReviewDoc, 'id' | 'kind' | 'fileMime'>;
  size?: 'sm' | 'xs';
}) {
  const what = DOC_KIND_LABEL[doc.kind];
  const cls = size === 'xs' ? 'h-7 px-2 text-xs' : undefined;
  return (
    <span className="flex shrink-0 gap-1">
      {canView(doc.fileMime) && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cls}
          aria-label={`View ${what}`}
          onClick={(e) => {
            e.stopPropagation();
            void openDocument(doc.id, 'view');
          }}
        >
          <Eye aria-hidden /> View
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={cls}
        aria-label={`Download ${what}`}
        onClick={(e) => {
          e.stopPropagation();
          void openDocument(doc.id, 'download');
        }}
      >
        <Download aria-hidden /> Download
      </Button>
    </span>
  );
}

/** The latest version of each document a step is about, with View and Download */
export function ReviewDocList({ docs, className }: { docs: ReviewDoc[]; className?: string }) {
  if (docs.length === 0) return null;
  return (
    <ul className={cn('flex flex-col gap-2', className)} aria-label="Latest documents">
      {docs.map((d) => (
        <li
          key={d.id}
          className="bg-muted/50 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
        >
          <span className="flex min-w-0 items-center gap-2 text-[13px]">
            <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
            <span className="min-w-0">
              <b className="font-medium">{DOC_KIND_LABEL[d.kind]}</b>{' '}
              <span className="text-muted-foreground break-all">{d.fileName}</span>
            </span>
          </span>
          <DocumentButtons doc={d} />
        </li>
      ))}
    </ul>
  );
}
