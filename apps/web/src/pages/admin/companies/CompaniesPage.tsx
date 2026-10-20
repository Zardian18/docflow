import { SLOT_INFO, type Company } from '@docflow/shared';
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

export function CompaniesPage() {
  const list = useListState();
  const companies = useQuery({
    queryKey: ['companies', list.query],
    queryFn: ({ signal }) => api.companies.list(list.query, signal),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Company>[] = [
    {
      key: 'name',
      header: 'Company Name',
      primary: true,
      cell: (c) => <span className="font-medium">{c.name}</span>,
    },
    {
      key: 'code',
      header: 'Company Code',
      cell: (c) => <span className="text-muted-foreground">{c.code ?? '—'}</span>,
    },
    {
      key: 'people',
      header: 'Named people',
      className: 'min-w-64',
      cell: (c) => {
        const missing = c.slots.filter((s) => s.people.length === 0).length;
        const marketing = c.slots.find((s) => s.slot === 'MARKETING')?.people[0]?.name;
        return (
          <span className="flex flex-col text-[13px]">
            <span>
              {marketing ? `${SLOT_INFO.MARKETING.label}: ${marketing}` : 'No Marketing person yet'}
            </span>
            <span
              className={missing ? 'text-status-amber text-xs' : 'text-muted-foreground text-xs'}
            >
              {missing
                ? `${missing} slot${missing === 1 ? '' : 's'} still empty`
                : 'Everyone named'}
            </span>
          </span>
        );
      },
    },
    { key: 'status', header: 'Status', cell: (c) => <ActivePill active={c.isActive} /> },
    {
      key: 'actions',
      header: 'Actions',
      action: true,
      className: 'w-20 text-right',
      cell: (c) => (
        <Button variant="outline" size="sm" asChild>
          <Link to={`/admin/companies/${c.id}`} aria-label={`Edit ${c.name}`}>
            Edit
          </Link>
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Company Master"
        description="Manage companies and their default approval chains"
        actions={
          <Button asChild>
            <Link to="/admin/companies/new">
              <Plus aria-hidden /> Add Company
            </Link>
          </Button>
        }
      />
      <PageBody>
        <MastersTabs />
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <SearchField
            label="Search companies"
            placeholder="Search name or code"
            value={list.q}
            onChange={list.setQ}
          />
          <StatusSelect value={list.status} onChange={list.setStatus} />
        </div>
        <ResponsiveTable
          caption="Companies"
          columns={columns}
          rows={companies.data?.items}
          rowKey={(c) => c.id}
          isPending={companies.isPending}
          error={companies.error}
          onRetry={() => companies.refetch()}
          empty={
            list.query.q || list.status !== 'all' ? (
              <EmptyState title="No companies match">Try a different search or status.</EmptyState>
            ) : (
              <EmptyState title="No companies yet">
                Add a company and name its people, so Marketing can start orders for it.
              </EmptyState>
            )
          }
        />
        {companies.data && (
          <Pagination
            page={list.page}
            pageSize={companies.data.pageSize}
            total={companies.data.total}
            onPage={list.setPage}
          />
        )}
        <p className="text-muted-foreground mt-4 text-[13px]">
          Each company names who approves its orders, and whether every Head Approver must approve
          or any one is enough. Orders copy these when they are created; later changes don’t affect
          them.
        </p>
      </PageBody>
    </>
  );
}
