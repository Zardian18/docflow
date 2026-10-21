import {
  COMPONENT_REQUIRED_FIELDS,
  SLOT_INFO,
  SLOTS,
  stepOf,
  type Component,
  type ComponentStatus,
  type ComponentTables,
  type DocKind,
  type OrderDetail,
  type OrderEvent,
  type ReviewDoc,
  type ShipmentStatus,
  type StepDef,
  type TaskView,
} from '@docflow/shared';
import { asc, eq, inArray } from 'drizzle-orm';
import type { AuthUser } from '../auth/sessions.js';
import type { Db } from '../db/client.js';
import {
  approvalVotes,
  buyers,
  channelRounds,
  documents,
  employees,
  holderIntervals,
  orderComponents,
  orderEvents,
  orderProducts,
  payments,
  shipmentCheckpoints,
} from '../db/schema.js';
import { notFound } from '../errors.js';
import {
  canEditComponents,
  canSeeComponents,
  canSeeDoc,
  canSeeOrder,
  currentPhase,
} from './access.js';
import { dayCount, heldClock, localDay, sinceClock } from './clock.js';
import {
  actionsFor,
  canEditChain,
  canRename,
  editableSlots,
  holderLabel,
  loadCtx,
  type OrderCtx,
} from './engine.js';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function namesOf(db: Db, ids: Array<string | null>) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: employees.id, name: employees.name })
    .from(employees)
    .where(inArray(employees.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Loads an order the person may see, or 404 (never reveal an order exists) */
export async function visibleCtx(db: Db, user: AuthUser, orderId: string) {
  const ctx = await loadCtx(db, orderId);
  if (!canSeeOrder(user, ctx)) throw notFound('Order');
  return ctx;
}

type DocRow = typeof documents.$inferSelect;

/** The document kinds a step is about: what it attaches, and what its approval chain approves */
function reviewKinds(step: StepDef): DocKind[] {
  switch (step.kind) {
    case 'TASK':
      return (step.docs ?? []).map((d) => d.kind);
    case 'REVIEW_LOOP':
      return step.doc ? [step.doc] : [];
    case 'APPROVAL_CHAIN':
      return [
        ...(step.docToApprove ?? []),
        ...(step.stages.some((s) => s.form === 'PAYMENT') ? (['PAYMENT_PROOF'] as const) : []),
      ].filter((k, i, all) => all.indexOf(k) === i);
    default:
      return [];
  }
}

/**
 * The latest version of each document a task is about, that this person may open (D27):
 * what was attached on the task itself, or for an approval chain, the latest on the order.
 */
export function reviewDocsFor(
  user: AuthUser,
  ctx: OrderCtx,
  task: { id: string; stepKey: string },
  docs: DocRow[],
): ReviewDoc[] {
  const step = stepOf(ctx.template, task.stepKey);
  const latest = (rows: DocRow[]) =>
    rows.reduce<DocRow | undefined>(
      (a, b) => (!a || b.uploadedAt >= a.uploadedAt ? b : a),
      undefined,
    );
  return reviewKinds(step).flatMap((kind) => {
    if (!canSeeDoc(user, ctx, kind)) return [];
    const ofKind = docs.filter((d) => d.kind === kind);
    const doc =
      latest(ofKind.filter((d) => d.taskId === task.id)) ??
      (step.kind === 'APPROVAL_CHAIN' ? latest(ofKind) : undefined);
    return doc
      ? [{ id: doc.id, kind: doc.kind, fileName: doc.fileName, fileMime: doc.fileMime }]
      : [];
  });
}

/** Task views with who holds each, how long, and what this person can do */
export async function taskViews(
  db: Db,
  user: AuthUser,
  ctx: OrderCtx,
  docs: DocRow[],
): Promise<TaskView[]> {
  const intervals = await db
    .select()
    .from(holderIntervals)
    .where(eq(holderIntervals.orderId, ctx.order.id))
    .orderBy(asc(holderIntervals.startedAt));
  const names = await namesOf(db, [
    ...ctx.tasks.map((t) => t.doneBy),
    ...[...ctx.slots.values()].flat(),
  ]);
  const order = new Map(ctx.template.steps.map((s, i) => [s.key, i]));
  const sorted = [...ctx.tasks].sort(
    (a, b) =>
      order.get(a.stepKey)! - order.get(b.stepKey)! ||
      (ctx.products.find((p) => p.id === a.productId)?.position ?? 0) -
        (ctx.products.find((p) => p.id === b.productId)?.position ?? 0),
  );
  const views: TaskView[] = [];
  for (const t of sorted) {
    const step = stepOf(ctx.template, t.stepKey);
    const mine = intervals.filter((i) => i.taskId === t.id);
    const holder = t.holderTeam || t.holderSlot ? { team: t.holderTeam, slot: t.holderSlot } : null;
    const current = mine.find((i) => i.endedAt === null);
    const sameHolder = holder
      ? mine.filter((i) => i.holderTeam === holder.team && i.holderSlot === holder.slot)
      : [];
    views.push({
      id: t.id,
      stepKey: t.stepKey,
      title: step.title,
      kind: step.kind,
      phase: step.phase,
      productId: t.productId,
      productName: ctx.products.find((p) => p.id === t.productId)?.name ?? null,
      status: t.status,
      tag: t.tag,
      side: t.side,
      run: t.run,
      holder: holder
        ? {
            ...holder,
            label: holderLabel(holder),
            people: holder.slot
              ? (ctx.slots.get(holder.slot) ?? []).map((id) => names.get(id) ?? '—')
              : [],
          }
        : null,
      openedAt: iso(t.openedAt),
      waitingSince: iso(current?.startedAt ?? null),
      doneAt: iso(t.doneAt),
      doneByName: t.doneBy ? (names.get(t.doneBy) ?? null) : null,
      held: holder ? heldClock(sameHolder) : null,
      actions: await actionsFor(db, user, ctx, t),
      reviewDocs: reviewDocsFor(user, ctx, t, docs),
    });
  }
  return views;
}

export async function orderDetail(db: Db, user: AuthUser, orderId: string): Promise<OrderDetail> {
  const ctx = await visibleCtx(db, user, orderId);
  const o = ctx.order;
  const [[buyer], docs, rounds, votes, pays, checkpoints] = await Promise.all([
    db.select({ name: buyers.name }).from(buyers).where(eq(buyers.id, o.buyerId)),
    db
      .select()
      .from(documents)
      .where(eq(documents.orderId, o.id))
      .orderBy(asc(documents.uploadedAt)),
    db
      .select()
      .from(channelRounds)
      .where(eq(channelRounds.orderId, o.id))
      .orderBy(asc(channelRounds.round)),
    db
      .select()
      .from(approvalVotes)
      .where(
        inArray(
          approvalVotes.taskId,
          ctx.tasks.map((t) => t.id).concat('00000000-0000-0000-0000-000000000000'),
        ),
      )
      .orderBy(asc(approvalVotes.createdAt)),
    db.select().from(payments).where(eq(payments.orderId, o.id)).orderBy(asc(payments.verifiedAt)),
    db
      .select()
      .from(shipmentCheckpoints)
      .where(eq(shipmentCheckpoints.orderId, o.id))
      .orderBy(asc(shipmentCheckpoints.loggedAt)),
  ]);
  const names = await namesOf(db, [
    o.createdBy,
    ...docs.map((d) => d.uploadedBy),
    ...rounds.flatMap((r) => [r.submittedBy, r.verdictBy]),
    ...votes.map((v) => v.employeeId),
    ...pays.map((p) => p.verifiedBy),
    ...checkpoints.map((c) => c.loggedBy),
    ...[...ctx.slots.values()].flat(),
  ]);
  const name = (id: string | null) => (id ? (names.get(id) ?? '—') : null);
  const tasksView = await taskViews(db, user, ctx, docs);
  // Payments carry amounts, so the same people who may see the full PI see them
  const seePayments = canSeeDoc(user, ctx, 'PI_FULL') || canSeeDoc(user, ctx, 'PAYMENT_PROOF');
  return {
    id: o.id,
    number: o.number,
    ref: o.ref,
    buyerName: buyer!.name,
    status: o.status,
    phase: currentPhase(ctx),
    current: tasksView
      .filter((t) => t.status === 'OPEN')
      .map((t) => (t.productName ? `${t.title} · ${t.productName}` : t.title)),
    trackerA: sinceClock(o.productionStartedAt, o.closedAt ?? undefined),
    trackerB: sinceClock(o.chainStartedAt, o.closedAt ?? undefined),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    notes: o.notes,
    createdByName: name(o.createdBy) ?? '—',
    templateKey: o.templateKey,
    templateVersion: o.templateVersion,
    closedAt: iso(o.closedAt),
    cancelReason: o.cancelReason,
    slots: SLOTS.map((slot) => ({
      slot,
      people: (ctx.slots.get(slot) ?? []).map((id) => ({ id, name: name(id) ?? '—' })),
      gate: SLOT_INFO[slot].hasGate ? (ctx.gates.get(slot) ?? 'ALL') : null,
    })),
    products: ctx.products,
    tasks: tasksView,
    documents: docs
      .filter((d) => canSeeDoc(user, ctx, d.kind))
      .map((d) => ({
        id: d.id,
        kind: d.kind,
        fileName: d.fileName,
        fileMime: d.fileMime,
        fileSize: d.fileSize,
        uploadedByName: name(d.uploadedBy) ?? '—',
        uploadedAt: d.uploadedAt.toISOString(),
        taskId: d.taskId,
        roundId: d.roundId,
      })),
    rounds: rounds.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      channel: r.channel,
      round: r.round,
      productName:
        ctx.products.find((p) => p.id === ctx.tasks.find((t) => t.id === r.taskId)?.productId)
          ?.name ?? null,
      submittedByName: name(r.submittedBy),
      submittedAt: iso(r.submittedAt),
      submitComment: r.submitComment,
      verdict: r.verdict,
      verdictByName: name(r.verdictBy),
      verdictAt: iso(r.verdictAt),
      verdictComment: r.verdictComment,
      returnedToTeam: r.returnedToTeam,
    })),
    votes: votes.map((v) => ({
      taskId: v.taskId,
      run: v.run,
      stage: v.stage,
      employeeName: name(v.employeeId) ?? '—',
      vote: v.vote,
      comment: v.comment,
      at: v.createdAt.toISOString(),
    })),
    payments: seePayments
      ? pays.map((p) => ({
          id: p.id,
          kind: p.kind,
          receivedOn: p.receivedOn,
          amount: p.amount,
          currency: p.currency,
          reference: p.reference,
          verifiedByName: name(p.verifiedBy) ?? '—',
          verifiedAt: p.verifiedAt.toISOString(),
          comment: p.comment,
        }))
      : [],
    checkpoints: checkpoints.map((c) => ({
      id: c.id,
      status: c.status as ShipmentStatus,
      note: c.note,
      happenedOn: c.happenedOn,
      loggedByName: name(c.loggedBy) ?? '—',
      loggedAt: c.loggedAt.toISOString(),
    })),
    canEditComponents: canEditComponents(user, ctx),
    canCancel:
      (o.status === 'ACTIVE' || o.status === 'NO_ACTION_NEEDED') &&
      (user.capabilities.includes('ADMIN') || (ctx.slots.get('MARKETING') ?? []).includes(user.id)),
    canSeeComponents: canSeeComponents(user, ctx),
    canRename: canRename(user, ctx),
    editableSlots: canEditChain(user, ctx) ? editableSlots(ctx) : [],
  };
}

