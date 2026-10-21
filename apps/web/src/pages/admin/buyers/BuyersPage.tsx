import { SLOT_INFO, type Buyer } from '@docflow/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Link } from 'react-router';
import { Pagination, SearchField, StatusSelect, useListState } from '@/components/ListControls';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable';
import { EmptyState } from '@/components/States';
import { ActivePill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { MastersTabs } from '../MastersLayout';

/** Buyer Master (Q3): the buyer is the company an order is for, with its default chain (D27) */
export function BuyersPage() {
  const list = useListState();
  const buyers = useQuery({
    queryKey: ['buyers', list.query],
    queryFn: ({ signal }) => api.buyers.list(list.query, signal),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Buyer>[] = [
    {
      key: 'name',
      header: 'Buyer',
      primary: true,
      cell: (b) => (
        <span className="flex flex-col">
          <span className="font-medium">{b.name}</span>
          {b.code && <span className="text-muted-foreground text-xs">{b.code}</span>}
        </span>
      ),
    },
    {
      key: 'country',
      header: 'Country',
      cell: (b) => <span className="text-muted-foreground">{b.country ?? '—'}</span>,
    },
    {
      key: 'chain',
      header: 'Default chain',
      className: 'min-w-64',
      cell: (b) => {
        const missing = b.slots.filter((s) => s.people.length === 0).length;
        const marketing = b.slots.find((s) => s.slot === 'MARKETING')?.people[0]?.name;
        return (
          <span className="flex flex-col text-[13px]">
            <span>
              {marketing ? `${SLOT_INFO.MARKETING.label}: ${marketing}` : 'No Marketing person yet'}
            </span>
            <span
              className={missing ? 'text-status-amber text-xs' : 'text-muted-foreground text-xs'}
            >
              {missing
                ? `${missing} role${missing === 1 ? '' : 's'} still empty`
                : 'Everyone named'}
            </span>
          </span>
        );
      },
    },
    { key: 'status', header: 'Status', cell: (b) => <ActivePill active={b.isActive} /> },
    {
      key: 'actions',
      header: 'Actions',
      action: true,
      className: 'w-20 text-right',
      cell: (b) => (
        <Button variant="outline" size="sm" asChild>
          <Link to={`/admin/buyers/${b.id}`} aria-label={`Edit ${b.name}`}>
            Edit
          </Link>
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Buyer Master"
        description="The companies you sell to, and each one’s default approval chain"
        actions={
          <Button asChild>
            <Link to="/admin/buyers/new">
              <Plus aria-hidden /> Add Buyer
            </Link>
          </Button>
        }
      />
      <PageBody>
        <MastersTabs />
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <SearchField
            label="Search buyers"
            placeholder="Search name, code or country"
            value={list.q}
            onChange={list.setQ}
          />
          <StatusSelect value={list.status} onChange={list.setStatus} />
        </div>
        <ResponsiveTable
          caption="Buyers"
          columns={columns}
          rows={buyers.data?.items}
          rowKey={(b) => b.id}
          isPending={buyers.isPending}
          error={buyers.error}
          onRetry={() => buyers.refetch()}
          empty={
            list.query.q || list.status !== 'all' ? (
              <EmptyState title="No buyers match">Try a different search or status.</EmptyState>
            ) : (
              <EmptyState title="No buyers yet">
                Add a buyer and its default chain, so Marketing can start orders for it.
              </EmptyState>
            )
          }
        />
        {buyers.data && (
          <Pagination
            page={list.page}
            pageSize={buyers.data.pageSize}
            total={buyers.data.total}
            onPage={list.setPage}
          />
        )}
        <p className="text-muted-foreground mt-4 text-[13px]">
          Each buyer names who works on its orders and, for every approval, whether all of them must
          approve or any one is enough. Orders copy this when they are created; Marketing can change
          it for one order, and later edits here don’t affect existing orders.
        </p>
      </PageBody>
    </>
  );
}
