import {
  CHANNEL_LABEL,
  SHIPMENT_STATUS_LABEL,
  SLOT_INFO,
  TAG_LABEL,
  TEAM_LABEL,
  type ApprovalVote,
  type ChannelRound,
  type OrderDetail,
  type StepDef,
  type TaskView,
  type Template,
} from '@docflow/shared';
import { Check, Circle, CircleDot, Clock3, CornerDownLeft, X } from 'lucide-react';
import { StatusPill } from '@/components/StatusPill';
import { formatDateTime } from '@/lib/format';
import { days, PHASE_LABEL, waitedFor } from '@/lib/labels';
import { cn } from '@/lib/utils';

type State = 'done' | 'open' | 'waiting' | 'not-started' | 'cancelled';

function stateOf(task: TaskView | undefined): State {
  if (!task) return 'not-started';
  if (task.status === 'DONE') return 'done';
  if (task.status === 'OPEN') return 'open';
  if (task.status === 'CANCELLED') return 'cancelled';
  return 'waiting';
}

function Marker({ state }: { state: State }) {
  const base = 'mt-0.5 size-5 shrink-0 rounded-full p-0.5';
  if (state === 'done')
    return <Check className={cn(base, 'bg-status-green-bg text-status-green')} aria-label="Done" />;
  if (state === 'open')
    return (
      <CircleDot
        className={cn(base, 'bg-status-amber-bg text-status-amber')}
        aria-label="In progress"
      />
    );
  if (state === 'cancelled')
    return <X className={cn(base, 'bg-status-grey-bg text-status-grey')} aria-label="Cancelled" />;
  if (state === 'waiting')
    return (
      <Clock3 className={cn(base, 'bg-status-grey-bg text-status-grey')} aria-label="Waiting" />
    );
  return <Circle className={cn(base, 'text-border')} aria-label="Not started" />;
}

function Rounds({ rounds }: { rounds: ChannelRound[] }) {
  if (rounds.length === 0) return null;
  return (
    <ol
      className="mt-2 flex flex-col gap-2 border-l pl-3"
      aria-label={`${CHANNEL_LABEL[rounds[0]!.channel]}: rounds`}
    >
      {rounds.map((r) => (
        <li key={r.id} className="text-[13px]">
          <span className="text-muted-foreground mr-1 font-mono text-xs">Round {r.round}</span>
          {r.submittedAt && (
            <span>
              Sent by <b className="font-medium">{r.submittedByName}</b>,{' '}
              {formatDateTime(r.submittedAt)}
              {r.submitComment && (
                <span className="text-muted-foreground"> · “{r.submitComment}”</span>
              )}
            </span>
          )}
          {r.verdict && (
            <span className="mt-0.5 flex items-start gap-1">
              {r.verdict === 'CONFIRMED' ? (
                <Check className="text-status-green mt-0.5 size-3.5 shrink-0" aria-hidden />
              ) : (
                <CornerDownLeft className="text-status-red mt-0.5 size-3.5 shrink-0" aria-hidden />
              )}
              <span>
                {r.verdict === 'CONFIRMED'
                  ? 'Confirmed'
                  : `Returned${r.returnedToTeam ? ` to ${TEAM_LABEL[r.returnedToTeam]}` : ''}`}{' '}
                by <b className="font-medium">{r.verdictByName}</b>,{' '}
                {r.verdictAt && formatDateTime(r.verdictAt)}
                {r.verdictComment && (
                  <span className="text-muted-foreground"> · “{r.verdictComment}”</span>
                )}
              </span>
            </span>
          )}
          {!r.submittedAt && !r.verdict && (
            <span className="text-muted-foreground">In progress</span>
          )}
          {/* Phase 1 comments are private to some teams (D28) */}
          {r.commentsHidden && (
            <span className="text-muted-foreground block text-xs italic">Comments hidden</span>
          )}
        </li>
      ))}
    </ol>
  );
}

function Votes({ step, task, votes }: { step: StepDef; task: TaskView; votes: ApprovalVote[] }) {
  if (step.kind !== 'APPROVAL_CHAIN') return null;
  const runs = [...new Set(votes.map((v) => v.run).concat(task.run))].sort((a, b) => a - b);
  return (
    <div className="mt-2 flex flex-col gap-2">
      {runs.map((run) => (
        <ol
          key={run}
          className="flex flex-col gap-1 border-l pl-3 text-[13px]"
          aria-label={`Run ${run}`}
        >
          {runs.length > 1 && (
            <li className="text-muted-foreground font-mono text-xs">Run {run}</li>
          )}
          {step.stages.map((s) => {
            const mine = votes.filter((v) => v.run === run && v.stage === s.key);
            const current = task.status === 'OPEN' && task.run === run && task.side === s.key;
            return (
              <li key={s.key} className="flex flex-wrap items-baseline gap-x-2">
                <span className={cn('font-medium', current && 'text-status-amber')}>{s.title}</span>
                {mine.length === 0 && (
                  <span className="text-muted-foreground">{current ? 'waiting' : '—'}</span>
                )}
                {mine.map((v) => (
                  <span
                    key={v.employeeName + v.at}
                    className={v.vote === 'REJECT' ? 'text-status-red' : 'text-status-green'}
                  >
                    {v.vote === 'APPROVE' ? 'approved' : 'rejected'} by {v.employeeName},{' '}
                    {formatDateTime(v.at)}
                    {v.comment && <span className="text-muted-foreground"> · “{v.comment}”</span>}
                    {v.commentHidden && (
                      <span className="text-muted-foreground italic"> · Comment hidden</span>
                    )}
                  </span>
                ))}
              </li>
            );
          })}
        </ol>
      ))}
    </div>
  );
}

