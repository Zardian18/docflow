import type { PendingApproval } from '@docflow/shared';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable';
import { StatCard } from '@/components/StatCard';
import { EmptyState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { REVIEWER, type ReviewerKind } from './reviewer';

/** Screen 06 (approver) and screen 09 (CFO). */
export function PendingPage({ kind }: { kind: ReviewerKind }) {
  const copy = REVIEWER[kind];
  const pending = useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: ({ signal }) => api.approvals.pending(signal),
    // Someone else's decision can put a document in front of me; keep the list fresh
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
  const stats = pending.data?.stats;

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
      cell: (p) => <span className="font-medium break-all">{p.fileName}</span>,
    },
    { key: 'company', header: 'Company', cell: (p) => p.companyName },
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
      <PageHeader title={copy.pendingTitle} description={copy.pendingDescription} />
      <PageBody>
        <div className="mb-5 grid grid-cols-1 gap-3 min-[420px]:grid-cols-3 sm:gap-4">
          <StatCard label={copy.stats[0]} value={stats?.awaiting} />
          <StatCard label={copy.stats[1]} value={stats?.approved} />
          <StatCard label={copy.stats[2]} value={stats?.rejected} />
        </div>
        <ResponsiveTable
          caption={copy.pendingTitle}
          columns={columns}
          rows={pending.data?.items}
          rowKey={(p) => p.workflowId}
          isPending={pending.isPending}
          error={pending.error}
          onRetry={() => pending.refetch()}
          empty={<EmptyState title={copy.emptyTitle}>{copy.emptyBody}</EmptyState>}
        />
      </PageBody>
    </>
  );
}
