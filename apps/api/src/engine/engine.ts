import {
  APPROVER_SLOTS,
  COMPONENT_REQUIRED_FIELDS,
  DOC_KIND_LABEL,
  CURRENT_TEMPLATE,
  findTemplate,
  SLOT_INFO,
  SLOTS,
  slotProblems,
  stepOf,
  TAG_LABEL,
  TEAM_LABEL,
  type Actor,
  type Gate,
  OrderCreate,
  orderRef,
  type Slot,
  type StepDef,
  type TaskAction,
  TaskActionRequest,
  type Team,
  type Template,
} from '@docflow/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { AuthUser } from '../auth/sessions.js';
import type { Db, Tx } from '../db/client.js';
import {
  approvalVotes,
  audienceMembers,
  audiences,
  buyers,
  buyerSlotGates,
  buyerSlotPeople,
  channelRounds,
  documents,
  employeeCapabilities,
  employees,
  holderIntervals,
  notices,
  orderComponents,
  orderEvents,
  orderProducts,
  orders,
  orderSlotGates,
  orderSlotPeople,
  payments,
  shipmentCheckpoints,
  tasks,
  teamMembers,
} from '../db/schema.js';
import { AppError, conflict, forbidden, notFound } from '../errors.js';
import type { StorageService } from '../storage/storage.js';
import { canSeeOrder } from './access.js';
import { instantForLocalDate } from './clock.js';
import { attachFiles, prepareFiles, removeUploadObjects } from './files.js';

type ActionInput = z.output<typeof TaskActionRequest>;
type CreateInput = z.output<typeof OrderCreate>;
type TaskRow = typeof tasks.$inferSelect;
type OrderRow = typeof orders.$inferSelect;

export interface Holder {
  team: Team | null;
  slot: Slot | null;
}

/** Everything the engine needs about one order, loaded inside the transaction */
export interface OrderCtx {
  order: OrderRow;
  template: Template;
  slots: Map<Slot, string[]>;
  gates: Map<Slot, Gate>;
  products: Array<{ id: string; name: string; position: number }>;
  tasks: TaskRow[];
}

const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);

export const actorHolder = (actor: Actor): Holder =>
  'team' in actor ? { team: actor.team, slot: null } : { team: null, slot: actor.slot };

export const holderLabel = (h: Holder) =>
  h.team ? TEAM_LABEL[h.team] : h.slot ? SLOT_INFO[h.slot].label : '—';

export async function loadCtx(tx: Tx | Db, orderId: string, lock = false): Promise<OrderCtx> {
  const [order] = lock
    ? await tx.select().from(orders).where(eq(orders.id, orderId)).for('update')
    : await tx.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw notFound('Order');
  const [slotRows, gateRows, products, taskRows] = await Promise.all([
    tx
      .select()
      .from(orderSlotPeople)
      .where(eq(orderSlotPeople.orderId, orderId))
      .orderBy(asc(orderSlotPeople.ordinal)),
    tx.select().from(orderSlotGates).where(eq(orderSlotGates.orderId, orderId)),
    tx
      .select({ id: orderProducts.id, name: orderProducts.name, position: orderProducts.position })
      .from(orderProducts)
      .where(eq(orderProducts.orderId, orderId))
      .orderBy(asc(orderProducts.position)),
    tx.select().from(tasks).where(eq(tasks.orderId, orderId)),
  ]);
  const slots = new Map<Slot, string[]>();
  for (const r of slotRows) slots.set(r.slot, [...(slots.get(r.slot) ?? []), r.employeeId]);
  return {
    order,
    template: findTemplate(order.templateKey, order.templateVersion),
    slots,
    gates: new Map(gateRows.map((g) => [g.slot, g.gate])),
    products,
    tasks: taskRows,
  };
}

const taskOf = (ctx: OrderCtx, stepKey: string, productId: string | null) =>
  ctx.tasks.find((t) => t.stepKey === stepKey && t.productId === productId);

// ---- Who may act -------------------------------------------------------------------

export function isHolder(user: Pick<AuthUser, 'id' | 'teams'>, ctx: OrderCtx, holder: Holder) {
  if (holder.team) return user.teams.includes(holder.team);
  if (holder.slot) return (ctx.slots.get(holder.slot) ?? []).includes(user.id);
  return false;
}

/** The actions the signed-in person can take on a task right now (Admin acts on none, Q9) */
export async function actionsFor(
  tx: Tx | Db,
  user: Pick<AuthUser, 'id' | 'teams'>,
  ctx: OrderCtx,
  task: TaskRow,
): Promise<TaskAction[]> {
  if (task.status !== 'OPEN' || ctx.order.status === 'DONE' || ctx.order.status === 'CANCELLED') {
    return [];
  }
  const holder = { team: task.holderTeam, slot: task.holderSlot };
  if (!isHolder(user, ctx, holder)) return [];
  const step = stepOf(ctx.template, task.stepKey);
  switch (step.kind) {
    case 'TASK':
      return ['COMPLETE'];
    case 'REVIEW_LOOP':
      return task.side === 'REVIEWER' ? ['CONFIRM', 'RETURN'] : ['SUBMIT'];
    case 'APPROVAL_CHAIN': {
      // One vote per person per stage per run
      const [voted] = await tx
        .select({ id: approvalVotes.id })
        .from(approvalVotes)
        .where(
          and(
            eq(approvalVotes.taskId, task.id),
            eq(approvalVotes.run, task.run),
            eq(approvalVotes.stage, task.side ?? ''),
            eq(approvalVotes.employeeId, user.id),
          ),
        );
      return voted ? [] : ['APPROVE', 'REJECT'];
    }
    case 'STATUS_LOG':
      return ['LOG'];
    case 'CHECKPOINT_LOG':
      return ['CHECKPOINT'];
    case 'CLOSE':
      return ['CLOSE'];
    case 'DATA_GATE':
      return [];
  }
}

/** Whether this person is among the actors of a step at all (any side, any stage) */
function takesPart(user: Pick<AuthUser, 'id' | 'teams'>, ctx: OrderCtx, step: StepDef) {
  const actors: Actor[] =
    step.kind === 'REVIEW_LOOP'
      ? [...step.submitters, step.reviewer]
      : step.kind === 'APPROVAL_CHAIN'
        ? step.stages.map((s) => s.actor)
        : step.kind === 'DATA_GATE'
          ? []
          : [step.actor];
  return actors.some((a) => isHolder(user, ctx, actorHolder(a)));
}

