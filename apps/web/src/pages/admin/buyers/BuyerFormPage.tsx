import { SLOT_INFO, type Buyer } from '@docflow/shared';
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
import { SlotEditor } from '@/components/SlotEditor';
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
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { emptySlots, slotValueProblems, type SlotValue } from '@/lib/slots';

const DetailsSchema = z.object({
  name: z.string().trim().min(1, 'Enter the buyer’s name').max(120),
  code: z.string().trim().max(20, 'Use 20 characters or fewer'),
  country: z.string().trim().max(80),
  address: z.string().trim().max(500),
  contact: z.string().trim().max(200),
  isActive: z.boolean(),
});
type Details = z.infer<typeof DetailsSchema>;

function RulesNote({ canEditChain }: { canEditChain: boolean }) {
  return (
    <aside className="bg-card rounded-xl border p-5 text-[13px] leading-relaxed">
      <h2 className="mb-3 text-sm font-semibold">How the default chain works</h2>
      <ul className="text-muted-foreground flex list-disc flex-col gap-2.5 pl-4">
        <li>Every new order for this buyer copies these people and ALL/ANY settings.</li>
        <li>
          Marketing can change them for one order: when creating it, and later for any approval that
          hasn’t started yet. This page stays as it is.
        </li>
        <li>
          One person can fill several roles here, the Creator included. They act and approve
          separately in each role.
        </li>
        <li>Team steps (Regulation, Materials and so on) go to everyone in that team.</li>
        <li>
          Empty roles can be filled later, or by Marketing on the order; an order can’t start until
          every role has someone.
        </li>
        {!canEditChain && <li>Only Admin changes the default chain.</li>}
      </ul>
    </aside>
  );
}

/** The chain as read-only text, for Marketing (only Admin edits it) */
function ChainSummary({ slots }: { slots: SlotValue[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
      {slots.map((s) => (
        <div key={s.slot} className="contents">
          <dt className="text-muted-foreground">{SLOT_INFO[s.slot].label}</dt>
          <dd className="min-w-0">
            {s.people.length ? s.people.map((p) => p.name).join(', ') : '—'}
            {s.gate && s.people.length > 1 && (
              <span className="text-muted-foreground">
                {' '}
                · {s.gate === 'ALL' ? 'all must approve' : 'any one is enough'}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function BuyerForm({ buyer }: { buyer: Buyer | null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canEditChain = useMe().data?.capabilities.includes('ADMIN') ?? false;
  const [slots, setSlots] = useState<SlotValue[]>(() =>
    buyer
      ? buyer.slots.map((s) => ({ slot: s.slot, people: s.people, gate: s.gate }))
      : emptySlots(),
  );
  const form = useForm<Details>({
    resolver: zodResolver(DetailsSchema),
    defaultValues: {
      name: buyer?.name ?? '',
      code: buyer?.code ?? '',
      country: buyer?.country ?? '',
      address: buyer?.address ?? '',
      contact: buyer?.contact ?? '',
      isActive: buyer?.isActive ?? true,
    },
  });

  const save = useMutation({
    mutationFn: (details: Details) => {
      const body = {
        ...details,
        // Only Admin sends the chain; Marketing's saves leave it as it is (D27)
        ...(canEditChain
          ? {
              slots: slots.map((s) => ({
                slot: s.slot,
                employeeIds: s.people.map((p) => p.id),
                gate: s.gate,
              })),
            }
          : {}),
      };
      return buyer ? api.buyers.update(buyer.id, body) : api.buyers.create(body);
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['buyers'] });
      queryClient.invalidateQueries({ queryKey: ['lookup-buyers'] });
      toast.success(buyer ? `Saved ${saved.name}` : `Added ${saved.name}`);
      navigate('/admin/buyers');
    },
  });

  const errors = form.formState.errors;
  const serverProblems =
    save.error instanceof ApiError && save.error.code === 'INVALID_SLOTS'
      ? ((save.error.details as { slots?: Record<string, string> })?.slots ?? {})
      : {};
  const problems = { ...slotValueProblems(slots, false), ...serverProblems };
  const onSubmit = form.handleSubmit((details) => {
    if (canEditChain && Object.keys(slotValueProblems(slots, false)).length > 0) return;
    save.mutate(details);
  });
  const text = (
    name: 'name' | 'code' | 'country' | 'contact',
    label: string,
    placeholder: string,
    hint?: string,
  ) => (
    <Field label={label} error={errors[name]?.message} hint={hint}>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          placeholder={placeholder}
          className={name === 'code' ? 'uppercase' : undefined}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          {...form.register(name)}
        />
      )}
    </Field>
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
            Buyer details
          </h2>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            {text('name', 'Buyer (company) name', 'e.g. Al Noor Medical')}
            {text('code', 'Code (optional)', 'e.g. ANM', 'Marketing can search by it.')}
            <Field label="Status" hint="New orders can’t use inactive buyers.">
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
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {text('country', 'Country (optional)', 'e.g. United Arab Emirates')}
            {text('contact', 'Contact (optional)', 'Name, phone or email')}
            <Field label="Address (optional)" className="sm:col-span-2">
              {({ id, describedBy }) => (
                <Textarea
                  id={id}
                  rows={2}
                  aria-describedby={describedBy}
                  {...form.register('address')}
                />
              )}
            </Field>
          </div>
        </section>

        <section className="bg-card rounded-xl border p-5 sm:p-6" aria-labelledby="chain-heading">
          <div className="mb-4">
            <h2 id="chain-heading" className="text-sm font-semibold">
              Default chain
            </h2>
            <p className="text-muted-foreground mt-1 text-[13px]">
              Who works on this buyer’s orders, and for each approval, whether everyone named must
              approve or any one is enough.
            </p>
          </div>
          {canEditChain ? (
            <SlotEditor value={slots} onChange={setSlots} showGates problems={problems} />
          ) : (
            <ChainSummary slots={slots} />
          )}
        </section>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {buyer && (
            <DeleteButton
              name={buyer.name}
              what="buyer"
              onDelete={() => api.buyers.remove(buyer.id)}
              onDeleted={() => {
                queryClient.invalidateQueries({ queryKey: ['buyers'] });
                navigate('/admin/buyers');
              }}
            />
          )}
          <Button type="button" variant="outline" asChild>
            <Link to="/admin/buyers">Cancel</Link>
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : buyer ? 'Save buyer' : 'Add buyer'}
          </Button>
        </div>
      </div>
      <RulesNote canEditChain={canEditChain} />
    </form>
  );
}

export function BuyerFormPage() {
  const { id } = useParams();
  const buyer = useQuery({
    queryKey: ['buyers', 'detail', id],
    queryFn: ({ signal }) => api.buyers.get(id!, signal),
    enabled: Boolean(id),
  });

  const title = id ? (buyer.data ? `Edit ${buyer.data.name}` : 'Edit buyer') : 'Add buyer';
  return (
    <>
      <PageHeader
        title={title}
        description={
          <Link to="/admin/buyers" className="hover:text-foreground inline-flex items-center gap-1">
            <ChevronLeft className="size-3.5" aria-hidden />
            Buyers
          </Link>
        }
      />
      <PageBody>
        {!id ? (
          <BuyerForm buyer={null} />
        ) : buyer.isPending ? (
          <div className="flex flex-col gap-5" aria-busy="true">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        ) : buyer.error ? (
          <ErrorState error={buyer.error} onRetry={() => buyer.refetch()} />
        ) : (
          <BuyerForm key={buyer.data.id} buyer={buyer.data} />
        )}
      </PageBody>
    </>
  );
}
