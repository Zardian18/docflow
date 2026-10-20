import type { Buyer, BuyerUpsert } from '@docflow/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { DeleteButton } from '@/components/ConfirmDeleteDialog';
import { FormError } from '@/components/forms';
import { Pagination, SearchField, StatusSelect, useListState } from '@/components/ListControls';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable';
import { EmptyState } from '@/components/States';
import { ActivePill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { MastersTabs } from './MastersLayout';

function BuyerDialog({ buyer, onClose }: { buyer: Buyer | null; onClose: () => void }) {
  const id = useId();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({
    name: buyer?.name ?? '',
    country: buyer?.country ?? '',
    address: buyer?.address ?? '',
    contact: buyer?.contact ?? '',
    isActive: buyer?.isActive ?? true,
  });
  const save = useMutation({
    mutationFn: () => {
      const body: BuyerUpsert = draft;
      return buyer ? api.buyers.update(buyer.id, body) : api.buyers.create(body);
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['buyers'] });
      queryClient.invalidateQueries({ queryKey: ['lookup-buyers'] });
      toast.success(buyer ? `Saved ${saved.name}` : `Added ${saved.name}`);
      onClose();
    },
  });
  const field = (k: 'name' | 'country' | 'contact', label: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${id}-${k}`} className="text-muted-foreground text-[13px] font-normal">
        {label}
      </Label>
      <Input
        id={`${id}-${k}`}
        value={draft[k]}
        onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
      />
    </div>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{buyer ? `Edit ${buyer.name}` : 'Add buyer'}</DialogTitle>
          <DialogDescription>Buyers are chosen when Marketing creates an order.</DialogDescription>
        </DialogHeader>
        <form
          id={`${id}-form`}
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.name.trim()) save.mutate();
          }}
        >
          <FormError message={save.error ? errorMessage(save.error) : undefined} />
          {field('name', 'Buyer name')}
          {field('country', 'Country (optional)')}
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor={`${id}-address`}
              className="text-muted-foreground text-[13px] font-normal"
            >
              Address (optional)
            </Label>
            <Textarea
              id={`${id}-address`}
              rows={3}
              value={draft.address}
              onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))}
            />
          </div>
          {field('contact', 'Contact (optional)')}
          {buyer && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={draft.isActive}
                onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
              />
              Active (inactive buyers can’t be chosen for new orders)
            </label>
          )}
        </form>
        <DialogFooter>
          {buyer && (
            <DeleteButton
              name={buyer.name}
              what="buyer"
              onDelete={() => api.buyers.remove(buyer.id)}
              onDeleted={() => {
                queryClient.invalidateQueries({ queryKey: ['buyers'] });
                onClose();
              }}
            />
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} disabled={save.isPending || !draft.name.trim()}>
            {save.isPending ? 'Saving…' : buyer ? 'Save buyer' : 'Add buyer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Buyer Master (Q3) */
export function BuyersPage() {
  const me = useMe().data!;
  const list = useListState();
  const buyers = useQuery({
    queryKey: ['buyers', list.query],
    queryFn: ({ signal }) => api.buyers.list(list.query, signal),
    placeholderData: keepPreviousData,
  });
  const [dialog, setDialog] = useState<{ buyer: Buyer | null } | null>(null);
  const columns: Column<Buyer>[] = [
    {
      key: 'name',
      header: 'Buyer',
      primary: true,
      cell: (b) => <span className="font-medium">{b.name}</span>,
    },
    { key: 'country', header: 'Country', cell: (b) => b.country ?? '—' },
    {
      key: 'contact',
      header: 'Contact',
      cell: (b) => <span className="text-muted-foreground">{b.contact ?? '—'}</span>,
    },
    { key: 'status', header: 'Status', cell: (b) => <ActivePill active={b.isActive} /> },
    {
      key: 'actions',
      header: 'Actions',
      action: true,
      className: 'w-20 text-right',
      cell: (b) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDialog({ buyer: b })}
          aria-label={`Edit ${b.name}`}
        >
          Edit
        </Button>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Buyers"
        description="The buyers orders are made for"
        actions={
          <Button onClick={() => setDialog({ buyer: null })}>
            <Plus aria-hidden /> Add Buyer
          </Button>
        }
      />
      <PageBody>
        {me.capabilities.includes('ADMIN') && <MastersTabs />}
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <SearchField
            label="Search buyers"
            placeholder="Search name or country"
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
          empty={<EmptyState title="No buyers yet">Add the buyers you make orders for.</EmptyState>}
        />
        {buyers.data && (
          <Pagination
            page={list.page}
            pageSize={buyers.data.pageSize}
            total={buyers.data.total}
            onPage={list.setPage}
          />
        )}
      </PageBody>
      {dialog && (
        <BuyerDialog
          key={dialog.buyer?.id ?? 'new'}
          buyer={dialog.buyer}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