// ---- Low-level moves ---------------------------------------------------------------

export async function logEvent(
  tx: Tx,
  e: {
    orderId: string;
    type: string;
    taskId?: string | null;
    stepKey?: string | null;
    actorId?: string | null;
    actingAs?: string | null;
    comment?: string | null;
    details?: Record<string, unknown>;
    /** A private message's audience (D29) */
    audienceId?: string | null;
  },
) {
  await tx.insert(orderEvents).values({
    orderId: e.orderId,
    type: e.type,
    taskId: e.taskId ?? null,
    stepKey: e.stepKey ?? null,
    actorId: e.actorId ?? null,
    actingAs: e.actingAs ?? null,
    comment: e.comment ?? null,
    details: e.details ?? {},
    audienceId: e.audienceId ?? null,
  });
}

/** Hands a task to a new holder (or to nobody), closing the previous holder interval. */
async function setHolder(tx: Tx, task: TaskRow, holder: Holder | null, reason: string) {
  await tx
    .update(holderIntervals)
    .set({ endedAt: sql`clock_timestamp()` })
    .where(and(eq(holderIntervals.taskId, task.id), isNull(holderIntervals.endedAt)));
  task.holderTeam = holder?.team ?? null;
  task.holderSlot = holder?.slot ?? null;
  if (holder && (holder.team || holder.slot)) {
    await tx.insert(holderIntervals).values({
      taskId: task.id,
      orderId: task.orderId,
      holderTeam: holder.team,
      holderSlot: holder.slot,
      reason,
    });
  }
}

async function saveTask(tx: Tx, task: TaskRow) {
  await tx
    .update(tasks)
    .set({
      status: task.status,
      side: task.side,
      run: task.run,
      holderTeam: task.holderTeam,
      holderSlot: task.holderSlot,
      openedAt: task.openedAt,
      doneAt: task.doneAt,
      doneBy: task.doneBy,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, task.id));
}

async function nextRound(
  tx: Tx,
  task: TaskRow,
  channel: (typeof channelRounds.$inferInsert)['channel'],
) {
  const [{ n } = { n: 0 }] = await tx
    .select({ n: sql<number>`coalesce(max(${channelRounds.round}), 0)::int` })
    .from(channelRounds)
    .where(eq(channelRounds.taskId, task.id));
  const [round] = await tx
    .insert(channelRounds)
    .values({ taskId: task.id, orderId: task.orderId, channel, round: n + 1 })
    .returning();
  return round!;
}

async function currentRound(tx: Tx, task: TaskRow) {
  const [round] = await tx
    .select()
    .from(channelRounds)
    .where(eq(channelRounds.taskId, task.id))
    .orderBy(sql`${channelRounds.round} desc`)
    .limit(1);
  if (!round) throw new Error(`review loop ${task.id} has no round`);
  return round;
}

/** Opens a step's task (creating it, or reopening a waiting one). */
async function openTask(
  tx: Tx,
  ctx: OrderCtx,
  step: StepDef,
  productId: string | null,
  reason: string,
) {
  let task = taskOf(ctx, step.key, productId);
  if (!task) {
    const [created] = await tx
      .insert(tasks)
      .values({
        orderId: ctx.order.id,
        productId,
        stepKey: step.key,
        phase: step.phase,
        tag: step.tag ?? null,
      })
      .returning();
    task = created!;
    ctx.tasks.push(task);
  } else if (step.kind === 'APPROVAL_CHAIN') {
    task.run += 1;
  }
  task.status = 'OPEN';
  task.openedAt = new Date();
  task.doneAt = null;
  task.doneBy = null;
  let holder: Holder | null = null;
  switch (step.kind) {
    case 'REVIEW_LOOP': {
      task.side = step.startsWith;
      holder = actorHolder(step.startsWith === 'REVIEWER' ? step.reviewer : step.submitters[0]!);
      await nextRound(tx, task, step.channel);
      break;
    }
    case 'APPROVAL_CHAIN':
      task.side = step.stages[0]!.key;
      holder = actorHolder(step.stages[0]!.actor);
      break;
    case 'DATA_GATE':
      task.side = null;
      break;
    default:
      task.side = null;
      holder = actorHolder(step.actor);
  }
  await setHolder(tx, task, holder, reason);
  await saveTask(tx, task);
  await logEvent(tx, {
    orderId: ctx.order.id,
    type: 'STEP_OPENED',
    taskId: task.id,
    stepKey: step.key,
    details: {
      productId,
      run: task.run,
      holder: holder ? holderLabel(holder) : null,
    },
  });
  return task;
}

/** Marks a task done and applies its effect on the order. */
async function completeTask(
  tx: Tx,
  ctx: OrderCtx,
  task: TaskRow,
  step: StepDef,
  userId: string | null,
  at: Date = new Date(),
) {
  task.status = 'DONE';
  task.doneAt = new Date();
  task.doneBy = userId;
  await setHolder(tx, task, null, 'DONE');
  await saveTask(tx, task);
  const o = ctx.order;
  switch (step.effect) {
    case 'START_CHAIN':
      o.chainStartedAt = at;
      await tx.update(orders).set({ chainStartedAt: at }).where(eq(orders.id, o.id));
      break;
    case 'START_PRODUCTION':
      o.productionStartedAt = at;
      await tx.update(orders).set({ productionStartedAt: at }).where(eq(orders.id, o.id));
      break;
    case 'NO_ACTION_NEEDED':
      o.status = 'NO_ACTION_NEEDED';
      await tx.update(orders).set({ status: 'NO_ACTION_NEEDED' }).where(eq(orders.id, o.id));
      await logEvent(tx, {
        orderId: o.id,
        type: 'STATUS_CHANGED',
        details: { status: 'NO_ACTION_NEEDED' },
      });
      break;
    case 'DONE': {
      o.status = 'DONE';
      o.closedAt = new Date();
      await tx
        .update(orders)
        .set({ status: 'DONE', closedAt: o.closedAt })
        .where(eq(orders.id, o.id));
      // Checkpoint logs close with the order
      for (const t of ctx.tasks) {
        const s = stepOf(ctx.template, t.stepKey);
        if (t.status === 'OPEN' && s.kind === 'CHECKPOINT_LOG' && s.closesWith === step.key) {
          t.status = 'DONE';
          t.doneAt = new Date();
          t.doneBy = userId;
          await setHolder(tx, t, null, 'DONE');
          await saveTask(tx, t);
        }
      }
      await logEvent(tx, { orderId: o.id, type: 'STATUS_CHANGED', details: { status: 'DONE' } });
      break;
    }
  }
}

