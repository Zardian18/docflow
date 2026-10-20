import type { DocKind, OrderDetail, TaskActionRequest } from '@docflow/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db/client.js';
import { MemoryStorage } from './storage/memory.js';
import { Client, createEmployee, resetDb, setupTestDb, TEST_DB_URL, testApp } from './test-db.js';

const PDF = 'application/pdf';
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(55, 0x20)]);

/**
 * One export order end to end through the real API (docs/v2-workflow.md), checking along the
 * way who can see and do what. Each `it` continues the same order, in sequence.
 */
describe.skipIf(!TEST_DB_URL)('v2 order engine, end to end', () => {
  let db: Db;
  let end: () => Promise<void>;
  let app: Awaited<ReturnType<typeof testApp>>;
  const storage = new MemoryStorage();
  const ids: Record<string, string> = {};
  const as: Record<string, Client> = {};
  let orderId: string;

  const people = {
    admin: { capabilities: ['ADMIN'] },
    mkt: { capabilities: ['MARKETING'] },
    creator: { capabilities: ['CREATOR'] },
    piAppr: { capabilities: ['APPROVER'] },
    head1: { capabilities: ['HEAD_APPROVER'] },
    head2: { capabilities: ['HEAD_APPROVER'] },
    payAppr: { capabilities: ['APPROVER'] },
    bolAppr: { capabilities: ['APPROVER'] },
    reg: { teams: ['REGULATION'] },
    mat: { teams: ['MATERIALS'] },
    mat2: { teams: ['MATERIALS'] },
    design: { teams: ['DESIGN'] },
    prod: { teams: ['PRODUCTION'] },
    acc: { teams: ['ACCOUNTS'] },
    logi: { teams: ['LOGISTICS'] },
    // In two teams at once, with no exclusion (D24)
    multi: { teams: ['REGULATION', 'PRODUCTION'] },
    outsider: { teams: [] as string[], capabilities: ['APPROVER'] },
  } as const;

  beforeAll(async () => {
    const setup = await setupTestDb();
    db = setup.db;
    end = () => setup.pool.end();
    app = await testApp(db, {}, storage);
    await resetDb(db);
    for (const [key, p] of Object.entries(people)) {
      ids[key] = await createEmployee(db, {
        name: key,
        email: `${key.toLowerCase()}@t.co`,
        teams: ('teams' in p ? [...p.teams] : []) as never,
        capabilities: ('capabilities' in p ? [...p.capabilities] : []) as never,
      });
      as[key] = await new Client(app).login(`${key.toLowerCase()}@t.co`);
    }
  });
  afterAll(async () => {
    await app.close();
    await end();
  });

  const detail = async (who = 'admin'): Promise<OrderDetail> => {
    const res = await as[who]!.get(`/v1/orders/${orderId}`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  const task = async (stepKey: string, product?: string) => {
    const d = await detail();
    const t = d.tasks.find(
      (x) => x.stepKey === stepKey && (product === undefined || x.productName === product),
    );
    if (!t) throw new Error(`no task ${stepKey} ${product ?? ''}`);
    return t;
  };
  async function upload(who: string, kind: DocKind, name = `${kind}.pdf`) {
    const res = await as[who]!.post('/v1/uploads/presign', {
      fileName: name,
      contentType: PDF,
      size: pdf.length,
    });
    expect(res.statusCode, res.body).toBe(200);
    const { uploadId } = res.json();
    const { rows } = await db.execute<{ object_key: string }>(
      sql`select object_key from uploads where id = ${uploadId}`,
    );
    storage.upload(rows[0]!.object_key, pdf, PDF);
    return { uploadId, kind };
  }
  const act = (who: string, taskId: string, body: TaskActionRequest) =>
    as[who]!.post(`/v1/tasks/${taskId}/actions`, body);
  const ok = async (who: string, taskId: string, body: TaskActionRequest) => {
    const res = await act(who, taskId, body);
    expect(res.statusCode, res.body).toBe(204);
  };

  it('Admin sets up a company with named people and ALL/ANY gates; Q6 is enforced', async () => {
    const buyer = await as.admin!.post('/v1/buyers', { name: 'Acme Imports', country: 'UAE' });
    expect(buyer.statusCode, buyer.body).toBe(201);
    ids.buyer = buyer.json().id;
    const slots = [
      { slot: 'MARKETING', employeeIds: [ids.mkt] },
      { slot: 'CREATOR', employeeIds: [ids.creator] },
      { slot: 'PI_APPROVER', employeeIds: [ids.piAppr] },
      { slot: 'PI_HEAD', employeeIds: [ids.head1], gate: 'ALL' },
      { slot: 'PAY_APPROVER', employeeIds: [ids.payAppr] },
      { slot: 'PAY_HEAD', employeeIds: [ids.head1, ids.head2], gate: 'ANY' },
      { slot: 'BOL_APPROVER', employeeIds: [ids.bolAppr] },
      { slot: 'BOL_HEAD', employeeIds: [ids.head1, ids.head2], gate: 'ALL' },
    ];
    // The Creator can't also approve, and one person can't sit twice in a chain
    const bad = await as.admin!.post('/v1/companies', {
      name: 'Bad Co',
      slots: slots.map((s) =>
        s.slot === 'PI_APPROVER' ? { ...s, employeeIds: [ids.creator] } : s,
      ),
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().details.slots.PI_APPROVER).toMatch(/Creator/);
    const company = await as.admin!.post('/v1/companies', {
      name: 'Microtech',
      code: 'mic',
      slots,
    });
    expect(company.statusCode, company.body).toBe(201);
    ids.company = company.json().id;
  });

  it('only Marketing creates orders; the order starts with the CBM loop at the Creator', async () => {
    expect(
      (await as.admin!.post('/v1/orders', { buyerId: ids.buyer, companyId: ids.company }))
        .statusCode,
    ).toBe(403);
    const res = await as.mkt!.post('/v1/orders', {
      buyerId: ids.buyer,
      companyId: ids.company,
      notes: '2 products',
    });
    expect(res.statusCode, res.body).toBe(201);
    orderId = res.json().id;
    const cbm = await task('cbm');
    expect(cbm).toMatchObject({ status: 'OPEN', side: 'SUBMITTER', holder: { slot: 'CREATOR' } });
    expect(cbm.actions).toEqual([]); // Admin never acts (Q9)
    // Teams don't see an order before their phase; the Creator does
    expect((await as.reg!.get(`/v1/orders/${orderId}`)).statusCode).toBe(404);
    expect((await detail('creator')).tasks.find((t) => t.stepKey === 'cbm')!.actions).toEqual([
      'SUBMIT',
    ]);
  });

  it('runs the CBM loop with every round recorded, then the buyer confirmation starts Tracker B', async () => {
    const cbm = await task('cbm');
    expect((await act('creator', cbm.id, { action: 'SUBMIT' })).json().error).toBe(
      'DOCUMENT_REQUIRED',
    );
    await ok('creator', cbm.id, { action: 'SUBMIT', uploads: [await upload('creator', 'CBM')] });
    expect((await act('mkt', cbm.id, { action: 'RETURN' })).json().error).toBe('COMMENT_REQUIRED');
    await ok('mkt', cbm.id, { action: 'RETURN', comment: 'Use 40ft containers' });
    await ok('creator', cbm.id, {
      action: 'SUBMIT',
      uploads: [await upload('creator', 'CBM', 'cbm-v2.pdf')],
    });
    await ok('mkt', cbm.id, { action: 'CONFIRM' });
    const d = await detail();
    expect(d.rounds.filter((r) => r.channel === 'CBM').map((r) => r.verdict)).toEqual([
      'RETURNED',
      'CONFIRMED',
    ]);
    expect(d.trackerB).toBeNull();
    const confirmed = await task('cbm_buyer_confirmed');
    await ok('mkt', confirmed.id, { action: 'LOG', date: new Date().toISOString().slice(0, 10) });
    expect((await detail()).trackerB).toMatchObject({ days: 0 });
  });

  it('the PI needs both versions and the products; a rejection returns it to the Creator and restarts the chain', async () => {
    const pi = await task('pi');
    expect(pi.holder?.slot).toBe('CREATOR');
    const missing = await act('creator', pi.id, {
      action: 'COMPLETE',
      products: ['Prod A'],
      uploads: [await upload('creator', 'PI_FULL')],
    });
    expect(missing.json().error).toBe('DOCUMENT_REQUIRED');
    await ok('creator', pi.id, {
      action: 'COMPLETE',
      products: ['Prod A', 'Prod B'],
      uploads: [await upload('creator', 'PI_FULL'), await upload('creator', 'PI_NO_RATES')],
    });
    let chain = await task('pi_approval');
    expect(chain).toMatchObject({ side: 'marketing', run: 1 });
    await ok('mkt', chain.id, { action: 'APPROVE' });
    chain = await task('pi_approval');
    expect(chain.side).toBe('approver');
    expect((await act('piAppr', chain.id, { action: 'REJECT' })).json().error).toBe(
      'COMMENT_REQUIRED',
    );
    await ok('piAppr', chain.id, { action: 'REJECT', comment: 'Rates for Prod B are wrong' });
    expect((await task('pi_approval')).status).toBe('WAITING');
    const again = await task('pi');
    expect(again).toMatchObject({ status: 'OPEN', holder: { slot: 'CREATOR' } });
    // Earlier files are kept; the Creator can resubmit without uploading again
    await ok('creator', again.id, {
      action: 'COMPLETE',
      products: ['Prod A', 'Prod B'],
      comment: 'Fixed rates',
    });
    chain = await task('pi_approval');
    expect(chain).toMatchObject({ status: 'OPEN', side: 'marketing', run: 2 });
    await ok('mkt', chain.id, { action: 'APPROVE' });
    await ok('piAppr', chain.id, { action: 'APPROVE' });
    await ok('head1', chain.id, { action: 'APPROVE' });
    expect((await task('pi_approval')).status).toBe('DONE');
  });

  it('Accounts verifies the advance: production starts (Tracker A) with three tracks per product', async () => {
    await ok('mkt', (await task('advance_requested')).id, { action: 'LOG' });
    const adv = await task('advance_verified');
    expect(adv.holder?.team).toBe('ACCOUNTS');
    expect((await act('acc', adv.id, { action: 'COMPLETE' })).json().error).toBe(
      'PAYMENT_REQUIRED',
    );
    await ok('acc', adv.id, {
      action: 'COMPLETE',
      payment: {
        receivedOn: new Date().toISOString().slice(0, 10),
        amount: '50000',
        currency: 'usd',
      },
    });
    const d = await detail();
    expect(d.trackerA).toMatchObject({ days: 0 });
    expect(d.payments[0]).toMatchObject({ kind: 'ADVANCE', amount: '50000.00', currency: 'USD' });
    const open = d.tasks
      .filter((t) => t.status === 'OPEN')
      .map((t) => `${t.stepKey}:${t.productName}`);
    expect(open.sort()).toEqual([
      'annexure:Prod A',
      'annexure:Prod B',
      'artwork:Prod A',
      'artwork:Prod B',
      'raw_material:Prod A',
      'raw_material:Prod B',
    ]);
    expect(d.tasks.find((t) => t.stepKey === 'raw_material')!.tag).toBe('RAW_MATERIAL');
    expect(d.tasks.find((t) => t.stepKey === 'annexure')!.tag).toBe('PACKAGING');
  });

  it('keeps the two PI versions apart (the server, not just the screen)', async () => {
    const reg = await detail('reg');
    expect(reg.documents.map((x) => x.kind)).toContain('PI_NO_RATES');
    expect(reg.documents.map((x) => x.kind)).not.toContain('PI_FULL');
    expect(reg.payments).toEqual([]);
    const full = (await detail()).documents.find((x) => x.kind === 'PI_FULL')!;
    expect((await as.reg!.get(`/v1/documents/${full.id}/file`)).statusCode).toBe(404);
    expect((await as.acc!.get(`/v1/documents/${full.id}/file`)).statusCode).toBe(200);
    const timeline = (await as.reg!.get(`/v1/orders/${orderId}/timeline`)).json();
    const docKinds = timeline
      .flatMap((e: { details: { documents?: { kind: string }[] } }) => e.details.documents ?? [])
      .map((x: { kind: string }) => x.kind);
    expect(docKinds).not.toContain('PI_FULL');
  });

  it('the dashboard lists team work oldest first, with tags to filter Materials work', async () => {
    const work = (await as.mat!.get('/v1/work')).json();
    expect(
      work.items.map((i: { title: string; productName: string }) => `${i.title}:${i.productName}`),
    ).toEqual(
      [
        'Order raw material:Prod A',
        'Packaging annexure:Prod A',
        'Order raw material:Prod B',
        'Packaging annexure:Prod B',
      ].sort(
        (a, b) =>
          work.items.findIndex(
            (i: { title: string; productName: string }) => `${i.title}:${i.productName}` === a,
          ) -
          work.items.findIndex(
            (i: { title: string; productName: string }) => `${i.title}:${i.productName}` === b,
          ),
      ),
    );
    expect(work.items).toHaveLength(4);
    const raw = (await as.mat!.get('/v1/work?tag=RAW_MATERIAL')).json();
    expect(raw.items.every((i: { tag: string }) => i.tag === 'RAW_MATERIAL')).toBe(true);
    expect(raw.items).toHaveLength(2);
    // Oldest first by default
    const times = work.items.map((i: { waitingSince: string }) => i.waitingSince);
    expect([...times].sort()).toEqual(times);
  });

  it('annexure and artwork loops run independently; packaging ordering opens only after both', async () => {
    const annexA = await task('annexure', 'Prod A');
    await ok('mat', annexA.id, { action: 'SUBMIT', uploads: [await upload('mat', 'ANNEXURE')] });
    // A second Materials member acting at once finds it has moved on: 409, not 403
    const late = await act('mat2', annexA.id, {
      action: 'SUBMIT',
      uploads: [await upload('mat2', 'ANNEXURE')],
    });
    expect(late.statusCode).toBe(409);
    expect((await act('design', annexA.id, { action: 'CONFIRM' })).statusCode).toBe(403);
    await ok('reg', annexA.id, { action: 'RETURN', comment: 'Batch number missing' });
    await ok('mat', annexA.id, { action: 'SUBMIT', uploads: [await upload('mat', 'ANNEXURE')] });
    // Someone in two teams acts as Regulation here
    await ok('multi', annexA.id, { action: 'CONFIRM' });
    expect((await detail()).tasks.some((t) => t.stepKey === 'packaging')).toBe(false);
    const artA = await task('artwork', 'Prod A');
    await ok('design', artA.id, { action: 'SUBMIT', uploads: [await upload('design', 'ARTWORK')] });
    await ok('reg', artA.id, { action: 'CONFIRM' });
    const packA = await task('packaging', 'Prod A');
    expect(packA).toMatchObject({
      status: 'OPEN',
      holder: { team: 'MATERIALS' },
      tag: 'PACKAGING',
    });
    // Product B
    for (const [step, who, kind] of [
      ['annexure', 'mat', 'ANNEXURE'],
      ['artwork', 'design', 'ARTWORK'],
    ] as const) {
      const t = await task(step, 'Prod B');
      await ok(who, t.id, { action: 'SUBMIT', uploads: [await upload(who, kind)] });
      await ok('reg', t.id, { action: 'CONFIRM' });
    }
    const d = await detail();
    expect(d.rounds.filter((r) => r.channel === 'ANNEXURE').length).toBe(3);
  });

  it('the component tables gate Production QA: every component of every product delivered', async () => {
    for (const product of ['Prod A', 'Prod B']) {
      await ok('mat', (await task('raw_material', product)).id, { action: 'COMPLETE' });
      await ok('mat', (await task('packaging', product)).id, { action: 'COMPLETE' });
    }
    const gate = await task('materials_delivered');
    expect(gate).toMatchObject({ status: 'OPEN', holder: null });
    const d = await detail();
    const [a, b] = d.products;
    // Only Materials edits
    const denied = await as.reg!.post(`/v1/orders/${orderId}/products/${a!.id}/components`, {
      name: 'x',
      kind: 'PACKAGING',
    });
    expect(denied.statusCode).toBe(403);
    const add = (productId: string, name: string, kind: string) =>
      as.mat!.post(`/v1/orders/${orderId}/products/${productId}/components`, {
        name,
        kind,
        poQuantity: '5,000',
        poDate: '2026-10-01',
      });
    const c1 = (await add(a!.id, 'Carton', 'PACKAGING')).json().id;
    const c2 = (await add(a!.id, 'API', 'RAW_MATERIAL')).json().id;
    const c3 = (await add(b!.id, 'Label', 'PACKAGING')).json().id;
    const today = new Date().toISOString().slice(0, 10);
    for (const id of [c1, c2]) {
      expect(
        (
          await as.mat!.put(`/v1/components/${id}`, {
            name: id === c1 ? 'Carton' : 'API',
            kind: id === c1 ? 'PACKAGING' : 'RAW_MATERIAL',
            deliverDate: today,
            tnsRemark: '2% extra',
          })
        ).statusCode,
      ).toBe(204);
    }
    expect((await task('materials_delivered')).status).toBe('OPEN');
    await as.mat!.put(`/v1/components/${c3}`, {
      name: 'Label',
      kind: 'PACKAGING',
      deliverDate: today,
      comment: 'Arrived today',
    });
    expect((await task('materials_delivered')).status).toBe('DONE');
    expect((await task('production_qa')).holder?.team).toBe('PRODUCTION');
    const history = (await as.reg!.get(`/v1/components/${c3}/history`)).json();
    expect(history[0]).toMatchObject({
      field: 'deliverDate',
      newValue: today,
      comment: 'Arrived today',
      actorName: 'mat',
    });
    const tables = (await as.prod!.get(`/v1/orders/${orderId}/components`)).json();
    expect(
      tables.products.map((p: { delivered: number; total: number }) => `${p.delivered}/${p.total}`),
    ).toEqual(['2/2', '1/1']);
  });

  it('Production QA returns work to Materials, then hands over to Logistics; edits close after', async () => {
    const qa = await task('production_qa');
    expect(
      (await act('prod', qa.id, { action: 'RETURN', comment: 'Cartons damaged' })).json().error,
    ).toBe('TARGET_REQUIRED');
    await ok('prod', qa.id, { action: 'RETURN', comment: 'Cartons damaged', toTeam: 'MATERIALS' });
    expect((await task('production_qa')).holder?.team).toBe('MATERIALS');
    await ok('mat', qa.id, { action: 'SUBMIT', comment: 'Replaced 200 cartons' });
    await ok('prod', qa.id, { action: 'CONFIRM' });
    const d = await detail('mat');
    expect(d.canEditComponents).toBe(false);
    expect(
      d.rounds.filter((r) => r.channel === 'PRODUCTION_QA').map((r) => r.returnedToTeam),
    ).toEqual(['MATERIALS', null]);
    expect((await task('container')).holder?.team).toBe('LOGISTICS');
  });

  it('Phase 3: two separate loops, the payment check (restart on rejection, ANY gate), then sailing', async () => {
    const container = await task('container');
    expect((await act('logi', container.id, { action: 'SUBMIT' })).json().error).toBe(
      'COMMENT_REQUIRED',
    );
    await ok('logi', container.id, { action: 'SUBMIT', comment: '2 × 40ft HC' });
    await ok('mkt', container.id, { action: 'CONFIRM' });
    const invoice = await task('invoice');
    await ok('logi', invoice.id, { action: 'SUBMIT', uploads: [await upload('logi', 'INVOICE')] });
    await ok('mkt', invoice.id, { action: 'RETURN', comment: 'Wrong HS code' });
    await ok('logi', invoice.id, { action: 'SUBMIT', uploads: [await upload('logi', 'INVOICE')] });
    await ok('mkt', invoice.id, { action: 'CONFIRM' });
    await ok('mkt', (await task('balance_requested')).id, { action: 'LOG' });
    let pay = await task('payment_check');
    expect(pay.holder?.team).toBe('ACCOUNTS');
    const payment = {
      receivedOn: new Date().toISOString().slice(0, 10),
      amount: '150000',
      currency: 'USD',
    };
    await ok('acc', pay.id, { action: 'APPROVE', payment });
    await ok('mkt', pay.id, { action: 'APPROVE' });
    await ok('payAppr', pay.id, { action: 'REJECT', comment: 'Short by 2,000' });
    pay = await task('payment_check');
    expect(pay).toMatchObject({ side: 'accounts', run: 2, holder: { team: 'ACCOUNTS' } });
    await ok('acc', pay.id, { action: 'APPROVE', payment: { ...payment, amount: '2000' } });
    await ok('mkt', pay.id, { action: 'APPROVE' });
    await ok('payAppr', pay.id, { action: 'APPROVE' });
    // ANY: two Head Approvers approving at the same instant advance the chain exactly once
    const results = await Promise.all([
      act('head1', pay.id, { action: 'APPROVE' }),
      act('head2', pay.id, { action: 'APPROVE' }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([204, 409]);
    expect((await task('payment_check')).status).toBe('DONE');
    const chainEvents = (await as.admin!.get(`/v1/orders/${orderId}/timeline`))
      .json()
      .filter(
        (e: { type: string; stepKey: string }) =>
          e.type === 'CHAIN_APPROVED' && e.stepKey === 'payment_check',
      );
    expect(chainEvents).toHaveLength(1);
    expect((await task('sailed')).holder?.team).toBe('LOGISTICS');
    expect(await task('bol_requested').catch(() => null)).toBeNull();
  });

  it('after sailing: updates any time, the BoL only when the buyer asks, approval (ALL), sent, delivered', async () => {
    await ok('logi', (await task('sailed')).id, { action: 'LOG' });
    const tracking = await task('tracking');
    await ok('logi', tracking.id, {
      action: 'CHECKPOINT',
      shipmentStatus: 'IN_TRANSIT',
      comment: 'Left Nhava Sheva',
    });
    await ok('logi', tracking.id, {
      action: 'CHECKPOINT',
      shipmentStatus: 'DELAYED',
      comment: 'Port congestion, 3 days',
    });
    await ok('logi', (await task('bol_requested')).id, { action: 'LOG' });
    const bol = await task('bol');
    await ok('logi', bol.id, { action: 'COMPLETE', uploads: [await upload('logi', 'BOL')] });
    let approval = await task('bol_approval');
    await ok('acc', approval.id, { action: 'APPROVE' });
    await ok('mkt', approval.id, { action: 'APPROVE' });
    await ok('bolAppr', approval.id, { action: 'REJECT', comment: 'Consignee address wrong' });
    expect((await task('bol')).holder?.team).toBe('LOGISTICS');
    await ok('logi', bol.id, {
      action: 'COMPLETE',
      uploads: [await upload('logi', 'BOL', 'bol-v2.pdf')],
    });
    approval = await task('bol_approval');
    expect(approval.run).toBe(2);
    await ok('acc', approval.id, { action: 'APPROVE' });
    await ok('mkt', approval.id, { action: 'APPROVE' });
    await ok('bolAppr', approval.id, { action: 'APPROVE' });
    // ALL: both Head Approvers at once: both votes count, one advance
    const both = await Promise.all([
      act('head1', approval.id, { action: 'APPROVE' }),
      act('head2', approval.id, { action: 'APPROVE' }),
    ]);
    expect(both.map((r) => r.statusCode)).toEqual([204, 204]);
    expect((await task('bol_approval')).status).toBe('DONE');
    await ok('logi', (await task('bol_sent')).id, { action: 'LOG' });
    expect((await detail()).status).toBe('NO_ACTION_NEEDED');
    // Updates still allowed while waiting for delivery
    await ok('logi', tracking.id, { action: 'CHECKPOINT', shipmentStatus: 'OUT_FOR_DELIVERY' });
    expect((await act('mkt', (await task('delivered')).id, { action: 'CLOSE' })).statusCode).toBe(
      403,
    );
    await ok('logi', (await task('delivered')).id, { action: 'CLOSE' });
    const d = await detail();
    expect(d.status).toBe('DONE');
    expect(d.tasks.find((t) => t.stepKey === 'tracking')!.status).toBe('DONE');
    expect(d.checkpoints.map((c) => c.status)).toEqual([
      'IN_TRANSIT',
      'DELAYED',
      'OUT_FOR_DELIVERY',
    ]);
    expect(d.tasks.filter((t) => t.status === 'OPEN')).toEqual([]);
  });

  it('the timeline records everything with actor, role and comment, and is append-only', async () => {
    const events = (await as.admin!.get(`/v1/orders/${orderId}/timeline`)).json();
    const returned = events.filter((e: { type: string }) => e.type === 'RETURNED');
    expect(returned.length).toBe(4);
    expect(returned[0]).toMatchObject({
      actorName: 'mkt',
      actingAs: 'MARKETING',
      comment: 'Use 40ft containers',
    });
    await expect(
      db.execute(sql`delete from order_events where order_id = ${orderId}`),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) } });
    // Closed orders take no more actions
    const anyTask = (await detail()).tasks[0]!;
    expect((await act('creator', anyTask.id, { action: 'SUBMIT' })).statusCode).toBe(409);
  });
});
