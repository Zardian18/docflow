import { type Company } from '@docflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { DeleteButton } from '@/components/ConfirmDeleteDialog';
import { Field, FormError } from '@/components/forms';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SlotEditor } from '@/components/SlotEditor';
import { emptySlots, slotValueProblems, type SlotValue } from '@/lib/slots';
import { api, ApiError, errorMessage } from '@/lib/api';

const DetailsSchema = z.object({
  name: z.string().trim().min(1, 'Enter the company name').max(120),
  code: z.string().trim().max(20, 'Use 20 characters or fewer'),
  isActive: z.boolean(),
});
type Details = z.infer<typeof DetailsSchema>;

function RulesNote() {
  return (
    <aside className="bg-card rounded-xl border p-5 text-[13px] leading-relaxed">
      <h2 className="mb-3 text-sm font-semibold">How named people work</h2>
      <ul className="text-muted-foreground flex list-disc flex-col gap-2.5 pl-4">
        <li>Every new order for this company copies these people and settings.</li>
        <li>
          Marketing can change the people for one order when creating it. The ALL/ANY settings
          always come from here.
        </li>
        <li>
          One person can fill several roles here, the Creator included. They act and approve
          separately in each role.
        </li>
        <li>Team steps (Regulation, Materials and so on) go to everyone in that team.</li>
        <li>
          Empty slots can be filled later, but orders can’t start until every slot has someone.
        </li>
      </ul>
    </aside>
  );
}

function CompanyForm({ company }: { company: Company | null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [slots, setSlots] = useState<SlotValue[]>(() =>
    company
      ? company.slots.map((s) => ({ slot: s.slot, people: s.people, gate: s.gate }))
      : emptySlots(),
  );
  const form = useForm<Details>({
    resolver: zodResolver(DetailsSchema),
    defaultValues: {
      name: company?.name ?? '',
      code: company?.code ?? '',
      isActive: company?.isActive ?? true,
    },
  });

  const save = useMutation({
    mutationFn: (details: Details) => {
      const body = {
        ...details,
        slots: slots.map((s) => ({
          slot: s.slot,
          employeeIds: s.people.map((p) => p.id),
          gate: s.gate,
        })),
      };
      return company ? api.companies.update(company.id, body) : api.companies.create(body);
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      toast.success(company ? `Saved ${saved.name}` : `Added ${saved.name}`);
      navigate('/admin/companies');
    },
  });

  const errors = form.formState.errors;
  const serverProblems =
    save.error instanceof ApiError && save.error.code === 'INVALID_SLOTS'
      ? ((save.error.details as { slots?: Record<string, string> })?.slots ?? {})
      : {};
  const problems = { ...slotValueProblems(slots, false), ...serverProblems };
  const onSubmit = form.handleSubmit((details) => {
    if (Object.keys(slotValueProblems(slots, false)).length > 0) return;
    save.mutate(details);
  });

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]"
    >
      <div className="flex min-w-0 flex-col gap-5">
        <FormError message={save.error ? errorMessage(save.error) : undefined} />

        <section className="bg-card rounded-xl border p-5 sm:p-6" aria-labelledby="details-heading">
          <h2 id="details-heading" className="mb-4 text-sm font-semibold">
            Company details
          </h2>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Field label="Company name" error={errors.name?.message}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  placeholder="e.g. Microtech Pvt Ltd"
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  {...form.register('name')}
                />
              )}
            </Field>
            <Field
              label="Code (optional)"
              error={errors.code?.message}
              hint="Marketing can search by it."
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  placeholder="e.g. MIC"
                  className="uppercase"
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  {...form.register('code')}
                />
              )}
            </Field>
            <Field label="Status" hint="New orders can’t use inactive companies.">
              {({ id, describedBy }) => (
                <Controller
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <Select
                      value={field.value ? 'active' : 'inactive'}
                      onValueChange={(v) => field.onChange(v === 'active')}
                    >
                      <SelectTrigger id={id} aria-describedby={describedBy} className="w-full">
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
          </div>
        </section>

        <section className="bg-card rounded-xl border p-5 sm:p-6" aria-labelledby="people-heading">
          <div className="mb-4">
            <h2 id="people-heading" className="text-sm font-semibold">
              Named people
            </h2>
            <p className="text-muted-foreground mt-1 text-[13px]">
              Who works on this company’s orders, and for each approval, whether everyone named must
              approve or any one is enough.
            </p>
          </div>
          <SlotEditor value={slots} onChange={setSlots} showGates problems={problems} />
        </section>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {company && (
            <DeleteButton
              name={company.name}
              what="company"
              onDelete={() => api.companies.remove(company.id)}
              onDeleted={() => {
                queryClient.invalidateQueries({ queryKey: ['companies'] });
                navigate('/admin/companies');
              }}
            />
          )}
          <Button type="button" variant="outline" asChild>
            <Link to="/admin/companies">Cancel</Link>
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : company ? 'Save company' : 'Add company'}
          </Button>
        </div>
      </div>
      <RulesNote />
    </form>
  );
}

export function CompanyFormPage() {
  const { id } = useParams();
  const company = useQuery({
    queryKey: ['companies', 'detail', id],
    queryFn: ({ signal }) => api.companies.get(id!, signal),
    enabled: Boolean(id),
  });

  const title = id ? (company.data ? `Edit ${company.data.name}` : 'Edit company') : 'Add company';
  return (
    <>
      <PageHeader
        title={title}
        description={
          <Link
            to="/admin/companies"
            className="hover:text-foreground inline-flex items-center gap-1"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
            Companies
          </Link>
        }
      />
      <PageBody>
        {!id ? (
          <CompanyForm company={null} />
        ) : company.isPending ? (
          <div className="flex flex-col gap-5" aria-busy="true">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        ) : company.error ? (
          <ErrorState error={company.error} onRetry={() => company.refetch()} />
        ) : (
          <CompanyForm key={company.data.id} company={company.data} />
        )}
      </PageBody>
    </>
  );
}
