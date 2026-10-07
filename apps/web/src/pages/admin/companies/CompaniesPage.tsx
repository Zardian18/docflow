import type { Company } from '@docflow/shared';
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
import { ChainSummary } from '@/components/chain/ChainSummary';

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
      key: 'chain',
      header: 'Default Approvers (in order)',
      className: 'min-w-64',
      cell: (c) => <ChainSummary approvers={c.approvers} />,
    },
    { key: 'status', header: 'Status', cell: (c) => <ActivePill active={c.isActive} /> },
    {
      key: 'actions',
      header: 'Actions',
      action: true,
      className: 'w-20 text-right',
      cell: (c) => (
        <Button variant="outline" size="sm" asChild>
          <Link to={`/admin/masters/companies/${c.id}`} aria-label={`Edit ${c.name}`}>
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
            <Link to="/admin/masters/companies/new">
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
                Add a company and its default approvers so Creators can start submitting documents.
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
          Only Admin can create, edit, or reorder a company’s default approvers. A company needs at
          least 2 approvers before the CFO. The CFO is always last and fixed.
        </p>
      </PageBody>
    </>
  );
}
