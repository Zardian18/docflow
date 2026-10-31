import {
  COMPONENT_REQUIRED_FIELDS,
  SLOT_INFO,
  SLOTS,
  stepOf,
  TEAM_LABEL,
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
  type Team,
} from '@docflow/shared';
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { AuthUser } from '../auth/sessions.js';
import type { Db } from '../db/client.js';
import {
  approvalVotes,
  audienceMembers,
  audiences,
  buyers,
  channelRounds,
  componentChanges,
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
  canSeeAudience,
  canSeeComponents,
  canSeeDoc,
  canSeeOrder,
  currentPhase,
  seesPhase,
  type AudienceMembers,
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

/**
 * What one person may see of an order's private parts (D29): private messages (by audience),
 * a phase hidden from Marketing alone, and documents by kind.
 */
export async function privacyFor(db: Db, user: AuthUser, ctx: OrderCtx) {
  const rows = await db
    .select({
      audienceId: audienceMembers.audienceId,
      employeeId: audienceMembers.employeeId,
      employeeName: employees.name,
      team: audienceMembers.team,
      tagged: audienceMembers.tagged,
    })
    .from(audienceMembers)
    .innerJoin(audiences, eq(audiences.id, audienceMembers.audienceId))
    .leftJoin(employees, eq(employees.id, audienceMembers.employeeId))
    .where(eq(audiences.orderId, ctx.order.id));
  const members = new Map<string, AudienceMembers & { labels: string[] }>();
  for (const r of rows) {
    const m = members.get(r.audienceId) ?? { employeeIds: [], teams: [], labels: [] };
    if (r.employeeId) m.employeeIds.push(r.employeeId);
    if (r.team) m.teams.push(r.team as Team);
    if (r.tagged) m.labels.push(r.team ? TEAM_LABEL[r.team as Team] : (r.employeeName ?? '—'));
    members.set(r.audienceId, m);
  }
  const sees = (audienceId: string | null) =>
    !audienceId || canSeeAudience(user, ctx, members.get(audienceId));
  /** In a private message's audience by name or team: shown even in a phase hidden from them */
  const taggedIn = (audienceId: string | null) => {
    const m = audienceId ? members.get(audienceId) : undefined;
    return !!m && (m.employeeIds.includes(user.id) || m.teams.some((t) => user.teams.includes(t)));
  };
  /** Who a private message is shared with, as labels; null when not private */
  const sharedWith = (audienceId: string | null) =>
    audienceId ? (members.get(audienceId)?.labels ?? []) : null;
  const phaseOfTask = (taskId: string | null) => {
    const task = ctx.tasks.find((t) => t.id === taskId);
    return task ? stepOf(ctx.template, task.stepKey).phase : null;
  };
  const seesTask = (taskId: string | null) => {
    const phase = phaseOfTask(taskId);
    return phase === null || seesPhase(user, ctx, phase);
  };
  const privatePhase = ctx.template.phasePrivacy?.phase;
  const hiddenPhases =
    privatePhase && !seesPhase(user, ctx, privatePhase) ? [privatePhase] : ([] as number[]);
  const seesDoc = (d: DocRow) =>
    canSeeDoc(user, ctx, d.kind) &&
    sees(d.audienceId) &&
    (taggedIn(d.audienceId) ||
      (d.componentId && privatePhase ? seesPhase(user, ctx, privatePhase) : seesTask(d.taskId)));
  /** A private-or-not part of a step: its phase visible and its audience, or tagged in it */
  const seesPart = (taskId: string | null, audienceId: string | null) =>
    taggedIn(audienceId) || (seesTask(taskId) && sees(audienceId));
  return { sees, sharedWith, seesTask, seesDoc, seesPart, taggedIn, hiddenPhases };
}

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
    // A phase hidden from this person shows as one line, not its steps (D29)
    if (!seesPhase(user, ctx, step.phase)) continue;
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
  const privacy = await privacyFor(db, user, ctx);
  const visibleDocs = docs.filter(privacy.seesDoc);
  const tasksView = await taskViews(db, user, ctx, visibleDocs);
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
    documents: visibleDocs.map((d) => ({
      id: d.id,
      kind: d.kind,
      fileName: d.fileName,
      fileMime: d.fileMime,
      fileSize: d.fileSize,
      uploadedByName: name(d.uploadedBy) ?? '—',
      uploadedAt: d.uploadedAt.toISOString(),
      taskId: d.taskId,
      roundId: d.roundId,
      componentId: d.componentId,
      privateTo: privacy.sharedWith(d.audienceId),
    })),
    rounds: rounds.flatMap((r) => {
      // A private part someone isn't in is left out entirely; one they're tagged in shows even
      // in a phase otherwise hidden from them (D29)
      const submit = privacy.seesPart(r.taskId, r.submitAudienceId);
      const verdict = privacy.seesPart(r.taskId, r.verdictAudienceId);
      const shownParts = (submit && r.submittedAt) || (verdict && r.verdict);
      if (!shownParts && (r.submittedAt || r.verdict || !privacy.seesTask(r.taskId))) return [];
      return {
        id: r.id,
        taskId: r.taskId,
        channel: r.channel,
        round: r.round,
        productName:
          ctx.products.find((p) => p.id === ctx.tasks.find((t) => t.id === r.taskId)?.productId)
            ?.name ?? null,
        submittedByName: submit ? name(r.submittedBy) : null,
        submittedAt: submit ? iso(r.submittedAt) : null,
        submitComment: submit ? r.submitComment : null,
        verdict: verdict ? r.verdict : null,
        verdictByName: verdict ? name(r.verdictBy) : null,
        verdictAt: verdict ? iso(r.verdictAt) : null,
        verdictComment: verdict ? r.verdictComment : null,
        returnedToTeam: verdict ? r.returnedToTeam : null,
        submitPrivateTo: submit ? privacy.sharedWith(r.submitAudienceId) : null,
        verdictPrivateTo: verdict ? privacy.sharedWith(r.verdictAudienceId) : null,
      };
    }),
    votes: votes
      .filter((v) => privacy.seesPart(v.taskId, v.audienceId))
      .map((v) => ({
        taskId: v.taskId,
        run: v.run,
        stage: v.stage,
        employeeName: name(v.employeeId) ?? '—',
        vote: v.vote,
        comment: v.comment,
        privateTo: privacy.sharedWith(v.audienceId),
        at: v.createdAt.toISOString(),
      })),
    payments: seePayments
      ? pays
          .filter((p) => privacy.sees(p.audienceId))
          .map((p) => ({
            id: p.id,
            kind: p.kind,
            receivedOn: p.receivedOn,
            amount: p.amount,
            currency: p.currency,
            reference: p.reference,
            verifiedByName: name(p.verifiedBy) ?? '—',
            verifiedAt: p.verifiedAt.toISOString(),
            comment: p.comment,
            privateTo: privacy.sharedWith(p.audienceId),
          }))
      : [],
    checkpoints: checkpoints
      .filter((c) => privacy.sees(c.audienceId))
      .map((c) => ({
        id: c.id,
        status: c.status as ShipmentStatus,
        note: c.note,
        happenedOn: c.happenedOn,
        loggedByName: name(c.loggedBy) ?? '—',
        loggedAt: c.loggedAt.toISOString(),
        privateTo: privacy.sharedWith(c.audienceId),
      })),
    canEditComponents: canEditComponents(user, ctx),
    canCancel:
      (o.status === 'ACTIVE' || o.status === 'NO_ACTION_NEEDED') &&
      (user.capabilities.includes('ADMIN') || (ctx.slots.get('MARKETING') ?? []).includes(user.id)),
    canSeeComponents: canSeeComponents(user, ctx),
    canRename: canRename(user, ctx),
    editableSlots: canEditChain(user, ctx) ? editableSlots(ctx) : [],
    hiddenPhases: privacy.hiddenPhases,
    poAccess: !canSeeDoc(user, ctx, 'PO')
      ? 'NONE'
      : canEditComponents(user, ctx)
        ? 'UPLOAD'
        : 'VIEW',
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
      audienceId: orderEvents.audienceId,
      details: orderEvents.details,
      at: orderEvents.createdAt,
    })
    .from(orderEvents)
    .leftJoin(employees, eq(employees.id, orderEvents.actorId))
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(asc(orderEvents.createdAt));
  const seePayments = canSeeDoc(user, ctx, 'PI_FULL') || canSeeDoc(user, ctx, 'PAYMENT_PROOF');
  const privacy = await privacyFor(db, user, ctx);
  const privatePhase = ctx.template.phasePrivacy;
  const shown = (r: (typeof rows)[number]) => {
    if (!privacy.sees(r.audienceId)) return false;
    if (privacy.taggedIn(r.audienceId)) return true;
    if (r.type.startsWith('COMPONENT_')) {
      return !privatePhase || !privacy.hiddenPhases.includes(privatePhase.phase);
    }
    if (!r.stepKey) return true;
    const phase = stepOf(ctx.template, r.stepKey).phase;
    if (!privacy.hiddenPhases.includes(phase)) return true;
    // Marketing hears of the hidden phase only when it finishes (D29)
    return r.type === 'GATE_PASSED' && !!privatePhase?.revealSteps.includes(r.stepKey);
  };
  return rows.filter(shown).map(({ audienceId, ...r }) => {
    const details = { ...(r.details as Record<string, unknown>) };
    if (Array.isArray(details.documents)) {
      details.documents = (details.documents as Array<{ kind: DocKind }>).filter((d) =>
        canSeeDoc(user, ctx, d.kind),
      );
    }
    if (!seePayments) delete details.payment;
    return { ...r, privateTo: privacy.sharedWith(audienceId), details, at: r.at.toISOString() };
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
  // The latest reason given for a change to each row, shown in the table (D28)
  const reasons = await db
    .selectDistinctOn([componentChanges.componentId], {
      componentId: componentChanges.componentId,
      text: componentChanges.comment,
      byName: employees.name,
      at: componentChanges.createdAt,
    })
    .from(componentChanges)
    .innerJoin(employees, eq(employees.id, componentChanges.actorId))
    .where(and(eq(componentChanges.orderId, orderId), isNotNull(componentChanges.comment)))
    .orderBy(componentChanges.componentId, desc(componentChanges.createdAt));
  // Each component's latest PO, for those who may open it (D29)
  const privacy = await privacyFor(db, user, ctx);
  const pos = await db
    .select()
    .from(documents)
    .where(and(eq(documents.orderId, orderId), eq(documents.kind, 'PO')))
    .orderBy(desc(documents.uploadedAt));
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
          po: (() => {
            const d = pos.find((x) => x.componentId === r.id);
            return d && privacy.seesDoc(d)
              ? { id: d.id, kind: d.kind, fileName: d.fileName, fileMime: d.fileMime }
              : null;
          })(),
          hasPo: pos.some((x) => x.componentId === r.id),
          note: (() => {
            const n = reasons.find((x) => x.componentId === r.id);
            return n ? { text: n.text!, byName: n.byName, at: n.at.toISOString() } : null;
          })(),
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
