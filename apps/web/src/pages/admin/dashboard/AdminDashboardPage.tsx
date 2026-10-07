import { type AdminSort, type AdminWorkflowRow, type WorkflowStatus } from '@docflow/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { Pagination, SearchField, useDebounced } from '@/components/ListControls';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable';
import { StatCard } from '@/components/StatCard';
import { EmptyState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { WorkflowStatusPill } from '@/components/WorkflowStatusPill';
import { api } from '@/lib/api';
import { formatAmount, formatDate } from '@/lib/format';
import {
  DEFAULT_FILTERS,
  hasActiveFilters,
  parseFilters,
  toApiQuery,
  toSearchParams,
  type DashboardFilters,
} from './filters';

const PAGE_SIZE = 20;

// "pa:2" = pending with an approver at position 2
const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'any', label: 'All statuses' },
  { value: 'PENDING_APPROVER', label: 'Pending approver (any)' },
  ...[1, 2, 3, 4, 5].map((n) => ({ value: `pa:${n}`, label: `Pending at position ${n}` })),
  { value: 'PENDING_CFO', label: 'Pending CFO' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'REJECTED', label: 'Rejected' },
];

function statusValue(f: DashboardFilters) {
  if (!f.status) return 'any';
  if (f.status === 'PENDING_APPROVER' && f.position) return `pa:${f.position}`;
  return f.status;
}

