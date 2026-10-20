import type { DocKind, OrderDetail, TaskActionRequest } from '@docflow/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db/client.js';
import { MemoryStorage } from './storage/memory.js';
import { Client, createEmployee, resetDb, setupTestDb, TEST_DB_URL, testApp } from './test-db.js';

const PDF = 'application/pdf';
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(55, 0x20)]);

/**
 * D27: the buyer's default chain, Marketing's per-order changes (people and ALL/ANY) until a
 * stage starts, the Creator renaming the order to the PI's number, and the latest documents
 * shown with the step that is about them.
 */
describe.skipIf(!TEST_DB_URL)('buyer chains, order numbers and documents to review', () => {
  let db: Db;
  let end: () => Promise<void>;
  let app: Awaited<ReturnType<typeof testApp>>;
  const storage = new MemoryStorage();
  const ids: Record<string, string> = {};
  const as: Record<string, Client> = {};
  let orderId: string;

  const people = {
    admin: ['ADMIN'],
    mkt: ['MARKETING'],
    mkt2: ['MARKETING'],
    creator: ['CREATOR'],
    appr1: ['APPROVER'],
    appr2: ['APPROVER'],
    appr3: ['APPROVER'],
    head: ['HEAD_APPROVER'],
  } as const;

  beforeAll(async () => {
    const setup = await setupTestDb();
    db = setup.db;
    end = () => setup.pool.end();
    app = await testApp(db, {}, storage);
    await resetDb(db);
    for (const [key, capabilities] of Object.entries(people)) {
      ids[key] = await createEmployee(db, {
        name: key,
        email: `${key}@t.co`,
        capabilities: [...capabilities] as never,
      });
      as[key] = await new Client(app).login(`${key}@t.co`);
    }
    const buyer = await as.admin!.post('/v1/buyers', {
      name: 'Acme Imports',
      code: 'ACM',
      slots: [
        { slot: 'MARKETING', employeeIds: [ids.mkt] },
        { slot: 'CREATOR', employeeIds: [ids.creator] },
        { slot: 'PI_APPROVER', employeeIds: [ids.appr1], gate: 'ALL' },
        { slot: 'PI_HEAD', employeeIds: [ids.head], gate: 'ALL' },
        { slot: 'PAY_APPROVER', employeeIds: [ids.appr1] },
        { slot: 'PAY_HEAD', employeeIds: [ids.head] },
        { slot: 'BOL_APPROVER', employeeIds: [ids.appr1] },
        { slot: 'BOL_HEAD', employeeIds: [ids.head] },
      ],
    });
    expect(buyer.statusCode, buyer.body).toBe(201);
    ids.buyer = buyer.json().id;
  });
  afterAll(async () => {
    await app.close();
    await end();
  });

  const detail = async (who = 'admin', id = orderId): Promise<OrderDetail> => {
    const res = await as[who]!.get(`/v1/orders/${id}`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  const task = async (stepKey: string, who = 'admin') =>
    (await detail(who)).tasks.find((t) => t.stepKey === stepKey)!;
  const ok = async (who: string, taskId: string, body: TaskActionRequest) => {
    const res = await as[who]!.post(`/v1/tasks/${taskId}/actions`, body);
    expect(res.statusCode, res.body).toBe(204);
  };
  async function upload(who: string, kind: DocKind, name: string) {
    const res = await as[who]!.post('/v1/uploads/presign', {
      fileName: name,
      contentType: PDF,
      size: pdf.length,
    });
    const { uploadId } = res.json();
    const { rows } = await db.execute<{ object_key: string }>(
      sql`select object_key from uploads where id = ${uploadId}`,
    );
    storage.upload(rows[0]!.object_key, pdf, PDF);
    return { uploadId, kind };
  }
  const slotOf = (d: OrderDetail, slot: string) => d.slots.find((s) => s.slot === slot)!;
  const putSlot = (who: string, slot: string, body: object) =>
    as[who]!.put(`/v1/orders/${orderId}/slots/${slot}`, body);

  it('Marketing starts from the buyer chain and can change people and ALL/ANY for this order', async () => {
    const res = await as.mkt!.post('/v1/orders', {
      buyerId: ids.buyer,
      slots: [{ slot: 'PI_APPROVER', employeeIds: [ids.appr1, ids.appr2], gate: 'ANY' }],
    });
    expect(res.statusCode, res.body).toBe(201);
    orderId = res.json().id;
    const d = await detail('mkt');
    expect(d.ref).toMatch(/^ORD-\d{4}$/);
    expect(slotOf(d, 'PI_APPROVER')).toMatchObject({
      gate: 'ANY',
      people: [{ id: ids.appr1 }, { id: ids.appr2 }],
    });
    // The buyer's default is unchanged
    const buyer = (await as.admin!.get(`/v1/buyers/${ids.buyer}`)).json();
    expect(buyer.slots.find((s: { slot: string }) => s.slot === 'PI_APPROVER')).toMatchObject({
      gate: 'ALL',
      people: [{ id: ids.appr1 }],
    });
    expect(d.editableSlots).toEqual(
      expect.arrayContaining(['PI_APPROVER', 'PI_HEAD', 'PAY_APPROVER', 'BOL_HEAD']),
    );
    expect((await detail('creator')).editableSlots).toEqual([]);
  });

  it('only the order’s Marketing person (and Admin) changes a stage that hasn’t started', async () => {
    const body = {
      employeeIds: [ids.appr1, ids.appr2, ids.appr3],
      gate: 'ALL',
      reason: 'Big order',
    };
    expect((await putSlot('creator', 'PI_APPROVER', body)).statusCode).toBe(403);
    expect((await putSlot('mkt2', 'PI_APPROVER', body)).statusCode).toBe(404);
    const res = await putSlot('mkt', 'PI_APPROVER', body);
    expect(res.statusCode, res.body).toBe(204);
    expect(slotOf(await detail(), 'PI_APPROVER')).toMatchObject({
      gate: 'ALL',
      people: [{ id: ids.appr1 }, { id: ids.appr2 }, { id: ids.appr3 }],
    });
    // The same people rules as everywhere: the capability is needed
    const bad = await putSlot('mkt', 'PI_HEAD', { employeeIds: [ids.appr1], gate: 'ALL' });
    expect(bad.statusCode).toBe(400);
    const events = (await as.admin!.get(`/v1/orders/${orderId}/timeline`)).json();
    expect(events.find((e: { type: string }) => e.type === 'SLOT_CHANGED')).toMatchObject({
      actorName: 'mkt',
      actingAs: 'MARKETING',
      comment: 'Big order',
      details: { slot: 'PI_APPROVER', gateFrom: 'ANY', gate: 'ALL' },
    });
  });

  it('the Creator renames the order to the PI number; numbers stay unique', async () => {
    let cbm = await task('cbm');
    await ok('creator', cbm.id, {
      action: 'SUBMIT',
      uploads: [await upload('creator', 'CBM', 'cbm1.pdf')],
    });
    // Marketing reviewing sees the latest CBM right on the step (D27)
    cbm = await task('cbm', 'mkt');
    expect(cbm.reviewDocs).toMatchObject([{ kind: 'CBM', fileName: 'cbm1.pdf' }]);
    await ok('mkt', cbm.id, { action: 'RETURN', comment: 'Fix pallets' });
    await ok('creator', cbm.id, {
      action: 'SUBMIT',
      uploads: [await upload('creator', 'CBM', 'cbm2.pdf')],
    });
    expect((await task('cbm', 'mkt')).reviewDocs).toMatchObject([{ fileName: 'cbm2.pdf' }]);
    await ok('mkt', cbm.id, { action: 'CONFIRM' });
    await ok('mkt', (await task('cbm_buyer_confirmed')).id, { action: 'LOG' });

    const other = (await as.mkt!.post('/v1/orders', { buyerId: ids.buyer })).json().id;
    expect(
      (await as.creator!.put(`/v1/orders/${other}/ref`, { ref: 'PI/ACM/0042' })).statusCode,
    ).toBe(204);
    expect((await detail('creator', other)).ref).toBe('PI/ACM/0042');
    expect((await as.appr1!.put(`/v1/orders/${other}/ref`, { ref: 'X-1' })).statusCode).toBe(403);
    expect((await as.creator!.put(`/v1/orders/${other}/ref`, { ref: 'bad<ref>' })).statusCode).toBe(
      400,
    );

    const pi = await task('pi');
    const taken = await as.creator!.post(`/v1/tasks/${pi.id}/actions`, {
      action: 'COMPLETE',
      products: ['Prod A'],
      orderRef: 'pi/acm/0042',
      uploads: [
        await upload('creator', 'PI_FULL', 'pi.pdf'),
        await upload('creator', 'PI_NO_RATES', 'pi-nr.pdf'),
      ],
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toBe('REF_TAKEN');
    await ok('creator', pi.id, {
      action: 'COMPLETE',
      products: ['Prod A'],
      orderRef: 'PI/ACM/0043',
      uploads: [
        await upload('creator', 'PI_FULL', 'pi.pdf'),
        await upload('creator', 'PI_NO_RATES', 'pi-nr.pdf'),
      ],
    });
    expect((await detail()).ref).toBe('PI/ACM/0043');
    const list = (await as.admin!.get('/v1/orders?q=acm/0043')).json();
    expect(list.items.map((o: { ref: string }) => o.ref)).toEqual(['PI/ACM/0043']);
    const events = (await as.admin!.get(`/v1/orders/${orderId}/timeline`)).json();
    expect(events.find((e: { type: string }) => e.type === 'ORDER_RENAMED')).toMatchObject({
      actorName: 'creator',
      actingAs: 'CREATOR',
    });
  });

  it('approvers get the latest PI on the step and on My Work; a started stage is locked', async () => {
    const chain = await task('pi_approval', 'mkt');
    expect(chain.reviewDocs.map((d) => d.kind)).toEqual(['PI_FULL', 'PI_NO_RATES']);
    await ok('mkt', chain.id, { action: 'APPROVE' });
    // The Approver stage has started: it can't change any more; the Head stage still can
    const locked = await putSlot('mkt', 'PI_APPROVER', { employeeIds: [ids.appr1], gate: 'ANY' });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error).toBe('STAGE_STARTED');
    expect((await detail('mkt')).editableSlots).not.toContain('PI_APPROVER');
    expect(
      (await putSlot('mkt', 'PI_HEAD', { employeeIds: [ids.head], gate: 'ANY' })).statusCode,
    ).toBe(204);

    const work = (await as.appr2!.get('/v1/work')).json();
    expect(work.items).toHaveLength(1);
    expect(work.items[0]).toMatchObject({ orderRef: 'PI/ACM/0043' });
    expect(work.items[0].documents.map((d: { kind: string }) => d.kind)).toEqual([
      'PI_FULL',
      'PI_NO_RATES',
    ]);
    // ALL of the three approvers this order now needs
    await ok('appr1', chain.id, { action: 'APPROVE' });
    await ok('appr2', chain.id, { action: 'APPROVE' });
    expect((await task('pi_approval')).side).toBe('approver');
    await ok('appr3', chain.id, { action: 'APPROVE' });
    expect((await task('pi_approval')).side).toBe('head');
  });
});