function depsDone(ctx: OrderCtx, step: StepDef, productId: string | null) {
  return step.after.every((depKey) => {
    const dep = stepOf(ctx.template, depKey);
    if (!dep.perProduct) return taskOf(ctx, depKey, null)?.status === 'DONE';
    if (step.perProduct) return taskOf(ctx, depKey, productId)?.status === 'DONE';
    return (
      ctx.products.length > 0 &&
      ctx.products.every((p) => taskOf(ctx, depKey, p.id)?.status === 'DONE')
    );
  });
}

async function gateSatisfied(tx: Tx, ctx: OrderCtx, step: StepDef) {
  if (step.kind !== 'DATA_GATE') return false;
  // Every product has components, and every component is far enough along
  const rows = await tx
    .select()
    .from(orderComponents)
    .where(eq(orderComponents.orderId, ctx.order.id));
  const ready = (r: (typeof rows)[number]) =>
    step.condition === 'ALL_COMPONENTS_DELIVERED'
      ? r.deliverDate !== null
      : COMPONENT_REQUIRED_FIELDS.every((f) => r[f] !== null);
  return (
    ctx.products.length > 0 &&
    ctx.products.every((p) => rows.some((r) => r.productId === p.id)) &&
    rows.every(ready)
  );
}

/**
 * Opens every step whose dependencies are done, and completes data gates whose condition
 * holds, until nothing changes. Called after every action.
 */
export async function advance(tx: Tx, ctx: OrderCtx) {
  if (ctx.order.status === 'CANCELLED' || ctx.order.status === 'DONE') return;
  for (let changed = true; changed;) {
    changed = false;
    for (const step of ctx.template.steps) {
      const instances = step.perProduct ? ctx.products.map((p) => p.id) : [null];
      for (const productId of instances) {
        const task = taskOf(ctx, step.key, productId);
        if (
          task?.status === 'OPEN' &&
          step.kind === 'DATA_GATE' &&
          (await gateSatisfied(tx, ctx, step))
        ) {
          await completeTask(tx, ctx, task, step, null);
          await logEvent(tx, {
            orderId: ctx.order.id,
            type: 'GATE_PASSED',
            taskId: task.id,
            stepKey: step.key,
          });
          changed = true;
          continue;
        }
        if (task && task.status !== 'WAITING') continue;
        if (!depsDone(ctx, step, productId)) continue;
        await openTask(tx, ctx, step, productId, task ? 'REOPENED' : 'OPENED');
        changed = true;
      }
    }
  }
}

// ---- Creating and cancelling orders ------------------------------------------------

async function peopleWithCapability(tx: Tx, ids: string[]) {
  if (ids.length === 0) return [];
  return tx
    .select({ id: employees.id, capability: employeeCapabilities.capability })
    .from(employees)
    .innerJoin(employeeCapabilities, eq(employeeCapabilities.employeeId, employees.id))
    .where(and(inArray(employees.id, ids), eq(employees.isActive, true)));
}

/** Checks named people: active, holding the slot's capability, and the slot's size rules. */
export async function checkSlots(tx: Tx, slots: Map<Slot, string[]>, requireAll: boolean) {
  const list = SLOTS.map((slot) => ({ slot, employeeIds: slots.get(slot) ?? [] }));
  const problems = slotProblems(list, { requireAll });
  const caps = await peopleWithCapability(tx, [...new Set(list.flatMap((s) => s.employeeIds))]);
  for (const { slot, employeeIds } of list) {
    for (const id of employeeIds) {
      if (!caps.some((c) => c.id === id && c.capability === SLOT_INFO[slot].capability)) {
        problems[slot] ??= `Everyone here must be active and able to be ${SLOT_INFO[slot].label}`;
      }
    }
  }
  if (Object.keys(problems).length > 0) {
    throw badRequest('INVALID_SLOTS', 'Some named people need changing', { slots: problems });
  }
}

async function refTaken(tx: Tx, ref: string, exceptOrderId?: string) {
  const [row] = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(sql`lower(${orders.ref}) = lower(${ref})`);
  return row !== undefined && row.id !== exceptOrderId;
}

/** An unused order number: ORD-0007, or ORD-0007-2 if an order was already renamed to it */
async function freshRef(tx: Tx, number: number) {
  for (let n = 1; ; n++) {
    const ref = n === 1 ? orderRef(number) : `${orderRef(number)}-${n}`;
    if (!(await refTaken(tx, ref))) return ref;
  }
}

/**
 * Marketing creates an order (Q2). The chain comes from the buyer's default (D27), and
 * Marketing can change its people and ALL/ANY settings for this order only (Q61).
 */
export async function createOrder(db: Db, user: AuthUser, input: CreateInput) {
  if (!user.capabilities.includes('MARKETING')) throw forbidden();
  return db.transaction(async (tx) => {
    const [buyer] = await tx.select().from(buyers).where(eq(buyers.id, input.buyerId));
    if (!buyer?.isActive) throw badRequest('BUYER_UNAVAILABLE', 'Choose an active buyer.');

    const configured = await tx
      .select()
      .from(buyerSlotPeople)
      .where(eq(buyerSlotPeople.buyerId, buyer.id))
      .orderBy(asc(buyerSlotPeople.ordinal));
    const slots = new Map<Slot, string[]>();
    for (const r of configured) slots.set(r.slot, [...(slots.get(r.slot) ?? []), r.employeeId]);
    for (const s of input.slots) slots.set(s.slot, s.employeeIds);
    // Whoever creates the order is its Marketing person unless the buyer names someone
    if ((slots.get('MARKETING') ?? []).length === 0) slots.set('MARKETING', [user.id]);
    await checkSlots(tx, slots, true);
    const defaultGates = await tx
      .select()
      .from(buyerSlotGates)
      .where(eq(buyerSlotGates.buyerId, buyer.id));
    const gateFor = (slot: Slot): Gate =>
      input.slots.find((s) => s.slot === slot)?.gate ??
      defaultGates.find((g) => g.slot === slot)?.gate ??
      'ALL';

    const template = CURRENT_TEMPLATE;
    const [created] = await tx
      .insert(orders)
      .values({
        // Replaced right below, once the sequence has given this order its number
        ref: `new-${crypto.randomUUID()}`,
        buyerId: buyer.id,
        templateKey: template.key,
        templateVersion: template.version,
        notes: input.notes,
        createdBy: user.id,
      })
      .returning();
    const ref = await freshRef(tx, created!.number);
    await tx.update(orders).set({ ref }).where(eq(orders.id, created!.id));
    const orderId = created!.id;
    await tx
      .insert(orderSlotPeople)
      .values(
        [...slots].flatMap(([slot, ids]) =>
          ids.map((employeeId, ordinal) => ({ orderId, slot, employeeId, ordinal })),
        ),
      );
    const gateRows = SLOTS.filter((s) => SLOT_INFO[s].hasGate).map((slot) => ({
      orderId,
      slot,
      gate: gateFor(slot),
    }));
    await tx.insert(orderSlotGates).values(gateRows);
    await logEvent(tx, {
      orderId,
      type: 'ORDER_CREATED',
      actorId: user.id,
      actingAs: 'MARKETING',
      comment: input.notes,
      details: {
        ref,
        buyer: buyer.name,
        template: `${template.key} v${template.version}`,
        slots: Object.fromEntries(slots),
        gates: Object.fromEntries(gateRows.map((g) => [g.slot, g.gate])),
      },
    });
    const ctx = await loadCtx(tx, orderId, true);
    await advance(tx, ctx);
    return orderId;
  });
}

