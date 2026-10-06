import { PERMISSIONS, RoleCreate, type Permission, type Role } from '@docflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Field, FormError } from '@/components/forms';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, errorMessage } from '@/lib/api';
import { MastersTabs } from './MastersLayout';
import { PERMISSION_DESCRIPTION, PERMISSION_LABEL } from './permissions';

const FormSchema = RoleCreate.extend({ isActive: z.boolean() });
type FormValues = z.infer<typeof FormSchema>;

function RoleDialog({
  role,
  open,
  onOpenChange,
}: {
  role: Role | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const editing = role !== null;
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    values: role
      ? { name: role.name, permission: role.permission, isActive: role.isActive }
      : { name: '', permission: 'APPROVER', isActive: true },
  });
  const save = useMutation({
    mutationFn: (v: FormValues) =>
      role
        ? api.roles.update(role.id, { name: v.name, isActive: v.isActive })
        : api.roles.create(v),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success(editing ? `Saved ${saved.name}` : `Added ${saved.name}`);
      onOpenChange(false);
    },
  });
  const errors = form.formState.errors;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) save.reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit role' : 'Add role'}</DialogTitle>
          <DialogDescription>
            A role is a name employees carry. Its permission decides what they can do, and can’t be
            changed later.
          </DialogDescription>
        </DialogHeader>
        <form
          id="role-form"
          noValidate
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((v) => save.mutate(v))}
        >
          <FormError message={save.error ? errorMessage(save.error) : undefined} />
          <Field label="Role name" error={errors.name?.message}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                placeholder="e.g. Regional Approver"
                aria-describedby={describedBy}
                aria-invalid={invalid}
                {...form.register('name')}
              />
            )}
          </Field>
          <Field
            label="Permission"
            error={errors.permission?.message}
            hint={
              editing
                ? 'Fixed after creation. To change it, create a new role and move people to it.'
                : undefined
            }
          >
            {({ id, describedBy }) => (
              <Controller
                control={form.control}
                name="permission"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => field.onChange(v as Permission)}
                    disabled={editing}
                  >
                    <SelectTrigger id={id} aria-describedby={describedBy} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PERMISSIONS.map((p) => (
                        <SelectItem key={p} value={p}>
                          <span className="flex flex-col items-start">
                            <span>{PERMISSION_LABEL[p]}</span>
                            <span className="text-muted-foreground text-xs">
                              {PERMISSION_DESCRIPTION[p]}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </Field>
          {editing && (
            <Field label="Status">
              {({ id }) => (
                <Controller
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <Select
                      value={field.value ? 'active' : 'inactive'}
                      onValueChange={(v) => field.onChange(v === 'active')}
                      disabled={role?.isSystem}
                    >
                      <SelectTrigger id={id} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
            </Field>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="role-form" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : editing ? 'Save role' : 'Add role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RolesPage() {
  const list = useListState();
  const roles = useQuery({
    queryKey: ['roles', list.query],
    queryFn: ({ signal }) => api.roles.list(list.query, signal),
    placeholderData: keepPreviousData,
  });
  const [dialog, setDialog] = useState<{ open: boolean; role: Role | null }>({
    open: false,
    role: null,
  });

  const columns: Column<Role>[] = [
    {
      key: 'name',
      header: 'Role Name',
      primary: true,
      cell: (r) => <span className="font-medium">{r.name}</span>,
    },
    {
      key: 'permission',
      header: 'Permission',
      cell: (r) => (
        <span>
          {PERMISSION_LABEL[r.permission]}
          <span className="text-muted-foreground hidden text-xs lg:block">
            {PERMISSION_DESCRIPTION[r.permission]}
          </span>
        </span>
      ),
    },
    { key: 'people', header: 'Active employees', cell: (r) => r.activeEmployeeCount },
    {
      key: 'type',
      header: 'Type',
      cell: (r) => (
        <span className="text-muted-foreground">{r.isSystem ? 'Built-in' : 'Custom'}</span>
      ),
    },
    { key: 'status', header: 'Status', cell: (r) => <ActivePill active={r.isActive} /> },
    {
      key: 'actions',
      header: 'Actions',
      action: true,
      className: 'w-20 text-right',
      cell: (r) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDialog({ open: true, role: r })}
          aria-label={`Edit ${r.name}`}
        >
          Edit
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Role Master"
        description="Name the roles people hold and what each one is allowed to do"
        actions={
          <Button onClick={() => setDialog({ open: true, role: null })}>
            <Plus aria-hidden /> Add Role
          </Button>
        }
      />
      <PageBody>
        <MastersTabs />
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <SearchField
            label="Search roles"
            placeholder="Search roles"
            value={list.q}
            onChange={list.setQ}
          />
          <StatusSelect value={list.status} onChange={list.setStatus} />
        </div>
        <ResponsiveTable
          caption="Roles"
          columns={columns}
          rows={roles.data?.items}
          rowKey={(r) => r.id}
          isPending={roles.isPending}
          error={roles.error}
          onRetry={() => roles.refetch()}
          empty={<EmptyState title="No roles match">Try a different search or status.</EmptyState>}
        />
        {roles.data && (
          <Pagination
            page={list.page}
            pageSize={roles.data.pageSize}
            total={roles.data.total}
            onPage={list.setPage}
          />
        )}
      </PageBody>
      <RoleDialog
        role={dialog.role}
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
    </>
  );
}
