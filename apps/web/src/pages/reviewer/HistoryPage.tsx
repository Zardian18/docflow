import type { DecisionHistoryItem } from '@docflow/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Pagination } from '@/components/ListControls';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable';
import { EmptyState } from '@/components/States';
import { StatusPill } from '@/components/StatusPill';
import { WorkflowStatusPill } from '@/components/WorkflowStatusPill';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { REVIEWER, type ReviewerKind } from './reviewer';

/** Not in Figma: past decisions for approvers and the CFO, in the screen 05 style. */
export function HistoryPage({ kind }: { kind: ReviewerKind }) {
  const [page, setPage] = useState(1);
  const history = useQuery({
    queryKey: ['approvals', 'history', page],
    queryFn: ({ signal }) => api.approvals.history({ page, pageSize: 20 }, signal),
    placeholderData: keepPreviousData,
  });
  const base = REVIEWER[kind].base;

  const columns: Column<DecisionHistoryItem>[] = [
    {
      key: 'document',
      header: 'Document',
      primary: true,
      cell: (h) => (
        <Link to={`${base}/${h.workflowId}`} className="font-medium break-all hover:underline">
          {h.fileName}
        </Link>
      ),
    },
    { key: 'company', header: 'Company', cell: (h) => h.companyName },
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
      className: 'whitespace-nowrap',
      cell: (h) => <span className="text-muted-foreground">{formatDate(h.decidedAt)}</span>,
    },
    {
      key: 'status',
      header: 'Document Status',
      cell: (h) => <WorkflowStatusPill status={h.status} position={h.currentPosition} />,
    },
  ];

  return (
    <>
      <PageHeader title="History" description={REVIEWER[kind].historyDescription} />
      <PageBody>
        <ResponsiveTable
          caption="Decision history"
          columns={columns}
          rows={history.data?.items}
          rowKey={(h) => h.workflowId}
          isPending={history.isPending}
          error={history.error}
          onRetry={() => history.refetch()}
          empty={
            <EmptyState title="No decisions yet">
              Documents you approve or reject will be listed here.
            </EmptyState>
          }
        />
        {history.data && (
          <Pagination
            page={page}
            pageSize={history.data.pageSize}
            total={history.data.total}
            onPage={setPage}
          />
        )}
      </PageBody>
    </>
  );
}
