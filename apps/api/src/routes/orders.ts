import {
  CancelOrderRequest,
  ComponentChange,
  ComponentInput,
  ComponentTables,
  CURRENT_TEMPLATE,
  IdParam,
  OrderCreate,
  OrderDetail,
  OrderEvent,
  OrderListQuery,
  OrderSlotUpdate,
  OrderSummary,
  paginated,
  RenameOrderRequest,
  ReplaceSlotPersonRequest,
  Slot,
  TaskActionRequest,
  WorkQuery,
  WorkResponse,
  stepOf,
  findTemplate,
  type Team,
} from '@docflow/shared';
import { and, asc, count, desc, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthUser } from '../auth/sessions.js';
import type { Db } from '../db/client.js';
import {
  buyers,
  componentChanges,
  documents,
  employees,
  orderComponents,
  orders,
  orderSlotPeople,
  tasks,
} from '../db/schema.js';
import { canSeeComponents, canSeeDoc } from '../engine/access.js';
import { sinceClock } from '../engine/clock.js';
import { addComponent, deleteComponent, updateComponent } from '../engine/components.js';
import {
  act,
  cancelOrder,
  createOrder,
  renameOrder,
  replaceSlotPerson,
  updateOrderSlot,
} from '../engine/engine.js';
import { componentTables, orderDetail, orderTimeline, visibleCtx } from '../engine/views.js';
import { myWork } from '../engine/work.js';
import { notFound } from '../errors.js';
import { currentUser, requireUser } from '../plugins/auth.js';
import type { StorageService } from '../storage/storage.js';
import { perUserLimit, type RouteDeps } from './deps.js';
import { containsPattern } from './query-helpers.js';

const FILE_LINK_SECONDS = 5 * 60;

/**
 * Orders this person may list (§4.8): Admin all; named people theirs; team members once the
 * order reaches the phase their team joins in. Uses the current template's phases.
 */
function visibleTo(user: AuthUser): SQL | undefined {
  if (user.capabilities.includes('ADMIN')) return undefined;
  const named = sql`(${orders.createdBy} = ${user.id} or exists (
    select 1 from ${orderSlotPeople} s where s.order_id = ${orders.id} and s.employee_id = ${user.id}))`;
  const phases = user.teams.map((t: Team) => CURRENT_TEMPLATE.teamVisibleFrom[t]);
  if (phases.length === 0) return named;
  const from = Math.min(...phases);
  return sql`(${named} or (select coalesce(max(t.phase), 0) from ${tasks} t where t.order_id = ${orders.id}) >= ${from})`;
}

