import {
  groupBySteps,
  InvoiceFields,
  MIN_DEFAULT_APPROVERS,
  validateChain,
  type CompanyOption,
} from '@docflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { z } from 'zod';
import { ChainBuilder, newStepKey, type ChainStep } from '@/components/chain/ChainBuilder';
import { Field, FormError } from '@/components/forms';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { CompanyPicker } from './CompanyPicker';
import { FileDropzone, type UploadState } from './FileDropzone';

type InvoiceInput = z.input<typeof InvoiceFields>;

const stepsFromCompany = (company: CompanyOption): ChainStep[] =>
  groupBySteps(company.approvers).map((group) => ({
    key: newStepKey(),
    people: group.map((a) => ({ employeeId: a.employeeId, name: a.name })),
  }));

const toPayload = (steps: ChainStep[]) =>
  steps.flatMap((step, i) =>
    step.people.map((p) => ({ employeeId: p.employeeId, position: i + 1 })),
  );

/** Same comparison the server makes for `chainCustomised`: who is in which step. */
const chainKey = (steps: ChainStep[]) =>
  toPayload(steps)
    .map((a) => `${a.position}:${a.employeeId}`)
    .sort()
    .join('|');

function chainProblem(steps: ChainStep[]): string | undefined {
  const errors = validateChain(toPayload(steps));
  if (errors.some((e) => e.code === 'TOO_FEW_APPROVERS')) {
    return `Keep at least ${MIN_DEFAULT_APPROVERS} approvers before the CFO.`;
  }
  return errors.length > 0 ? 'Each person can appear only once in the chain.' : undefined;
}

function BeforeYouSubmit({
  canSubmit,
  pending,
  onSubmit,
}: {
  canSubmit: boolean;
  pending: boolean;
  onSubmit: () => void;
}) {
  return (
    <aside className="bg-card flex flex-col gap-4 rounded-xl border p-5 lg:sticky lg:top-6">
      <h2 className="text-sm font-semibold">Before you submit</h2>
      <ul className="text-muted-foreground flex list-disc flex-col gap-2.5 pl-4 text-[13px] leading-relaxed">
        <li>The Creator role only uploads. It does not approve.</li>
        <li>The CFO is a fixed, global approver and is always last.</li>
        <li>
          Chain changes here apply to this document only. The Company Master default is untouched.
        </li>
        <li>Once submitted, the approver order is locked for this document.</li>
      </ul>
      <Button
        type="button"
        className="h-10 w-full"
        onClick={onSubmit}
        disabled={!canSubmit || pending}
      >
        {pending ? 'Submitting…' : 'Submit for Approval'}
      </Button>
    </aside>
  );
}

