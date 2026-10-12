import type { DecisionHistoryItem, DecisionHistoryQuery, WorkflowStatus } from '@docflow/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Pagination } from '@/components/ListControls';
import { ListFilterBar } from '@/components/ListFilters';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable';
import { EmptyState } from '@/components/States';
import { StatusPill } from '@/components/StatusPill';
import { WorkflowStatusPill } from '@/components/WorkflowStatusPill';
import { api } from '@/lib/api';
import { dayEnd, dayStart, STATUS_CHOICES, useListFilters } from '@/lib/list-filters';
import { formatDate } from '@/lib/format';
import { REVIEWER, type ReviewerKind } from './reviewer';

const SPEC = {
  sorts: [
    { value: 'decided', label: 'Decided', kind: 'date' },
    { value: 'document', label: 'Document', kind: 'text' },
    { value: 'company', label: 'Company', kind: 'text' },
    { value: 'status', label: 'Document status', kind: 'status' },
  ],
  defaultSort: 'decided',
  defaultDir: 'desc',
  statuses: STATUS_CHOICES,
  decisions: [
    { value: 'APPROVED', label: 'I approved' },
    { value: 'REJECTED', label: 'I rejected' },
  ],
} as const;

/**
 * Not in Figma: past decisions for approvers and the CFO, in the screen 05 style, with the
 * Admin Dashboard's filters and sort.
 */
export function HistoryPage({ kind }: { kind: ReviewerKind }) {
  const state = useListFilters(SPEC);
  const { filters } = state;
  const query: DecisionHistoryQuery = {
    page: filters.page,
    pageSize: 20,
    decision: filters.decision as DecisionHistoryQuery['decision'],
    status: filters.status as WorkflowStatus | undefined,
    companyId: filters.companyId,
    decidedFrom: dayStart(filters.from),
    decidedTo: dayEnd(filters.to),
    q: filters.q,
    sort: filters.sort as DecisionHistoryQuery['sort'],
    dir: filters.dir,
  };
  const history = useQuery({
    queryKey: ['approvals', 'history', query],
    queryFn: ({ signal }) => api.approvals.history(query, signal),
    placeholderData: keepPreviousData,
  });
  const base = REVIEWER[kind].base;

  const columns: Column<DecisionHistoryItem>[] = [
    {
      key: 'document',
      header: 'Document',
      primary: true,
      sortKey: 'document',
      cell: (h) => (
        <Link to={`${base}/${h.workflowId}`} className="font-medium break-all hover:underline">
          {h.fileName}
        </Link>
      ),
    },
    { key: 'company', header: 'Company', sortKey: 'company', cell: (h) => h.companyName },
    {
      key: 'mine',
      header: 'Your Decision',
      cell: (h) => (
        <StatusPill tone={h.myDecision === 'APPROVED' ? 'green' : 'red'}>
          {h.myDecision === 'APPROVED' ? 'Approved' : 'Rejected'}
        </StatusPill>
      ),
    },
    {
      key: 'decided',
      header: 'Decided',
      sortKey: 'decided',
      className: 'whitespace-nowrap',
      cell: (h) => <span className="text-muted-foreground">{formatDate(h.decidedAt)}</span>,
    },
    {
      key: 'status',
      header: 'Document Status',
      sortKey: 'status',
      cell: (h) => <WorkflowStatusPill status={h.status} position={h.currentPosition} />,
    },
  ];

  return (
    <>
      <PageHeader
        title={REVIEWER[kind].historyTitle}
        description={REVIEWER[kind].historyDescription}
      />
      <PageBody>
        <ListFilterBar
          key={state.barKey}
          state={state}
          spec={SPEC}
          companies={history.data?.companies}
          dates="Decided"
          total={history.data?.total}
          noun={['decision', 'decisions']}
        />
        <ResponsiveTable
          caption="Decision history"
          columns={columns}
          rows={history.data?.items}
          rowKey={(h) => h.workflowId}
          isPending={history.isPending}
          error={history.error}
          onRetry={() => history.refetch()}
          sort={{ key: filters.sort, dir: filters.dir }}
          onSort={state.onSort}
          empty={
            state.active ? (
              <EmptyState title="No decisions match these filters">
                Change or clear the filters to see more.
              </EmptyState>
            ) : (
              <EmptyState title="No decisions yet">
                Documents you approve or reject will be listed here.
              </EmptyState>
            )
          }
        />
        {history.data && (
          <Pagination
            page={filters.page}
            pageSize={history.data.pageSize}
            total={history.data.total}
            onPage={state.setPage}
          />
        )}
      </PageBody>
    </>
  );
}
