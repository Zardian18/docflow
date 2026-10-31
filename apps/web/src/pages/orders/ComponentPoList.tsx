import { TAG_LABEL, type Component, type Tag } from '@docflow/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { DocumentButtons } from '@/components/DocumentButtons';
import { FileDropzone, type UploadState } from '@/components/FileDropzone';
import { api, errorMessage } from '@/lib/api';

/**
 * Purchase orders, one per component (D29, D30). Materials attaches each while the tables are
 * open; Approvers and Head Approvers view them; nobody else opens them. On an ordering step it
 * lists that product's components of that type; in the Chain tab, every product's components.
 */
export function ComponentPoList({
  orderId,
  canUpload,
  productId,
  kind,
}: {
  orderId: string;
  canUpload: boolean;
  /** Only this product's components (an ordering step) */
  productId?: string;
  /** Only components of this type (an ordering step) */
  kind?: Tag;
}) {
  const queryClient = useQueryClient();
  const tables = useQuery({
    queryKey: ['components', orderId],
    queryFn: ({ signal }) => api.orders.components(orderId, signal),
  });
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const products = (tables.data?.products ?? [])
    .filter((p) => !productId || p.id === productId)
    .map((p) => ({ ...p, components: p.components.filter((c) => !kind || c.kind === kind) }));
  const label = kind ? `${TAG_LABEL[kind].toLowerCase()} ` : '';

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

  const row = (c: Component) => (
    <li key={c.id} className="flex flex-col gap-1.5 rounded-lg border px-3 py-2">
      <span className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <span className="min-w-0">
          <span className="font-medium">{c.name}</span>
          {!kind && <span className="text-muted-foreground"> · {TAG_LABEL[c.kind]}</span>}
        </span>
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
      {canUpload && (
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
      )}
    </li>
  );

  if (tables.isPending) return null;
  const empty = products.every((p) => p.components.length === 0);
  return (
    <section
      className="flex flex-col gap-2"
      aria-label={`Purchase orders for each ${label}component`}
    >
      <p className="text-muted-foreground text-[13px]">
        A purchase order (PO) for each {label}component. Every one needs its PO before it can be
        marked ordered, and before the materials go to Production. Only Materials, Approvers and
        Head Approvers can open them.
      </p>
      {empty ? (
        <p className="text-status-amber text-[13px]">
          No {label}components yet. Add them in the Materials tab first.
        </p>
      ) : productId ? (
        <ul className="flex flex-col gap-2">{products[0]?.components.map(row)}</ul>
      ) : (
        products
          .filter((p) => p.components.length > 0)
          .map((p) => (
            <div key={p.id} className="flex flex-col gap-2">
              <p className="text-[13px] font-semibold">{p.name}</p>
              <ul className="flex flex-col gap-2">{p.components.map(row)}</ul>
            </div>
          ))
      )}
    </section>
  );
}
