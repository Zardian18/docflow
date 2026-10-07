import type { WorkflowSummary } from '@docflow/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Pagination } from '@/components/ListControls';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable';
import { EmptyState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { WorkflowStatusPill } from '@/components/WorkflowStatusPill';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

/** Screen 05. */
export function MySubmissionsPage() {
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['workflows', 'mine', page],
    queryFn: ({ signal }) => api.workflows.mine({ page, pageSize: 20 }, signal),
    placeholderData: keepPreviousData,
  });

  const columns: Column<WorkflowSummary>[] = [
    {
      key: 'document',
      header: 'Document',
      primary: true,
      cell: (w) => (
        <Link to={`/submissions/${w.id}`} className="font-medium break-all hover:underline">
          {w.fileName}
        </Link>
      ),
    },
    { key: 'company', header: 'Company', cell: (w) => w.companyName },
    {
      key: 'status',
      header: 'Status',
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
        <ResponsiveTable
          caption="My submissions"
          columns={columns}
          rows={list.data?.items}
          rowKey={(w) => w.id}
          isPending={list.isPending}
          error={list.error}
          onRetry={() => list.refetch()}
          empty={
            <EmptyState title="No submissions yet">
              Upload a document from{' '}
              <Link to="/submit" className="text-primary hover:underline">
                New Submission
              </Link>{' '}
              to start an approval.
            </EmptyState>
          }
        />
        {list.data && (
          <Pagination
            page={page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            onPage={setPage}
          />
        )}
      </PageBody>
    </>
  );
}