const inSlot = (ctx: OrderCtx, slot: Slot, userId: string) =>
  (ctx.slots.get(slot) ?? []).includes(userId);

/** Who may change the order number: the Creator, the order's Marketing person, and Admin (D27) */
export function canRename(user: Pick<AuthUser, 'id' | 'capabilities'>, ctx: OrderCtx) {
  if (ctx.order.status === 'DONE' || ctx.order.status === 'CANCELLED') return false;
  return (
    user.capabilities.includes('ADMIN') ||
    inSlot(ctx, 'CREATOR', user.id) ||
    inSlot(ctx, 'MARKETING', user.id)
  );
}

async function setRef(tx: Tx, ctx: OrderCtx, ref: string, actorId: string, actingAs: string) {
  const next = ref.trim();
  if (next === ctx.order.ref) return;
  if (await refTaken(tx, next, ctx.order.id)) {
    throw conflict('REF_TAKEN', `Another order already uses ${next}.`);
  }
  await tx
    .update(orders)
    .set({ ref: next, updatedAt: new Date() })
    .where(eq(orders.id, ctx.order.id));
  await logEvent(tx, {
    orderId: ctx.order.id,
    type: 'ORDER_RENAMED',
    actorId,
    actingAs,
    details: { from: ctx.order.ref, to: next },
  });
  ctx.order.ref = next;
}

export async function renameOrder(db: Db, user: AuthUser, orderId: string, ref: string) {
  await db.transaction(async (tx) => {
    const ctx = await loadCtx(tx, orderId, true);
    if (!canSeeOrder(user, ctx)) throw notFound('Order');
    if (!canRename(user, ctx)) throw forbidden();
    const actingAs = inSlot(ctx, 'CREATOR', user.id)
      ? 'CREATOR'
      : inSlot(ctx, 'MARKETING', user.id)
        ? 'MARKETING'
        : 'ADMIN';
    await setRef(tx, ctx, ref, user.id, actingAs);
  });
}

/**
 * Approval slots whose stage hasn't started yet in the current run, so Marketing can still
 * change their people and ALL/ANY for this order (D27). A chain waiting to (re-)run counts as
 * not started.
 */
export function editableSlots(ctx: OrderCtx): Slot[] {
  if (ctx.order.status === 'DONE' || ctx.order.status === 'CANCELLED') return [];
  const result = new Set<Slot>();
  for (const step of ctx.template.steps) {
    if (step.kind !== 'APPROVAL_CHAIN') continue;
    const task = taskOf(ctx, step.key, null);
    const current = task ? step.stages.findIndex((s) => s.key === task.side) : -1;
    for (const [index, stage] of step.stages.entries()) {
      if (!('slot' in stage.actor) || !SLOT_INFO[stage.actor.slot].hasGate) continue;
      const started =
        task !== undefined &&
        (task.status === 'DONE' ||
          task.status === 'CANCELLED' ||
          (task.status === 'OPEN' && current >= index));
      if (!started) result.add(stage.actor.slot);
    }
  }
  return [...result];
}

/** The order's Marketing person, and Admin, may change its chain (D27) */
export function canEditChain(user: Pick<AuthUser, 'id' | 'capabilities'>, ctx: OrderCtx) {
  return (
    user.capabilities.includes('ADMIN') ||
    (user.capabilities.includes('MARKETING') && inSlot(ctx, 'MARKETING', user.id))
  );
}

/** Marketing changes one approval slot of this order before its stage starts (D27). */
export async function updateOrderSlot(
  db: Db,
  user: AuthUser,
  orderId: string,
  slot: Slot,
  input: { employeeIds: string[]; gate: Gate; reason: string | null },
) {
  await db.transaction(async (tx) => {
    const ctx = await loadCtx(tx, orderId, true);
    // An order someone can't see is a 404, never a 403 (invariant 9)
    if (!canSeeOrder(user, ctx)) throw notFound('Order');
    if (!canEditChain(user, ctx)) throw forbidden();
    if (!editableSlots(ctx).includes(slot)) {
      throw conflict(
        'STAGE_STARTED',
        `The ${SLOT_INFO[slot].label} stage has already started, so it can't be changed now.`,
      );
    }
    const next = new Map(ctx.slots);
    next.set(slot, input.employeeIds);
    await checkSlots(tx, next, true);
    await tx
      .delete(orderSlotPeople)
      .where(and(eq(orderSlotPeople.orderId, orderId), eq(orderSlotPeople.slot, slot)));
    await tx
      .insert(orderSlotPeople)
      .values(
        input.employeeIds.map((employeeId, ordinal) => ({ orderId, slot, employeeId, ordinal })),
      );
    await tx
      .insert(orderSlotGates)
      .values({ orderId, slot, gate: input.gate })
      .onConflictDoUpdate({
        target: [orderSlotGates.orderId, orderSlotGates.slot],
        set: { gate: input.gate },
      });
    await logEvent(tx, {
      orderId,
      type: 'SLOT_CHANGED',
      actorId: user.id,
      actingAs: inSlot(ctx, 'MARKETING', user.id) ? 'MARKETING' : 'ADMIN',
      comment: input.reason,
      details: {
        slot,
        from: ctx.slots.get(slot) ?? [],
        to: input.employeeIds,
        gateFrom: ctx.gates.get(slot) ?? 'ALL',
        gate: input.gate,
      },
    });
    await tx.update(orders).set({ updatedAt: new Date() }).where(eq(orders.id, orderId));
  });
}

