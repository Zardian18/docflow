import { DOC_KIND_LABEL, findTemplate, SLOT_INFO, type OrderDetail } from '@docflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, Eye } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { FormError } from '@/components/forms';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ErrorState, ListSkeleton } from '@/components/States';
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
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { formatAmount, formatDateTime, formatFileSize } from '@/lib/format';
import { clockText, ORDER_TONE, orderRef, orderStatusLabel, PHASE_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { ChainView } from './ChainView';
import { ComponentTablesView } from './ComponentTablesView';
import { OrderHistory } from './OrderHistory';
import { TaskActionCard } from './TaskActionCard';

type Tab = 'chain' | 'materials' | 'history' | 'details';

async function openDocument(id: string, mode: 'view' | 'download') {
  try {
    const link = await api.documents.fileLink(id, mode);
    if (mode === 'view') window.open(link.url, '_blank', 'noopener');
    else window.location.assign(link.url);
  } catch (err) {
    toast.error(errorMessage(err));
  }
}

function CancelDialog({
  order,
  open,
  onOpenChange,
}: {
  order: OrderDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => api.orders.cancel(order.id, reason),
    onSuccess: () => {
      toast.success(`${orderRef(order.number)} cancelled`);
      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      queryClient.invalidateQueries({ queryKey: ['work'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel {orderRef(order.number)}?</DialogTitle>
          <DialogDescription>
            Every open step stops. The order and its history stay readable.
          </DialogDescription>
        </DialogHeader>
        <FormError message={cancel.error ? errorMessage(cancel.error) : undefined} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cancel-reason" className="text-muted-foreground text-[13px] font-normal">
            Reason (required)
          </Label>
          <Textarea
            id="cancel-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep the order
          </Button>
          <Button
            variant="destructive"
            disabled={!reason.trim() || cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {cancel.isPending ? 'Cancelling…' : 'Cancel order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Details({ order }: { order: OrderDetail }) {
  const [cancelOpen, setCancelOpen] = useState(false);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="bg-card rounded-xl border p-4 sm:p-5" aria-labelledby="named-people">
        <h3 id="named-people" className="mb-3 text-sm font-semibold">
          Named people
        </h3>
        <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
          {order.slots.map((s) => (
            <div key={s.slot} className="contents">
              <dt className="text-muted-foreground">{SLOT_INFO[s.slot].label}</dt>
              <dd>
                {s.people.map((p) => p.name).join(', ') || '—'}
                {s.gate && s.people.length > 1 && (
                  <span className="text-muted-foreground">
                    {' '}
                    · {s.gate === 'ALL' ? 'all must approve' : 'any one is enough'}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="bg-card rounded-xl border p-4 sm:p-5" aria-labelledby="order-docs">
        <h3 id="order-docs" className="mb-3 text-sm font-semibold">
          Documents you can open
        </h3>
        {order.documents.length === 0 ? (
          <p className="text-muted-foreground text-[13px]">None yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-[13px]">
            {[...order.documents].reverse().map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <b className="font-medium">{DOC_KIND_LABEL[d.kind]}</b> ·{' '}
                  <span className="break-all">{d.fileName}</span>
                  <span className="text-muted-foreground block text-xs">
                    {formatFileSize(d.fileSize)} · {d.uploadedByName},{' '}
                    {formatDateTime(d.uploadedAt)}
                  </span>
                </span>
                <span className="flex gap-1">
                  {(d.fileMime === 'application/pdf' || d.fileMime.startsWith('image/')) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void openDocument(d.id, 'view')}
                    >
                      <Eye aria-hidden /> View
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void openDocument(d.id, 'download')}
                  >
                    <Download aria-hidden /> Download
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {order.payments.length > 0 && (
        <section className="bg-card rounded-xl border p-4 sm:p-5" aria-labelledby="order-payments">
          <h3 id="order-payments" className="mb-3 text-sm font-semibold">
            Payments verified by Accounts
          </h3>
          <ul className="flex flex-col gap-2 text-[13px]">
            {order.payments.map((p) => (
              <li key={p.id}>
                <b className="font-medium">
                  {p.kind === 'ADVANCE' ? 'Advance' : 'Remaining payment'}
                </b>
                : {formatAmount(p.amount, p.currency)}, received {p.receivedOn}
                {p.reference && ` · ref ${p.reference}`}
                <span className="text-muted-foreground block text-xs">
                  Verified by {p.verifiedByName}, {formatDateTime(p.verifiedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="bg-card rounded-xl border p-4 sm:p-5" aria-labelledby="order-about">
        <h3 id="order-about" className="mb-3 text-sm font-semibold">
          About this order
        </h3>
        <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
          <dt className="text-muted-foreground">Created</dt>
          <dd>
            {formatDateTime(order.createdAt)} by {order.createdByName}
          </dd>
          <dt className="text-muted-foreground">Buyer’s requirements</dt>
          <dd className="whitespace-pre-wrap">{order.notes ?? '—'}</dd>
          <dt className="text-muted-foreground">Workflow</dt>
          <dd>Version {order.templateVersion}</dd>
          {order.cancelReason && (
            <>
              <dt className="text-muted-foreground">Cancelled</dt>
              <dd>{order.cancelReason}</dd>
            </>
          )}
        </dl>
        {order.canCancel && (
          <Button variant="outline" className="mt-4" onClick={() => setCancelOpen(true)}>
            Cancel order…
          </Button>
        )}
      </section>
      <CancelDialog order={order} open={cancelOpen} onOpenChange={setCancelOpen} />
    </div>
  );
}

/** One order: what waits for you, the live chain, the material tables and the history */
export function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const tab = (
    ['chain', 'materials', 'history', 'details'].includes(params.get('tab') ?? '')
      ? params.get('tab')
      : 'chain'
  ) as Tab;
  const order = useQuery({
    queryKey: ['order', id],
    queryFn: ({ signal }) => api.orders.get(id!, signal),
    refetchOnWindowFocus: true,
  });
  // Coming from a dashboard row (#task-…): scroll to that step once it has rendered
  useEffect(() => {
    if (order.data && location.hash.startsWith('#task-')) {
      document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' });
    }
  }, [order.data, location.hash]);

  if (order.isPending) {
    return (
      <PageBody>
        <ListSkeleton />
      </PageBody>
    );
  }
  if (order.error) {
    return (
      <PageBody>
        <ErrorState error={order.error} onRetry={() => order.refetch()} />
      </PageBody>
    );
  }
  const o = order.data!;
  const template = findTemplate(o.templateKey, o.templateVersion);
  const mine = o.tasks.filter((t) => t.actions.length > 0);
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'chain', label: 'Chain' },
    ...(o.canSeeComponents ? [{ key: 'materials' as const, label: 'Materials' }] : []),
    { key: 'history', label: 'History' },
    { key: 'details', label: 'Details' },
  ];

  return (
    <>
      <PageHeader
        title={`${orderRef(o.number)} · ${o.buyerName}`}
        description={`${o.company.name} · ${o.status === 'ACTIVE' ? PHASE_LABEL[o.phase] : orderStatusLabel(o.status)}`}
        actions={
          <Button asChild variant="outline">
            <Link to="/orders">
              <ArrowLeft aria-hidden /> All orders
            </Link>
          </Button>
        }
      />
      <PageBody>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="bg-card rounded-xl border px-4 py-3">
            <p className="text-muted-foreground text-xs">Status</p>
            <p className="mt-1">
              <StatusPill tone={ORDER_TONE[o.status]}>{orderStatusLabel(o.status)}</StatusPill>
            </p>
            {o.current.length > 0 && (
              <p className="text-muted-foreground mt-1 text-xs">Now: {o.current.join(', ')}</p>
            )}
          </div>
          <div className="bg-card rounded-xl border px-4 py-3">
            <p className="text-muted-foreground text-xs">Since the buyer confirmed the CBM</p>
            <p className="mt-1 text-sm font-semibold">{clockText(o.trackerB)}</p>
          </div>
          <div className="bg-card rounded-xl border px-4 py-3">
            <p className="text-muted-foreground text-xs">Since production started</p>
            <p className="mt-1 text-sm font-semibold">{clockText(o.trackerA)}</p>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Order sections"
          className="bg-card -mx-4 mb-4 flex overflow-x-auto border-b px-2 sm:mx-0 sm:rounded-t-lg [scrollbar-width:none]"
        >
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setParams(t.key === 'chain' ? {} : { tab: t.key }, { replace: true })}
              className={cn(
                '-mb-px border-b-2 px-3 py-3 text-[13px] whitespace-nowrap sm:px-4 sm:text-sm',
                tab === t.key
                  ? 'border-primary text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground border-transparent',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'chain' && (
          <div className="flex flex-col gap-6">
            {mine.length > 0 && (
              <div className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold">Waiting for you</h2>
                {mine.map((t) => (
                  <TaskActionCard
                    key={`${t.id}-${t.side}-${t.run}`}
                    order={o}
                    task={t}
                    template={template}
                  />
                ))}
              </div>
            )}
            <ChainView order={o} template={template} />
          </div>
        )}
        {tab === 'materials' && <ComponentTablesView orderId={o.id} />}
        {tab === 'history' && <OrderHistory order={o} template={template} />}
        {tab === 'details' && <Details order={o} />}
      </PageBody>
    </>
  );
}
