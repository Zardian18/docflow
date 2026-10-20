import {
  SLOT_INFO,
  SLOTS,
  slotProblems,
  type Gate,
  type PersonOption,
  type Slot,
} from '@docflow/shared';

export interface SlotValue {
  slot: Slot;
  people: PersonOption[];
  gate: Gate | null;
}

export const emptySlots = (): SlotValue[] =>
  SLOTS.map((slot) => ({ slot, people: [], gate: SLOT_INFO[slot].hasGate ? 'ALL' : null }));

/** Problems by slot, from the same rule the server uses (D26) */
export const slotValueProblems = (value: SlotValue[], requireAll: boolean) =>
  slotProblems(
    value.map((v) => ({ slot: v.slot, employeeIds: v.people.map((p) => p.id) })),
    { requireAll },
  );
