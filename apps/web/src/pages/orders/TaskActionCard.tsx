import {
  DOC_KIND_LABEL,
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

/**
 * One step waiting for the signed-in person, with exactly the inputs that step needs.
 * The server checks everything again; this only keeps people from sending incomplete work.
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
  const [action, setAction] = useState<TaskAction>(task.actions[0] as TaskAction);
  const id = useId();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [date, setDate] = useState(today());
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [products, setProducts] = useState(order.products.map((p) => p.name).join('\n'));
  const [payment, setPayment] = useState({
    receivedOn: today(),
    amount: '',
    currency: 'USD',
    reference: '',
  });
  const [toTeam, setToTeam] = useState<Team | ''>('');
  const [status, setStatus] = useState<ShipmentStatus>('IN_TRANSIT');
  const [problem, setProblem] = useState<string>();

  const stage =
    step.kind === 'APPROVAL_CHAIN' ? step.stages.find((s) => s.key === task.side) : undefined;
  const docs = docsFor(step, task, action);
  const needsPayment =
    (step.kind === 'TASK' && step.form === 'PAYMENT' && action === 'COMPLETE') ||
    (stage?.form === 'PAYMENT' && action === 'APPROVE');
  const needsProducts = step.kind === 'TASK' && step.form === 'PRODUCTS' && action === 'COMPLETE';
  const needsDate = action === 'LOG' || action === 'CHECKPOINT';
  const returnTeams =
    step.kind === 'REVIEW_LOOP' && action === 'RETURN' && step.submitters.length > 1
      ? step.submitters.flatMap((a) => ('team' in a ? [a.team] : []))
      : [];
  const commentRequired = action === 'RETURN' || action === 'REJECT';
  const earlierKinds = new Set(
    order.documents.filter((d) => d.taskId === task.id).map((d) => d.kind),
  );

  const act = useMutation({
    mutationFn: (body: TaskActionRequest) => api.tasks.act(task.id, body),
    onSuccess: () => {
      toast.success(`${step.title}: done`);
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

  const submit = () => {
    setProblem(undefined);
    const attached = docs.flatMap((d) => {
      const u = uploads[d.kind];
      return u?.kind === 'done' ? [{ uploadId: u.uploadId, kind: d.kind }] : [];
    });
    const busy = Object.values(uploads).some((u) => u.kind === 'uploading');
    if (busy) return setProblem('Wait for the upload to finish.');
    for (const d of docs) {
      if (d.required && !attached.some((a) => a.kind === d.kind) && !earlierKinds.has(d.kind)) {
        return setProblem(`Attach the ${DOC_KIND_LABEL[d.kind]}.`);
      }
    }
    if (commentRequired && !comment.trim()) return setProblem('Say what needs changing, or why.');
    if (returnTeams.length && !toTeam) return setProblem('Choose who gets it back.');
    const productList = products
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean);
    if (needsProducts && productList.length === 0) return setProblem('List at least one product.');
    if (needsPayment && !payment.amount) return setProblem('Enter the amount received.');
    act.mutate({
      action,
      comment: comment.trim() || null,
      uploads: attached,
      ...(needsProducts ? { products: productList } : {}),
      ...(needsPayment ? { payment: { ...payment, reference: payment.reference || null } } : {}),
      ...(needsDate ? { date } : {}),
      ...(returnTeams.length && toTeam ? { toTeam } : {}),
      ...(action === 'CHECKPOINT' ? { shipmentStatus: status } : {}),
    });
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="bg-card border-primary/40 flex flex-col gap-4 rounded-xl border-2 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
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

      {task.actions.length > 1 && (
        <div role="radiogroup" aria-label="What to do" className="flex flex-wrap gap-2">
          {task.actions.map((a) => (
            <Button
              key={a}
              type="button"
              size="sm"
              variant={a === action ? 'default' : 'outline'}
              role="radio"
              aria-checked={a === action}
              onClick={() => {
                setAction(a as TaskAction);
                setProblem(undefined);
              }}
            >
              {actionLabel(step, a as TaskAction)}
            </Button>
          ))}
        </div>
      )}

      {docs.map((d) => (
        <div key={d.kind} className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-[13px]">
            {DOC_KIND_LABEL[d.kind]}
            {d.required ? '' : ' (optional)'}
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

      {needsProducts && (
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
      )}

      {needsPayment && (
        <fieldset className="grid gap-3 sm:grid-cols-4">
          <legend className="text-muted-foreground mb-1.5 text-[13px]">Payment received</legend>
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
              placeholder="125000.00"
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
            <Label htmlFor={`${id}-ref`} className="text-[13px] font-normal">
              Reference (optional)
            </Label>
            <Input
              id={`${id}-ref`}
              value={payment.reference}
              onChange={(e) => setPayment((p) => ({ ...p, reference: e.target.value }))}
            />
          </div>
        </fieldset>
      )}

      {action === 'CHECKPOINT' && (
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

      {needsDate && (
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
            Who gets it back
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
          {commentRequired ? 'Comments (required)' : 'Comments (optional)'}
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
      <div>
        <Button
          type="button"
          onClick={submit}
          disabled={act.isPending}
          variant={action === 'REJECT' || action === 'RETURN' ? 'outline' : 'default'}
        >
          {act.isPending ? 'Saving…' : actionLabel(step, action)}
        </Button>
      </div>
    </section>
  );
}
