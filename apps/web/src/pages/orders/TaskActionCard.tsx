import {
  DOC_KIND_LABEL,
  OrderRef,
  SHIPMENT_STATUS_LABEL,
  SHIPMENT_STATUSES,
  stepOf,
  TEAM_LABEL,
  type DocKind,
  type OrderDetail,
  type ShipmentStatus,
  type StepDef,
  type TaskAction,
  type TaskActionRequest,
  type TaskView,
  type Team,
  type Template,
} from '@docflow/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { ReviewDocList } from '@/components/DocumentButtons';
import { FileDropzone, type UploadState } from '@/components/FileDropzone';
import { FormError } from '@/components/forms';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { waitedFor } from '@/lib/labels';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** What each action's button says, from the step's own labels */
function actionLabel(step: StepDef, action: TaskAction): string {
  switch (action) {
    case 'COMPLETE':
    case 'LOG':
    case 'CLOSE':
      return 'actionLabel' in step ? step.actionLabel : 'Done';
    case 'SUBMIT':
      return step.kind === 'REVIEW_LOOP' ? step.submitLabel : 'Send';
    case 'CONFIRM':
      return step.kind === 'REVIEW_LOOP' ? step.confirmLabel : 'Confirm';
    case 'RETURN':
      return 'Send back with comments';
    case 'APPROVE':
      return 'Approve';
    case 'REJECT':
      return 'Reject';
    case 'CHECKPOINT':
      return 'Post update';
  }
}

/** Sending back and rejecting need a reason, and look different from going ahead */
const isNegative = (a: TaskAction) => a === 'RETURN' || a === 'REJECT';

/** The documents a person can attach for this action */
function docsFor(
  step: StepDef,
  task: TaskView,
  action: TaskAction,
): Array<{ kind: DocKind; required: boolean }> {
  if (step.kind === 'TASK' && action === 'COMPLETE') return step.docs ?? [];
  if (step.kind === 'REVIEW_LOOP' && step.doc) {
    if (action === 'SUBMIT') return [{ kind: step.doc, required: step.startsWith === 'SUBMITTER' }];
    if (action === 'RETURN' && step.doc === 'QA_NOTE') return [{ kind: step.doc, required: false }];
  }
  if (step.kind === 'APPROVAL_CHAIN' && action === 'APPROVE') {
    const stage = step.stages.find((s) => s.key === task.side);
    if (stage?.form === 'PAYMENT') return [{ kind: 'PAYMENT_PROOF', required: false }];
  }
  return [];
}

/** Everything one action needs from the form */
function needsOf(step: StepDef, task: TaskView, action: TaskAction) {
  const stage =
    step.kind === 'APPROVAL_CHAIN' ? step.stages.find((s) => s.key === task.side) : undefined;
  return {
    docs: docsFor(step, task, action),
    payment:
      (step.kind === 'TASK' && step.form === 'PAYMENT' && action === 'COMPLETE') ||
      (stage?.form === 'PAYMENT' && action === 'APPROVE'),
    products: step.kind === 'TASK' && step.form === 'PRODUCTS' && action === 'COMPLETE',
    date: action === 'LOG' || action === 'CHECKPOINT',
    returnTeams:
      step.kind === 'REVIEW_LOOP' && action === 'RETURN' && step.submitters.length > 1
        ? step.submitters.flatMap((a) => ('team' in a ? [a.team] : []))
        : [],
    comment: isNegative(action),
  };
}

/**
 * One step waiting for the signed-in person: the latest document it is about (View and
 * Download right here), the inputs the step needs, and one button per action that acts
 * straight away (D27). The server checks everything again; this only keeps people from
 * sending incomplete work.
 */
