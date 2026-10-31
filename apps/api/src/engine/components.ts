import { COMPONENT_FIELD_LABEL, ComponentInput, type ComponentField } from '@docflow/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { AuthUser } from '../auth/sessions.js';
import type { Db, Tx } from '../db/client.js';
import type { StorageService } from '../storage/storage.js';
import { componentChanges, orderComponents, orderProducts } from '../db/schema.js';
import { AppError, forbidden, notFound } from '../errors.js';
import { canEditComponents, canSeeOrder } from './access.js';
import { localDay } from './clock.js';
import { advance, loadCtx, logEvent } from './engine.js';
import { attachFiles, prepareFiles, removeUploadObjects } from './files.js';

type Input = z.output<typeof ComponentInput>;

const EDITABLE: Exclude<ComponentField, never>[] = [
  'name',
  'kind',
  'poQuantity',
  'orderQuantity',
  'poDate',
  'dispatchDate',
  'deliverDate',
  'lrDetails',
  'challanNo',
  'tridentRemark',
  'tnsRemark',
];

/** Locks the order and checks that this person may edit its component tables (Materials, C2) */
async function editable(tx: Tx, user: AuthUser, orderId: string) {
  const ctx = await loadCtx(tx, orderId, true);
  if (!canSeeOrder(user, ctx)) throw notFound('Order');
  if (!canEditComponents(user, ctx)) throw forbidden();
  return ctx;
}

function checkDates(input: Partial<Input>) {
  const today = localDay(new Date());
  for (const field of ['poDate', 'dispatchDate', 'deliverDate'] as const) {
    const value = input[field];
    if (value && value > today) {
      throw new AppError(
        400,
        'DATE_IN_FUTURE',
        `${COMPONENT_FIELD_LABEL[field]} is in the future.`,
      );
    }
  }
}

async function recordChanges(
  tx: Tx,
  user: AuthUser,
  row: { id: string; orderId: string; productId: string },
  changes: Array<{ field: string; oldValue: string | null; newValue: string | null }>,
  comment: string | null,
) {
  if (changes.length === 0) return;
  await tx.insert(componentChanges).values(
    changes.map((c) => ({
      componentId: row.id,
      orderId: row.orderId,
      productId: row.productId,
      actorId: user.id,
      field: c.field,
      oldValue: c.oldValue,
      newValue: c.newValue,
      comment,
    })),
  );
}

export async function addComponent(
  db: Db,
  user: AuthUser,
  orderId: string,
  productId: string,
  input: Input,
) {
  checkDates(input);
  return db.transaction(async (tx) => {
    const ctx = await editable(tx, user, orderId);
    const [product] = await tx
      .select({ id: orderProducts.id, name: orderProducts.name })
      .from(orderProducts)
      .where(and(eq(orderProducts.id, productId), eq(orderProducts.orderId, orderId)));
    if (!product) throw notFound('Product');
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`coalesce(max(${orderComponents.srNo}), 0)::int` })
      .from(orderComponents)
      .where(eq(orderComponents.productId, productId));
    const values = Object.fromEntries(EDITABLE.map((f) => [f, input[f] ?? null]));
    const [row] = await tx
      .insert(orderComponents)
      .values({ orderId, productId, srNo: n + 1, ...values, name: input.name, kind: input.kind })
      .returning();
    await recordChanges(
      tx,
      user,
      row!,
      EDITABLE.filter((f) => values[f] !== null).map((f) => ({
        field: f,
        oldValue: null,
        newValue: String(values[f]),
      })),
      input.comment,
    );
    await logEvent(tx, {
      orderId,
      type: 'COMPONENT_ADDED',
      actorId: user.id,
      actingAs: 'MATERIALS',
      comment: input.comment,
      details: { product: product.name, component: input.name, kind: input.kind },
    });
    await advance(tx, ctx);
    return row!.id;
  });
}

