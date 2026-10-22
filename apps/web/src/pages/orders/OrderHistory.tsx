import {
  CHANNEL_LABEL,
  DOC_KIND_LABEL,
  SHIPMENT_STATUS_LABEL,
  SLOT_INFO,
  TEAM_LABEL,
  type Channel,
  type DocKind,
  type OrderDetail,
  type OrderEvent,
  type ShipmentStatus,
  type Template,
} from '@docflow/shared';
import { useQuery } from '@tanstack/react-query';
import { Paperclip } from 'lucide-react';
import { ErrorState, ListSkeleton } from '@/components/States';
import { api } from '@/lib/api';
import { openDocument } from '@/lib/documents';
import { formatDateTime } from '@/lib/format';

const roleLabel = (as: string | null) => {
  if (!as) return null;
  if (as === 'ADMIN') return 'Admin';
  if (as in TEAM_LABEL) return TEAM_LABEL[as as keyof typeof TEAM_LABEL];
  if (as in SLOT_INFO) return SLOT_INFO[as as keyof typeof SLOT_INFO].label;
  return as;
};

/** One readable sentence per tracked event (actor, role, time and comment shown alongside) */
function sentence(e: OrderEvent, step: string, product: string | null): string {
  const what = product ? `${step} · ${product}` : step;
  const d = e.details as Record<string, unknown>;
  const channel = d.channel ? CHANNEL_LABEL[d.channel as Channel] : null;
  switch (e.type) {
    case 'ORDER_CREATED':
      return `Created the order for ${String(d.buyer)}`;
    case 'STEP_OPENED':
      return `${what} opened${d.holder ? `, with ${String(d.holder)}` : ''}${Number(d.run) > 1 ? ` (run ${String(d.run)})` : ''}`;
    case 'SUBMITTED':
      return `Sent ${what} for review${channel ? ` (${channel}, round ${String(d.round)})` : ''}`;
    case 'CONFIRMED':
      return `Confirmed ${what}`;
    case 'RETURNED':
      return `Sent ${what} back to ${String(d.to)}`;
    case 'APPROVED':
      return `Approved ${what} (${String(d.stage)})`;
    case 'REJECTED':
      return `Rejected ${what} (${String(d.stage)})`;
    case 'STAGE_PASSED':
      return `${what}: stage “${String(d.stage)}” passed`;
    case 'CHAIN_APPROVED':
      return `${what} fully approved`;
    case 'CHAIN_RESTARTED':
      return `${what} starts again from the first stage (run ${String(d.run)})`;
    case 'COMPLETED':
      return `Completed ${what}${Array.isArray(d.products) ? `: ${(d.products as string[]).join(', ')}` : ''}`;
    case 'LOGGED':
      return `${what}${d.date ? ` (${String(d.date)})` : ''}`;
    case 'CHECKPOINT':
      return `Shipment update: ${SHIPMENT_STATUS_LABEL[d.status as ShipmentStatus] ?? String(d.status)}${d.date ? ` (${String(d.date)})` : ''}`;
    case 'CLOSED':
      return 'Confirmed the buyer received the goods';
    case 'GATE_PASSED':
      return `${what}: every component ready for Production`;
    case 'STATUS_CHANGED':
      return d.status === 'DONE' ? 'Order done' : 'Order: No Action Needed';
    case 'CANCELLED':
      return 'Cancelled the order';
    case 'SLOT_PERSON_REPLACED':
      return `Replaced a named person (${SLOT_INFO[d.slot as keyof typeof SLOT_INFO]?.label ?? String(d.slot)})`;
    case 'SLOT_CHANGED': {
      const gate = d.gate === 'ANY' ? 'any one is enough' : 'all must approve';
      return `Changed ${SLOT_INFO[d.slot as keyof typeof SLOT_INFO]?.label ?? String(d.slot)} for this order (${gate})`;
    }
    case 'ORDER_RENAMED':
      return `Changed the order number from ${String(d.from)} to ${String(d.to)}`;
    case 'COMPONENT_ADDED':
      return `Added ${String(d.component)} to ${String(d.product)}`;
    case 'COMPONENT_UPDATED':
      return `Updated ${String(d.component)} (${(d.fields as string[]).join(', ')})`;
    case 'COMPONENT_DELETED':
      return `Removed ${String(d.component)}`;
    default:
      return e.type;
  }
}

/** The order’s complete history, oldest first (brief, cross-cutting 5) */
export function OrderHistory({ order, template }: { order: OrderDetail; template: Template }) {
  const events = useQuery({
    queryKey: ['order-timeline', order.id],
    queryFn: ({ signal }) => api.orders.timeline(order.id, signal),
  });
  if (events.isPending) return <ListSkeleton />;
  if (events.error) return <ErrorState error={events.error} onRetry={() => events.refetch()} />;
  const stepTitle = (key: string | null) => template.steps.find((s) => s.key === key)?.title ?? '';
  const productOf = (taskId: string | null) =>
    order.tasks.find((t) => t.id === taskId)?.productName ?? null;
  return (
    <ol className="bg-card flex flex-col rounded-xl border" aria-label="Order history">
      {events.data!.map((e) => {
        const docs =
          (e.details as { documents?: Array<{ id: string; kind: DocKind; fileName: string }> })
            .documents ?? [];
        const role = roleLabel(e.actingAs);
        return (
          <li
            key={e.id}
            className="flex flex-col gap-1 border-b px-4 py-3 last:border-0 sm:flex-row sm:gap-4"
          >
            <time
              className="text-muted-foreground w-40 shrink-0 text-xs tabular-nums"
              dateTime={e.at}
            >
              {formatDateTime(e.at)}
            </time>
            <div className="min-w-0 text-[13px]">
              <p>
                {sentence(e, stepTitle(e.stepKey), productOf(e.taskId))}
                {e.actorName && (
                  <span className="text-muted-foreground">
                    {' '}
                    · {e.actorName}
                    {role && ` as ${role}`}
                  </span>
                )}
              </p>
              {e.comment && <p className="text-muted-foreground mt-0.5">“{e.comment}”</p>}
              {e.commentHidden && (
                <p className="text-muted-foreground mt-0.5 italic">Comment hidden</p>
              )}
              {docs.length > 0 && (
                <ul className="mt-1 flex flex-wrap gap-2">
                  {docs.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        className="text-primary inline-flex items-center gap-1 hover:underline"
                        onClick={() => void openDocument(d.id, 'view')}
                      >
                        <Paperclip className="size-3.5" aria-hidden />
                        {DOC_KIND_LABEL[d.kind]}: {d.fileName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
