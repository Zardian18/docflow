import type { OrderDetail } from '@docflow/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db/client.js';
import { DEMO_PASSWORD, demoEmail, seedDemo } from './demo/seed.js';
import { MemoryStorage } from './storage/memory.js';
import { Client, createEmployee, resetDb, setupTestDb, TEST_DB_URL, testApp } from './test-db.js';

const PDF = 'application/pdf';
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(55, 0x20)]);

/**
 * D29 on the demo data: private messages (who sees them, notices), Phase 2 hidden from
 * Marketing alone, and the payment proof kept to Accounts and the approvers.
 */
describe.skipIf(!TEST_DB_URL)('private messages, Phase 2 privacy, payment proof (D29)', () => {
  let db: Db;
  let end: () => Promise<void>;
  let app: Awaited<ReturnType<typeof testApp>>;
  const storage = new MemoryStorage();
  const as: Record<string, Client> = {};
  const ids: Record<string, string> = {};
  const people = [
    'admin',
    'rohan',
    'nisha',
    'rahul',
    'priya',
    'arjun',
    'vikram',
    'meera',
    'lina',
    'kabir',
    'ananya',
    'farhan',
    'pooja',
    'tara',
  ];

  beforeAll(async () => {
    const setup = await setupTestDb();
    db = setup.db;
    end = () => setup.pool.end();
    app = await testApp(db, {}, storage);
    await resetDb(db);
    await seedDemo(db, storage);
    for (const who of people) as[who] = await new Client(app).login(demoEmail(who), DEMO_PASSWORD);
    const { rows } = await db.execute<{ id: string; email: string }>(
      sql`select id, email from employees`,
    );
    for (const r of rows) ids[r.email.split('@')[0]!] = r.id;
    // Marketing and Design at once: Design is part of Phase 2
    await createEmployee(db, {
      name: 'Mira Both',
      email: 'mira@t.co',
      teams: ['DESIGN'],
      capabilities: ['MARKETING'],
    });
    as.mira = await new Client(app).login('mira@t.co');
    // An Approver by role, not named on any order, and Marketing + Approver at once (D30)
    await createEmployee(db, { name: 'Ravi Role', email: 'ravi@t.co', capabilities: ['APPROVER'] });
    as.ravi = await new Client(app).login('ravi@t.co');
    await createEmployee(db, {
      name: 'Mohan Mix',
      email: 'mohan@t.co',
      capabilities: ['MARKETING', 'HEAD_APPROVER'],
    });
    as.mohan = await new Client(app).login('mohan@t.co');
  }, 180_000);
  afterAll(async () => {
    await app.close();
    await end();
  });

  const orderId = async (ref: string) => {
    const { rows } = await db.execute<{ id: string }>(
      sql`select id from orders where ref = ${ref}`,
    );
    return rows[0]!.id;
  };
  const detail = async (who: string, id: string): Promise<OrderDetail> => {
    const res = await as[who]!.get(`/v1/orders/${id}`);
    expect(res.statusCode, `${who}: ${res.body}`).toBe(200);
    return res.json();
  };
  const timeline = async (who: string, id: string) =>
    (await as[who]!.get(`/v1/orders/${id}/timeline`)).json() as Array<{
      type: string;
      stepKey: string | null;
      comment: string | null;
      privateTo: string[] | null;
    }>;
  const secret = 'Batch format still wrong (private)';

  it('Phase 2 is one line for Marketing alone: no steps, no tables, only "materials complete"', async () => {
    const qa = await orderId('TPE/PI/26-27/0045');
    const rohan = await detail('rohan', qa);
    expect(rohan.hiddenPhases).toEqual([2]);
    expect(rohan.tasks.filter((t) => t.phase === 2)).toEqual([]);
    expect(rohan.rounds.filter((r) => r.channel === 'ANNEXURE')).toEqual([]);
    expect(rohan.canSeeComponents).toBe(false);
    expect((await as.rohan!.get(`/v1/orders/${qa}/components`)).statusCode).toBe(404);
    const events = await timeline('rohan', qa);
    expect(
      events.some((e) => e.type === 'GATE_PASSED' && e.stepKey === 'materials_delivered'),
    ).toBe(true);
    expect(events.some((e) => e.type.startsWith('COMPONENT_'))).toBe(false);
    expect(events.some((e) => e.stepKey === 'raw_material' || e.stepKey === 'annexure')).toBe(
      false,
    );
    // Phase 1 comments are open to everyone (D29 replaces D28)
    expect(
      (await detail('lina', qa)).rounds.some((r) => r.channel === 'CBM' && r.verdictComment),
    ).toBe(true);
    // Marketing who is also in Design, approvers and Admin see Phase 2 in full
    for (const who of ['mira', 'priya', 'admin', 'kabir']) {
      const d = await detail(who, qa);
      expect(d.hiddenPhases, who).toEqual([]);
      expect(
        d.tasks.some((t) => t.phase === 2),
        who,
      ).toBe(true);
    }
  });

  it('a private send-back reaches only its audience, even into a hidden phase', async () => {
    const loops = await orderId('TPE/PI/26-27/0043');
    const annexure = (await detail('lina', loops)).tasks.find(
      (t) => t.stepKey === 'annexure' && t.actions.includes('RETURN'),
    )!;
    const res = await as.lina!.post(`/v1/tasks/${annexure.id}/actions`, {
      action: 'RETURN',
      comment: secret,
      privateTo: { employeeIds: [ids.rohan], teams: [] },
    });
    expect(res.statusCode, res.body).toBe(204);

    const verdictOf = (d: OrderDetail) =>
      d.rounds.find((r) => r.taskId === annexure.id && r.verdictComment === secret);
    // In it: the writer, Materials (gets the work back), the tagged Marketing person, the
    // approvers and Head Approvers, Admin
    for (const who of ['lina', 'kabir', 'rohan', 'priya', 'vikram', 'admin']) {
      const d = await detail(who, loops);
      expect(verdictOf(d), who).toMatchObject({ verdictPrivateTo: ['Rohan Kapoor'] });
      const e = (await timeline(who, loops)).find((x) => x.comment === secret);
      expect(e, who).toMatchObject({ type: 'RETURNED', privateTo: ['Rohan Kapoor'] });
    }
    // Not in it: nothing at all, not even that something was returned
    for (const who of ['ananya', 'farhan', 'mira']) {
      const d = await detail(who, loops);
      expect(verdictOf(d), who).toBeUndefined();
      expect(
        d.rounds.some((r) => r.taskId === annexure.id && r.verdictComment === null && r.verdict),
        who,
      ).toBe(false);
      expect(
        (await timeline(who, loops)).some((x) => x.comment === secret),
        who,
      ).toBe(false);
    }
  });

  it('the tagged people and the approvers get a notice, the writer none', async () => {
    const notices = async (who: string) =>
      (
        (await as[who]!.get('/v1/work')).json().notices as Array<{
          id: string;
          kind: string;
          comment: string | null;
          actorName: string;
        }>
      ).filter((n) => n.comment === secret);
    for (const who of ['rohan', 'priya', 'arjun', 'vikram', 'meera']) {
      expect(await notices(who), who).toMatchObject([
        { kind: 'PRIVATE_MESSAGE', actorName: 'Lina Fernandes' },
      ]);
    }
    for (const who of ['lina', 'ananya', 'farhan']) expect(await notices(who), who).toEqual([]);
    const [mine] = await notices('rohan');
    expect((await as.ananya!.post(`/v1/notices/${mine!.id}/read`)).statusCode).toBe(404);
    expect((await as.rohan!.post(`/v1/notices/${mine!.id}/read`)).statusCode).toBe(204);
    expect(await notices('rohan')).toEqual([]);
  });

  it('the payment proof: Accounts and the approvers only, with a notice for the approvers', async () => {
    const advance = await orderId('THC/PI/26-27/0042');
    const task = (await detail('pooja', advance)).tasks.find(
      (t) => t.stepKey === 'advance_verified',
    )!;
    const presign = await as.pooja!.post('/v1/uploads/presign', {
      fileName: 'receipt.pdf',
      contentType: PDF,
      size: pdf.length,
    });
    const { uploadId } = presign.json();
    const { rows } = await db.execute<{ object_key: string }>(
      sql`select object_key from uploads where id = ${uploadId}`,
    );
    storage.upload(rows[0]!.object_key, pdf, PDF);
    const res = await as.pooja!.post(`/v1/tasks/${task.id}/actions`, {
      action: 'COMPLETE',
      payment: {
        receivedOn: new Date().toISOString().slice(0, 10),
        amount: '2500000',
        currency: 'INR',
      },
      uploads: [{ uploadId, kind: 'PAYMENT_PROOF' }],
    });
    expect(res.statusCode, res.body).toBe(204);
    const hasProof = async (who: string) =>
      (await detail(who, advance)).documents.some((d) => d.kind === 'PAYMENT_PROOF');
    for (const who of ['pooja', 'tara', 'priya', 'arjun', 'meera', 'admin']) {
      expect(await hasProof(who), who).toBe(true);
    }
    for (const who of ['nisha', 'rahul']) expect(await hasProof(who), who).toBe(false);
    for (const who of ['priya', 'arjun', 'meera', 'vikram']) {
      const n = (await as[who]!.get('/v1/work')).json().notices as Array<{ kind: string }>;
      expect(
        n.some((x) => x.kind === 'PAYMENT_PROOF'),
        who,
      ).toBe(true);
    }
  });

  it('Approvers and Head Approvers see everything, by role (D30)', async () => {
    const { rows } = await db.execute<{ n: number }>(sql`select count(*)::int as n from orders`);
    for (const who of ['ravi', 'mohan']) {
      const list = (await as[who]!.get('/v1/orders?pageSize=50')).json();
      expect(list.total, who).toBe(rows[0]!.n);
    }
    const qa = await orderId('TPE/PI/26-27/0045');
    for (const who of ['ravi', 'mohan']) {
      const d = await detail(who, qa);
      expect(d, who).toMatchObject({ hiddenPhases: [], canSeeComponents: true, poAccess: 'VIEW' });
      expect(
        d.tasks.some((t) => t.phase === 2),
        who,
      ).toBe(true);
      const tables = (await as[who]!.get(`/v1/orders/${qa}/components`)).json();
      const po = tables.products[0].components[0].po;
      expect(po, who).toMatchObject({ kind: 'PO' });
      expect((await as[who]!.get(`/v1/documents/${po.id}/file`)).statusCode, who).toBe(200);
    }
    // The secret send-back from earlier: approvers by role read it too
    const loops = await orderId('TPE/PI/26-27/0043');
    expect((await timeline('ravi', loops)).some((e) => e.comment === secret)).toBe(true);
    // Admin sees the order but not the POs
    const admin = await detail('admin', qa);
    expect(admin.poAccess).toBe('NONE');
    const adminTables = (await as.admin!.get(`/v1/orders/${qa}/components`)).json();
    expect(adminTables.products[0].components[0]).toMatchObject({ po: null, hasPo: true });
  });

  it('Materials can attach POs, and nothing goes to Production until every component has one', async () => {
    const delivery = await orderId('THC/PI/26-27/0044');
    expect((await detail('kabir', delivery)).poAccess).toBe('UPLOAD');
    // A component added late, complete in every field but without its PO
    const product = (await detail('kabir', delivery)).products[0]!;
    const today = new Date().toISOString().slice(0, 10);
    const added = await as.kabir!.post(`/v1/orders/${delivery}/products/${product.id}/components`, {
      name: 'Desiccant sachet',
      kind: 'PACKAGING',
      poDate: today,
      dispatchDate: today,
      deliverDate: today,
      challanNo: 'CH-1',
      lrDetails: 'LR-1',
    });
    expect(added.statusCode, added.body).toBe(201);
    const late = added.json().id as string;
    // Deliver the one component still on the way
    let tables = (await as.kabir!.get(`/v1/orders/${delivery}/components`)).json();
    const waiting = tables.products
      .flatMap((p: { components: Array<Record<string, unknown>> }) => p.components)
      .find((c: { status: string }) => c.status === 'DISPATCHED');
    const put = await as.kabir!.put(`/v1/components/${waiting.id}`, {
      ...waiting,
      deliverDate: today,
      comment: null,
    });
    expect(put.statusCode, put.body).toBe(204);
    const gate = async () =>
      (await detail('admin', delivery)).tasks.find((t) => t.stepKey === 'materials_delivered')!
        .status;
    expect(await gate()).toBe('OPEN');
    // Only Materials attaches POs
    const presign = async (who: string) => {
      const res = await as[who]!.post('/v1/uploads/presign', {
        fileName: 'po.pdf',
        contentType: PDF,
        size: pdf.length,
      });
      const { uploadId } = res.json();
      const r = await db.execute<{ object_key: string }>(
        sql`select object_key from uploads where id = ${uploadId}`,
      );
      storage.upload(r.rows[0]!.object_key, pdf, PDF);
      return uploadId as string;
    };
    expect(
      (await as.ravi!.post(`/v1/components/${late}/po`, { uploadId: await presign('ravi') }))
        .statusCode,
    ).toBe(403);
    const ok = await as.kabir!.post(`/v1/components/${late}/po`, {
      uploadId: await presign('kabir'),
    });
    expect(ok.statusCode, ok.body).toBe(204);
    expect(await gate()).toBe('DONE');
    tables = (await as.kabir!.get(`/v1/orders/${delivery}/components`)).json();
    expect(tables.products[0].components.find((c: { id: string }) => c.id === late).hasPo).toBe(
      true,
    );
  });
});
