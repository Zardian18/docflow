import type {
  PendingApproval,
  PendingQuery,
  RejectedBeforeFinalItem,
  RejectedBeforeFinalQuery,
} from '@docflow/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { ArrowRight } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { Pagination } from '@/components/ListControls';
import { ListFilterBar } from '@/components/ListFilters';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable';
import { StatCard } from '@/components/StatCard';
import { EmptyState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useListFilters } from '@/lib/list-filters';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { REVIEWER, type ReviewerKind } from './reviewer';

type CfoView = 'pending' | 'rejected';

// Everything pending has the same status, so these lists have no status filter
const PENDING_SPEC = {
  sorts: [
    { value: 'waiting', label: 'Waiting since', kind: 'date' },
    { value: 'document', label: 'Document', kind: 'text' },
    { value: 'company', label: 'Company', kind: 'text' },
  ],
  defaultSort: 'waiting',
  // Oldest first: what has waited longest comes first
  defaultDir: 'asc',
} as const;

const REJECTED_SPEC = {
  sorts: [
    { value: 'rejected', label: 'Rejected on', kind: 'date' },
    { value: 'document', label: 'Document', kind: 'text' },
    { value: 'company', label: 'Company', kind: 'text' },
  ],
  defaultSort: 'rejected',
  defaultDir: 'desc',
} as const;