function FilterBar({
  filters,
  update,
}: {
  filters: DashboardFilters;
  update: (patch: Partial<DashboardFilters>) => void;
}) {
  const [q, setQ] = useState(filters.q ?? '');
  const debounced = useDebounced(q.trim(), 300);
  useEffect(() => {
    if ((filters.q ?? '') !== debounced) update({ q: debounced || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to typing
  }, [debounced]);

  return (
    <section aria-label="Filters" className="bg-card mb-4 rounded-xl border p-3 sm:p-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_repeat(2,minmax(0,1fr))]">
        <SearchField
          label="Search documents"
          placeholder="Name, invoice no. or vendor"
          value={q}
          onChange={setQ}
        />
        <Select
          value={statusValue(filters)}
          onValueChange={(v) => {
            if (v === 'any') update({ status: undefined, position: undefined });
            else if (v.startsWith('pa:'))
              update({ status: 'PENDING_APPROVER', position: Number(v.slice(3)) });
            else update({ status: v as WorkflowStatus, position: undefined });
          }}
        >
          <SelectTrigger
            className="bg-card h-9 w-full min-w-0 [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate"
            aria-label="Status"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <AsyncCombobox
          label="Company"
          anyLabel="All"
          placeholder="Search companies"
          queryKey="filter-companies"
          value={
            filters.companyId
              ? { id: filters.companyId, label: filters.companyName ?? 'Selected' }
              : null
          }
          search={async (term, signal) =>
            (await api.companies.list({ q: term || undefined, pageSize: 10 }, signal)).items.map(
              (c) => ({
                id: c.id,
                label: c.name,
                hint: c.isActive ? (c.code ?? undefined) : 'Inactive',
              }),
            )
          }
          onChange={(o) => update({ companyId: o?.id, companyName: o?.label })}
        />
        <AsyncCombobox
          label="Created by"
          anyLabel="Anyone"
          placeholder="Search creators"
          queryKey="filter-creators"
          value={
            filters.createdBy
              ? { id: filters.createdBy, label: filters.createdByName ?? 'Selected' }
              : null
          }
          search={async (term, signal) =>
            (
              await api.employees.list(
                { q: term || undefined, pageSize: 10, permission: 'CREATOR' },
                signal,
              )
            ).items.map((e) => ({
              id: e.id,
              label: e.name,
              hint: e.isActive ? undefined : 'Inactive',
            }))
          }
          onChange={(o) => update({ createdBy: o?.id, createdByName: o?.label })}
        />
        <label className="bg-card border-input flex h-9 min-w-0 items-center gap-2 rounded-lg border pl-3 text-sm">
          <span className="text-muted-foreground shrink-0">From</span>
          <Input
            type="date"
            value={filters.from ?? ''}
            max={filters.to}
            onChange={(e) => update({ from: e.target.value || undefined })}
            className="h-full min-w-0 border-0 px-1 shadow-none focus-visible:ring-0"
          />
        </label>
        <label className="bg-card border-input flex h-9 min-w-0 items-center gap-2 rounded-lg border pl-3 text-sm">
          <span className="text-muted-foreground shrink-0">To</span>
          <Input
            type="date"
            value={filters.to ?? ''}
            min={filters.from}
            onChange={(e) => update({ to: e.target.value || undefined })}
            className="h-full min-w-0 border-0 px-1 shadow-none focus-visible:ring-0"
          />
        </label>
      </div>
    </section>
  );
}

/** Screen 02: every document, filterable and sortable; click through to the audit trail. */
export function AdminDashboardPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const filters = parseFilters(params);
  // Bumped by “Clear filters” to remount the filter bar, which resets its search box
  const [filterBarKey, setFilterBarKey] = useState(0);
  const update = (patch: Partial<DashboardFilters>) =>
    setParams(toSearchParams({ ...filters, page: 1, ...patch }), { replace: true });

  const stats = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: ({ signal }) => api.admin.stats(signal),
  });
  const list = useQuery({
    queryKey: ['admin', 'workflows', toApiQuery(filters, PAGE_SIZE)],
    queryFn: ({ signal }) => api.admin.workflows(toApiQuery(filters, PAGE_SIZE), signal),
    placeholderData: keepPreviousData,
  });

  const onSort = (key: string) => {
    const sort = key as AdminSort;
    // Same column toggles direction; a new column starts with the natural order
    const dir =
      filters.sort === sort
        ? filters.dir === 'asc'
          ? 'desc'
          : 'asc'
        : sort === 'submitted' || sort === 'updated'
          ? 'desc'
          : 'asc';
    update({ sort, dir });
  };
  const detailHref = (id: string) => `/admin/workflows/${id}`;

  const columns: Column<AdminWorkflowRow>[] = [
    {
      key: 'document',
      header: 'Document',
      primary: true,
      sortKey: 'document',
      cell: (w) => (
        <Link
          to={detailHref(w.id)}
          state={{ from: params.toString() }}
          className="font-medium break-all hover:underline"
        >
          {w.fileName}
        </Link>
      ),
    },
    { key: 'company', header: 'Company', sortKey: 'company', cell: (w) => w.companyName },
    { key: 'creator', header: 'Created By', cell: (w) => w.createdByName },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (w) => <WorkflowStatusPill status={w.status} position={w.currentPosition} />,
    },
    {
      key: 'invoice',
      header: 'Invoice',
      className: 'hidden 2xl:table-cell',
      cell: (w) =>
        w.invoiceNumber || w.amount ? (
          <span className="text-muted-foreground">
            {w.invoiceNumber}
            {w.invoiceNumber && w.amount ? ' · ' : ''}
            {w.amount ? formatAmount(w.amount, w.currency) : ''}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'submitted',
      header: 'Submitted',
      sortKey: 'submitted',
      className: 'whitespace-nowrap',
      cell: (w) => <span className="text-muted-foreground">{formatDate(w.submittedAt)}</span>,
    },
    {
      key: 'updated',
      header: 'Last Updated',
      sortKey: 'updated',
      className: 'whitespace-nowrap',
      cell: (w) => <span className="text-muted-foreground">{formatDate(w.updatedAt)}</span>,
    },
  ];

  const s = stats.data;
  return (
    <>
      <PageHeader
        title="Admin Dashboard"
        description="View and filter every workflow across all companies"
      />
      <PageBody>
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <StatCard label="Total Workflows" value={s?.total} />
          <StatCard label="Pending Approval" value={s?.pendingApprover} />
          <StatCard label="Pending CFO" value={s?.pendingCfo} />
          <div className="bg-card rounded-xl border px-4 py-3.5 sm:px-5 sm:py-4">
            <p className="text-muted-foreground text-[13px]">Completed / Rejected</p>
            <p className="mt-0.5 text-2xl font-semibold tabular-nums sm:text-[28px]">
              {s ? `${s.completed} / ${s.rejected}` : '…'}
            </p>
          </div>
        </div>

        <FilterBar key={filterBarKey} filters={filters} update={update} />

        <div className="mb-2 flex min-h-8 items-center justify-between gap-2 text-sm">
          <p className="text-muted-foreground" aria-live="polite">
            {list.data ? `${list.data.total} document${list.data.total === 1 ? '' : 's'}` : ''}
          </p>
          {hasActiveFilters(filters) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setParams(toSearchParams(DEFAULT_FILTERS), { replace: true });
                setFilterBarKey((k) => k + 1);
              }}
            >
              <X aria-hidden /> Clear filters
            </Button>
          )}
        </div>

        <ResponsiveTable
          caption="All workflows"
          cardsBelow="xl"
          columns={columns}
          rows={list.data?.items}
          rowKey={(w) => w.id}
          isPending={list.isPending}
          error={list.error}
          onRetry={() => list.refetch()}
          sort={{ key: filters.sort, dir: filters.dir }}
          onSort={onSort}
          onRowClick={(w) => navigate(detailHref(w.id), { state: { from: params.toString() } })}
          empty={
            hasActiveFilters(filters) ? (
              <EmptyState title="No documents match these filters">
                Change or clear the filters to see more.
              </EmptyState>
            ) : (
              <EmptyState title="No documents yet">
                Documents appear here as soon as a Creator submits one.
              </EmptyState>
            )
          }
        />
        {list.data && (
          <Pagination
            page={filters.page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            onPage={(page) => setParams(toSearchParams({ ...filters, page }), { replace: false })}
          />
        )}
      </PageBody>
    </>
  );
}
