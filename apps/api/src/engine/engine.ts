import {
  CURRENT_TEMPLATE,
  findTemplate,
  SLOT_INFO,
  SLOTS,
  slotProblems,
  stepOf,
  TEAM_LABEL,
  type Actor,
  type Gate,
  OrderCreate,
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
  buyers,
  channelRounds,
  companies,
  companySlotGates,
  companySlotPeople,
  documents,
  employeeCapabilities,
  employees,
  holderIntervals,
  orderComponents,
  orderEvents,
  orderProducts,
  orders,
  orderSlotGates,
  orderSlotPeople,
  payments,
  shipmentCheckpoints,
  tasks,
} from '../db/schema.js';
import { AppError, conflict, forbidden, notFound } from '../errors.js';
import type { StorageService } from '../storage/storage.js';
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
  // ALL_COMPONENTS_DELIVERED: every product has components, and every one has a Deliver Date
  const rows = await tx
    .select({ productId: orderComponents.productId, deliverDate: orderComponents.deliverDate })
    .from(orderComponents)
    .where(eq(orderComponents.orderId, ctx.order.id));
  return (
    ctx.products.length > 0 &&
    ctx.products.every((p) => rows.some((r) => r.productId === p.id)) &&
    rows.every((r) => r.deliverDate !== null)
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

/** Checks named people: active, holding the slot's capability, and passing Q6. */
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

/** Marketing creates an order (Q2); named people come from the company, changeable here (Q61). */
export async function createOrder(db: Db, user: AuthUser, input: CreateInput) {
  if (!user.capabilities.includes('MARKETING')) throw forbidden();
  return db.transaction(async (tx) => {
    const [buyer] = await tx.select().from(buyers).where(eq(buyers.id, input.buyerId));
    if (!buyer?.isActive) throw badRequest('BUYER_UNAVAILABLE', 'Choose an active buyer.');
    const [company] = await tx.select().from(companies).where(eq(companies.id, input.companyId));
    if (!company?.isActive) throw badRequest('COMPANY_UNAVAILABLE', 'Choose an active company.');

    const configured = await tx
      .select()
      .from(companySlotPeople)
      .where(eq(companySlotPeople.companyId, company.id))
      .orderBy(asc(companySlotPeople.ordinal));
    const slots = new Map<Slot, string[]>();
    for (const r of configured) slots.set(r.slot, [...(slots.get(r.slot) ?? []), r.employeeId]);
    for (const s of input.slots) slots.set(s.slot, s.employeeIds);
    // Whoever creates the order is its Marketing person unless the company names someone
    if ((slots.get('MARKETING') ?? []).length === 0) slots.set('MARKETING', [user.id]);
    await checkSlots(tx, slots, true);

    const template = CURRENT_TEMPLATE;
    const [order] = await tx
      .insert(orders)
      .values({
        buyerId: buyer.id,
        companyId: company.id,
        templateKey: template.key,
        templateVersion: template.version,
        notes: input.notes,
        createdBy: user.id,
      })
      .returning();
    await tx
      .insert(orderSlotPeople)
      .values(
        [...slots].flatMap(([slot, ids]) =>
          ids.map((employeeId, ordinal) => ({ orderId: order!.id, slot, employeeId, ordinal })),
        ),
      );
    const gates = await tx
      .select()
      .from(companySlotGates)
      .where(eq(companySlotGates.companyId, company.id));
    const gateRows = SLOTS.filter((s) => SLOT_INFO[s].hasGate).map((slot) => ({
      orderId: order!.id,
      slot,
      gate: gates.find((g) => g.slot === slot)?.gate ?? ('ALL' as const),
    }));
    await tx.insert(orderSlotGates).values(gateRows);
    await logEvent(tx, {
      orderId: order!.id,
      type: 'ORDER_CREATED',
      actorId: user.id,
      actingAs: 'MARKETING',
      comment: input.notes,
      details: {
        buyer: buyer.name,
        company: company.name,
        template: `${template.key} v${template.version}`,
        slots: Object.fromEntries(slots),
        gates: Object.fromEntries(gateRows.map((g) => [g.slot, g.gate])),
      },
    });
    const ctx = await loadCtx(tx, order!.id, true);
    await advance(tx, ctx);
    return order!.id;
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
      const base = {
        orderId: ctx.order.id,
        taskId: task.id,
        stepKey: step.key,
        actorId: user.id,
        actingAs,
      };
      const docsFor = (roundId: string | null) =>
        attachFiles(tx, files, {
          orderId: ctx.order.id,
          taskId: task.id,
          roundId,
          userId: user.id,
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
      await tx.update(orders).set({ updatedAt: new Date() }).where(eq(orders.id, ctx.order.id));
      await advance(tx, ctx);
    });
  } catch (err) {
    await discard();
    throw err;
  }
  await removeUploadObjects(storage, files);
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

type Base = { orderId: string; taskId: string; stepKey: string; actorId: string; actingAs: string };
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
  const details: Record<string, unknown> = {
    documents: docs.map((d) => ({ id: d.id, kind: d.kind, fileName: d.fileName })),
  };
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
      .set({ submittedBy: base.actorId, submittedAt: new Date(), submitComment: input.comment })
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