/** CFO dashboard tabs; the chosen tab lives in the URL (?view=rejected) so it survives refresh. */
function ViewTabs({
  view,
  onChange,
  pendingCount,
  rejectedCount,
}: {
  view: CfoView;
  onChange: (v: CfoView) => void;
  pendingCount?: number;
  rejectedCount?: number;
}) {
  const tab = (value: CfoView, label: string, count?: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === value}
      onClick={() => onChange(value)}
      className={cn(
        '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-3 text-[13px] whitespace-nowrap transition-colors sm:px-4 sm:text-sm',
        view === value
          ? 'border-primary text-primary font-medium'
          : 'text-muted-foreground hover:text-foreground border-transparent',
      )}
    >
      {label}
      {count !== undefined && (
        <span
          className={cn(
            'rounded-full px-1.5 text-xs tabular-nums',
            view === value ? 'bg-primary-soft text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
  return (
    <div
      role="tablist"
      aria-label="Final approval lists"
      className="bg-card -mx-4 mb-4 flex overflow-x-auto border-b px-2 sm:mx-0 sm:rounded-t-lg [scrollbar-width:none]"
    >
      {tab('pending', 'Pending final approval', pendingCount)}
      {tab('rejected', 'Rejected before final approval', rejectedCount)}
    </div>
  );
}

/** D22: documents an approver rejected before they reached the CFO. Read-only. */
function RejectedBeforeFinalList() {
  const state = useListFilters(REJECTED_SPEC);
  const { filters } = state;
  const query: RejectedBeforeFinalQuery = {
    page: filters.page,
    pageSize: 20,
    companyId: filters.companyId,
    q: filters.q,
    sort: filters.sort as RejectedBeforeFinalQuery['sort'],
    dir: filters.dir,
  };
  const list = useQuery({
    queryKey: ['approvals', 'rejected-before-final', query],
    queryFn: ({ signal }) => api.approvals.rejectedBeforeFinal(query, signal),
    placeholderData: keepPreviousData,
  });
  const columns: Column<RejectedBeforeFinalItem>[] = [
    {
      key: 'document',
      header: 'Document',
      primary: true,
      sortKey: 'document',
      cell: (r) => (
        <Link
          to={`/final-approvals/${r.workflowId}`}
          className="font-medium break-all hover:underline"
        >
          {r.fileName}
        </Link>
      ),
    },
    { key: 'company', header: 'Company', sortKey: 'company', cell: (r) => r.companyName },
    {
      key: 'by',
      header: 'Rejected By',
      cell: (r) => (
        <span>
          {r.rejectedBy} <span className="text-muted-foreground">(Position {r.position})</span>
        </span>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      className: 'max-w-xs',
      cell: (r) => (
        <span className="text-muted-foreground line-clamp-2 break-words">{r.reason ?? '—'}</span>
      ),
    },
    {
      key: 'when',
      header: 'Rejected On',
      sortKey: 'rejected',
      className: 'whitespace-nowrap',
      cell: (r) => <span className="text-muted-foreground">{formatDate(r.rejectedAt)}</span>,
    },
  ];
  return (
    <>
      <ListFilterBar
        key={state.barKey}
        state={state}
        spec={REJECTED_SPEC}
        companies={list.data?.companies}
        total={list.data?.total}
        noun={['document', 'documents']}
      />
      <ResponsiveTable
        caption="Rejected before final approval"
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.workflowId}
        isPending={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        sort={{ key: filters.sort, dir: filters.dir }}
        onSort={state.onSort}
        empty={
          state.active ? (
            <EmptyState title="No documents match these filters">
              Change or clear the filters to see more.
            </EmptyState>
          ) : (
            <EmptyState title="No early rejections">
              Documents an approver rejects before they reach you will be listed here.
            </EmptyState>
          )
        }
      />
      {list.data && (
        <Pagination
          page={filters.page}
          pageSize={list.data.pageSize}
          total={list.data.total}
          onPage={state.setPage}
        />
      )}
    </>
  );
}

function usePending(query: PendingQuery = {}) {
  return useQuery({
    queryKey: ['approvals', 'pending', query],
    queryFn: ({ signal }) => api.approvals.pending(query, signal),
    placeholderData: keepPreviousData,
    // Someone else's decision can put a document in front of me; keep the list fresh
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
}

function PendingList({ kind }: { kind: ReviewerKind }) {
  const copy = REVIEWER[kind];
  const state = useListFilters(PENDING_SPEC);
  const { filters } = state;
  const pending = usePending({
    companyId: filters.companyId,
    q: filters.q,
    sort: filters.sort as PendingQuery['sort'],
    dir: filters.dir,
  });

  const review: Column<PendingApproval> = {
    key: 'review',
    header: 'Review',
    action: true,
    className: 'w-px text-right',
    cell: (p) => (
      <Button size="sm" asChild>
        <Link to={`${copy.base}/${p.workflowId}`} aria-label={`Review ${p.fileName}`}>
          Review
        </Link>
      </Button>
    ),
  };
  const columns: Column<PendingApproval>[] = [
    {
      key: 'document',
      header: 'Document',
      primary: true,
      sortKey: 'document',
      cell: (p) => <span className="font-medium break-all">{p.fileName}</span>,
    },
    { key: 'company', header: 'Company', sortKey: 'company', cell: (p) => p.companyName },
    kind === 'cfo'
      ? {
          key: 'cleared',
          header: 'Cleared By',
          cell: (p) => (
            <span className="text-muted-foreground inline-flex flex-wrap items-center gap-x-1.5">
              {p.clearedBy.map((name, i) => (
                <span key={name} className="inline-flex items-center gap-1.5">
                  {i > 0 && <ArrowRight className="size-3.5" aria-label="then" />}
                  {name}
                </span>
              ))}
            </span>
          ),
        }
      : {
          key: 'position',
          header: 'Position',
          cell: (p) => (
            <span className="text-muted-foreground">
              {p.position} of {p.totalPositions}
            </span>
          ),
        },
    {
      key: 'waiting',
      header: 'Waiting Since',
      sortKey: 'waiting',
      className: 'whitespace-nowrap',
      cell: (p) => (
        <span className="text-status-amber" title={new Date(p.waitingSince).toLocaleString()}>
          {formatDistanceToNowStrict(new Date(p.waitingSince))}
        </span>
      ),
    },
    review,
  ];

  return (
    <>
      <ListFilterBar
        key={state.barKey}
        state={state}
        spec={PENDING_SPEC}
        companies={pending.data?.companies}
        total={pending.data?.items.length}
        noun={['document', 'documents']}
      />
      <ResponsiveTable
        caption={copy.pendingTitle}
        columns={columns}
        rows={pending.data?.items}
        rowKey={(p) => p.workflowId}
        isPending={pending.isPending}
        error={pending.error}
        onRetry={() => pending.refetch()}
        sort={{ key: filters.sort, dir: filters.dir }}
        onSort={state.onSort}
        empty={
          state.active ? (
            <EmptyState title="No documents match these filters">
              Change or clear the filters to see more.
            </EmptyState>
          ) : (
            <EmptyState title={copy.emptyTitle}>{copy.emptyBody}</EmptyState>
          )
        }
      />
    </>
  );
}

/** Screen 06 (approver) and screen 09 (CFO). */
export function PendingPage({ kind }: { kind: ReviewerKind }) {
  const copy = REVIEWER[kind];
  const [params, setParams] = useSearchParams();
  const view: CfoView =
    kind === 'cfo' && params.get('view') === 'rejected' ? 'rejected' : 'pending';
  // Each tab has its own filters, so switching tabs starts with none
  const setView = (v: CfoView) => setParams(v === 'rejected' ? { view: v } : {}, { replace: true });
  // The cards always count everything, whatever the list below is filtered to (unfiltered,
  // this is the same query as the list, so it is fetched once)
  const stats = usePending({ sort: PENDING_SPEC.defaultSort, dir: PENDING_SPEC.defaultDir }).data
    ?.stats;

  return (
    <>
      <PageHeader title={copy.pendingTitle} description={copy.pendingDescription} />
      <PageBody>
        <div className="mb-5 grid grid-cols-1 gap-3 min-[420px]:grid-cols-3 sm:gap-4">
          <StatCard label={copy.stats[0]} value={stats?.awaiting} />
          <StatCard label={copy.stats[1]} value={stats?.approved} />
          <StatCard label={copy.stats[2]} value={stats?.rejected} />
        </div>
        {kind === 'cfo' && (
          <ViewTabs
            view={view}
            onChange={setView}
            pendingCount={stats?.awaiting}
            rejectedCount={stats?.rejectedBeforeFinal}
          />
        )}
        {view === 'rejected' ? <RejectedBeforeFinalList /> : <PendingList kind={kind} />}
      </PageBody>
    </>
  );
}
