import { TAG_LABEL, type Tag } from '@docflow/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { DocumentButtons } from '@/components/DocumentButtons';
import { FileDropzone, type UploadState } from '@/components/FileDropzone';
import { api, errorMessage } from '@/lib/api';

/**
 * The ordering step (D29): one PO upload per component of this type for this product. Every
 * one needs its PO before Materials can mark it ordered; components are added in the
 * Materials tab.
 */
export function ComponentPoList({
  orderId,
  productId,
  kind,
}: {
  orderId: string;
  productId: string;
  kind: Tag;
}) {
  const queryClient = useQueryClient();
  const tables = useQuery({
    queryKey: ['components', orderId],
    queryFn: ({ signal }) => api.orders.components(orderId, signal),
  });
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const parts =
    tables.data?.products
      .find((p) => p.id === productId)
      ?.components.filter((c) => c.kind === kind) ?? [];
  const label = TAG_LABEL[kind].toLowerCase();

  const attach = async (componentId: string, state: UploadState) => {
    setUploads((u) => ({ ...u, [componentId]: state }));
    if (state.kind !== 'done') return;
    try {
      await api.components.uploadPo(componentId, state.uploadId);
      setUploads((u) => ({ ...u, [componentId]: { kind: 'empty' } }));
      await queryClient.invalidateQueries({ queryKey: ['components', orderId] });
      await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    } catch (err) {
      setUploads((u) => ({
        ...u,
        [componentId]: { kind: 'error', file: state.file, message: errorMessage(err) },
      }));
    }
  };

  return (
    <section className="flex flex-col gap-2" aria-label={`Purchase orders for each ${label}`}>
      <p className="text-muted-foreground text-[13px]">
        Purchase order (PO) for each {label} component, needed before marking it ordered. Only
        Materials, approvers and Admin can open these.
      </p>
      {tables.isPending ? null : parts.length === 0 ? (
        <p className="text-status-amber text-[13px]">
          No {label} components yet. Add them in the Materials tab first.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {parts.map((c) => (
            <li key={c.id} className="flex flex-col gap-1.5 rounded-lg border px-3 py-2">
              <span className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <span className="font-medium">{c.name}</span>
                {c.po ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-status-green inline-flex items-center gap-1 text-xs">
                      <CheckCircle2 className="size-3.5" aria-hidden /> PO uploaded
                    </span>
                    <DocumentButtons doc={c.po} size="xs" />
                  </span>
                ) : (
                  <span className="text-status-amber text-xs">PO needed</span>
                )}
              </span>
              <FileDropzone
                compact
                label={
                  c.po
                    ? `Replace the PO for ${c.name}: drop it here, or click to browse`
                    : `Drop the PO for ${c.name} here, or click to browse`
                }
                state={uploads[c.id] ?? { kind: 'empty' }}
                onChange={(s) => void attach(c.id, s)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