async function listOrders(db: Db, user: AuthUser, query: z.output<typeof OrderListQuery>) {
  const pattern = query.q ? containsPattern(query.q) : undefined;
  const phaseOf = sql<number>`coalesce((select min(t.phase) from ${tasks} t where t.order_id = ${orders.id} and t.status = 'OPEN'),
                                      (select max(t.phase) from ${tasks} t where t.order_id = ${orders.id}), 1)`;
  const where = and(
    visibleTo(user),
    query.status ? eq(orders.status, query.status) : undefined,
    query.buyerId ? eq(orders.buyerId, query.buyerId) : undefined,
    query.phase ? sql`${phaseOf} = ${query.phase}` : undefined,
    query.stepKey
      ? sql`exists (select 1 from ${tasks} t where t.order_id = ${orders.id} and t.step_key = ${query.stepKey} and t.status = 'OPEN')`
      : undefined,
    query.createdFrom ? gte(orders.createdAt, new Date(query.createdFrom)) : undefined,
    query.createdTo ? lte(orders.createdAt, new Date(query.createdTo)) : undefined,
    pattern
      ? or(sql`lower(${buyers.name}) like ${pattern}`, sql`lower(${orders.ref}) like ${pattern}`)
      : undefined,
  );
  const SORT: Record<typeof query.sort, SQL> = {
    updated: sql`${orders.updatedAt}`,
    created: sql`${orders.createdAt}`,
    number: sql`${orders.number}`,
    buyer: sql`lower(${buyers.name})`,
    // Older anchor = more days; nulls (not started) last
    trackerA: sql`${orders.productionStartedAt}`,
    trackerB: sql`${orders.chainStartedAt}`,
  };
  const order = query.dir === 'asc' ? asc : desc;
  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: orders.id,
        number: orders.number,
        ref: orders.ref,
        buyerName: buyers.name,
        status: orders.status,
        phase: phaseOf,
        templateKey: orders.templateKey,
        templateVersion: orders.templateVersion,
        productionStartedAt: orders.productionStartedAt,
        chainStartedAt: orders.chainStartedAt,
        closedAt: orders.closedAt,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
      })
      .from(orders)
      .innerJoin(buyers, eq(buyers.id, orders.buyerId))
      .where(where)
      .orderBy(sql`${order(SORT[query.sort])} nulls last`, order(orders.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ total: count() })
      .from(orders)
      .innerJoin(buyers, eq(buyers.id, orders.buyerId))
      .where(where),
  ]);
  const open = rows.length
    ? await db
        .select({ orderId: tasks.orderId, stepKey: tasks.stepKey })
        .from(tasks)
        .where(
          and(
            inArray(
              tasks.orderId,
              rows.map((r) => r.id),
            ),
            eq(tasks.status, 'OPEN'),
          ),
        )
    : [];
  return {
    items: rows.map((r) => {
      const template = findTemplate(r.templateKey, r.templateVersion);
      const current = [
        ...new Set(
          open.filter((t) => t.orderId === r.id).map((t) => stepOf(template, t.stepKey).title),
        ),
      ];
      return {
        id: r.id,
        number: r.number,
        ref: r.ref,
        buyerName: r.buyerName,
        status: r.status,
        phase: Number(r.phase),
        current,
        trackerA: sinceClock(r.productionStartedAt, r.closedAt ?? undefined),
        trackerB: sinceClock(r.chainStartedAt, r.closedAt ?? undefined),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    }),
    total: totals?.total ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export const orderRoutes: FastifyPluginAsyncZod<RouteDeps & { storage: StorageService }> = async (
  app,
  { db, storage, limits },
) => {
  app.addHook('onRequest', requireUser);

  app.post(
    '/v1/orders',
    {
      config: perUserLimit(limits.userActionsPerMinute),
      schema: { body: OrderCreate, response: { 201: z.object({ id: z.uuid() }) } },
    },
    async (request, reply) => {
      const id = await createOrder(db, currentUser(request), request.body);
      request.log.info({ orderId: id, actorId: currentUser(request).id }, 'order created');
      return reply.code(201).send({ id });
    },
  );

  app.get(
    '/v1/orders',
    { schema: { querystring: OrderListQuery, response: { 200: paginated(OrderSummary) } } },
    async (request) => listOrders(db, currentUser(request), request.query),
  );

  app.get(
    '/v1/orders/:id',
    { schema: { params: IdParam, response: { 200: OrderDetail } } },
    async (request) => orderDetail(db, currentUser(request), request.params.id),
  );

  app.get(
    '/v1/orders/:id/timeline',
    { schema: { params: IdParam, response: { 200: OrderEvent.array() } } },
    async (request) => orderTimeline(db, currentUser(request), request.params.id),
  );

  app.post(
    '/v1/tasks/:id/actions',
    {
      config: perUserLimit(limits.userActionsPerMinute),
      schema: { params: IdParam, body: TaskActionRequest },
    },
    async (request, reply) => {
      const user = currentUser(request);
      await act(db, storage, user, request.params.id, request.body);
      request.log.info(
        { taskId: request.params.id, actorId: user.id, action: request.body.action },
        'task action',
      );
      return reply.code(204).send();
    },
  );

  app.post(
    '/v1/orders/:id/cancel',
    { schema: { params: IdParam, body: CancelOrderRequest } },
    async (request, reply) => {
      await cancelOrder(db, currentUser(request), request.params.id, request.body.reason);
      return reply.code(204).send();
    },
  );

  // The Creator renames the order to match the PI (D27); the change is in the history
  app.put(
    '/v1/orders/:id/ref',
    { schema: { params: IdParam, body: RenameOrderRequest } },
    async (request, reply) => {
      await renameOrder(db, currentUser(request), request.params.id, request.body.ref);
      return reply.code(204).send();
    },
  );

  // Marketing changes an approval stage of this order before it starts (D27)
  app.put(
    '/v1/orders/:id/slots/:slot',
    {
      schema: {
        params: z.object({ id: z.uuid(), slot: Slot }),
        body: OrderSlotUpdate,
      },
    },
    async (request, reply) => {
      const user = currentUser(request);
      await updateOrderSlot(db, user, request.params.id, request.params.slot, request.body);
      request.log.info(
        { orderId: request.params.id, actorId: user.id, slot: request.params.slot },
        'order slot changed',
      );
      return reply.code(204).send();
    },
  );

  app.post(
    '/v1/orders/:id/replace-person',
    { schema: { params: IdParam, body: ReplaceSlotPersonRequest } },
    async (request, reply) => {
      await replaceSlotPerson(db, currentUser(request), request.params.id, request.body);
      return reply.code(204).send();
    },
  );

  // A short-lived link to one document, only for people allowed that document kind
  app.get(
    '/v1/documents/:id/file',
    {
      schema: {
        params: IdParam,
        querystring: z.object({ mode: z.enum(['view', 'download']).default('download') }),
        response: { 200: z.object({ url: z.url(), expiresAt: z.iso.datetime({ offset: true }) }) },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const [doc] = await db.select().from(documents).where(eq(documents.id, request.params.id));
      if (!doc) throw notFound('Document');
      const ctx = await visibleCtx(db, user, doc.orderId);
      if (!canSeeDoc(user, ctx, doc.kind)) throw notFound('Document');
      const inline =
        request.query.mode === 'view' &&
        (doc.fileMime === 'application/pdf' || doc.fileMime.startsWith('image/'));
      const link = await storage.presignGet(doc.fileKey, {
        fileName: doc.fileName,
        expiresInSeconds: FILE_LINK_SECONDS,
        disposition: inline ? 'inline' : 'attachment',
        contentType: doc.fileMime,
      });
      return { url: link.url, expiresAt: link.expiresAt.toISOString() };
    },
  );

  // ---- Component tables -------------------------------------------------------

  app.get(
    '/v1/orders/:id/components',
    { schema: { params: IdParam, response: { 200: ComponentTables } } },
    async (request) => componentTables(db, currentUser(request), request.params.id),
  );

  app.post(
    '/v1/orders/:id/products/:productId/components',
    {
      schema: {
        params: z.object({ id: z.uuid(), productId: z.uuid() }),
        body: ComponentInput,
        response: { 201: z.object({ id: z.uuid() }) },
      },
    },
    async (request, reply) => {
      const id = await addComponent(
        db,
        currentUser(request),
        request.params.id,
        request.params.productId,
        request.body,
      );
      return reply.code(201).send({ id });
    },
  );

  app.put(
    '/v1/components/:id',
    { schema: { params: IdParam, body: ComponentInput } },
    async (request, reply) => {
      await updateComponent(db, currentUser(request), request.params.id, request.body);
      return reply.code(204).send();
    },
  );

  app.delete(
    '/v1/components/:id',
    {
      schema: {
        params: IdParam,
        querystring: z.object({ comment: z.string().trim().max(500).optional() }),
      },
    },
    async (request, reply) => {
      await deleteComponent(
        db,
        currentUser(request),
        request.params.id,
        request.query.comment || null,
      );
      return reply.code(204).send();
    },
  );

  app.get(
    '/v1/components/:id/history',
    { schema: { params: IdParam, response: { 200: ComponentChange.array() } } },
    async (request) => {
      const user = currentUser(request);
      const [row] = await db
        .select({ orderId: componentChanges.orderId })
        .from(componentChanges)
        .where(eq(componentChanges.componentId, request.params.id))
        .limit(1);
      const [live] = row
        ? [row]
        : await db
            .select({ orderId: orderComponents.orderId })
            .from(orderComponents)
            .where(eq(orderComponents.id, request.params.id));
      if (!live) throw notFound('Component');
      const ctx = await visibleCtx(db, user, live.orderId);
      if (!canSeeComponents(user, ctx)) throw notFound('Component');
      const changes = await db
        .select({
          id: componentChanges.id,
          field: componentChanges.field,
          oldValue: componentChanges.oldValue,
          newValue: componentChanges.newValue,
          comment: componentChanges.comment,
          actorName: employees.name,
          at: componentChanges.createdAt,
        })
        .from(componentChanges)
        .innerJoin(employees, eq(employees.id, componentChanges.actorId))
        .where(eq(componentChanges.componentId, request.params.id))
        .orderBy(desc(componentChanges.createdAt));
      return changes.map((c) => ({ ...c, at: c.at.toISOString() }));
    },
  );

  // ---- Dashboard ----------------------------------------------------------------

  app.get(
    '/v1/work',
    { schema: { querystring: WorkQuery, response: { 200: WorkResponse } } },
    async (request) => myWork(db, currentUser(request), request.query),
  );
};
