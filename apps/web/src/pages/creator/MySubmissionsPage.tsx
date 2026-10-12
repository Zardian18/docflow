import type { MySubmissionsQuery, WorkflowStatus, WorkflowSummary } from '@docflow/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Link } from 'react-router';
import { Pagination } from '@/components/ListControls';
import { ListFilterBar } from '@/components/ListFilters';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable';
import { EmptyState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { WorkflowStatusPill } from '@/components/WorkflowStatusPill';
import { api } from '@/lib/api';
import { dayEnd, dayStart, STATUS_CHOICES, useListFilters } from '@/lib/list-filters';
import { formatDate } from '@/lib/format';

const SPEC = {
  sorts: [
    { value: 'submitted', label: 'Submitted', kind: 'date' },
    { value: 'updated', label: 'Last updated', kind: 'date' },
    { value: 'document', label: 'Document', kind: 'text' },
    { value: 'company', label: 'Company', kind: 'text' },
    { value: 'status', label: 'Status', kind: 'status' },
  ],
  defaultSort: 'submitted',
  defaultDir: 'desc',
  statuses: STATUS_CHOICES,
} as const;

/** Screen 05, with the Admin Dashboard's filters and sort. */
export function MySubmissionsPage() {
  const state = useListFilters(SPEC);
  const { filters } = state;
  const query: MySubmissionsQuery = {
    page: filters.page,
    pageSize: 20,
    status: filters.status as WorkflowStatus | undefined,
    companyId: filters.companyId,
    submittedFrom: dayStart(filters.from),
    submittedTo: dayEnd(filters.to),
    q: filters.q,
    sort: filters.sort as MySubmissionsQuery['sort'],
    dir: filters.dir,
  };
  const list = useQuery({
    queryKey: ['workflows', 'mine', query],
    queryFn: ({ signal }) => api.workflows.mine(query, signal),
    placeholderData: keepPreviousData,
  });

  const columns: Column<WorkflowSummary>[] = [
    {
      key: 'document',
      header: 'Document',
      primary: true,
      sortKey: 'document',
      cell: (w) => (
        <Link to={`/submissions/${w.id}`} className="font-medium break-all hover:underline">
          {w.fileName}
        </Link>
      ),
    },
    { key: 'company', header: 'Company', sortKey: 'company', cell: (w) => w.companyName },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (w) => <WorkflowStatusPill status={w.status} position={w.currentPosition} />,
    },
    {
      key: 'with',
      header: 'Currently With',
      cell: (w) => (
        <span className="text-muted-foreground">
          {w.currentWith.length ? w.currentWith.join(', ') : '—'}
        </span>
      ),
    },
    {
      key: 'submitted',
      header: 'Submitted',
      sortKey: 'submitted',
      className: 'whitespace-nowrap',
      cell: (w) => <span className="text-muted-foreground">{formatDate(w.submittedAt)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="My Submissions"
        description="Documents you have uploaded and their current status"
        actions={
          <Button asChild>
            <Link to="/submit">
              <Plus aria-hidden /> New Submission
            </Link>
          </Button>
        }
      />
      <PageBody>
        <ListFilterBar
          key={state.barKey}
          state={state}
          spec={SPEC}
          companies={list.data?.companies}
          dates="Submitted"
          total={list.data?.total}
          noun={['document', 'documents']}
        />
        <ResponsiveTable
          caption="My submissions"
          columns={columns}
          rows={list.data?.items}
          rowKey={(w) => w.id}
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
              <EmptyState title="No submissions yet">
                Upload a document from{' '}
                <Link to="/submit" className="text-primary hover:underline">
                  New Submission
                </Link>{' '}
                to start an approval.
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
      </PageBody>
    </>
  );
}
