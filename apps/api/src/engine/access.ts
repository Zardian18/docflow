import { stepOf, type DocKind, type Team } from '@docflow/shared';
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

/** Teams of this person that can see the order at the phase it has reached */
export function visibleTeams(user: Pick<AuthUser, 'teams'>, ctx: OrderCtx): Team[] {
  const reached = phaseReached(ctx);
  return user.teams.filter((t) => ctx.template.teamVisibleFrom[t] <= reached);
}

/** Admin sees every order; named people see theirs; teams from the phase they join (§4.8) */
export function canSeeOrder(user: Pick<AuthUser, 'id' | 'teams' | 'capabilities'>, ctx: OrderCtx) {
  return (
    user.capabilities.includes('ADMIN') || isNamed(user, ctx) || visibleTeams(user, ctx).length > 0
  );
}

/** Document access by kind: the two PI versions go to different teams (D24) */
export function canSeeDoc(
  user: Pick<AuthUser, 'id' | 'teams' | 'capabilities'>,
  ctx: OrderCtx,
  kind: DocKind,
) {
  if (user.capabilities.includes('ADMIN') || isNamed(user, ctx)) return true;
  const allowed = ctx.template.docAccess[kind];
  return visibleTeams(user, ctx).some((t) => allowed.includes(t));
}

/**
 * D28: which other roles still see private comments. ANY_ROLE: holding Marketing, Creator,
 * Approver or Head Approver at all (the owner's choice for now). NAMED_ON_ORDER: only when on
 * this order's chain (the owner may switch to this later).
 */
const PRIVATE_COMMENT_ROLES: 'ANY_ROLE' | 'NAMED_ON_ORDER' = 'ANY_ROLE';

/**
 * Comments on steps of the template's private phases (Phase 1: CBM and PI) are hidden from
 * people who see the order only through Regulation, Design, Materials or Logistics (D28).
 * Admin, people named on the order, other named roles and the other teams see them.
 */
export function canSeeComment(
  user: Pick<AuthUser, 'id' | 'teams' | 'capabilities'>,
  ctx: OrderCtx,
  phase: number,
) {
  const privacy = ctx.template.commentPrivacy;
  if (!privacy.phases.includes(phase as 1 | 2 | 3)) return true;
  if (user.capabilities.includes('ADMIN') || isNamed(user, ctx)) return true;
  if (PRIVATE_COMMENT_ROLES === 'ANY_ROLE' && user.capabilities.length > 0) return true;
  return user.teams.some((t) => !privacy.hiddenFromTeams.includes(t));
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
  return phaseReached(ctx) >= 2 && canSeeOrder(user, ctx);
}
