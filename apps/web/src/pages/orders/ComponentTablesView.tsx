import {
  COMPONENT_FIELD_LABEL,
  TAG_LABEL,
  TAGS,
  type Component,
  type ComponentInput,
  type Tag,
} from '@docflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Pencil, Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/forms';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/States';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { clockText } from '@/lib/labels';

type Draft = Required<Omit<ComponentInput, 'comment'>> & { comment: string };

const blank = (): Draft => ({
  name: '',
  kind: 'RAW_MATERIAL',
  poQuantity: '',
  orderQuantity: '',
  poDate: null,
  dispatchDate: null,
  deliverDate: null,
  lrDetails: '',
  challanNo: '',
  tridentRemark: '',
  tnsRemark: '',
  comment: '',
});

const fromRow = (c: Component): Draft => ({
  name: c.name,
  kind: c.kind,
  poQuantity: c.poQuantity ?? '',
  orderQuantity: c.orderQuantity ?? '',
  poDate: c.poDate,
  dispatchDate: c.dispatchDate,
  deliverDate: c.deliverDate,
  lrDetails: c.lrDetails ?? '',
  challanNo: c.challanNo ?? '',
  tridentRemark: c.tridentRemark ?? '',
  tnsRemark: c.tnsRemark ?? '',
  comment: '',
});

