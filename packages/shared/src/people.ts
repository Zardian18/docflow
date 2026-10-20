import { z } from 'zod';

/**
 * v2 people model (decisions.md D24). Two separate mechanisms, as the brief requires:
 * - **Teams** are pools: a step held by a team is open to every member, and any one acts.
 *   A person can be in any number of teams, with no exclusions.
 * - **Named slots** are specific people chosen per company and copied onto each order.
 */
export const TEAMS = [
  'REGULATION',
  'MATERIALS',
  'DESIGN',
  'PRODUCTION',
  'ACCOUNTS',
  'LOGISTICS',
] as const;
export const Team = z.enum(TEAMS);
export type Team = z.infer<typeof Team>;

export const TEAM_LABEL: Record<Team, string> = {
  REGULATION: 'Regulation',
  MATERIALS: 'Materials',
  DESIGN: 'Design',
  PRODUCTION: 'Production',
  ACCOUNTS: 'Accounts',
  LOGISTICS: 'Logistics',
};

/** What a person may be named as (or, for ADMIN, may do). Any combination is allowed. */
export const CAPABILITIES = ['ADMIN', 'MARKETING', 'CREATOR', 'APPROVER', 'HEAD_APPROVER'] as const;
export const Capability = z.enum(CAPABILITIES);
export type Capability = z.infer<typeof Capability>;

export const CAPABILITY_LABEL: Record<Capability, string> = {
  ADMIN: 'Admin',
  MARKETING: 'Marketing',
  CREATOR: 'Creator',
  APPROVER: 'Approver',
  HEAD_APPROVER: 'Head Approver',
};

/**
 * Named slots on an order. Approval chains each have their own Approver and Head Approver
 * slots (Q42, Q43), so the same person can be named in several, or different people.
 */
export const SLOTS = [
  'MARKETING',
  'CREATOR',
  'PI_APPROVER',
  'PI_HEAD',
  'PAY_APPROVER',
  'PAY_HEAD',
  'BOL_APPROVER',
  'BOL_HEAD',
] as const;
export const Slot = z.enum(SLOTS);
export type Slot = z.infer<typeof Slot>;

export const SLOT_INFO: Record<
  Slot,
  { label: string; capability: Capability; multiple: boolean; hasGate: boolean }
> = {
  MARKETING: { label: 'Marketing', capability: 'MARKETING', multiple: false, hasGate: false },
  CREATOR: { label: 'Creator', capability: 'CREATOR', multiple: false, hasGate: false },
  PI_APPROVER: { label: 'PI Approver', capability: 'APPROVER', multiple: true, hasGate: true },
  PI_HEAD: {
    label: 'PI Head Approver',
    capability: 'HEAD_APPROVER',
    multiple: true,
    hasGate: true,
  },
  PAY_APPROVER: {
    label: 'Payment Approver',
    capability: 'APPROVER',
    multiple: true,
    hasGate: true,
  },
  PAY_HEAD: {
    label: 'Payment Head Approver',
    capability: 'HEAD_APPROVER',
    multiple: true,
    hasGate: true,
  },
  BOL_APPROVER: { label: 'BoL Approver', capability: 'APPROVER', multiple: true, hasGate: true },
  BOL_HEAD: {
    label: 'BoL Head Approver',
    capability: 'HEAD_APPROVER',
    multiple: true,
    hasGate: true,
  },
};

/** ALL: every named person on the stage must approve. ANY: the first approval is enough. */
export const GATES = ['ALL', 'ANY'] as const;
export const Gate = z.enum(GATES);
export type Gate = z.infer<typeof Gate>;

export interface SlotPeople {
  slot: Slot;
  employeeIds: string[];
}

/**
 * Problems with a set of named slots, by slot; empty when they're fine. One person may fill
 * several slots on the same order, the Creator included (D26): each slot acts and votes
 * separately.
 */
export function slotProblems(
  slots: readonly SlotPeople[],
  { requireAll }: { requireAll: boolean },
): Partial<Record<Slot, string>> {
  const problems: Partial<Record<Slot, string>> = {};
  const people = (slot: Slot) => slots.find((s) => s.slot === slot)?.employeeIds ?? [];
  for (const slot of SLOTS) {
    const ids = people(slot);
    if (requireAll && ids.length === 0) problems[slot] = 'Choose someone';
    if (!SLOT_INFO[slot].multiple && ids.length > 1) problems[slot] = 'Choose one person';
    if (new Set(ids).size !== ids.length) problems[slot] = 'A person is listed twice';
  }
  return problems;
}