/** One task (a step, or one product's copy of it): who has it, since when, what happened */
function TaskLine({
  order,
  step,
  task,
  product,
}: {
  order: OrderDetail;
  step: StepDef;
  task: TaskView | undefined;
  /** For a per-product step not started yet: which product this line is */
  product?: string;
}) {
  const state = stateOf(task);
  const rounds = task ? order.rounds.filter((r) => r.taskId === task.id) : [];
  const votes = task ? order.votes.filter((v) => v.taskId === task.id) : [];
  return (
    <div id={task ? `task-${task.id}` : undefined} className="flex min-w-0 scroll-mt-24 gap-3">
      <Marker state={state} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {/* The step title is the heading above; a line names only its product */}
          {(task?.productName ?? product) && (
            <span className={cn('font-medium', state === 'not-started' && 'text-muted-foreground')}>
              {task?.productName ?? product}
            </span>
          )}
          {!(task?.productName ?? product) && (
            <span className={cn(state === 'not-started' ? 'text-muted-foreground' : 'font-medium')}>
              {state === 'done'
                ? 'Done'
                : state === 'open'
                  ? 'In progress'
                  : state === 'waiting'
                    ? 'On hold'
                    : state === 'cancelled'
                      ? 'Cancelled'
                      : 'Not started'}
            </span>
          )}
          {task?.tag && <StatusPill tone="grey">{TAG_LABEL[task.tag]}</StatusPill>}
          {task?.status === 'OPEN' && task.holder && (
            // Several named people make a long label: let it wrap on narrow screens
            <StatusPill tone="amber" className="max-w-full whitespace-normal">
              With {task.holder.label}
              {task.holder.people.length > 0 && `: ${task.holder.people.join(', ')}`}
            </StatusPill>
          )}
          {state === 'waiting' && <StatusPill tone="grey">Waiting for a fix</StatusPill>}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {task?.status === 'OPEN' && task.waitingSince && (
            <>
              Since {formatDateTime(task.waitingSince)} ({waitedFor(task.waitingSince)})
              {task.held && ` · ${days(task.held.days)} with them in total`}
            </>
          )}
          {task?.status === 'DONE' && task.doneAt && (
            <>
              Done {formatDateTime(task.doneAt)}
              {task.doneByName ? ` by ${task.doneByName}` : ''}
            </>
          )}
          {state === 'not-started' && (task || product ? 'Not started yet' : '')}
        </p>
        <Rounds rounds={rounds} />
        {task && <Votes step={step} task={task} votes={votes} />}
        {step.kind === 'CHECKPOINT_LOG' && order.checkpoints.length > 0 && (
          <ol className="mt-2 flex flex-col gap-1 border-l pl-3 text-[13px]">
            {order.checkpoints.map((c) => (
              <li key={c.id}>
                <b className="font-medium">{SHIPMENT_STATUS_LABEL[c.status]}</b>, {c.happenedOn}
                {c.note && <span className="text-muted-foreground"> · “{c.note}”</span>}
                <span className="text-muted-foreground"> · {c.loggedByName}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

const who = (step: StepDef) => {
  const label = (a: { team: string } | { slot: string }) =>
    'team' in a
      ? TEAM_LABEL[a.team as keyof typeof TEAM_LABEL]
      : SLOT_INFO[a.slot as keyof typeof SLOT_INFO].label;
  if (step.kind === 'REVIEW_LOOP')
    return `${step.submitters.map(label).join(' / ')} ⇄ ${label(step.reviewer)}`;
  if (step.kind === 'APPROVAL_CHAIN') return step.stages.map((s) => s.title).join(' → ');
  if (step.kind === 'DATA_GATE') return 'Automatic';
  return label(step.actor);
};

/**
 * The whole chain, live (brief, cross-cutting 5): every step of the order's workflow in
 * order, per phase, with who has it, since when, every loop round and every vote.
 */
export function ChainView({ order, template }: { order: OrderDetail; template: Template }) {
  return (
    <div className="flex flex-col gap-6">
      {[1, 2, 3].map((phase) => (
        <section
          key={phase}
          aria-labelledby={`phase-${phase}`}
          className="bg-card rounded-xl border p-4 sm:p-5"
        >
          <h3 id={`phase-${phase}`} className="mb-4 text-sm font-semibold">
            {PHASE_LABEL[phase]}
          </h3>
          <ol className="flex flex-col gap-5">
            {template.steps
              .filter((s) => s.phase === phase)
              .map((step) => {
                const tasks = order.tasks.filter((t) => t.stepKey === step.key);
                return (
                  <li key={step.key} className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-[13px] font-semibold">{step.title}</span>
                      <span className="text-muted-foreground text-xs">{who(step)}</span>
                    </div>
                    {step.perProduct && tasks.length === 0 && order.products.length > 0 ? (
                      order.products.map((p) => (
                        <TaskLine
                          key={p.id}
                          order={order}
                          step={step}
                          task={undefined}
                          product={p.name}
                        />
                      ))
                    ) : tasks.length === 0 ? (
                      <TaskLine order={order} step={step} task={undefined} />
                    ) : (
                      tasks.map((t) => <TaskLine key={t.id} order={order} step={step} task={t} />)
                    )}
                  </li>
                );
              })}
          </ol>
        </section>
      ))}
    </div>
  );
}
