import {
  findTemplate,
  SLOT_INFO,
  stepOf,
  TEAM_LABEL,
  type Slot,
  type Tag,
  type Team,
  type WorkItem,
  type WorkQuery,
  type WorkResponse,
} from '@docflow/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { AuthUser } from '../auth/sessions.js';
import type { Db } from '../db/client.js';
import { buyers, documents, employees, notices, orders } from '../db/schema.js';
import { sinceClock } from './clock.js';
import { loadCtx } from './engine.js';
import { privacyFor, reviewDocsFor } from './views.js';

type Query = z.output<typeof WorkQuery>;

interface Row extends Record<string, unknown> {
  task_id: string;
  order_id: string;
  number: number;
  ref: string;
  buyer_id: string;
  buyer_name: string;
  step_key: string;
  phase: number;
  product_name: string | null;
  tag: Tag | null;
  holder_team: Team | null;
  holder_slot: Slot | null;
  side: string | null;
  template_key: string;
  template_version: number;
  waiting_since: Date;
  held_seconds: number;
  held_since: Date;
  production_started_at: Date | null;
  chain_started_at: Date | null;
}

/** What waits for this person: tasks held by their teams, or by a slot naming them (Q8) */
export async function myWork(db: Db, user: AuthUser, query: Query): Promise<WorkResponse> {
  const teams = user.teams.length
    ? sql`t.holder_team::text in (${sql.join(
        user.teams.map((t) => sql`${t}`),
        sql`, `,
      )})`
    : sql`false`;
  const base = sql`
    select t.id as task_id, t.order_id, o.number, o.ref, b.id as buyer_id, b.name as buyer_name,
           t.step_key, t.phase,
           p.name as product_name, t.tag, t.holder_team, t.holder_slot, t.side,
           o.template_key, o.template_version, hi.started_at as waiting_since,
           h.held_seconds, h.held_since, o.production_started_at, o.chain_started_at
      from tasks t
      join orders o on o.id = t.order_id
      join buyers b on b.id = o.buyer_id
      left join order_products p on p.id = t.product_id
      join holder_intervals hi on hi.task_id = t.id and hi.ended_at is null
      cross join lateral (
        select coalesce(sum(extract(epoch from coalesce(x.ended_at, now()) - x.started_at)), 0)::float8 as held_seconds,
               min(x.started_at) as held_since
          from holder_intervals x
         where x.task_id = t.id
           and x.holder_team is not distinct from t.holder_team
           and x.holder_slot is not distinct from t.holder_slot
      ) h
     where t.status = 'OPEN'
       and o.status in ('ACTIVE', 'NO_ACTION_NEEDED')
       and (${teams} or (t.holder_slot is not null and exists (
             select 1 from order_slot_people s
              where s.order_id = t.order_id and s.slot = t.holder_slot and s.employee_id = ${user.id})))
       -- An approver who has voted on this stage is done with it, even if others haven't
       and not exists (
             select 1 from approval_votes v
              where v.task_id = t.id and v.run = t.run and v.stage = t.side and v.employee_id = ${user.id})`;

  const { rows: all } = await db.execute<Row>(base);

  const keep = (r: Row) => {
    if (query.tab === 'NAMED' && !r.holder_slot) return false;
    if (query.tab && query.tab !== 'NAMED' && r.holder_team !== query.tab) return false;
    if (query.buyerId && r.buyer_id !== query.buyerId) return false;
    if (query.stepKey && r.step_key !== query.stepKey) return false;
    if (query.tag && r.tag !== query.tag) return false;
    const since = new Date(r.waiting_since);
    if (query.since && since < new Date(query.since)) return false;
    if (query.until && since > new Date(query.until)) return false;
    if (query.q) {
      const needle = query.q.toLowerCase();
      if (!r.buyer_name.toLowerCase().includes(needle) && !r.ref.toLowerCase().includes(needle))
        return false;
    }
    return true;
  };

  const value = (r: Row): number | string => {
    switch (query.sort) {
      case 'waiting':
        return new Date(r.waiting_since).getTime();
      case 'held':
        return -Number(r.held_seconds);
      case 'order':
        return r.number;
      case 'buyer':
        return r.buyer_name.toLowerCase();
      case 'trackerA':
        return r.production_started_at ? new Date(r.production_started_at).getTime() : Infinity;
      case 'trackerB':
        return r.chain_started_at ? new Date(r.chain_started_at).getTime() : Infinity;
    }
  };
  const dir = query.dir === 'asc' ? 1 : -1;
  const shown = all.filter(keep);

  // The latest document each step is about, so it opens straight from the dashboard (D27)
  const orderIds = [...new Set(shown.map((r) => r.order_id))];
  const [ctxs, docs] = await Promise.all([
    Promise.all(orderIds.map((id) => loadCtx(db, id))),
    orderIds.length
      ? db.select().from(documents).where(inArray(documents.orderId, orderIds))
      : Promise.resolve([]),
  ]);
  const ctxOf = new Map(ctxs.map((c) => [c.order.id, c]));
  // Only documents this person may open: by kind, phase and private audience (D29)
  const privacies = new Map(
    await Promise.all(ctxs.map(async (c) => [c.order.id, await privacyFor(db, user, c)] as const)),
  );

  const items = shown
    .sort((a, b) => {
      const x = value(a);
      const y = value(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir || a.task_id.localeCompare(b.task_id);
    })
    .map((r): WorkItem => {
      const template = findTemplate(r.template_key, r.template_version);
      const step = stepOf(template, r.step_key);
      const asTeam = r.holder_team;
      const asSlot = r.holder_slot;
      return {
        taskId: r.task_id,
        orderId: r.order_id,
        orderRef: r.ref,
        buyerName: r.buyer_name,
        stepKey: r.step_key,
        title:
          step.kind === 'APPROVAL_CHAIN'
            ? `${step.title} · ${step.stages.find((s) => s.key === r.side)?.title ?? ''}`
            : step.title,
        phase: r.phase,
        productName: r.product_name,
        tag: r.tag,
        as: {
          team: asTeam,
          slot: asSlot,
          label: asTeam ? TEAM_LABEL[asTeam] : asSlot ? SLOT_INFO[asSlot].label : '',
        },
        waitingSince: new Date(r.waiting_since).toISOString(),
        held: {
          days: Math.ceil(Number(r.held_seconds) / 86_400),
          since: new Date(r.held_since).toISOString(),
        },
        trackerA: sinceClock(r.production_started_at ? new Date(r.production_started_at) : null),
        trackerB: sinceClock(r.chain_started_at ? new Date(r.chain_started_at) : null),
        actions: actionsFromKind(step.kind, r.side),
        documents: reviewDocsFor(
          user,
          ctxOf.get(r.order_id)!,
          { id: r.task_id, stepKey: r.step_key },
          docs.filter((d) => d.orderId === r.order_id && privacies.get(r.order_id)!.seesDoc(d)),
        ),
      };
    });

  const tabCounts = new Map<string, number>();
  for (const r of all) {
    const tab = r.holder_team ?? 'NAMED';
    tabCounts.set(tab, (tabCounts.get(tab) ?? 0) + 1);
  }
  const tabs = [
    ...user.teams.map((t) => ({ tab: t, label: TEAM_LABEL[t], count: tabCounts.get(t) ?? 0 })),
    ...(tabCounts.has('NAMED') || user.capabilities.some((c) => c !== 'ADMIN')
      ? [{ tab: 'NAMED', label: 'Named on orders', count: tabCounts.get('NAMED') ?? 0 }]
      : []),
  ];
  const uniq = <T extends { id: string; name: string }>(list: T[]) =>
    [...new Map(list.map((x) => [x.id, x])).values()].sort((a, b) => a.name.localeCompare(b.name));
  // Messages and files shared with this person, until they mark them read (D29)
  const unread = await db
    .select({
      id: notices.id,
      kind: notices.kind,
      orderId: notices.orderId,
      orderRef: orders.ref,
      buyerName: buyers.name,
      taskId: notices.taskId,
      title: notices.title,
      actorName: employees.name,
      comment: notices.comment,
      at: notices.createdAt,
    })
    .from(notices)
    .innerJoin(orders, eq(orders.id, notices.orderId))
    .innerJoin(buyers, eq(buyers.id, orders.buyerId))
    .leftJoin(employees, eq(employees.id, notices.actorId))
    .where(and(eq(notices.employeeId, user.id), isNull(notices.readAt)))
    .orderBy(desc(notices.createdAt))
    .limit(100);
  return {
    items,
    tabs,
    buyers: uniq(all.map((r) => ({ id: r.buyer_id, name: r.buyer_name }))),
    notices: unread.map((n) => ({ ...n, at: n.at.toISOString() })),
  };
}

/** Marks one of this person's notices read; someone else's is a 404 (D29) */
export async function markNoticeRead(db: Db, user: AuthUser, noticeId: string) {
  const [row] = await db
    .update(notices)
    .set({ readAt: new Date() })
    .where(and(eq(notices.id, noticeId), eq(notices.employeeId, user.id)))
    .returning({ id: notices.id });
  return Boolean(row);
}

function actionsFromKind(kind: string, side: string | null): string[] {
  switch (kind) {
    case 'TASK':
      return ['COMPLETE'];
    case 'REVIEW_LOOP':
      return side === 'REVIEWER' ? ['CONFIRM', 'RETURN'] : ['SUBMIT'];
    case 'APPROVAL_CHAIN':
      return ['APPROVE', 'REJECT'];
    case 'STATUS_LOG':
      return ['LOG'];
    case 'CHECKPOINT_LOG':
      return ['CHECKPOINT'];
    case 'CLOSE':
      return ['CLOSE'];
    default:
      return [];
  }
}
