import type { CfoInfo } from '@docflow/shared';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, ArrowDown, ArrowUp, GripVertical, Lock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ApproverPicker } from './ApproverPicker';

export interface ChainPerson {
  employeeId: string;
  name: string;
}

/** One step of the chain. More than one person makes it a parallel step (D1). */
export interface ChainStep {
  key: string;
  people: ChainPerson[];
}

let keySeq = 0;
export const newStepKey = () => `step-${++keySeq}`;

function StepNumber({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold',
        muted ? 'bg-muted text-muted-foreground text-[11px]' : 'bg-primary-soft text-primary',
      )}
    >
      {children}
    </span>
  );
}

function StepCard({
  step,
  index,
  count,
  exclude,
  onMove,
  onRemovePerson,
  onAddParallel,
}: {
  step: ChainStep;
  index: number;
  count: number;
  exclude: Set<string>;
  onMove: (from: number, to: number) => void;
  onRemovePerson: (employeeId: string) => void;
  onAddParallel: (person: ChainPerson) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.key });
  const parallel = step.people.length > 1;
  const stepLabel = `Step ${index + 1}`;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'bg-card relative rounded-lg border',
        isDragging && 'border-primary z-10 shadow-lg',
      )}
      aria-label={`${stepLabel}${parallel ? ', parallel' : ''}`}
    >
      <div className="flex items-center gap-3 px-3 pt-3 sm:px-3.5">
        <StepNumber>{index + 1}</StepNumber>
        <p className="min-w-0 flex-1 text-[13px]">
          <span className="font-medium">{stepLabel}</span>
          {parallel && (
            <span className="text-primary"> · parallel, all {step.people.length} must approve</span>
          )}
        </p>
        <div className="-mr-1 flex shrink-0 items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-8"
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
            aria-label={`Move ${stepLabel} up`}
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-8"
            disabled={index === count - 1}
            onClick={() => onMove(index, index + 1)}
            aria-label={`Move ${stepLabel} down`}
          >
            <ArrowDown aria-hidden />
          </Button>
          <Button
            ref={setActivatorNodeRef}
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-8 cursor-grab touch-none active:cursor-grabbing"
            aria-label={`Drag to reorder ${stepLabel}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden />
          </Button>
        </div>
      </div>
      <div className="pr-2 pb-2 pl-14 sm:pl-[3.625rem]">
        <ul className={cn('flex flex-col', parallel && 'border-primary-soft border-l-2 pl-3')}>
          {step.people.map((p) => (
            <li key={p.employeeId} className="flex min-h-10 items-center justify-between gap-2">
              <span className="min-w-0 text-sm font-medium break-words">{p.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground h-8 shrink-0 px-2"
                onClick={() => onRemovePerson(p.employeeId)}
                aria-label={`Remove ${p.name}`}
              >
                <X aria-hidden />
                <span className="hidden sm:inline">Remove</span>
              </Button>
            </li>
          ))}
        </ul>
        <ApproverPicker
          exclude={exclude}
          onPick={(o) => onAddParallel({ employeeId: o.id, name: o.name })}
          variant="ghost"
          className="text-primary -ml-2.5 h-8"
        >
          Add someone to this step
        </ApproverPicker>
      </div>
    </li>
  );
}

/**
 * The default approval chain editor. Steps run in order; people inside one step approve in
 * parallel. The CFO is always the fixed final step (invariant 4) and isn't editable here.
 */
export function ChainBuilder({
  steps,
  onChange,
  cfo,
  error,
}: {
  steps: ChainStep[];
  onChange: (steps: ChainStep[]) => void;
  cfo: CfoInfo['cfo'] | undefined;
  error?: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const chosen = new Set(steps.flatMap((s) => s.people.map((p) => p.employeeId)));
  const move = (from: number, to: number) => onChange(arrayMove(steps, from, to));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = steps.findIndex((s) => s.key === active.id);
    const to = steps.findIndex((s) => s.key === over.id);
    if (from >= 0 && to >= 0) move(from, to);
  };

  return (
    <div className="flex flex-col gap-3">
      {steps.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
          No approvers yet. Add at least two people who review documents before the CFO.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          modifiers={[restrictToVerticalAxis]}
        >
          <SortableContext items={steps.map((s) => s.key)} strategy={verticalListSortingStrategy}>
            <ol className="flex flex-col gap-3" aria-label="Approval steps">
              {steps.map((step, index) => (
                <StepCard
                  key={step.key}
                  step={step}
                  index={index}
                  count={steps.length}
                  exclude={chosen}
                  onMove={move}
                  onRemovePerson={(employeeId) =>
                    onChange(
                      steps
                        .map((s) =>
                          s.key === step.key
                            ? { ...s, people: s.people.filter((p) => p.employeeId !== employeeId) }
                            : s,
                        )
                        .filter((s) => s.people.length > 0),
                    )
                  }
                  onAddParallel={(person) =>
                    onChange(
                      steps.map((s) =>
                        s.key === step.key ? { ...s, people: [...s.people, person] } : s,
                      ),
                    )
                  }
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      <div>
        <ApproverPicker
          exclude={chosen}
          onPick={(o) =>
            onChange([
              ...steps,
              { key: newStepKey(), people: [{ employeeId: o.id, name: o.name }] },
            ])
          }
        >
          Add approver step
        </ApproverPicker>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {/* Locked CFO step (screen 04's "Locked · Final Step" row) */}
      {cfo === null ? (
        <div
          className="bg-status-amber-bg text-status-amber flex items-start gap-3 rounded-lg px-3.5 py-3 text-sm"
          role="status"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-medium">No active CFO yet.</span> You can save this company now,
            but documents can’t be submitted until an employee holds the CFO role.
          </span>
        </div>
      ) : (
        <div className="bg-surface-subtle flex items-center gap-3 rounded-lg border p-3 sm:p-3.5">
          <StepNumber muted>CFO</StepNumber>
          <span className="min-w-0 flex-1">
            {cfo === undefined ? (
              <Skeleton className="h-4 w-28" />
            ) : (
              <span className="block truncate text-sm font-medium">{cfo.name}</span>
            )}
            <span className="text-muted-foreground block text-xs">Chief Financial Officer</span>
          </span>
          <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs">
            <Lock className="size-3.5" aria-hidden />
            Locked · Final step
          </span>
        </div>
      )}
    </div>
  );
}
