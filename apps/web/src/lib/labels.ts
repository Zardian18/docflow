import {
  ORDER_STATUS_LABEL,
  SLOT_INFO,
  TEAM_LABEL,
  type Clock,
  type OrderStatus,
  type Slot,
  type Team,
} from '@docflow/shared';
import { formatDistanceToNowStrict } from 'date-fns';
import type { PillTone } from '@/components/StatusPill';
import { formatDate } from './format';

export const orderRef = (n: number) => `ORD-${String(n).padStart(4, '0')}`;

export const ORDER_TONE: Record<OrderStatus, PillTone> = {
  ACTIVE: 'blue',
  NO_ACTION_NEEDED: 'amber',
  DONE: 'green',
  CANCELLED: 'grey',
};
export const orderStatusLabel = (s: OrderStatus) => ORDER_STATUS_LABEL[s];

export const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/** "12 days · since 3 Oct 2026": a day-counter always shows the date it counts from */
export function clockText(clock: Clock, empty = 'Not started') {
  if (!clock) return empty;
  return `${days(clock.days)} · since ${formatDate(clock.since)}`;
}

export const holderText = (h: { team: Team | null; slot: Slot | null } | null) =>
  h?.team ? TEAM_LABEL[h.team] : h?.slot ? SLOT_INFO[h.slot].label : '—';

/** "3 days" or "5 hours", for how long something has waited */
export const waitedFor = (iso: string) => formatDistanceToNowStrict(new Date(iso));

export const PHASE_LABEL: Record<number, string> = {
  1: 'Phase 1 · Sales and PI',
  2: 'Phase 2 · Production',
  3: 'Phase 3 · Logistics and shipment',
};
