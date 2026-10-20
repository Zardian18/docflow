import {
  CURRENT_TEMPLATE,
  DOC_KIND_LABEL,
  TAG_LABEL,
  TAGS,
  WORK_SORTS,
  type Tag,
  type WorkItem,
  type WorkQuery,
} from '@docflow/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { SearchField, useDebounced } from '@/components/ListControls';
import { DocumentButtons } from '@/components/DocumentButtons';
import { ChoiceSelect } from '@/components/ListFilters';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable';
import { EmptyState } from '@/components/States';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { clockText, days, waitedFor } from '@/lib/labels';
import { cn } from '@/lib/utils';

const STAGES = CURRENT_TEMPLATE.steps
  .filter((s) => s.kind !== 'DATA_GATE')
  .map((s) => ({ value: s.key, label: s.title }));

const SORT_LABEL: Record<(typeof WORK_SORTS)[number], string> = {
  waiting: 'Waiting longest',
  held: 'With you longest',
  order: 'Order number',
  buyer: 'Buyer',
  trackerA: 'Production start',
  trackerB: 'Order start',
};

/**
 * Everything waiting for this person (Q8): one list, a tab per team and one for steps they
 * are named on, longest-waiting first (brief, cross-cutting 4). Filters live in the URL.
 */
export function WorkPage() {
  const me = useMe().data!;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? undefined;
  const query: WorkQuery = {
    tab: get('tab') as WorkQuery['tab'],
    buyerId: get('buyerId'),
    stepKey: get('stepKey'),
    tag: TAGS.includes(get('tag') as Tag) ? (get('tag') as Tag) : undefined,
    q: get('q'),
    sort: WORK_SORTS.includes(get('sort') as never)
      ? (get('sort') as WorkQuery['sort'])
      : 'waiting',
    dir: get('dir') === 'desc' ? 'desc' : 'asc',
  };
  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };
  const work = useQuery({
    queryKey: ['work', query],
    queryFn: ({ signal }) => api.work(query, signal),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const [q, setQ] = useState(query.q ?? '');
  const debounced = useDebounced(q.trim(), 300);
  useEffect(() => {
    if ((query.q ?? '') !== debounced) update({ q: debounced || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to typing
  }, [debounced]);

  const showTags = me.teams.includes('MATERIALS') && (!query.tab || query.tab === 'MATERIALS');
  const filtered = Boolean(query.buyerId || query.stepKey || query.tag || query.q);
  const total = work.data?.tabs.reduce((n, t) => n + t.count, 0);

  const columns: Column<WorkItem>[] = [
    {
      key: 'order',
      header: 'Order',
      primary: true,
      sortKey: 'order',
      cell: (w) => (
        <Link to={`/orders/${w.orderId}#task-${w.taskId}`} className="font-medium hover:underline">
          {w.orderRef} · {w.buyerName}
        </Link>
      ),
    },
    {
      key: 'step',
      header: 'Waiting for you',
      cell: (w) => (
        <span className="flex flex-col gap-1">
          <span>
            {w.title}
            {w.productName && <span className="text-muted-foreground"> · {w.productName}</span>}
          </span>
          <span className="flex flex-wrap gap-1.5">
            <StatusPill tone="blue">{w.as.label}</StatusPill>
            {w.tag && <StatusPill tone="grey">{TAG_LABEL[w.tag]}</StatusPill>}
          </span>
        </span>
      ),
    },
    {
      key: 'documents',
      header: 'Latest document',
      cell: (w) =>
        w.documents.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {w.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-muted-foreground text-xs">{DOC_KIND_LABEL[d.kind]}</span>
                <DocumentButtons doc={d} size="xs" />
              </li>
            ))}
          </ul>
        ),
    },
    {
      key: 'waiting',
      header: 'Waiting',
      sortKey: 'waiting',
      className: 'whitespace-nowrap',
      cell: (w) => (
        <span className="flex flex-col" title={formatDateTime(w.waitingSince)}>
          <span className="text-status-amber font-medium">{waitedFor(w.waitingSince)}</span>
          <span className="text-muted-foreground text-xs">since {formatDate(w.waitingSince)}</span>
        </span>
      ),
    },
    {
      key: 'held',
      header: 'With you in total',
      sortKey: 'held',
      className: 'whitespace-nowrap',
      cell: (w) => (w.held ? days(w.held.days) : '—'),
    },
    {
      key: 'clocks',
      header: 'Order clocks',
      cell: (w) => (
        <span className="text-muted-foreground flex flex-col text-xs">
          <span>Order: {clockText(w.trackerB)}</span>
          <span>Production: {clockText(w.trackerA)}</span>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="My Work"
        description="Everything waiting for you, the longest-waiting first"
      />
      <PageBody>
        <div
          role="tablist"
          aria-label="Work by team"
          className="bg-card -mx-4 mb-4 flex overflow-x-auto border-b px-2 sm:mx-0 sm:rounded-t-lg [scrollbar-width:none]"
        >
          {[{ tab: '', label: 'All my work', count: total }, ...(work.data?.tabs ?? [])].map(
            (t) => {
              const active = (query.tab ?? '') === t.tab;
              return (
                <button
                  key={t.tab || 'all'}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => update({ tab: t.tab || undefined, tag: undefined })}
                  className={cn(
                    '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-3 text-[13px] whitespace-nowrap sm:px-4 sm:text-sm',
                    active
                      ? 'border-primary text-primary font-medium'
                      : 'text-muted-foreground hover:text-foreground border-transparent',
                  )}
                >
                  {t.label}
                  {t.count !== undefined && (
                    <span
                      className={cn(
                        'rounded-full px-1.5 text-xs tabular-nums',
                        active ? 'bg-primary-soft text-primary' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              );
            },
          )}
        </div>

        <section aria-label="Filters" className="bg-card mb-4 rounded-xl border p-3 sm:p-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <SearchField
              label="Search work"
              placeholder="Buyer or order number"
              value={q}
              onChange={setQ}
            />
            <ChoiceSelect
              label="Buyer"
              anyLabel="All buyers"
              value={query.buyerId}
              choices={(work.data?.buyers ?? []).map((b) => ({ value: b.id, label: b.name }))}
              onChange={(buyerId) => update({ buyerId })}
            />
            <ChoiceSelect
              label="Stage"
              anyLabel="All stages"
              value={query.stepKey}
              choices={STAGES}
              onChange={(stepKey) => update({ stepKey })}
            />
            {showTags && (
              <ChoiceSelect
                label="Task type"
                anyLabel="Raw material and packaging"
                value={query.tag}
                choices={TAGS.map((t) => ({ value: t, label: TAG_LABEL[t] }))}
                onChange={(tag) => update({ tag })}
              />
            )}
            <ChoiceSelect
              label="Sort by"
              anyLabel="Sort: Waiting longest"
              value={
                query.sort === 'waiting' && query.dir === 'asc'
                  ? undefined
                  : `${query.sort}:${query.dir}`
              }
              choices={WORK_SORTS.flatMap((s) => [
                {
                  value: `${s}:asc`,
                  label: `Sort: ${SORT_LABEL[s]}${s === 'waiting' ? '' : ' (ascending)'}`,
                },
                { value: `${s}:desc`, label: `Sort: ${SORT_LABEL[s]} (reversed)` },
              ]).filter((c) => c.value !== 'waiting:asc')}
              onChange={(v) => {
                const [sort, dir] = (v ?? 'waiting:asc').split(':');
                update({
                  sort: sort === 'waiting' ? undefined : sort,
                  dir: dir === 'asc' ? undefined : dir,
                });
              }}
            />
          </div>
        </section>
        <div className="mb-2 flex min-h-8 items-center justify-between gap-2 text-sm">
          <p className="text-muted-foreground" aria-live="polite">
            {work.data ? `${work.data.items.length} waiting` : ''}
          </p>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ('');
                update({
                  buyerId: undefined,
                  stepKey: undefined,
                  tag: undefined,
                  q: undefined,
                });
              }}
            >
              <X aria-hidden /> Clear filters
            </Button>
          )}
        </div>
        <ResponsiveTable
          caption="Work waiting for you"
          cardsBelow="xl"
          columns={columns}
          rows={work.data?.items}
          rowKey={(w) => w.taskId}
          isPending={work.isPending}
          error={work.error}
          onRetry={() => work.refetch()}
          sort={{ key: query.sort ?? 'waiting', dir: query.dir ?? 'asc' }}
          onSort={(key) =>
            update({
              sort: key === 'waiting' ? undefined : key,
              dir: query.sort === key ? (query.dir === 'asc' ? 'desc' : undefined) : undefined,
            })
          }
          onRowClick={(w) => navigate(`/orders/${w.orderId}#task-${w.taskId}`)}
          empty={
            filtered ? (
              <EmptyState title="Nothing matches these filters">
                Change or clear the filters to see more.
              </EmptyState>
            ) : (
              <EmptyState title="Nothing is waiting for you">
                Steps appear here as soon as they reach your team or you.
              </EmptyState>
            )
          }
        />
      </PageBody>
    </>
  );
}