export async function cancelOrder(db: Db, user: AuthUser, orderId: string, reason: string) {
  await db.transaction(async (tx) => {
    const ctx = await loadCtx(tx, orderId, true);
    const allowed =
      user.capabilities.includes('ADMIN') || (ctx.slots.get('MARKETING') ?? []).includes(user.id);
    if (!allowed) throw forbidden();
    if (ctx.order.status === 'DONE' || ctx.order.status === 'CANCELLED') {
      throw conflict('ORDER_CLOSED', 'This order is already closed.');
    }
    for (const t of ctx.tasks) {
      if (t.status === 'OPEN' || t.status === 'WAITING') {
        t.status = 'CANCELLED';
        await setHolder(tx, t, null, 'CANCELLED');
        await saveTask(tx, t);
      }
    }
    await tx
      .update(orders)
      .set({
        status: 'CANCELLED',
        cancelReason: reason,
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));
    await logEvent(tx, {
      orderId,
      type: 'CANCELLED',
      actorId: user.id,
      actingAs: user.capabilities.includes('ADMIN') ? 'ADMIN' : 'MARKETING',
      comment: reason,
    });
  });
}

/** Admin replaces a named person on an order (Q7); the change is logged. */
export async function replaceSlotPerson(
  db: Db,
  user: AuthUser,
  orderId: string,
  input: { slot: Slot; fromEmployeeId: string; toEmployeeId: string; reason: string },
) {
  if (!user.capabilities.includes('ADMIN')) throw forbidden();
  await db.transaction(async (tx) => {
    const ctx = await loadCtx(tx, orderId, true);
    if (ctx.order.status === 'DONE' || ctx.order.status === 'CANCELLED') {
      throw conflict('ORDER_CLOSED', 'This order is already closed.');
    }
    const current = ctx.slots.get(input.slot) ?? [];
    if (!current.includes(input.fromEmployeeId)) {
      throw badRequest('NOT_IN_SLOT', 'That person is not named in this slot.');
    }
    const next = new Map(ctx.slots);
    next.set(
      input.slot,
      current.map((id) => (id === input.fromEmployeeId ? input.toEmployeeId : id)),
    );
    await checkSlots(tx, next, false);
    await tx
      .update(orderSlotPeople)
      .set({ employeeId: input.toEmployeeId })
      .where(
        and(
          eq(orderSlotPeople.orderId, orderId),
          eq(orderSlotPeople.slot, input.slot),
          eq(orderSlotPeople.employeeId, input.fromEmployeeId),
        ),
      );
    await logEvent(tx, {
      orderId,
      type: 'SLOT_PERSON_REPLACED',
      actorId: user.id,
      actingAs: 'ADMIN',
      comment: input.reason,
      details: { slot: input.slot, from: input.fromEmployeeId, to: input.toEmployeeId },
    });
    // An ALL gate may now be satisfied if the leaver was the only one left to vote
    const fresh = await loadCtx(tx, orderId);
    for (const t of fresh.tasks) {
      const step = stepOf(fresh.template, t.stepKey);
      if (t.status === 'OPEN' && step.kind === 'APPROVAL_CHAIN' && t.holderSlot === input.slot) {
        await maybeFinishStage(tx, fresh, t, step, user.id);
      }
    }
    await advance(tx, fresh);
  });
}

// ---- Acting on a task ----------------------------------------------------------------

/**
 * One action by one person on one task. Runs in a single transaction that locks the order
 * row first, so two people acting at once on the same order are serialised (Q-concurrency).
 */
export async function act(
  db: Db,
  storage: StorageService,
  user: AuthUser,
  taskId: string,
  input: ActionInput,
) {
  const [found] = await db
    .select({ orderId: tasks.orderId })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (!found) throw notFound('Task');
  const { files, discard } = await prepareFiles(db, storage, user.id, found.orderId, input.uploads);
  try {
    await db.transaction(async (tx) => {
      const ctx = await loadCtx(tx, found.orderId, true);
      const task = ctx.tasks.find((t) => t.id === taskId)!;
      const allowed = await actionsFor(tx, user, ctx, task);
      if (!allowed.includes(input.action)) {
        // Someone who takes part in this step but finds it moved on (a colleague acted first,
        // or it is with the other side) gets a conflict; anyone else is simply not allowed
        if (!takesPart(user, ctx, stepOf(ctx.template, task.stepKey))) throw forbidden();
        throw conflict(
          'ALREADY_HANDLED',
          'This step has moved on since you opened it. Refresh to see where it is now.',
        );
      }
      const step = stepOf(ctx.template, task.stepKey);
      const actingAs = (task.holderTeam ?? task.holderSlot)!;
      const audience = await createAudience(tx, ctx, step, user.id, input);
      const base: Base = {
        orderId: ctx.order.id,
        taskId: task.id,
        stepKey: step.key,
        actorId: user.id,
        actingAs,
        audienceId: audience?.id ?? null,
      };
      const docsFor = (roundId: string | null) =>
        attachFiles(tx, files, {
          orderId: ctx.order.id,
          taskId: task.id,
          roundId,
          userId: user.id,
          audienceId: base.audienceId,
        });
      const allowedKinds = new Set(stepDocKinds(step));
      for (const f of files) {
        if (!allowedKinds.has(f.kind))
          throw badRequest('DOC_NOT_EXPECTED', 'That document doesn’t belong to this step.');
      }

      switch (input.action) {
        case 'COMPLETE':
          await completeTaskStep(tx, ctx, task, step, input, docsFor, base);
          break;
        case 'SUBMIT':
        case 'CONFIRM':
        case 'RETURN':
          await reviewAction(tx, ctx, task, step, input, docsFor, base);
          break;
        case 'APPROVE':
        case 'REJECT':
          await approvalAction(tx, ctx, task, step, input, docsFor, base, user.id);
          break;
        case 'LOG': {
          const at = loggedDate(input.date);
          await completeTask(tx, ctx, task, step, user.id, at);
          await logEvent(tx, {
            ...base,
            type: 'LOGGED',
            comment: input.comment,
            details: { date: input.date ?? null, title: step.title },
          });
          break;
        }
        case 'CHECKPOINT': {
          if (!input.shipmentStatus)
            throw badRequest('STATUS_REQUIRED', 'Choose the shipment status.');
          loggedDate(input.date);
          const [cp] = await tx
            .insert(shipmentCheckpoints)
            .values({
              orderId: ctx.order.id,
              status: input.shipmentStatus,
              note: input.comment,
              happenedOn: input.date ?? new Date().toISOString().slice(0, 10),
              loggedBy: user.id,
              audienceId: base.audienceId,
            })
            .returning({ id: shipmentCheckpoints.id });
          await logEvent(tx, {
            ...base,
            type: 'CHECKPOINT',
            comment: input.comment,
            details: {
              checkpointId: cp!.id,
              status: input.shipmentStatus,
              date: input.date ?? null,
            },
          });
          break;
        }
        case 'CLOSE':
          await completeTask(tx, ctx, task, step, user.id);
          await logEvent(tx, { ...base, type: 'CLOSED', comment: input.comment });
          break;
      }
      // Dashboard notices (D29): a private message for those it is shared with, and a payment
      // proof for the order's approvers and Head Approvers
      const product = ctx.products.find((p) => p.id === task.productId)?.name;
      const title = product ? `${step.title} · ${product}` : step.title;
      const notify = async (
        ids: string[],
        kind: 'PRIVATE_MESSAGE' | 'PAYMENT_PROOF',
        t: string,
      ) => {
        const to = [...new Set(ids)].filter((id) => id !== user.id);
        if (to.length === 0) return;
        await tx.insert(notices).values(
          to.map((employeeId) => ({
            orderId: ctx.order.id,
            employeeId,
            kind,
            taskId: task.id,
            title: t,
            actorId: user.id,
            comment: input.comment,
          })),
        );
      };
      if (audience) await notify(audience.notify, 'PRIVATE_MESSAGE', title);
      if (files.some((f) => f.kind === 'PAYMENT_PROOF')) {
        await notify(
          APPROVER_SLOTS.flatMap((s) => ctx.slots.get(s) ?? []),
          'PAYMENT_PROOF',
          `${DOC_KIND_LABEL.PAYMENT_PROOF} · ${step.title}`,
        );
      }
      await tx.update(orders).set({ updatedAt: new Date() }).where(eq(orders.id, ctx.order.id));
      await advance(tx, ctx);
    });
  } catch (err) {
    await discard();
    throw err;
  }
  await removeUploadObjects(storage, files);
}

