import {
  CURRENT_TEMPLATE,
  ORDER_SORTS,
  ORDER_STATUSES,
  type OrderListQuery,
  type OrderStatus,
  type OrderSummary,
} from '@docflow/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Pagination, SearchField, useDebounced } from '@/components/ListControls';
import { ChoiceSelect, DateField } from '@/components/ListFilters';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable';
import { EmptyState } from '@/components/States';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { clockText, ORDER_TONE, orderRef, orderStatusLabel, PHASE_LABEL } from '@/lib/labels';
import { dayEnd, dayStart } from '@/lib/list-filters';

const STAGES = CURRENT_TEMPLATE.steps.map((s) => ({ value: s.key, label: s.title }));

/** Every order this person may see: Admin all, others theirs and their teams’ (§4.8). */
export function OrdersPage() {
  const me = useMe().data!;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? undefined;
  const page = Math.max(1, Number(get('page')) || 1);
  const sort = ORDER_SORTS.includes(get('sort') as never)
    ? (get('sort') as OrderListQuery['sort'])
    : 'updated';
  const query: OrderListQuery = {
    page,
    pageSize: 20,
    status: ORDER_STATUSES.includes(get('status') as OrderStatus)
      ? (get('status') as OrderStatus)
      : undefined,
    phase: get('phase') ? Number(get('phase')) : undefined,
    buyerId: get('buyerId'),
    companyId: get('companyId'),
    stepKey: get('stepKey'),
    createdFrom: dayStart(get('from')),
    createdTo: dayEnd(get('to')),
    q: get('q'),
    sort,
    dir: get('dir') === 'asc' ? 'asc' : 'desc',
  };
  const update = (patch: Record<string, string | undefined>, keepPage = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!keepPage) next.delete('page');
    setParams(next, { replace: !keepPage });
  };
  const orders = useQuery({
    queryKey: ['orders', query],
    queryFn: ({ signal }) => api.orders.list(query, signal),
    placeholderData: keepPreviousData,
  });
  const buyers = useQuery({
    queryKey: ['lookup-buyers'],
    queryFn: ({ signal }) => api.lookups.buyers('', signal),
  });
  const companies = useQuery({
    queryKey: ['lookup-companies'],
    queryFn: ({ signal }) => api.lookups.companies('', signal),
  });

  const [q, setQ] = useState(query.q ?? '');
  const debounced = useDebounced(q.trim(), 300);
  useEffect(() => {
    if ((query.q ?? '') !== debounced) update({ q: debounced || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to typing
  }, [debounced]);
  const filtered = ['status', 'phase', 'buyerId', 'companyId', 'stepKey', 'from', 'to', 'q'].some(
    (k) => params.get(k),
  );

  const columns: Column<OrderSummary>[] = [
    {
      key: 'order',
      header: 'Order',
      primary: true,
      sortKey: 'number',
      cell: (o) => (
        <Link to={`/orders/${o.id}`} className="font-medium hover:underline">
          {orderRef(o.number)}
        </Link>
      ),
    },
    { key: 'buyer', header: 'Buyer', sortKey: 'buyer', cell: (o) => o.buyerName },
    { key: 'company', header: 'Company', cell: (o) => o.company.name },
    {
      key: 'status',
      header: 'Status',
      cell: (o) => (
        <span className="flex flex-col items-start gap-1">
          <StatusPill tone={ORDER_TONE[o.status]}>{orderStatusLabel(o.status)}</StatusPill>
          {o.status === 'ACTIVE' && (
            <span className="text-muted-foreground text-xs">Phase {o.phase}</span>
          )}
        </span>
      ),
    },
    {
      key: 'current',
      header: 'Now',
      cell: (o) => (
        <span className="text-muted-foreground text-[13px]">
          {o.current.length ? o.current.join(', ') : '—'}
        </span>
      ),
    },
    {
      key: 'trackerB',
      header: 'Since order start',
      sortKey: 'trackerB',
      className: 'whitespace-nowrap',
      cell: (o) => <span className="text-[13px]">{clockText(o.trackerB)}</span>,
    },
    {
      key: 'trackerA',
      header: 'Since production start',
      sortKey: 'trackerA',
      className: 'whitespace-nowrap',
      cell: (o) => <span className="text-[13px]">{clockText(o.trackerA)}</span>,
    },
    {
      key: 'updated',
      header: 'Last change',
      sortKey: 'updated',
      className: 'whitespace-nowrap',
      cell: (o) => <span className="text-muted-foreground">{formatDate(o.updatedAt)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Orders"
        description={
          me.capabilities.includes('ADMIN')
            ? 'Every order, with where each one is now'
            : 'Orders you are named on, and orders your teams work on'
        }
        actions={
          me.capabilities.includes('MARKETING') ? (
            <Button asChild>
              <Link to="/orders/new">
                <Plus aria-hidden /> New Order
              </Link>
            </Button>
          ) : undefined
        }
      />
      <PageBody>
        <section aria-label="Filters" className="bg-card mb-4 rounded-xl border p-3 sm:p-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <SearchField
              label="Search orders"
              placeholder="Buyer or order number"
              value={q}
              onChange={setQ}
            />
            <ChoiceSelect
              label="Status"
              anyLabel="All statuses"
              value={query.status}
              choices={ORDER_STATUSES.map((s) => ({ value: s, label: orderStatusLabel(s) }))}
              onChange={(status) => update({ status })}
            />
            <ChoiceSelect
              label="Phase"
              anyLabel="All phases"
              value={query.phase ? String(query.phase) : undefined}
              choices={[1, 2, 3].map((p) => ({ value: String(p), label: PHASE_LABEL[p]! }))}
              onChange={(phase) => update({ phase })}
            />
            <ChoiceSelect
              label="Buyer"
              anyLabel="All buyers"
              value={query.buyerId}
              choices={(buyers.data ?? []).map((b) => ({ value: b.id, label: b.name }))}
              onChange={(buyerId) => update({ buyerId })}
            />
            <ChoiceSelect
              label="Company"
              anyLabel="All companies"
              value={query.companyId}
              choices={(companies.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
              onChange={(companyId) => update({ companyId })}
            />
            <ChoiceSelect
              label="Stage now"
              anyLabel="Any stage"
              value={query.stepKey}
              choices={STAGES}
              onChange={(stepKey) => update({ stepKey })}
            />
            <DateField
              label="Created from"
              value={get('from')}
              max={get('to')}
              onChange={(from) => update({ from })}
            />
            <DateField
              label="To"
              value={get('to')}
              min={get('from')}
              onChange={(to) => update({ to })}
            />
          </div>
        </section>
        <div className="mb-2 flex min-h-8 items-center justify-between gap-2 text-sm">
          <p className="text-muted-foreground" aria-live="polite">
            {orders.data ? `${orders.data.total} order${orders.data.total === 1 ? '' : 's'}` : ''}
          </p>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ('');
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              <X aria-hidden /> Clear filters
            </Button>
          )}
        </div>
        <ResponsiveTable
          caption="Orders"
          cardsBelow="xl"
          columns={columns}
          rows={orders.data?.items}
          rowKey={(o) => o.id}
          isPending={orders.isPending}
          error={orders.error}
          onRetry={() => orders.refetch()}
          sort={{ key: sort ?? 'updated', dir: query.dir ?? 'desc' }}
          onSort={(key) =>
            update({ sort: key, dir: sort === key && query.dir === 'desc' ? 'asc' : undefined })
          }
          onRowClick={(o) => navigate(`/orders/${o.id}`)}
          empty={
            filtered ? (
              <EmptyState title="No orders match these filters">
                Change or clear the filters to see more.
              </EmptyState>
            ) : (
              <EmptyState title="No orders yet">
                Orders appear here once Marketing creates them.
              </EmptyState>
            )
          }
        />
        {orders.data && (
          <Pagination
            page={page}
            pageSize={orders.data.pageSize}
            total={orders.data.total}
            onPage={(p) => update({ page: p > 1 ? String(p) : undefined }, true)}
          />
        )}
      </PageBody>
    </>
  );
}
