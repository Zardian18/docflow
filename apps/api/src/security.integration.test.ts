import type { OrderDetail } from '@docflow/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db/client.js';
import { DEMO_PASSWORD, demoEmail, seedDemo } from './demo/seed.js';
import { MemoryStorage } from './storage/memory.js';
import { Client, createEmployee, resetDb, setupTestDb, TEST_DB_URL, testApp } from './test-db.js';

const PDF = 'application/pdf';
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(55, 0x20)]);

/** The security review's findings (D33), each pinned by a test, on the demo data */
describe.skipIf(!TEST_DB_URL)('security review fixes (D33)', () => {
  let db: Db;
  let end: () => Promise<void>;
  let app: Awaited<ReturnType<typeof testApp>>;
  const storage = new MemoryStorage();
  const as: Record<string, Client> = {};
  const people = ['admin', 'rohan', 'nisha', 'kabir', 'lina', 'imran', 'tara', 'pooja'];

  beforeAll(async () => {
    const setup = await setupTestDb();
    db = setup.db;
    end = () => setup.pool.end();
    app = await testApp(db, {}, storage);
    await resetDb(db);
    await seedDemo(db, storage);
    for (const who of people) as[who] = await new Client(app).login(demoEmail(who), DEMO_PASSWORD);
  }, 180_000);
  afterAll(async () => {
    await app.close();
    await end();
  });

  const one = async <T>(query: ReturnType<typeof sql>) =>
    (await db.execute<T & Record<string, unknown>>(query)).rows[0]!;
  const orderId = async (ref: string) =>
    (await one<{ id: string }>(sql`select id from orders where ref = ${ref}`)).id;
  const detail = async (who: string, id: string): Promise<OrderDetail> => {
    const res = await as[who]!.get(`/v1/orders/${id}`);
    expect(res.statusCode, `${who}: ${res.body}`).toBe(200);
    return res.json();
  };
  const upload = async (who: string, name = 'file.pdf') => {
    const res = await as[who]!.post('/v1/uploads/presign', {
      fileName: name,
      contentType: PDF,
      size: pdf.length,
    });
    expect(res.statusCode, res.body).toBe(200);
    const { uploadId } = res.json();
    const { object_key } = await one<{ object_key: string }>(
      sql`select object_key from uploads where id = ${uploadId}`,
    );
    storage.upload(object_key, pdf, PDF);
    return uploadId as string;
  };

  it('the order list shows Marketing alone nothing of Phase 2, not even by filtering (F1)', async () => {
    const list = async (who: string, query = '') =>
      (await as[who]!.get(`/v1/orders?pageSize=100${query}`)).json().items as Array<{
        id: string;
        current: string[];
      }>;
    const loops = await orderId('TPE/PI/26-27/0043');
    const phase2 = ['Order raw material', 'Packaging annexure', 'Artwork', 'Production QA'];
    // Materials sees where the order stands; Marketing alone sees no Phase 2 step
    expect((await list('kabir')).find((o) => o.id === loops)!.current).toEqual(
      expect.arrayContaining(['Packaging annexure']),
    );
    for (const o of await list('rohan')) {
      expect(
        o.current.filter((t) => phase2.includes(t)),
        o.id,
      ).toEqual([]);
    }
    expect(await list('rohan', '&stepKey=annexure')).toEqual([]);
    expect((await list('kabir', '&stepKey=annexure')).map((o) => o.id)).toContain(loops);
  });

  it('an order someone can’t see is a 404 for cancelling and for its tasks, before any file work (F2)', async () => {
    // Regulation joins in Phase 2; this order is still at the CBM
    const { id, task } = await one<{ id: string; task: string }>(sql`
      select o.id, t.id as task from orders o join tasks t on t.order_id = o.id
       where t.step_key = 'cbm' and t.status = 'OPEN' order by o.number limit 1`);
    expect((await as.lina!.get(`/v1/orders/${id}`)).statusCode).toBe(404);
    expect((await as.lina!.post(`/v1/orders/${id}/cancel`, { reason: 'x' })).statusCode).toBe(404);
    const files = () => [...storage.objects.keys()].filter((k) => k.startsWith(`documents/${id}/`));
    const before = files().length;
    const acted = await as.lina!.post(`/v1/tasks/${task}/actions`, {
      action: 'CONFIRM',
      uploads: [{ uploadId: await upload('lina'), kind: 'CBM' }],
    });
    expect(acted.statusCode).toBe(404);
    // No copy of the file was made under documents/
    expect(files()).toHaveLength(before);
  });

  it('a file sent with an action that doesn’t keep it is refused, not silently lost (F5)', async () => {
    const loops = await orderId('TPE/PI/26-27/0043');
    const annexure = (await detail('lina', loops)).tasks.find(
      (t) => t.stepKey === 'annexure' && t.actions.includes('CONFIRM'),
    )!;
    const res = await as.lina!.post(`/v1/tasks/${annexure.id}/actions`, {
      action: 'CONFIRM',
      uploads: [{ uploadId: await upload('lina'), kind: 'ANNEXURE' }],
    });
    expect(res.json().error).toBe('DOC_NOT_EXPECTED');
    expect((await detail('lina', loops)).tasks.find((t) => t.id === annexure.id)!.status).toBe(
      'OPEN',
    );
  });

  it('one person can’t pile up unlimited unsent uploads (F5)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 41; i++) {
      statuses.push(
        (
          await as.tara!.post('/v1/uploads/presign', {
            fileName: `f${i}.pdf`,
            contentType: PDF,
            size: pdf.length,
          })
        ).statusCode,
      );
    }
    expect(statuses.slice(0, 40).every((s) => s === 200)).toBe(true);
    expect(statuses[40]).toBe(429);
    await db.execute(sql`delete from uploads`);
  });

  it('a payment proof is accepted only on the stage that records the payment (F12)', async () => {
    const pay = await orderId('THC/PI/26-27/0052');
    const check = (await detail('nisha', pay)).tasks.find((t) => t.stepKey === 'payment_check')!;
    expect(check.side).toBe('marketing');
    const res = await as.nisha!.post(`/v1/tasks/${check.id}/actions`, {
      action: 'APPROVE',
      uploads: [{ uploadId: await upload('nisha'), kind: 'PAYMENT_PROOF' }],
    });
    expect(res.json().error).toBe('DOC_NOT_EXPECTED');
  });

  it('notices show only while the order and the message are open to the person (F7)', async () => {
    const pi = await orderId('TPE/PI/26-27/0050');
    // Logistics was tagged while the order was still in Phase 1, which Logistics can't see
    const stored = await one<{ n: number }>(sql`
      select count(*)::int as n from notices n join employees e on e.id = n.employee_id
       where e.email = ${demoEmail('imran')} and n.order_id = ${pi}`);
    expect(stored.n).toBeGreaterThan(0);
    expect((await as.imran!.get(`/v1/orders/${pi}`)).statusCode).toBe(404);
    const notices = async (who: string) =>
      (await as[who]!.get('/v1/work')).json().notices as Array<{ orderId: string }>;
    expect((await notices('imran')).some((n) => n.orderId === pi)).toBe(false);
    // Tara is in Accounts too, which sees Phase 1, so hers still shows
    expect((await notices('tara')).some((n) => n.orderId === pi)).toBe(true);
    // Every notice anyone gets opens an order they can see
    for (const who of people) {
      for (const n of await notices(who)) {
        expect((await as[who]!.get(`/v1/orders/${n.orderId}`)).statusCode, who).toBe(200);
      }
    }
  });

  it('only Admin deletes a buyer; Marketing can still add one (F8)', async () => {
    const created = await as.rohan!.post('/v1/buyers', { name: 'Test Buyer F8', isActive: true });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    expect((await as.rohan!.del(`/v1/buyers/${id}`)).statusCode).toBe(403);
    expect((await as.admin!.del(`/v1/buyers/${id}`)).statusCode).toBe(204);
  });

  it('the share picker gives names only, and answers are never cached (F10, F11)', async () => {
    const loops = await orderId('TPE/PI/26-27/0043');
    const res = await as.lina!.get(`/v1/orders/${loops}/share-candidates?q=a`);
    expect(res.headers['cache-control']).toBe('no-store');
    const people = res.json() as Array<Record<string, unknown>>;
    expect(people.length).toBeGreaterThan(0);
    for (const p of people) expect(Object.keys(p).sort()).toEqual(['id', 'name']);
  });

  it('two Admins removing each other at once can’t leave no Admin (F4)', async () => {
    await createEmployee(db, {
      name: 'Second Admin',
      email: 'admin2@t.co',
      capabilities: ['ADMIN'],
    });
    const second = await new Client(app).login('admin2@t.co');
    const ids = Object.fromEntries(
      (
        await db.execute<{ id: string; email: string }>(
          sql`select id, email from employees where email in (${demoEmail('admin')}, 'admin2@t.co')`,
        )
      ).rows.map((r) => [r.email, r.id]),
    );
    const demote = (client: Client, email: string, name: string) =>
      client.put(`/v1/employees/${ids[email]}`, {
        name,
        email,
        employeeCode: null,
        teams: ['REGULATION'],
        capabilities: [],
        isActive: true,
      });
    const results = await Promise.all([
      demote(as.admin!, 'admin2@t.co', 'Second Admin'),
      demote(second, demoEmail('admin'), 'Anita Mehta'),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().error).toBe('LAST_ADMIN');
    const { n } = await one<{ n: number }>(sql`
      select count(*)::int as n from employee_capabilities c join employees e on e.id = c.employee_id
       where c.capability = 'ADMIN' and e.is_active`);
    expect(n).toBe(1);
  });
});