export async function updateComponent(db: Db, user: AuthUser, componentId: string, input: Input) {
  checkDates(input);
  const [existing] = await db
    .select()
    .from(orderComponents)
    .where(eq(orderComponents.id, componentId));
  if (!existing) throw notFound('Component');
  await db.transaction(async (tx) => {
    const ctx = await editable(tx, user, existing.orderId);
    const [row] = await tx
      .select()
      .from(orderComponents)
      .where(eq(orderComponents.id, componentId));
    if (!row) throw notFound('Component');
    const changes = EDITABLE.flatMap((f) => {
      if (input[f] === undefined) return [];
      const before = row[f] === null ? null : String(row[f]);
      const after = input[f] === null ? null : String(input[f]);
      return before === after ? [] : [{ field: f, oldValue: before, newValue: after }];
    });
    if (changes.length === 0) {
      // Only a note ("Why") and nothing else changed: keep it, so it shows in the Notes column
      // and the row's history (D28). Saving with neither is a no-op.
      if (!input.comment) return;
      await tx
        .update(orderComponents)
        .set({ updatedAt: new Date() })
        .where(eq(orderComponents.id, componentId));
      await recordChanges(
        tx,
        user,
        row,
        [{ field: 'note', oldValue: null, newValue: input.comment }],
        input.comment,
      );
      await logEvent(tx, {
        orderId: row.orderId,
        type: 'COMPONENT_NOTE',
        actorId: user.id,
        actingAs: 'MATERIALS',
        comment: input.comment,
        details: { component: row.name },
      });
      return;
    }
    await tx
      .update(orderComponents)
      .set({
        ...Object.fromEntries(
          changes.map((c) => [c.field, input[c.field as ComponentField] ?? null]),
        ),
        updatedAt: new Date(),
      })
      .where(eq(orderComponents.id, componentId));
    await recordChanges(tx, user, row, changes, input.comment);
    await logEvent(tx, {
      orderId: row.orderId,
      type: 'COMPONENT_UPDATED',
      actorId: user.id,
      actingAs: 'MATERIALS',
      comment: input.comment,
      details: { component: row.name, fields: changes.map((c) => c.field) },
    });
    await advance(tx, ctx);
  });
}

export async function deleteComponent(
  db: Db,
  user: AuthUser,
  componentId: string,
  comment: string | null,
) {
  const [existing] = await db
    .select()
    .from(orderComponents)
    .where(eq(orderComponents.id, componentId));
  if (!existing) throw notFound('Component');
  await db.transaction(async (tx) => {
    const ctx = await editable(tx, user, existing.orderId);
    await tx.delete(orderComponents).where(eq(orderComponents.id, componentId));
    await recordChanges(
      tx,
      user,
      existing,
      [{ field: 'deleted', oldValue: existing.name, newValue: null }],
      comment,
    );
    await logEvent(tx, {
      orderId: existing.orderId,
      type: 'COMPONENT_DELETED',
      actorId: user.id,
      actingAs: 'MATERIALS',
      comment,
      details: { component: existing.name },
    });
    await advance(tx, ctx);
  });
}

/**
 * Materials attaches a component's purchase order (D29). A new one replaces the shown one; the
 * earlier ones stay in the order's documents. Only Materials, approvers, Head Approvers and Admin
 * open POs (template.docAccess, docsByAccessOnly).
 */
export async function uploadComponentPo(
  db: Db,
  storage: StorageService,
  user: AuthUser,
  componentId: string,
  uploadId: string,
) {
  const [existing] = await db
    .select()
    .from(orderComponents)
    .where(eq(orderComponents.id, componentId));
  if (!existing) throw notFound('Component');
  // Who may, before touching the upload (checked again under the lock)
  const pre = await loadCtx(db, existing.orderId);
  if (!canSeeOrder(user, pre)) throw notFound('Order');
  if (!canEditComponents(user, pre)) throw forbidden();
  const { files, discard } = await prepareFiles(db, storage, user.id, existing.orderId, [
    { uploadId, kind: 'PO' },
  ]);
  try {
    await db.transaction(async (tx) => {
      const ctx = await editable(tx, user, existing.orderId);
      const [doc] = await attachFiles(tx, files, {
        orderId: existing.orderId,
        taskId: null,
        roundId: null,
        userId: user.id,
        componentId,
      });
      await logEvent(tx, {
        orderId: existing.orderId,
        type: 'COMPONENT_PO',
        actorId: user.id,
        actingAs: 'MATERIALS',
        details: {
          component: existing.name,
          documents: [{ id: doc!.id, kind: doc!.kind, fileName: doc!.fileName }],
        },
      });
      await advance(tx, ctx);
    });
  } catch (err) {
    await discard();
    throw err;
  }
  await removeUploadObjects(storage, files);
}