/** The order's full history for the live chain view; hides documents the person can't open */
export async function orderTimeline(
  db: Db,
  user: AuthUser,
  orderId: string,
): Promise<OrderEvent[]> {
  const ctx = await visibleCtx(db, user, orderId);
  const rows = await db
    .select({
      id: orderEvents.id,
      type: orderEvents.type,
      stepKey: orderEvents.stepKey,
      taskId: orderEvents.taskId,
      actorName: employees.name,
      actingAs: orderEvents.actingAs,
      comment: orderEvents.comment,
      details: orderEvents.details,
      at: orderEvents.createdAt,
    })
    .from(orderEvents)
    .leftJoin(employees, eq(employees.id, orderEvents.actorId))
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(asc(orderEvents.createdAt));
  const seePayments = canSeeDoc(user, ctx, 'PI_FULL') || canSeeDoc(user, ctx, 'PAYMENT_PROOF');
  return rows.map((r) => {
    const details = { ...(r.details as Record<string, unknown>) };
    if (Array.isArray(details.documents)) {
      details.documents = (details.documents as Array<{ kind: DocKind }>).filter((d) =>
        canSeeDoc(user, ctx, d.kind),
      );
    }
    if (!seePayments) delete details.payment;
    return { ...r, details, at: r.at.toISOString() };
  });
}

