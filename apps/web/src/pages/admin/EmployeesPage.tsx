import { EmployeeUpdate, type Employee, type PasswordLink } from '@docflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Check, Copy, Link2, Plus } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { DeleteButton } from '@/components/ConfirmDeleteDialog';
import { Field, FormError } from '@/components/forms';
import { Pagination, SearchField, StatusSelect, useListState } from '@/components/ListControls';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable';
import { EmptyState } from '@/components/States';
import { ActivePill, StatusPill } from '@/components/StatusPill';
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
import { PERMISSION_LABEL } from './permissions';

type FormValues = z.input<typeof EmployeeUpdate>;

function useActiveRoles() {
  return useQuery({
    queryKey: ['roles', 'active-options'],
    queryFn: ({ signal }) => api.roles.list({ status: 'active', pageSize: 100 }, signal),
  });
}

/** Shows a one-time set-password link to copy and send to the employee (D16). */
function PasswordLinkDialog({
  link,
  name,
  onClose,
}: {
  link: PasswordLink | null;
  name: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copy failed. Select the link and copy it manually.');
    }
  };
  return (
    <Dialog open={link !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Password link for {name}</DialogTitle>
          <DialogDescription>
            Send this link to {name} directly. It works once and expires{' '}
            {link ? format(new Date(link.expiresAt), "d MMM yyyy 'at' h:mm a") : ''}. Issuing a new
            link cancels this one.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            readOnly
            value={link?.url ?? ''}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Set-password link"
            className="font-mono text-xs"
          />
          <Button onClick={copy} className="shrink-0">
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmployeeDialog({
  employee,
  open,
  onOpenChange,
  onCreated,
}: {
  employee: Employee | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (e: Employee) => void;
}) {
  const queryClient = useQueryClient();
  const roles = useActiveRoles();
  const editing = employee !== null;
  const form = useForm<FormValues>({
    resolver: zodResolver(EmployeeUpdate),
    values: employee
      ? {
          name: employee.name,
          email: employee.email,
          employeeCode: employee.employeeCode ?? '',
          roleId: employee.roleId,
          isActive: employee.isActive,
        }
      : { name: '', email: '', employeeCode: '', roleId: '', isActive: true },
  });
  const save = useMutation({
    mutationFn: (v: FormValues) =>
      employee ? api.employees.update(employee.id, v) : api.employees.create(v),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      queryClient.invalidateQueries({ queryKey: ['cfo'] });
      onOpenChange(false);
      if (editing) toast.success(`Saved ${saved.name}`);
      else onCreated(saved);
    },
  });
  const errors = form.formState.errors;
  // Roles list for the picker: active roles, plus the employee's current role if it's inactive
  const roleOptions = roles.data?.items ?? [];

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
          <DialogTitle>{editing ? 'Edit employee' : 'Add employee'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Deactivate people who leave, so past approvals stay readable. Delete is only for entries with no history.'
              : 'They sign in with this email. After saving you’ll get a link to send them so they can set a password.'}
          </DialogDescription>
        </DialogHeader>
        <form
          id="employee-form"
          noValidate
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((v) => save.mutate(v))}
        >
          <FormError message={save.error ? errorMessage(save.error) : undefined} />
          <Field label="Full name" error={errors.name?.message}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                autoComplete="off"
                aria-describedby={describedBy}
                aria-invalid={invalid}
                {...form.register('name')}
              />
            )}
          </Field>
          <Field
            label="Email"
            error={errors.email?.message}
            hint="Used to sign in and for notifications."
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="name@company.com"
                aria-describedby={describedBy}
                aria-invalid={invalid}
                {...form.register('email')}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Employee code (optional)" error={errors.employeeCode?.message}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  placeholder="e.g. EMP-0231"
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  {...form.register('employeeCode')}
                />
              )}
            </Field>
            <Field label="Role" error={errors.roleId ? 'Choose a role' : undefined}>
              {({ id, describedBy, invalid }) => (
                <Controller
                  control={form.control}
                  name="roleId"
                  render={({ field }) => (
                    <Select value={field.value || undefined} onValueChange={field.onChange}>
                      <SelectTrigger
                        id={id}
                        aria-describedby={describedBy}
                        aria-invalid={invalid}
                        className="w-full"
                      >
                        <SelectValue
                          placeholder={roles.isPending ? 'Loading roles…' : 'Choose a role'}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {employee && !roleOptions.some((r) => r.id === employee.roleId) && (
                          <SelectItem value={employee.roleId}>
                            {employee.roleName} (inactive)
                          </SelectItem>
                        )}
                        {roleOptions.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                            {r.name !== PERMISSION_LABEL[r.permission] && (
                              <span className="text-muted-foreground">
                                {' '}
                                · {PERMISSION_LABEL[r.permission]}
                              </span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
            </Field>
          </div>
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
                    >
                      <SelectTrigger id={id} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive (can’t sign in)</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
            </Field>
          )}
        </form>
        <DialogFooter>
          {employee && (
            <DeleteButton
              name={employee.name}
              what="employee"
              onDelete={() => api.employees.remove(employee.id)}
              onDeleted={() => {
                queryClient.invalidateQueries({ queryKey: ['employees'] });
                queryClient.invalidateQueries({ queryKey: ['roles'] });
                queryClient.invalidateQueries({ queryKey: ['cfo'] });
                onOpenChange(false);
              }}
            />
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="employee-form" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : editing ? 'Save employee' : 'Add employee'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EmployeesPage() {
  const list = useListState();
  const employees = useQuery({
    queryKey: ['employees', list.query],
    queryFn: ({ signal }) => api.employees.list(list.query, signal),
    placeholderData: keepPreviousData,
  });
  const [dialog, setDialog] = useState<{ open: boolean; employee: Employee | null }>({
    open: false,
    employee: null,
  });
  const [linkFor, setLinkFor] = useState<{ name: string; link: PasswordLink | null }>({
    name: '',
    link: null,
  });
  const queryClient = useQueryClient();

  const issueLink = useMutation({
    mutationFn: (e: Employee) => api.employees.passwordLink(e.id).then((link) => ({ e, link })),
    onSuccess: ({ e, link }) => {
      setLinkFor({ name: e.name, link });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const columns: Column<Employee>[] = [
    {
      key: 'name',
      header: 'Name',
      primary: true,
      cell: (e) => (
        <span className="flex flex-col">
          <span className="font-medium">{e.name}</span>
          <span className="text-muted-foreground text-xs break-all md:hidden">{e.email}</span>
        </span>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      className: 'hidden md:table-cell',
      cell: (e) => <span className="text-muted-foreground break-all">{e.email}</span>,
    },
    {
      key: 'code',
      header: 'Code',
      cell: (e) => <span className="text-muted-foreground">{e.employeeCode ?? '—'}</span>,
    },
    {
      key: 'role',
      header: 'Role',
      cell: (e) => (
        <span>
          {e.roleName}
          {e.roleName !== PERMISSION_LABEL[e.permission] && (
            <span className="text-muted-foreground text-xs">
              {' '}
              · {PERMISSION_LABEL[e.permission]}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (e) =>
        e.isActive && !e.hasPassword ? (
          <StatusPill tone="amber">Invited</StatusPill>
        ) : (
          <ActivePill active={e.isActive} />
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      action: true,
      className: 'w-px whitespace-nowrap text-right',
      cell: (e) => (
        <span className="flex justify-end gap-2">
          {e.isActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => issueLink.mutate(e)}
              disabled={issueLink.isPending}
              aria-label={`Create password link for ${e.name}`}
            >
              <Link2 aria-hidden />
              {e.hasPassword ? 'Reset link' : 'Invite link'}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDialog({ open: true, employee: e })}
            aria-label={`Edit ${e.name}`}
          >
            Edit
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Employee Master"
        description="Everyone who can sign in, and the role each person holds"
        actions={
          <Button onClick={() => setDialog({ open: true, employee: null })}>
            <Plus aria-hidden /> Add Employee
          </Button>
        }
      />
      <PageBody>
        <MastersTabs />
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <SearchField
            label="Search employees"
            placeholder="Search name, email or code"
            value={list.q}
            onChange={list.setQ}
          />
          <StatusSelect value={list.status} onChange={list.setStatus} />
        </div>
        <ResponsiveTable
          caption="Employees"
          columns={columns}
          rows={employees.data?.items}
          rowKey={(e) => e.id}
          isPending={employees.isPending}
          error={employees.error}
          onRetry={() => employees.refetch()}
          empty={
            list.query.q || list.status !== 'all' ? (
              <EmptyState title="No employees match">Try a different search or status.</EmptyState>
            ) : (
              <EmptyState title="No employees yet">
                Add the people who will create, approve and sign off documents.
              </EmptyState>
            )
          }
        />
        {employees.data && (
          <Pagination
            page={list.page}
            pageSize={employees.data.pageSize}
            total={employees.data.total}
            onPage={list.setPage}
          />
        )}
      </PageBody>
      <EmployeeDialog
        employee={dialog.employee}
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onCreated={(e) => issueLink.mutate(e)}
      />
      <PasswordLinkDialog
        link={linkFor.link}
        name={linkFor.name}
        onClose={() => setLinkFor({ name: '', link: null })}
      />
    </>
  );
}
