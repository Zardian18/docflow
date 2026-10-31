import { APPROVER_SLOTS, stepOf, type DocKind, type Team } from '@docflow/shared';
import type { AuthUser } from '../auth/sessions.js';
import type { OrderCtx } from './engine.js';

/** The furthest phase the order has reached (by the steps opened so far) */
export function phaseReached(ctx: OrderCtx): 1 | 2 | 3 {
  let phase: 1 | 2 | 3 = 1;
  for (const t of ctx.tasks) {
    const p = stepOf(ctx.template, t.stepKey).phase;
    if (p > phase) phase = p;
  }
  return phase;
}

/** The current phase: the earliest phase with an open task, else the furthest reached */
export function currentPhase(ctx: OrderCtx): 1 | 2 | 3 {
  const open = ctx.tasks
    .filter((t) => t.status === 'OPEN')
    .map((t) => stepOf(ctx.template, t.stepKey).phase);
  return open.length > 0 ? (Math.min(...open) as 1 | 2 | 3) : phaseReached(ctx);
}

const isNamed = (user: Pick<AuthUser, 'id'>, ctx: OrderCtx) =>
  [...ctx.slots.values()].some((ids) => ids.includes(user.id)) || ctx.order.createdBy === user.id;

/**
 * Approvers and Head Approvers see everything (D30): every order, every phase, the component
 * tables, every document and private message. By role, not only on the orders they're named on.
 */
export const isApprover = (user: Pick<AuthUser, 'id' | 'capabilities'>, ctx: OrderCtx) =>
  hasApproverRole(user) || APPROVER_SLOTS.some((s) => (ctx.slots.get(s) ?? []).includes(user.id));

export const hasApproverRole = (user: Pick<AuthUser, 'capabilities'>) =>
  user.capabilities.includes('APPROVER') || user.capabilities.includes('HEAD_APPROVER');

/** A private message's members, as stored (D29) */
export interface AudienceMembers {
  employeeIds: string[];
  teams: Team[];
}

/**
 * Who reads a private message (D29): its members (by person or team), the order's approvers
 * and Head Approvers, and Admin. Not private (no audience): everyone who sees the order.
 */
export function canSeeAudience(
  user: Pick<AuthUser, 'id' | 'teams' | 'capabilities'>,
  ctx: OrderCtx,
  members: AudienceMembers | undefined,
) {
  if (!members) return true;
  return (
    user.capabilities.includes('ADMIN') ||
    isApprover(user, ctx) ||
    members.employeeIds.includes(user.id) ||
    members.teams.some((t) => user.teams.includes(t))
  );
}

/**
 * A private phase (D29: Phase 2) is hidden from people whose only part is Marketing. Anyone
 * also in one of its teams, approvers, Head Approvers and Admin see it.
 */
export function seesPhase(
  user: Pick<AuthUser, 'id' | 'teams' | 'capabilities'>,
  ctx: OrderCtx,
  phase: number,
) {
  const privacy = ctx.template.phasePrivacy;
  if (!privacy || privacy.phase !== phase) return true;
  if (user.capabilities.includes('ADMIN') || isApprover(user, ctx)) return true;
  if (user.teams.some((t) => privacy.involvedTeams.includes(t))) return true;
  const marketing =
    user.capabilities.includes('MARKETING') || (ctx.slots.get('MARKETING') ?? []).includes(user.id);
  return !marketing;
}

/** Teams of this person that can see the order at the phase it has reached */
export function visibleTeams(user: Pick<AuthUser, 'teams'>, ctx: OrderCtx): Team[] {
  const reached = phaseReached(ctx);
  return user.teams.filter((t) => ctx.template.teamVisibleFrom[t] <= reached);
}

/** Admin sees every order; named people see theirs; teams from the phase they join (§4.8) */
export function canSeeOrder(user: Pick<AuthUser, 'id' | 'teams' | 'capabilities'>, ctx: OrderCtx) {
  return (
    user.capabilities.includes('ADMIN') ||
    hasApproverRole(user) ||
    isNamed(user, ctx) ||
    visibleTeams(user, ctx).length > 0
  );
}

/** Document access by kind: the two PI versions go to different teams (D24) */
export function canSeeDoc(
  user: Pick<AuthUser, 'id' | 'teams' | 'capabilities'>,
  ctx: OrderCtx,
  kind: DocKind,
) {
  if (isApprover(user, ctx)) return true;
  // Admin opens everything except the kinds kept to their teams and the approvers (D30: POs)
  if (user.capabilities.includes('ADMIN')) return !ctx.template.docsHiddenFromAdmin.includes(kind);
  // Named people open every document, except the kinds kept to their teams (D29)
  if (isNamed(user, ctx) && !ctx.template.docsByAccessOnly.includes(kind)) return true;
  const allowed = ctx.template.docAccess[kind];
  return visibleTeams(user, ctx).some((t) => allowed.includes(t));
}

/** Materials edits the component tables from production start until hand-over (C2) */
export function canEditComponents(user: Pick<AuthUser, 'teams'>, ctx: OrderCtx) {
  if (ctx.order.status !== 'ACTIVE' || !ctx.order.productionStartedAt) return false;
  const until = ctx.tasks.find((t) => t.stepKey === ctx.template.componentsEditableUntil);
  if (until?.status === 'DONE') return false;
  return user.teams.includes('MATERIALS');
}

/** The component tables: every team that can see the order in Phase 2+, named people, Admin */
export function canSeeComponents(
  user: Pick<AuthUser, 'id' | 'teams' | 'capabilities'>,
  ctx: OrderCtx,
) {
  return phaseReached(ctx) >= 2 && canSeeOrder(user, ctx) && seesPhase(user, ctx, 2);
}