/** Everyone who takes part in a step: every side or stage, and a rejection's reopened step */
function stepActors(ctx: OrderCtx, step: StepDef): Actor[] {
  switch (step.kind) {
    case 'REVIEW_LOOP':
      return [...step.submitters, step.reviewer];
    case 'APPROVAL_CHAIN':
      return [
        ...step.stages.map((s) => s.actor),
        ...(step.onReject === 'RESTART'
          ? []
          : stepActors(ctx, stepOf(ctx.template, step.onReject.reopen))),
      ];
    case 'DATA_GATE':
      return [];
    default:
      return [step.actor];
  }
}

/**
 * A private action (D29): who sees it is fixed now. The writer, the people and teams they
 * tagged, and everyone taking part in the step (so whoever gets the work back can read why).
 * Approvers, Head Approvers and Admin always see it too, checked when reading. Returns who
 * gets a dashboard notice: the tagged people, members of tagged teams, and the approvers.
 */
async function createAudience(
  tx: Tx,
  ctx: OrderCtx,
  step: StepDef,
  writerId: string,
  input: ActionInput,
) {
  if (!input.privateTo) return null;
  const tagged = input.privateTo;
  const people = new Set<string>([writerId]);
  const teams = new Set<Team>();
  for (const a of stepActors(ctx, step)) {
    if ('team' in a) teams.add(a.team);
    else for (const id of ctx.slots.get(a.slot) ?? []) people.add(id);
  }
  const [row] = await tx
    .insert(audiences)
    .values({ orderId: ctx.order.id, createdBy: writerId })
    .returning({ id: audiences.id });
  const members = [
    ...tagged.employeeIds.map((employeeId) => ({ employeeId, team: null, tagged: true })),
    ...tagged.teams.map((team) => ({ employeeId: null, team, tagged: true })),
    ...[...people]
      .filter((id) => !tagged.employeeIds.includes(id))
      .map((employeeId) => ({ employeeId, team: null, tagged: false })),
    ...[...teams]
      .filter((t) => !tagged.teams.includes(t))
      .map((team) => ({ employeeId: null, team, tagged: false })),
  ];
  await tx.insert(audienceMembers).values(members.map((m) => ({ ...m, audienceId: row!.id })));
  const inTaggedTeams = tagged.teams.length
    ? await tx
        .select({ id: teamMembers.employeeId })
        .from(teamMembers)
        .innerJoin(employees, eq(employees.id, teamMembers.employeeId))
        .where(and(inArray(teamMembers.team, tagged.teams), eq(employees.isActive, true)))
    : [];
  return {
    id: row!.id,
    notify: [
      ...tagged.employeeIds,
      ...inTaggedTeams.map((r) => r.id),
      ...APPROVER_SLOTS.flatMap((s) => ctx.slots.get(s) ?? []),
    ],
  };
}

function loggedDate(date: string | undefined) {
  try {
    return instantForLocalDate(date);
  } catch {
    throw badRequest('DATE_IN_FUTURE', 'That date is in the future.');
  }
}

function stepDocKinds(step: StepDef) {
  if (step.kind === 'TASK') return (step.docs ?? []).map((d) => d.kind);
  if (step.kind === 'REVIEW_LOOP') return step.doc ? [step.doc] : [];
  if (step.kind === 'APPROVAL_CHAIN') {
    return step.stages.some((s) => s.form === 'PAYMENT') ? (['PAYMENT_PROOF'] as const) : [];
  }
  return [];
}

type Base = {
  orderId: string;
  taskId: string;
  stepKey: string;
  actorId: string;
  actingAs: string;
  /** Set when this action is a private message (D29) */
  audienceId: string | null;
};
type DocsFor = (
  roundId: string | null,
) => Promise<Array<{ id: string; kind: string; fileName: string }>>;