function ComponentDialog({
  orderId,
  productId,
  productName,
  row,
  open,
  onOpenChange,
}: {
  orderId: string;
  productId: string;
  productName: string;
  row: Component | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(row ? fromRow(row) : blank());
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body: ComponentInput = { ...draft, comment: draft.comment || null };
      return row
        ? api.components.update(row.id, body)
        : api.components.add(orderId, productId, body);
    },
    onSuccess: () => {
      toast.success(row ? `Saved ${draft.name}` : `Added ${draft.name}`);
      for (const key of [
        ['components', orderId],
        ['order', orderId],
        ['order-timeline', orderId],
        ['work'],
      ]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      onOpenChange(false);
    },
  });
  const text = (
    k: 'poQuantity' | 'orderQuantity' | 'lrDetails' | 'challanNo',
    placeholder?: string,
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${id}-${k}`} className="text-muted-foreground text-[13px] font-normal">
        {COMPONENT_FIELD_LABEL[k]}
      </Label>
      <Input
        id={`${id}-${k}`}
        placeholder={placeholder}
        value={draft[k] ?? ''}
        onChange={(e) => set(k, e.target.value)}
      />
    </div>
  );
  const dateField = (k: 'poDate' | 'dispatchDate' | 'deliverDate') => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${id}-${k}`} className="text-muted-foreground text-[13px] font-normal">
        {COMPONENT_FIELD_LABEL[k]}
      </Label>
      <Input
        id={`${id}-${k}`}
        type="date"
        value={draft[k] ?? ''}
        onChange={(e) => set(k, e.target.value || null)}
      />
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {row ? `Edit ${row.name}` : `Add a component to ${productName}`}
          </DialogTitle>
          <DialogDescription>
            Every change is kept in the row’s history with who made it and when. A Deliver Date
            marks the component delivered.
          </DialogDescription>
        </DialogHeader>
        <form
          id={`${id}-form`}
          noValidate
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.name.trim()) save.mutate();
          }}
        >
          <div className="sm:col-span-2">
            <FormError message={save.error ? errorMessage(save.error) : undefined} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-name`} className="text-muted-foreground text-[13px] font-normal">
              {COMPONENT_FIELD_LABEL.name}
            </Label>
            <Input
              id={`${id}-name`}
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              aria-invalid={!draft.name.trim()}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-kind`} className="text-muted-foreground text-[13px] font-normal">
              Type
            </Label>
            <Select value={draft.kind} onValueChange={(v) => set('kind', v as Tag)}>
              <SelectTrigger id={`${id}-kind`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TAGS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TAG_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {text('poQuantity', 'What the buyer ordered')}
          {text('orderQuantity', 'What was made')}
          {dateField('poDate')}
          {dateField('dispatchDate')}
          {dateField('deliverDate')}
          {text('lrDetails')}
          {text('challanNo')}
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label
              htmlFor={`${id}-trident`}
              className="text-muted-foreground text-[13px] font-normal"
            >
              Trident Remark
            </Label>
            <Textarea
              id={`${id}-trident`}
              rows={2}
              value={draft.tridentRemark ?? ''}
              onChange={(e) => set('tridentRemark', e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor={`${id}-tns`} className="text-muted-foreground text-[13px] font-normal">
              TNS Remark (manufacturer)
            </Label>
            <Textarea
              id={`${id}-tns`}
              rows={2}
              value={draft.tnsRemark ?? ''}
              onChange={(e) => set('tnsRemark', e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label
              htmlFor={`${id}-comment`}
              className="text-muted-foreground text-[13px] font-normal"
            >
              Why (optional, kept with the change)
            </Label>
            <Input
              id={`${id}-comment`}
              value={draft.comment}
              onChange={(e) => set('comment', e.target.value)}
            />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} disabled={save.isPending || !draft.name.trim()}>
            {save.isPending ? 'Saving…' : row ? 'Save' : 'Add component'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ row, onClose }: { row: Component | null; onClose: () => void }) {
  const history = useQuery({
    queryKey: ['component-history', row?.id],
    enabled: Boolean(row),
    queryFn: ({ signal }) => api.components.history(row!.id, signal),
  });
  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>History of {row?.name}</DialogTitle>
          <DialogDescription>Every change to this row, newest first.</DialogDescription>
        </DialogHeader>
        {history.isPending ? (
          <ListSkeleton rows={3} />
        ) : history.error ? (
          <ErrorState error={history.error} onRetry={() => history.refetch()} />
        ) : (
          <ol className="flex flex-col gap-2 text-[13px]">
            {history.data!.map((c) => (
              <li key={c.id} className="border-b pb-2 last:border-0">
                <b className="font-medium">
                  {c.field in COMPONENT_FIELD_LABEL
                    ? COMPONENT_FIELD_LABEL[c.field as keyof typeof COMPONENT_FIELD_LABEL]
                    : c.field}
                </b>
                : {c.oldValue ?? '—'} → {c.newValue ?? '—'}
                <span className="text-muted-foreground block text-xs">
                  {c.actorName}, {formatDateTime(c.at)}
                  {c.comment && ` · “${c.comment}”`}
                </span>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The per-product tracking tables (brief Phase 2): one table per product, one row per component */
export function ComponentTablesView({ orderId }: { orderId: string }) {
  const tables = useQuery({
    queryKey: ['components', orderId],
    queryFn: ({ signal }) => api.orders.components(orderId, signal),
  });
  const [dialog, setDialog] = useState<{
    productId: string;
    productName: string;
    row: Component | null;
  } | null>(null);
  const [historyRow, setHistoryRow] = useState<Component | null>(null);
  if (tables.isPending) return <ListSkeleton />;
  if (tables.error) return <ErrorState error={tables.error} onRetry={() => tables.refetch()} />;
  const data = tables.data!;
  const cell = 'border-b px-3 py-2 align-top whitespace-nowrap';
  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-[13px]">
        Production started {clockText(data.trackerA)}. Order started {clockText(data.trackerB)}.
        {data.editable
          ? ' You can edit these tables until Production hands over to Logistics.'
          : ''}
      </p>
      {data.products.length === 0 && (
        <EmptyState title="No products yet">Products are listed with the PI.</EmptyState>
      )}
      {data.products.map((p) => (
        <section
          key={p.id}
          aria-labelledby={`product-${p.id}`}
          className="bg-card rounded-xl border"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
            <h3 id={`product-${p.id}`} className="flex items-center gap-2 text-sm font-semibold">
              {p.name}
              <StatusPill tone={p.total > 0 && p.delivered === p.total ? 'green' : 'amber'}>
                {p.delivered} of {p.total} delivered
              </StatusPill>
            </h3>
            {data.editable && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDialog({ productId: p.id, productName: p.name, row: null })}
              >
                <Plus aria-hidden /> Add component
              </Button>
            )}
          </div>
          {p.components.length === 0 ? (
            <p className="text-muted-foreground p-4 text-[13px]">No components yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] tabular-nums">
                <caption className="sr-only">Components of {p.name}</caption>
                <thead className="bg-surface-subtle text-muted-foreground text-left text-xs">
                  <tr>
                    {[
                      'Sr.',
                      'Prod Name',
                      'Type',
                      'PO Qty',
                      'Order Qty',
                      'PO Date',
                      'Days since PO',
                      'Dispatch',
                      'Deliver',
                      'LR Details',
                      'Challan No.',
                      'Trident Remark',
                      'TNS Remark',
                      '',
                    ].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="border-b px-3 py-2 font-medium whitespace-nowrap"
                      >
                        {h || <span className="sr-only">Actions</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.components.map((c) => (
                    <tr key={c.id}>
                      <td className={cell}>{c.srNo}</td>
                      <td className={cell + ' font-medium'}>{c.name}</td>
                      <td className={cell}>{TAG_LABEL[c.kind]}</td>
                      <td className={cell}>{c.poQuantity ?? '—'}</td>
                      <td className={cell}>{c.orderQuantity ?? '—'}</td>
                      <td className={cell}>{c.poDate ?? '—'}</td>
                      <td className={cell}>{c.daysSincePo ?? (c.delivered ? 'Delivered' : '—')}</td>
                      <td className={cell}>{c.dispatchDate ?? '—'}</td>
                      <td className={cell}>
                        {c.deliverDate ? (
                          <StatusPill tone="green">{c.deliverDate}</StatusPill>
                        ) : (
                          <StatusPill tone="amber">Waiting</StatusPill>
                        )}
                      </td>
                      <td className={cell}>{c.lrDetails ?? '—'}</td>
                      <td className={cell}>{c.challanNo ?? '—'}</td>
                      <td className={cell + ' max-w-56 whitespace-normal'}>
                        {c.tridentRemark ?? '—'}
                      </td>
                      <td className={cell + ' max-w-56 whitespace-normal'}>{c.tnsRemark ?? '—'}</td>
                      <td className={cell + ' text-right'}>
                        <span className="flex justify-end gap-1">
                          {data.editable && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8"
                              aria-label={`Edit ${c.name}`}
                              onClick={() =>
                                setDialog({ productId: p.id, productName: p.name, row: c })
                              }
                            >
                              <Pencil aria-hidden />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8"
                            aria-label={`History of ${c.name}`}
                            onClick={() => setHistoryRow(c)}
                          >
                            <History aria-hidden />
                          </Button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
      {dialog && (
        <ComponentDialog
          key={dialog.row?.id ?? `new-${dialog.productId}`}
          orderId={orderId}
          productId={dialog.productId}
          productName={dialog.productName}
          row={dialog.row}
          open
          onOpenChange={(o) => !o && setDialog(null)}
        />
      )}
      <HistoryDialog row={historyRow} onClose={() => setHistoryRow(null)} />
    </div>
  );
}