export function NewSubmissionPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const companyFieldId = useId();
  const [upload, setUpload] = useState<UploadState>({ kind: 'empty' });
  const [company, setCompany] = useState<CompanyOption | null>(null);
  const [steps, setSteps] = useState<ChainStep[]>([]);
  const [defaultKey, setDefaultKey] = useState('');
  const [attempted, setAttempted] = useState(false);

  // The CFO comes with company search results; an empty search fetches it up front
  const lookup = useQuery({
    queryKey: ['company-search', ''],
    queryFn: ({ signal }) => api.lookups.companies('', signal),
  });
  const cfo = lookup.data?.cfo;

  const invoice = useForm<InvoiceInput>({
    resolver: zodResolver(InvoiceFields),
    defaultValues: {
      invoiceNumber: '',
      vendorName: '',
      invoiceDate: '',
      amount: '',
      currency: 'INR',
      notes: '',
    },
  });

  const customised = company !== null && chainKey(steps) !== defaultKey;
  const problem = chainProblem(steps);

  const pickCompany = (c: CompanyOption) => {
    const fresh = stepsFromCompany(c);
    setCompany(c);
    setSteps(fresh);
    setDefaultKey(chainKey(fresh));
  };

  const submit = useMutation({
    mutationFn: (fields: z.output<typeof InvoiceFields>) => {
      if (upload.kind !== 'done' || !company) throw new Error('unreachable');
      return api.workflows.create({
        ...fields,
        uploadId: upload.uploadId,
        companyId: company.id,
        approvers: toPayload(steps),
      });
    },
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      toast.success('Submitted for approval');
      navigate(`/submissions/${id}`);
    },
  });

  const blockers = useMemo(() => {
    const list: string[] = [];
    if (upload.kind !== 'done')
      list.push(
        upload.kind === 'uploading' ? 'Wait for the upload to finish.' : 'Upload a document.',
      );
    if (!company) list.push('Choose a company.');
    else if (problem) list.push(problem);
    if (cfo === null) list.push('There is no active CFO yet. Ask your administrator to add one.');
    return list;
  }, [upload.kind, company, problem, cfo]);

  const onSubmit = () => {
    setAttempted(true);
    if (blockers.length > 0) return;
    void invoice.handleSubmit((fields) =>
      submit.mutate(fields as z.output<typeof InvoiceFields>),
    )();
  };

  const errors = invoice.formState.errors;

  return (
    <>
      <PageHeader
        title="New Submission"
        description="Upload a document and route it through the approval chain"
      />
      <PageBody>
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-5">
            <FileDropzone state={upload} onChange={setUpload} />

            <div className="flex flex-col gap-1.5 sm:max-w-md">
              <Label
                htmlFor={companyFieldId}
                className="text-muted-foreground text-[13px] font-normal"
              >
                Company
              </Label>
              <CompanyPicker
                id={companyFieldId}
                value={company}
                onPick={pickCompany}
                invalid={attempted && !company}
              />
            </div>

            {company && (
              <section
                className="bg-card rounded-xl border p-4 sm:p-5"
                aria-labelledby="chain-heading"
              >
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h2
                    id="chain-heading"
                    className="flex flex-wrap items-center gap-2 text-sm font-semibold"
                  >
                    Approval Chain · {company.name}
                    {customised && (
                      <StatusPill tone="blue">Customised for this document</StatusPill>
                    )}
                  </h2>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!customised}
                    onClick={() => pickCompany(company)}
                  >
                    <RotateCcw aria-hidden /> Reset to Company Default
                  </Button>
                </div>
                <ChainBuilder
                  steps={steps}
                  onChange={setSteps}
                  cfo={cfo}
                  error={attempted ? problem : undefined}
                  noCfoMessage="Documents can’t be submitted until your administrator adds a CFO."
                />
              </section>
            )}

            <section
              className="bg-card rounded-xl border p-4 sm:p-5"
              aria-labelledby="invoice-heading"
            >
              <h2 id="invoice-heading" className="text-sm font-semibold">
                Invoice details{' '}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </h2>
              <p className="text-muted-foreground mt-1 mb-4 text-[13px]">
                Leave these blank if the document isn’t an invoice.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Invoice number" error={errors.invoiceNumber?.message}>
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      {...invoice.register('invoiceNumber')}
                    />
                  )}
                </Field>
                <Field label="Vendor" error={errors.vendorName?.message}>
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      {...invoice.register('vendorName')}
                    />
                  )}
                </Field>
                <Field label="Invoice date" error={errors.invoiceDate?.message}>
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      type="date"
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      {...invoice.register('invoiceDate')}
                    />
                  )}
                </Field>
                <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3">
                  <Field label="Amount" error={errors.amount?.message}>
                    {({ id, describedBy, invalid }) => (
                      <Input
                        id={id}
                        inputMode="decimal"
                        placeholder="e.g. 125000.50"
                        aria-describedby={describedBy}
                        aria-invalid={invalid}
                        {...invoice.register('amount')}
                      />
                    )}
                  </Field>
                  <Field label="Currency" error={errors.currency?.message}>
                    {({ id, describedBy, invalid }) => (
                      <Input
                        id={id}
                        maxLength={3}
                        className="uppercase"
                        aria-describedby={describedBy}
                        aria-invalid={invalid}
                        {...invoice.register('currency')}
                      />
                    )}
                  </Field>
                </div>
                <Field label="Notes" error={errors.notes?.message} className="sm:col-span-2">
                  {({ id, describedBy, invalid }) => (
                    <Textarea
                      id={id}
                      rows={3}
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      {...invoice.register('notes')}
                    />
                  )}
                </Field>
              </div>
            </section>

            {attempted && blockers.length > 0 && (
              <div
                role="alert"
                className="bg-status-red-bg text-status-red rounded-lg px-4 py-3 text-sm"
              >
                <p className="font-medium">Before you can submit:</p>
                <ul className="mt-1 list-disc pl-5">
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            )}
            <FormError message={submit.error ? errorMessage(submit.error) : undefined} />
          </div>

          <BeforeYouSubmit
            canSubmit={upload.kind !== 'uploading'}
            pending={submit.isPending}
            onSubmit={onSubmit}
          />
        </div>
      </PageBody>
    </>
  );
}