export async function componentTables(
  db: Db,
  user: AuthUser,
  orderId: string,
): Promise<ComponentTables> {
  const ctx = await visibleCtx(db, user, orderId);
  if (!canSeeComponents(user, ctx)) throw notFound('Component tables');
  const rows = await db
    .select()
    .from(orderComponents)
    .where(eq(orderComponents.orderId, orderId))
    .orderBy(asc(orderComponents.srNo));
  const products = await db
    .select()
    .from(orderProducts)
    .where(eq(orderProducts.orderId, orderId))
    .orderBy(asc(orderProducts.position));
  // Ordering delay counts from the day production started, in India time (D27)
  const productionDay = ctx.order.productionStartedAt
    ? localDay(ctx.order.productionStartedAt)
    : null;
  const statusOf = (r: (typeof rows)[number]): ComponentStatus =>
    r.deliverDate
      ? 'DELIVERED'
      : r.dispatchDate
        ? 'DISPATCHED'
        : r.poDate
          ? 'ORDERED'
          : 'NOT_ORDERED';
  return {
    products: products.map((p) => {
      const components: Component[] = rows
        .filter((r) => r.productId === p.id)
        .map((r) => ({
          id: r.id,
          productId: r.productId,
          srNo: r.srNo,
          name: r.name,
          kind: r.kind,
          poQuantity: r.poQuantity,
          orderQuantity: r.orderQuantity,
          poDate: r.poDate,
          dispatchDate: r.dispatchDate,
          deliverDate: r.deliverDate,
          lrDetails: r.lrDetails,
          challanNo: r.challanNo,
          tridentRemark: r.tridentRemark,
          tnsRemark: r.tnsRemark,
          status: statusOf(r),
          orderingDays: dayCount(productionDay, r.poDate),
          deliveryDays: dayCount(r.poDate, r.deliverDate),
          missing: COMPONENT_REQUIRED_FIELDS.filter((f) => r[f] === null),
          delivered: r.deliverDate !== null,
          updatedAt: r.updatedAt.toISOString(),
        }));
      return {
        id: p.id,
        name: p.name,
        position: p.position,
        components,
        delivered: components.filter((c) => c.delivered).length,
        total: components.length,
      };
    }),
    editable: canEditComponents(user, ctx),
    trackerA: sinceClock(ctx.order.productionStartedAt, ctx.order.closedAt ?? undefined),
    trackerB: sinceClock(ctx.order.chainStartedAt, ctx.order.closedAt ?? undefined),
  };
}
