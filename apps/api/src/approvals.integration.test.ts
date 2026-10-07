import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db/client.js';
import { MemoryStorage } from './storage/memory.js';
import { Client, createEmployee, resetDb, setupTestDb, TEST_DB_URL, testApp } from './test-db.js';

const PDF = 'application/pdf';
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(55, 0x20)]);
type Chain = Array<[who: string, position: number]>;

describe.skipIf(!TEST_DB_URL)('approval engine (plan.md §4.8)', () => {
  let db: Db;
  let end: () => Promise<void>;
  let app: Awaited<ReturnType<typeof testApp>>;
  let storage: MemoryStorage;
  let ids: Record<string, string>;
  let companyId: string;
  const clients: Record<string, Client> = {};

  const EMAILS: Record<string, string> = {
    admin: 'admin@t.co',
    creator: 'creator@t.co',
    a: 'a@t.co',
    b: 'b@t.co',
    c: 'c@t.co',
    d: 'd@t.co',
    cfo: 'cfo@t.co',
  };

  beforeAll(async () => {
    const setup = await setupTestDb();
    db = setup.db;
    end = () => setup.pool.end();
    storage = new MemoryStorage();
    app = await testApp(db, {}, storage);
  });
  afterAll(async () => {
    await app.close();
    await end();
  });

  beforeEach(async () => {
    await resetDb(db);
    storage.objects.clear();
    ids = {
      admin: await createEmployee(db, { name: 'Admin', email: EMAILS.admin!, permission: 'ADMIN' }),
      creator: await createEmployee(db, {
        name: 'Creator',
        email: EMAILS.creator!,
        permission: 'CREATOR',
      }),
      a: await createEmployee(db, { name: 'Ann', email: EMAILS.a!, permission: 'APPROVER' }),
      b: await createEmployee(db, { name: 'Bob', email: EMAILS.b!, permission: 'APPROVER' }),
      c: await createEmployee(db, { name: 'Cy', email: EMAILS.c!, permission: 'APPROVER' }),
      d: await createEmployee(db, { name: 'Di', email: EMAILS.d!, permission: 'APPROVER' }),
      cfo: await createEmployee(db, { name: 'Vee CFO', email: EMAILS.cfo!, permission: 'CFO' }),
    };
    for (const [who, email] of Object.entries(EMAILS))
      clients[who] = await new Client(app).login(email);
    // Default chain uses c and d, so a and b can be deactivated in tests (D17)
    companyId = (
      await clients.admin!.post('/v1/companies', {
        name: 'Acme',
        approvers: [
          { employeeId: ids.c, position: 1 },
          { employeeId: ids.d, position: 2 },
        ],
      })
    ).json().id;
  });

  async function submit(chain: Chain): Promise<string> {
    const creator = clients.creator!;
    const presign = await creator.post('/v1/uploads/presign', {
      fileName: 'Invoice.pdf',
      contentType: PDF,
      size: pdf.length,
    });
    const { uploadId } = presign.json();
    const { rows } = await db.execute<{ object_key: string }>(
      sql`select object_key from uploads where id = ${uploadId}`,
    );
    storage.upload(rows[0]!.object_key, pdf, PDF);
    const res = await creator.post('/v1/workflows', {
      uploadId,
      companyId,
      approvers: chain.map(([who, position]) => ({ employeeId: ids[who], position })),
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id;
  }

  const decide = (who: string, wf: string, decision: 'APPROVE' | 'REJECT', remarks?: string) =>
    clients[who]!.post(`/v1/workflows/${wf}/decision`, {
      decision,
      ...(remarks !== undefined ? { remarks } : {}),
    });

  const state = async (wf: string) => (await clients.admin!.get(`/v1/workflows/${wf}`)).json();
  const stepStatus = async (wf: string) =>
    Object.fromEntries(
      (await state(wf)).steps.map((s: { name: string; status: string }) => [s.name, s.status]),
    ) as Record<string, string>;
  const outbox = async (wf: string) =>
    (
      await db.execute<{ template: string; recipient_id: string; status: string }>(
        sql`select template, recipient_id, status from notification_outbox where workflow_id = ${wf} order by created_at, template`,
      )
    ).rows;
  const events = async (wf: string) =>
    (
      await db.execute<{ event_type: string }>(
        sql`select event_type from audit_events where workflow_id = ${wf} order by created_at, id`,
      )
    ).rows.map((r) => r.event_type);

  describe('happy path with sequential and parallel steps', () => {
    it('advances step by step, waits for every member of a parallel step, then completes', async () => {
      // 1: Ann  →  2: Bob + Cy (parallel)  →  3: Di  →  CFO
      const wf = await submit([
        ['a', 1],
        ['b', 2],
        ['c', 2],
        ['d', 3],
      ]);
      expect((await decide('a', wf, 'APPROVE', 'Looks correct')).json()).toEqual({
        status: 'PENDING_APPROVER',
        currentPosition: 2,
      });
      expect(await stepStatus(wf)).toMatchObject({
        Ann: 'APPROVED',
        Bob: 'PENDING',
        Cy: 'PENDING',
        Di: 'WAITING',
      });

      // One of the pair approves: nothing advances yet
      expect((await decide('b', wf, 'APPROVE')).json()).toEqual({
        status: 'PENDING_APPROVER',
        currentPosition: 2,
      });
      expect((await stepStatus(wf)).Di).toBe('WAITING');

      expect((await decide('c', wf, 'APPROVE')).json()).toEqual({
        status: 'PENDING_APPROVER',
        currentPosition: 3,
      });
      expect((await decide('d', wf, 'APPROVE')).json()).toEqual({
        status: 'PENDING_CFO',
        currentPosition: 4,
      });
      expect((await decide('cfo', wf, 'APPROVE', 'Approved for payment')).json()).toEqual({
        status: 'COMPLETED',
        currentPosition: 4,
      });

      const detail = await state(wf);
      expect(detail.steps.every((s: { status: string }) => s.status === 'APPROVED')).toBe(true);
      expect(detail.steps.find((s: { name: string }) => s.name === 'Ann').remarks).toBe(
        'Looks correct',
      );
      expect(await events(wf)).toEqual([
        'SUBMITTED',
        'APPROVED',
        'ADVANCED',
        'APPROVED',
        'APPROVED',
        'ADVANCED',
        'APPROVED',
        'ADVANCED',
        'APPROVED',
        'COMPLETED',
      ]);

      // Notifications (plan §4.6, D2): your-turn for each step reached; completion to Creator + CFO
      const mail = await outbox(wf);
      const yourTurn = mail
        .filter((m) => m.template === 'your-turn')
        .map((m) => m.recipient_id)
        .sort();
      expect(yourTurn).toEqual([ids.a, ids.b, ids.c, ids.d, ids.cfo].sort());
      expect(
        mail
          .filter((m) => m.template === 'completed')
          .map((m) => m.recipient_id)
          .sort(),
      ).toEqual([ids.creator, ids.cfo].sort());
      // No email provider until Phase 5: rows are marked skipped, never left as a backlog
      expect(mail.every((m) => m.status === 'skipped')).toBe(true);
    });
  });

  describe('rejection (invariant 5)', () => {
    it('at the first step: ends the workflow, skips everyone else, notifies Creator and CFO', async () => {
      const wf = await submit([
        ['a', 1],
        ['b', 2],
      ]);
      expect((await decide('a', wf, 'REJECT', 'Wrong vendor')).json().status).toBe('REJECTED');
      expect(await stepStatus(wf)).toEqual({
        Ann: 'REJECTED',
        Bob: 'SKIPPED',
        'Vee CFO': 'SKIPPED',
      });
      const rejected = (await outbox(wf)).filter((m) => m.template === 'rejected');
      expect(rejected.map((m) => m.recipient_id).sort()).toEqual([ids.creator, ids.cfo].sort());
      const [payload] = (
        await db.execute<{ payload: { reason: string; rejectorName: string } }>(
          sql`select payload from notification_outbox where workflow_id = ${wf} and template = 'rejected' limit 1`,
        )
      ).rows;
      expect(payload!.payload).toMatchObject({ reason: 'Wrong vendor', rejectorName: 'Ann' });
    });

    it('in the middle of a parallel step: the other member’s approval stands, the rest are skipped', async () => {
      const wf = await submit([
        ['a', 1],
        ['b', 1],
        ['c', 2],
      ]);
      await decide('a', wf, 'APPROVE');
      expect((await decide('b', wf, 'REJECT', 'Missing PO')).json().status).toBe('REJECTED');
      expect(await stepStatus(wf)).toEqual({
        Ann: 'APPROVED',
        Bob: 'REJECTED',
        Cy: 'SKIPPED',
        'Vee CFO': 'SKIPPED',
      });
    });

    it('by the CFO at the final step', async () => {
      const wf = await submit([
        ['a', 1],
        ['b', 2],
      ]);
      await decide('a', wf, 'APPROVE');
      await decide('b', wf, 'APPROVE');
      expect((await decide('cfo', wf, 'REJECT', 'Over budget')).json().status).toBe('REJECTED');
    });

    it('requires a reason', async () => {
      const wf = await submit([
        ['a', 1],
        ['b', 2],
      ]);
      expect((await decide('a', wf, 'REJECT')).statusCode).toBe(400);
      expect((await decide('a', wf, 'REJECT', '   ')).statusCode).toBe(400);
      expect((await state(wf)).status).toBe('PENDING_APPROVER');
    });
  });

  describe('concurrency (invariant 6)', () => {
    it('two members of the same parallel step approving at the same instant: both recorded, ONE advance, no duplicate emails', async () => {
      // Repeat to give a race every chance to show itself
      for (let round = 0; round < 5; round++) {
        await db.execute(sql`truncate notification_outbox`);
        const wf = await submit([
          ['a', 1],
          ['b', 1],
          ['c', 2],
        ]);
        const [ra, rb] = await Promise.all([
          decide('a', wf, 'APPROVE'),
          decide('b', wf, 'APPROVE'),
        ]);
        expect([ra.statusCode, rb.statusCode]).toEqual([200, 200]);
        const detail = await state(wf);
        expect(detail).toMatchObject({ status: 'PENDING_APPROVER', currentPosition: 2 });
        expect(await stepStatus(wf)).toMatchObject({
          Ann: 'APPROVED',
          Bob: 'APPROVED',
          Cy: 'PENDING',
        });
        expect((await events(wf)).filter((e) => e === 'ADVANCED')).toHaveLength(1);
        const forCy = (await outbox(wf)).filter(
          (m) => m.template === 'your-turn' && m.recipient_id === ids.c,
        );
        expect(forCy).toHaveLength(1);
      }
    });

    it('a double click by the same person records one decision; the other gets 409', async () => {
      const wf = await submit([
        ['a', 1],
        ['b', 2],
      ]);
      const results = await Promise.all([decide('a', wf, 'APPROVE'), decide('a', wf, 'APPROVE')]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect((await events(wf)).filter((e) => e === 'APPROVED')).toHaveLength(1);
    });

    it('an approve and a reject racing in one parallel step leave a consistent, rejected workflow', async () => {
      const wf = await submit([
        ['a', 1],
        ['b', 1],
        ['c', 2],
      ]);
      await Promise.all([decide('a', wf, 'APPROVE'), decide('b', wf, 'REJECT', 'No')]);
      const s = await stepStatus(wf);
      expect((await state(wf)).status).toBe('REJECTED');
      expect(s.Bob).toBe('REJECTED');
      expect(['APPROVED', 'SKIPPED']).toContain(s.Ann);
      expect(s.Cy).toBe('SKIPPED');
    });
  });

  describe('who may act', () => {
    it('a replay after deciding gets 409, and finished workflows never change', async () => {
      const wf = await submit([
        ['a', 1],
        ['b', 2],
      ]);
      await decide('a', wf, 'APPROVE');
      expect((await decide('a', wf, 'APPROVE')).json().error).toBe('ALREADY_DECIDED');
      await decide('b', wf, 'APPROVE');
      await decide('cfo', wf, 'APPROVE');
      expect((await decide('cfo', wf, 'REJECT', 'Changed my mind')).statusCode).toBe(409);
      expect((await state(wf)).status).toBe('COMPLETED');
    });

    it('someone whose step is not reached gets 404 for the document, its file and a decision', async () => {
      const wf = await submit([
        ['a', 1],
        ['b', 2],
      ]);
      expect((await clients.b!.get(`/v1/workflows/${wf}`)).statusCode).toBe(404);
      expect((await clients.b!.get(`/v1/workflows/${wf}/file`)).statusCode).toBe(404);
      expect((await decide('b', wf, 'APPROVE')).statusCode).toBe(404);
      expect((await decide('d', wf, 'APPROVE')).statusCode).toBe(404); // not in the chain at all
    });

    it('after deciding, an approver can still read the document', async () => {
      const wf = await submit([
        ['a', 1],
        ['b', 2],
      ]);
      await decide('a', wf, 'APPROVE');
      const detail = (await clients.a!.get(`/v1/workflows/${wf}`)).json();
      expect(detail.myStep).toMatchObject({ status: 'APPROVED', canAct: false });
      expect((await clients.b!.get(`/v1/workflows/${wf}`)).json().myStep).toMatchObject({
        canAct: true,
      });
    });

    it('a deactivated approver can no longer act', async () => {
      const wf = await submit([
        ['a', 1],
        ['b', 2],
      ]);
      const approverRole = (await clients.admin!.get('/v1/roles?q=approver')).json().items[0].id;
      await clients.admin!.put(`/v1/employees/${ids.a}`, {
        name: 'Ann',
        email: EMAILS.a,
        roleId: approverRole,
        isActive: false,
      });
      expect((await decide('a', wf, 'APPROVE')).statusCode).toBe(401);
    });

    it('Creators and Admins cannot decide', async () => {
      const wf = await submit([
        ['a', 1],
        ['b', 2],
      ]);
      expect((await decide('creator', wf, 'APPROVE')).statusCode).toBe(403);
      expect((await decide('admin', wf, 'APPROVE')).statusCode).toBe(403);
    });
  });

  describe('reviewer lists', () => {
    it('pending shows what is waiting for me, in arrival order, with counts', async () => {
      const first = await submit([
        ['a', 1],
        ['b', 2],
      ]);
      const second = await submit([
        ['a', 1],
        ['c', 2],
      ]);
      const pending = (await clients.a!.get('/v1/approvals/pending')).json();
      expect(pending.items.map((i: { workflowId: string }) => i.workflowId)).toEqual([
        first,
        second,
      ]);
      expect(pending.items[0]).toMatchObject({ position: 1, totalPositions: 2, isCfo: false });
      expect(pending.stats).toMatchObject({
        awaiting: 2,
        approved: 0,
        rejected: 0,
        period: 'week',
      });

      await decide('a', first, 'APPROVE');
      await decide('a', second, 'REJECT', 'Duplicate');
      expect((await clients.a!.get('/v1/approvals/pending')).json().stats).toMatchObject({
        awaiting: 0,
        approved: 1,
        rejected: 1,
      });
      const history = (await clients.a!.get('/v1/approvals/history')).json();
      expect(history.items.map((h: { myDecision: string }) => h.myDecision)).toEqual([
        'REJECTED',
        'APPROVED',
      ]);
    });

    it('the CFO dashboard shows who cleared each document, with monthly counts', async () => {
      const wf = await submit([
        ['a', 1],
        ['b', 1],
        ['c', 2],
      ]);
      await decide('a', wf, 'APPROVE');
      await decide('b', wf, 'APPROVE');
      await decide('c', wf, 'APPROVE');
      const pending = (await clients.cfo!.get('/v1/approvals/pending')).json();
      expect(pending.items[0]).toMatchObject({ isCfo: true, clearedBy: ['Ann & Bob', 'Cy'] });
      expect(pending.stats.period).toBe('month');
    });

    it('is for approvers and the CFO only', async () => {
      expect((await clients.creator!.get('/v1/approvals/pending')).statusCode).toBe(403);
      expect((await clients.admin!.get('/v1/approvals/history')).statusCode).toBe(403);
    });
  });

  describe('the CFO sees rejections that never reached them (D22)', () => {
    it('lists them with who rejected, where and why, and opens them read-only', async () => {
      const wf = await submit([
        ['a', 1],
        ['b', 2],
      ]);
      await decide('a', wf, 'APPROVE');
      await decide('b', wf, 'REJECT', 'Vendor not on the approved list');

      const cfo = clients.cfo!;
      expect((await cfo.get('/v1/approvals/pending')).json().stats.rejectedBeforeFinal).toBe(1);
      const list = (await cfo.get('/v1/approvals/rejected-before-final')).json();
      expect(list.total).toBe(1);
      expect(list.items[0]).toMatchObject({
        workflowId: wf,
        rejectedBy: 'Bob',
        position: 2,
        reason: 'Vendor not on the approved list',
      });

      const detail = await cfo.get(`/v1/workflows/${wf}`);
      expect(detail.statusCode).toBe(200);
      expect(detail.json().myStep).toMatchObject({ isCfo: true, status: 'SKIPPED', canAct: false });
      expect((await cfo.get(`/v1/workflows/${wf}/file`)).statusCode).toBe(200);
      expect((await decide('cfo', wf, 'APPROVE')).statusCode).not.toBe(200);
    });

    it('does not open early rejections to other skipped approvers', async () => {
      const wf = await submit([
        ['a', 1],
        ['b', 2],
      ]);
      await decide('a', wf, 'REJECT', 'Wrong company');
      expect((await clients.b!.get(`/v1/workflows/${wf}`)).statusCode).toBe(404);
    });

    it('leaves out documents the CFO rejected themselves, and is CFO-only', async () => {
      const wf = await submit([
        ['a', 1],
        ['b', 2],
      ]);
      await decide('a', wf, 'APPROVE');
      await decide('b', wf, 'APPROVE');
      await decide('cfo', wf, 'REJECT', 'Over budget');
      expect((await clients.cfo!.get('/v1/approvals/rejected-before-final')).json().total).toBe(0);
      expect((await clients.a!.get('/v1/approvals/rejected-before-final')).statusCode).toBe(403);
    });
  });

  describe('Admin reassign (D9)', () => {
    const reassign = (wf: string, stepId: string, to: string, reason = 'On leave') =>
      clients.admin!.post(`/v1/workflows/${wf}/steps/${stepId}/reassign`, {
        employeeId: ids[to],
        reason,
      });
    const stepOf = async (wf: string, name: string) =>
      (await state(wf)).steps.find((s: { name: string }) => s.name === name).id as string;

    it('hands a pending step to someone else, who can then act; the change is audited', async () => {
      const wf = await submit([
        ['a', 1],
        ['b', 2],
      ]);
      expect((await reassign(wf, await stepOf(wf, 'Ann'), 'd')).statusCode).toBe(204);
      expect((await clients.a!.get(`/v1/workflows/${wf}`)).statusCode).toBe(404);
      expect((await decide('d', wf, 'APPROVE')).statusCode).toBe(200);
      expect(await events(wf)).toContain('REASSIGNED');
      expect(
        (await outbox(wf)).some((m) => m.template === 'your-turn' && m.recipient_id === ids.d),
      ).toBe(true);
    });

    it('also works for a waiting step', async () => {
      const wf = await submit([
        ['a', 1],
        ['b', 2],
      ]);
      expect((await reassign(wf, await stepOf(wf, 'Bob'), 'd')).statusCode).toBe(204);
      expect((await state(wf)).steps.map((s: { name: string }) => s.name)).toContain('Di');
    });

    it('refuses decided steps, finished workflows, ineligible people and people already in the chain', async () => {
      const wf = await submit([
        ['a', 1],
        ['b', 2],
      ]);
      await decide('a', wf, 'APPROVE');
      expect((await reassign(wf, await stepOf(wf, 'Ann'), 'd')).json().error).toBe('STEP_DECIDED');
      expect((await reassign(wf, await stepOf(wf, 'Bob'), 'creator')).json().error).toBe(
        'INELIGIBLE_APPROVER',
      );
      expect((await reassign(wf, await stepOf(wf, 'Bob'), 'a')).json().error).toBe(
        'ALREADY_IN_CHAIN',
      );
      expect((await reassign(wf, await stepOf(wf, 'Vee CFO'), 'd')).json().error).toBe(
        'INELIGIBLE_APPROVER',
      );
      expect(
        (
          await clients.a!.post(`/v1/workflows/${wf}/steps/${await stepOf(wf, 'Bob')}/reassign`, {
            employeeId: ids.d,
            reason: 'x',
          })
        ).statusCode,
      ).toBe(403);
    });
  });
});