export function TaskActionCard({
  order,
  task,
  template,
}: {
  order: OrderDetail;
  task: TaskView;
  template: Template;
}) {
  const step = stepOf(template, task.stepKey);
  const actions = task.actions as TaskAction[];
  const id = useId();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [date, setDate] = useState(today());
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [products, setProducts] = useState(order.products.map((p) => p.name).join('\n'));
  const [ref, setRef] = useState(order.ref);
  const [payment, setPayment] = useState({
    receivedOn: today(),
    amount: '',
    currency: 'INR',
    reference: '',
  });
  const [toTeam, setToTeam] = useState<Team | ''>('');
  const [status, setStatus] = useState<ShipmentStatus>('IN_TRANSIT');
  const [problem, setProblem] = useState<string>();

  const stage =
    step.kind === 'APPROVAL_CHAIN' ? step.stages.find((s) => s.key === task.side) : undefined;
  const all = actions.map((a) => ({ action: a, needs: needsOf(step, task, a) }));
  // The form shows what any of the actions needs; each button checks only its own needs
  const docs = all
    .flatMap((x) => x.needs.docs.map((d) => ({ ...d, action: x.action })))
    .filter((d, i, list) => list.findIndex((x) => x.kind === d.kind) === i);
  const showPayment = all.some((x) => x.needs.payment);
  const showProducts = all.some((x) => x.needs.products);
  const showDate = all.some((x) => x.needs.date);
  const returnTeams = all.flatMap((x) => x.needs.returnTeams);
  const negative = actions.find(isNegative);
  const earlierKinds = new Set(
    order.documents.filter((d) => d.taskId === task.id).map((d) => d.kind),
  );

  const act = useMutation({
    mutationFn: (body: TaskActionRequest) => api.tasks.act(task.id, body),
    onSuccess: (_data, body) => {
      toast.success(`${step.title}: ${actionLabel(step, body.action as TaskAction).toLowerCase()}`);
      for (const key of [
        ['order', order.id],
        ['order-timeline', order.id],
        ['work'],
        ['orders'],
        ['components', order.id],
      ]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });

  const submit = (action: TaskAction) => {
    setProblem(undefined);
    const needs = needsOf(step, task, action);
    const attached = needs.docs.flatMap((d) => {
      const u = uploads[d.kind];
      return u?.kind === 'done' ? [{ uploadId: u.uploadId, kind: d.kind }] : [];
    });
    if (Object.values(uploads).some((u) => u.kind === 'uploading')) {
      return setProblem('Wait for the upload to finish.');
    }
    for (const d of needs.docs) {
      if (d.required && !attached.some((a) => a.kind === d.kind) && !earlierKinds.has(d.kind)) {
        return setProblem(`Attach the ${DOC_KIND_LABEL[d.kind]}.`);
      }
    }
    if (needs.comment && !comment.trim()) {
      return setProblem(
        action === 'REJECT' ? 'Give a reason for rejecting.' : 'Say what needs changing.',
      );
    }
    if (needs.returnTeams.length && !toTeam) return setProblem('Choose who gets it back.');
    const productList = products
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean);
    if (needs.products && productList.length === 0) return setProblem('List at least one product.');
    if (needs.products) {
      const checked = OrderRef.safeParse(ref);
      if (!checked.success) return setProblem(checked.error.issues[0]?.message);
    }
    if (needs.payment && !payment.amount) return setProblem('Enter the amount received.');
    act.mutate({
      action,
      comment: comment.trim() || null,
      uploads: attached,
      ...(needs.products ? { products: productList, orderRef: ref.trim() } : {}),
      ...(needs.payment ? { payment: { ...payment, reference: payment.reference || null } } : {}),
      ...(needs.date ? { date } : {}),
      ...(needs.returnTeams.length && toTeam ? { toTeam } : {}),
      ...(action === 'CHECKPOINT' ? { shipmentStatus: status } : {}),
    });
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="bg-card border-primary/40 flex min-w-0 flex-col gap-4 rounded-xl border-2 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="text-sm font-semibold">
            {step.title}
            {task.productName && (
              <span className="text-muted-foreground font-normal"> · {task.productName}</span>
            )}
            {stage && <span className="text-muted-foreground font-normal"> · {stage.title}</span>}
          </h3>
          <p className="text-muted-foreground mt-0.5 text-[13px]">{step.help}</p>
        </div>
        {task.waitingSince && (
          <span className="text-status-amber text-xs font-medium whitespace-nowrap">
            Waiting {waitedFor(task.waitingSince)}
          </span>
        )}
      </div>

      <ReviewDocList docs={task.reviewDocs} />

      {docs.map((d) => (
        <div key={d.kind} className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-[13px]">
            {task.reviewDocs.some((r) => r.kind === d.kind) ? 'New version of the ' : ''}
            {DOC_KIND_LABEL[d.kind]}
            {d.required ? '' : ' (optional)'}
            {d.action === 'RETURN' && actions.length > 1 && ', when sending back'}
            {earlierKinds.has(d.kind) && ' · already attached; upload only to replace it'}
          </span>
          <FileDropzone
            compact
            label={`Drop the ${DOC_KIND_LABEL[d.kind]} here, or click to browse`}
            state={uploads[d.kind] ?? { kind: 'empty' }}
            onChange={(s) => setUploads((u) => ({ ...u, [d.kind]: s }))}
          />
        </div>
      ))}

      {showProducts && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-ref`} className="text-muted-foreground text-[13px] font-normal">
              Order number
            </Label>
            <Input
              id={`${id}-ref`}
              value={ref}
              maxLength={40}
              onChange={(e) => setRef(e.target.value)}
              aria-describedby={`${id}-ref-hint`}
              className="w-full sm:w-72"
            />
            <p id={`${id}-ref-hint`} className="text-status-amber text-xs">
              Change this to match the PI number, so everyone can find the order by it.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor={`${id}-products`}
              className="text-muted-foreground text-[13px] font-normal"
            >
              Products on this order, one per line
            </Label>
            <Textarea
              id={`${id}-products`}
              rows={4}
              value={products}
              onChange={(e) => setProducts(e.target.value)}
            />
          </div>
        </>
      )}

      {showPayment && (
        <fieldset className="grid gap-3 sm:grid-cols-4">
          <legend className="text-muted-foreground mb-1.5 text-[13px]">
            Payment received{negative ? ' (when approving)' : ''}
          </legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-received`} className="text-[13px] font-normal">
              Date
            </Label>
            <Input
              id={`${id}-received`}
              type="date"
              max={today()}
              value={payment.receivedOn}
              onChange={(e) => setPayment((p) => ({ ...p, receivedOn: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-amount`} className="text-[13px] font-normal">
              Amount
            </Label>
            <Input
              id={`${id}-amount`}
              inputMode="decimal"
              placeholder="2500000.00"
              value={payment.amount}
              onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-currency`} className="text-[13px] font-normal">
              Currency
            </Label>
            <Input
              id={`${id}-currency`}
              maxLength={3}
              value={payment.currency}
              onChange={(e) =>
                setPayment((p) => ({ ...p, currency: e.target.value.toUpperCase() }))
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-ref-no`} className="text-[13px] font-normal">
              Reference (optional)
            </Label>
            <Input
              id={`${id}-ref-no`}
              value={payment.reference}
              onChange={(e) => setPayment((p) => ({ ...p, reference: e.target.value }))}
            />
          </div>
        </fieldset>
      )}

      {actions.includes('CHECKPOINT') && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-status`} className="text-muted-foreground text-[13px] font-normal">
            Shipment status
          </Label>
          <Select value={status} onValueChange={(v) => setStatus(v as ShipmentStatus)}>
            <SelectTrigger id={`${id}-status`} className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHIPMENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SHIPMENT_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {showDate && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-date`} className="text-muted-foreground text-[13px] font-normal">
            When it happened
          </Label>
          <Input
            id={`${id}-date`}
            type="date"
            max={today()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full sm:w-48"
          />
        </div>
      )}

      {returnTeams.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-to`} className="text-muted-foreground text-[13px] font-normal">
            Who gets it back, when sending back
          </Label>
          <Select value={toTeam} onValueChange={(v) => setToTeam(v as Team)}>
            <SelectTrigger id={`${id}-to`} className="w-full sm:w-64">
              <SelectValue placeholder="Choose a team" />
            </SelectTrigger>
            <SelectContent>
              {returnTeams.map((t) => (
                <SelectItem key={t} value={t}>
                  {TEAM_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-comment`} className="text-muted-foreground text-[13px] font-normal">
          {negative === 'REJECT'
            ? 'Comments (required to reject)'
            : negative === 'RETURN'
              ? 'Comments (required to send back)'
              : 'Comments (optional)'}
        </Label>
        <Textarea
          id={`${id}-comment`}
          rows={3}
          maxLength={2000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>

      <FormError message={problem ?? (act.error ? errorMessage(act.error) : undefined)} />
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button
            key={a}
            type="button"
            onClick={() => submit(a)}
            disabled={act.isPending}
            variant={isNegative(a) ? 'outline' : 'default'}
            className={isNegative(a) ? 'text-destructive' : undefined}
          >
            {act.isPending && act.variables?.action === a ? 'Saving…' : actionLabel(step, a)}
          </Button>
        ))}
      </div>
    </section>
  );
}