async function recordPayment(
  tx: Tx,
  ctx: OrderCtx,
  task: TaskRow,
  input: ActionInput,
  kind: 'ADVANCE' | 'BALANCE',
  userId: string,
  audienceId: string | null,
) {
  if (!input.payment) throw badRequest('PAYMENT_REQUIRED', 'Enter the payment details.');
  loggedDate(input.payment.receivedOn);
  const [p] = await tx
    .insert(payments)
    .values({
      orderId: ctx.order.id,
      taskId: task.id,
      kind,
      receivedOn: input.payment.receivedOn,
      amount: input.payment.amount,
      currency: input.payment.currency,
      reference: input.payment.reference,
      verifiedBy: userId,
      comment: input.comment,
      audienceId,
    })
    .returning({ id: payments.id });
  return p!.id;
}

async function completeTaskStep(
  tx: Tx,
  ctx: OrderCtx,
  task: TaskRow,
  step: StepDef,
  input: ActionInput,
  docsFor: DocsFor,
  base: Base,
) {
  if (step.kind !== 'TASK') throw new Error('unreachable');
  // Required documents: attached now, or kept from an earlier attempt at this task
  const docs = await docsFor(null);
  const earlier = await tx
    .select({ kind: documents.kind })
    .from(documents)
    .where(eq(documents.taskId, task.id));
  for (const d of step.docs ?? []) {
    if (
      d.required &&
      !docs.some((x) => x.kind === d.kind) &&
      !earlier.some((x) => x.kind === d.kind)
    ) {
      throw badRequest(
        'DOCUMENT_REQUIRED',
        `Attach the ${d.kind === 'PI_NO_RATES' ? 'PI without rates' : d.kind === 'PI_FULL' ? 'full PI' : 'document'}.`,
        { kind: d.kind },
      );
    }
  }
  if (step.needsComponents) {
    const [listed] = await tx
      .select({ id: orderComponents.id })
      .from(orderComponents)
      .where(
        and(
          eq(orderComponents.productId, task.productId!),
          eq(orderComponents.kind, step.needsComponents),
        ),
      )
      .limit(1);
    if (!listed) {
      throw badRequest(
        'COMPONENTS_REQUIRED',
        `Add at least one ${TAG_LABEL[step.needsComponents].toLowerCase()} component for this product in the Materials tab first.`,
        { kind: step.needsComponents },
      );
    }
  }
  if (step.needsComponents && step.needsComponentDoc) {
    // Every component of that type needs its document, e.g. its PO (D29)
    const missing = await tx
      .select({ name: orderComponents.name })
      .from(orderComponents)
      .where(
        and(
          eq(orderComponents.productId, task.productId!),
          eq(orderComponents.kind, step.needsComponents),
          sql`not exists (select 1 from ${documents} d where d.component_id = ${orderComponents.id} and d.kind = ${step.needsComponentDoc})`,
        ),
      );
    if (missing.length > 0) {
      throw badRequest(
        'COMPONENT_DOC_REQUIRED',
        `Upload the ${DOC_KIND_LABEL[step.needsComponentDoc]} for ${missing.map((m) => m.name).join(', ')} first.`,
        { components: missing.map((m) => m.name) },
      );
    }
  }
  const details: Record<string, unknown> = {
    documents: docs.map((d) => ({ id: d.id, kind: d.kind, fileName: d.fileName })),
  };
  if (step.form === 'PRODUCTS' && input.orderRef) {
    await setRef(tx, ctx, input.orderRef, base.actorId, base.actingAs);
  }
  if (step.form === 'PRODUCTS') {
    const names = (input.products ?? []).map((n) => n.trim()).filter(Boolean);
    if (names.length === 0) throw badRequest('PRODUCTS_REQUIRED', 'List at least one product.');
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) {
      throw badRequest('PRODUCT_REPEATED', 'A product is listed twice.');
    }
    // Products can still change while the PI is being reworked; per-product work starts later
    const existing = ctx.products;
    const keep = existing.filter((p) =>
      names.some((n) => n.toLowerCase() === p.name.toLowerCase()),
    );
    const removed = existing.filter((p) => !keep.includes(p));
    if (removed.length > 0) {
      await tx.delete(orderProducts).where(
        inArray(
          orderProducts.id,
          removed.map((p) => p.id),
        ),
      );
    }
    const products = [];
    for (const [position, name] of names.entries()) {
      const same = keep.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (same) {
        await tx.update(orderProducts).set({ position, name }).where(eq(orderProducts.id, same.id));
        products.push({ id: same.id, name, position });
      } else {
        const [row] = await tx
          .insert(orderProducts)
          .values({ orderId: ctx.order.id, name, position })
          .returning();
        products.push({ id: row!.id, name, position });
      }
    }
    ctx.products = products;
    details.products = names;
  }
  if (step.form === 'PAYMENT') {
    details.paymentId = await recordPayment(
      tx,
      ctx,
      task,
      input,
      step.paymentKind ?? 'ADVANCE',
      base.actorId,
      base.audienceId,
    );
    details.payment = input.payment;
  }
  await completeTask(tx, ctx, task, step, base.actorId);
  await logEvent(tx, {
    ...base,
    type: 'COMPLETED',
    comment: input.comment,
    details: { ...details, title: step.title },
  });
}

