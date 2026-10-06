import { groupBySteps, MIN_DEFAULT_APPROVERS, validateChain, type Company } from '@docflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
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
import { api, errorMessage } from '@/lib/api';
import { ChainBuilder, newStepKey, type ChainStep } from './ChainBuilder';

const DetailsSchema = z.object({
  name: z.string().trim().min(1, 'Enter the company name').max(120),
  code: z.string().trim().max(20, 'Use 20 characters or fewer'),
  isActive: z.boolean(),
});
type Details = z.infer<typeof DetailsSchema>;

const toSteps = (company: Company): ChainStep[] =>
  groupBySteps(company.approvers).map((group) => ({
    key: newStepKey(),
    people: group.map((a) => ({ employeeId: a.employeeId, name: a.name })),
  }));

const toPayload = (steps: ChainStep[]) =>
  steps.flatMap((step, i) =>
    step.people.map((p) => ({ employeeId: p.employeeId, position: i + 1 })),
  );

function chainError(steps: ChainStep[]): string | undefined {
  const errors = validateChain(toPayload(steps));
  if (errors.some((e) => e.code === 'TOO_FEW_APPROVERS')) {
    return `Add at least ${MIN_DEFAULT_APPROVERS} approvers before the CFO.`;
  }
  return errors.length > 0 ? 'Each person can appear only once in the chain.' : undefined;
}

function RulesNote() {
  return (
    <aside className="bg-card rounded-xl border p-5 text-[13px] leading-relaxed">
      <h2 className="mb-3 text-sm font-semibold">How the chain works</h2>
      <ul className="text-muted-foreground flex list-disc flex-col gap-2.5 pl-4">
        <li>
          Steps run top to bottom. Each step starts only when the one above has fully approved.
        </li>
        <li>
          Put two or more people in one step to have them review in parallel. All of them must
          approve.
        </li>
        <li>
          A company needs at least {MIN_DEFAULT_APPROVERS} approvers. The CFO is always last and
          fixed.
        </li>
        <li>
          Creators can adjust the chain for a single document. That never changes this default.
        </li>
        <li>Only people with an Approver role can be added.</li>
      </ul>
    </aside>
  );
}

function CompanyForm({ company }: { company: Company | null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cfo = useQuery({ queryKey: ['cfo'], queryFn: ({ signal }) => api.employees.cfo(signal) });
  const [steps, setSteps] = useState<ChainStep[]>(() => (company ? toSteps(company) : []));
  const [submitted, setSubmitted] = useState(false);
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
      const body = { ...details, approvers: toPayload(steps) };
      return company ? api.companies.update(company.id, body) : api.companies.create(body);
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      toast.success(company ? `Saved ${saved.name}` : `Added ${saved.name}`);
      navigate('/admin/masters/companies');
    },
  });

  const chainProblem = submitted ? chainError(steps) : undefined;
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(
    (details) => {
      setSubmitted(true);
      if (chainError(steps)) return;
      save.mutate(details);
    },
    () => setSubmitted(true),
  );

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
              hint="Creators can search by it."
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
            <Field label="Status" hint="Inactive companies are hidden from Creators.">
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

        <section className="bg-card rounded-xl border p-5 sm:p-6" aria-labelledby="chain-heading">
          <div className="mb-4">
            <h2 id="chain-heading" className="text-sm font-semibold">
              Default approval chain
            </h2>
            <p className="text-muted-foreground mt-1 text-[13px]">
              Filled in automatically when a Creator picks this company.
            </p>
          </div>
          <ChainBuilder
            steps={steps}
            onChange={setSteps}
            cfo={cfo.data?.cfo}
            error={chainProblem}
          />
        </section>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" asChild>
            <Link to="/admin/masters/companies">Cancel</Link>
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
            to="/admin/masters/companies"
            className="hover:text-foreground inline-flex items-center gap-1"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
            Company Master
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