async function reviewAction(
  tx: Tx,
  ctx: OrderCtx,
  task: TaskRow,
  step: StepDef,
  input: ActionInput,
  docsFor: DocsFor,
  base: Base,
) {
  if (step.kind !== 'REVIEW_LOOP') throw new Error('unreachable');
  const round = await currentRound(tx, task);
  if (input.action === 'SUBMIT') {
    const docs = await docsFor(round.id);
    const needsDoc = step.doc && step.startsWith === 'SUBMITTER';
    if (needsDoc && docs.length === 0) {
      throw badRequest('DOCUMENT_REQUIRED', 'Attach the document you are sending.');
    }
    if (!needsDoc && docs.length === 0 && !input.comment) {
      throw badRequest('COMMENT_REQUIRED', 'Add the details you are sending.');
    }
    await tx
      .update(channelRounds)
      .set({
        submittedBy: base.actorId,
        submittedAt: new Date(),
        submitComment: input.comment,
        submitAudienceId: base.audienceId,
      })
      .where(eq(channelRounds.id, round.id));
    task.side = 'REVIEWER';
    await setHolder(tx, task, actorHolder(step.reviewer), 'SUBMITTED');
    await saveTask(tx, task);
    await logEvent(tx, {
      ...base,
      type: 'SUBMITTED',
      comment: input.comment,
      details: { channel: step.channel, round: round.round, documents: docs },
    });
    return;
  }
  if (input.action === 'CONFIRM') {
    await tx
      .update(channelRounds)
      .set({
        verdict: 'CONFIRMED',
        verdictBy: base.actorId,
        verdictAt: new Date(),
        verdictComment: input.comment,
        verdictAudienceId: base.audienceId,
      })
      .where(eq(channelRounds.id, round.id));
    await completeTask(tx, ctx, task, step, base.actorId);
    await logEvent(tx, {
      ...base,
      type: 'CONFIRMED',
      comment: input.comment,
      details: { channel: step.channel, round: round.round },
    });
    return;
  }
  // RETURN: a reason is required, and with several possible submitters, who gets it back
  if (!input.comment) throw badRequest('COMMENT_REQUIRED', 'Say what needs changing.');
  const teams = step.submitters.flatMap((a) => ('team' in a ? [a.team] : []));
  let target = step.submitters[0]!;
  if (step.submitters.length > 1) {
    if (!input.toTeam || !teams.includes(input.toTeam)) {
      throw badRequest(
        'TARGET_REQUIRED',
        `Choose who gets it back: ${teams.map((t) => TEAM_LABEL[t]).join(' or ')}.`,
      );
    }
    target = { team: input.toTeam };
  }
  const docs = await docsFor(round.id);
  const returnedToTeam = 'team' in target ? target.team : null;
  await tx
    .update(channelRounds)
    .set({
      verdict: 'RETURNED',
      verdictBy: base.actorId,
      verdictAt: new Date(),
      verdictComment: input.comment,
      verdictAudienceId: base.audienceId,
      returnedToTeam,
    })
    .where(eq(channelRounds.id, round.id));
  await nextRound(tx, task, step.channel);
  task.side = 'SUBMITTER';
  await setHolder(tx, task, actorHolder(target), 'RETURNED');
  await saveTask(tx, task);
  await logEvent(tx, {
    ...base,
    type: 'RETURNED',
    comment: input.comment,
    details: {
      channel: step.channel,
      round: round.round,
      to: holderLabel(actorHolder(target)),
      documents: docs,
    },
  });
}

async function approvalAction(
  tx: Tx,
  ctx: OrderCtx,
  task: TaskRow,
  step: StepDef,
  input: ActionInput,
  docsFor: DocsFor,
  base: Base,
  userId: string,
) {
  if (step.kind !== 'APPROVAL_CHAIN') throw new Error('unreachable');
  const stage = step.stages.find((s) => s.key === task.side)!;
  if (input.action === 'REJECT' && !input.comment) {
    throw badRequest('COMMENT_REQUIRED', 'Give a reason for rejecting.');
  }
  const details: Record<string, unknown> = { stage: stage.key, run: task.run };
  if (input.action === 'APPROVE' && stage.form === 'PAYMENT') {
    details.paymentId = await recordPayment(
      tx,
      ctx,
      task,
      input,
      stage.paymentKind ?? 'BALANCE',
      userId,
      base.audienceId,
    );
    details.payment = input.payment;
  }
  details.documents = await docsFor(null);
  await tx.insert(approvalVotes).values({
    taskId: task.id,
    run: task.run,
    stage: stage.key,
    employeeId: userId,
    vote: input.action === 'APPROVE' ? 'APPROVE' : 'REJECT',
    comment: input.comment,
    audienceId: base.audienceId,
  });
  await logEvent(tx, {
    ...base,
    type: input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
    comment: input.comment,
    details,
  });

  if (input.action === 'REJECT') {
    if (step.onReject === 'RESTART') {
      // Back to the first stage, as a new run (the payment check returns to Accounts, Q45)
      task.run += 1;
      task.side = step.stages[0]!.key;
      await setHolder(tx, task, actorHolder(step.stages[0]!.actor), 'RESTARTED');
      await saveTask(tx, task);
      await logEvent(tx, {
        orderId: ctx.order.id,
        type: 'CHAIN_RESTARTED',
        taskId: task.id,
        stepKey: step.key,
        details: { run: task.run },
      });
    } else {
      // Back to the step that produced what was rejected; this chain re-runs after it (Q16)
      task.status = 'WAITING';
      await setHolder(tx, task, null, 'REJECTED');
      await saveTask(tx, task);
      const target = stepOf(ctx.template, step.onReject.reopen);
      const targetTask = taskOf(ctx, target.key, null)!;
      targetTask.status = 'WAITING';
      await openTask(tx, ctx, target, null, 'RETURNED');
    }
    return;
  }
  await maybeFinishStage(tx, ctx, task, step, userId);
}

/** After a vote: is this stage complete (ALL / ANY), and if so move on or finish the chain. */
async function maybeFinishStage(
  tx: Tx,
  ctx: OrderCtx,
  task: TaskRow,
  step: StepDef,
  userId: string,
) {
  if (step.kind !== 'APPROVAL_CHAIN') return;
  const index = step.stages.findIndex((s) => s.key === task.side);
  const stage = step.stages[index]!;
  const votes = await tx
    .select({ employeeId: approvalVotes.employeeId, vote: approvalVotes.vote })
    .from(approvalVotes)
    .where(
      and(
        eq(approvalVotes.taskId, task.id),
        eq(approvalVotes.run, task.run),
        eq(approvalVotes.stage, stage.key),
      ),
    );
  const approvers = new Set(votes.filter((v) => v.vote === 'APPROVE').map((v) => v.employeeId));
  let done: boolean;
  if ('team' in stage.actor) {
    done = approvers.size > 0;
  } else {
    const people = ctx.slots.get(stage.actor.slot) ?? [];
    const gate = ctx.gates.get(stage.actor.slot) ?? 'ALL';
    done =
      gate === 'ANY'
        ? approvers.size > 0
        : people.length > 0 && people.every((id) => approvers.has(id));
  }
  if (!done) return;
  const next = step.stages[index + 1];
  if (next) {
    task.side = next.key;
    await setHolder(tx, task, actorHolder(next.actor), 'NEXT_STAGE');
    await saveTask(tx, task);
    await logEvent(tx, {
      orderId: ctx.order.id,
      type: 'STAGE_PASSED',
      taskId: task.id,
      stepKey: step.key,
      details: { stage: stage.key, next: next.key, run: task.run },
    });
  } else {
    await completeTask(tx, ctx, task, step, userId);
    await logEvent(tx, {
      orderId: ctx.order.id,
      type: 'CHAIN_APPROVED',
      taskId: task.id,
      stepKey: step.key,
      details: { run: task.run },
    });
  }
}
