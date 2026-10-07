import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db/client.js';
import { MemoryStorage } from './storage/memory.js';
import { Client, createEmployee, resetDb, setupTestDb, TEST_DB_URL, testApp } from './test-db.js';

const PDF = 'application/pdf';
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(55, 0x20)]);

describe.skipIf(!TEST_DB_URL)('Admin dashboard (URS §5.8)', () => {
  let db: Db;
  let end: () => Promise<void>;
  let app: Awaited<ReturnType<typeof testApp>>;
  let storage: MemoryStorage;
  let admin: Client;
  let ids: Record<string, string>;
  let co: Record<string, string>;
  let wf: Record<string, string>;

  beforeAll(async () => {
    const setup = await setupTestDb();
    db = setup.db;
    end = () => setup.pool.end();
    storage = new MemoryStorage();
    app = await testApp(db, {}, storage);

    // One fixed data set for every test in this file (read-only checks)
    await resetDb(db);
    ids = {
      admin: await createEmployee(db, { name: 'Admin', email: 'admin@t.co', permission: 'ADMIN' }),
      c1: await createEmployee(db, {
        name: 'Carla Creator',
        email: 'c1@t.co',
        permission: 'CREATOR',
      }),
      c2: await createEmployee(db, {
        name: 'Dev Creator',
        email: 'c2@t.co',
        permission: 'CREATOR',
      }),
      a: await createEmployee(db, { name: 'Ann', email: 'a@t.co', permission: 'APPROVER' }),
      b: await createEmployee(db, { name: 'Bob', email: 'b@t.co', permission: 'APPROVER' }),
      cfo: await createEmployee(db, { name: 'Vee CFO', email: 'cfo@t.co', permission: 'CFO' }),
    };
    admin = await new Client(app).login('admin@t.co');
    const chain = [
      { employeeId: ids.a, position: 1 },
      { employeeId: ids.b, position: 2 },
    ];
    co = {
      acme: (
        await admin.post('/v1/companies', { name: 'Acme', code: 'ACM', approvers: chain })
      ).json().id,
      zen: (
        await admin.post('/v1/companies', { name: 'Zenith', code: 'ZEN', approvers: chain })
      ).json().id,
    };
    const people: Record<string, Client> = {};
    for (const [who, email] of Object.entries({
      c1: 'c1@t.co',
      c2: 'c2@t.co',
      a: 'a@t.co',
      b: 'b@t.co',
      cfo: 'cfo@t.co',
    })) {
      people[who] = await new Client(app).login(email);
    }

    async function submit(
      creator: string,
      company: string,
      fileName: string,
      extra: Record<string, unknown> = {},
    ) {
      const c = people[creator]!;
      const { uploadId } = (
        await c.post('/v1/uploads/presign', { fileName, contentType: PDF, size: pdf.length })
      ).json();
      const { rows } = await db.execute<{ object_key: string }>(
        sql`select object_key from uploads where id = ${uploadId}`,
      );
      storage.upload(rows[0]!.object_key, pdf, PDF);
      const res = await c.post('/v1/workflows', {
        uploadId,
        companyId: co[company],
        approvers: chain,
        ...extra,
      });
      return res.json().id as string;
    }
    const decide = (who: string, id: string, decision: 'APPROVE' | 'REJECT', remarks?: string) =>
      people[who]!.post(`/v1/workflows/${id}/decision`, {
        decision,
        ...(remarks ? { remarks } : {}),
      });

    wf = {
      pending1: await submit('c1', 'acme', 'Q3_Invoice.pdf', {
        invoiceNumber: 'INV-100',
        vendorName: 'Globex',
      }),
      pending2: await submit('c1', 'zen', 'Lease_Agreement.pdf'),
      cfo: await submit('c2', 'acme', 'Purchase_Order.pdf'),
      done: await submit('c2', 'zen', 'Budget.pdf'),
      rejected: await submit('c1', 'acme', 'NDA.pdf', { vendorName: '50%_off Ltd' }),
    };
    await decide('a', wf.pending2!, 'APPROVE');
    await decide('a', wf.cfo!, 'APPROVE');
    await decide('b', wf.cfo!, 'APPROVE');
    await decide('a', wf.done!, 'APPROVE');
    await decide('b', wf.done!, 'APPROVE');
    await decide('cfo', wf.done!, 'APPROVE');
    await decide('a', wf.rejected!, 'REJECT', 'Unsigned');

    // Spread submission dates: 1st, 5th, 10th, 15th, 20th of September 2026 (UTC noon)
    const days = { pending1: 1, pending2: 5, cfo: 10, done: 15, rejected: 20 };
    for (const [key, day] of Object.entries(days)) {
      await db.execute(
        sql`update workflows set submitted_at = ${new Date(Date.UTC(2026, 8, day, 12))} where id = ${wf[key]}`,
      );
    }
  });
  afterAll(async () => {
    await app.close();
    await end();
  });
  beforeEach(() => undefined);

  const list = async (params: Record<string, string | number> = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]),
    ).toString();
    const res = await admin.get(`/v1/admin/workflows?${qs}`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { items: Array<{ id: string; fileName: string }>; total: number };
  };
  const names = async (params: Record<string, string | number> = {}) =>
    (await list(params)).items.map((i) => i.fileName);

  it('lists every document, newest submitted first, with the dashboard columns', async () => {
    const all = await list();
    expect(all.total).toBe(5);
    expect(all.items.map((i) => i.fileName)).toEqual([
      'NDA.pdf',
      'Budget.pdf',
      'Purchase_Order.pdf',
      'Lease_Agreement.pdf',
      'Q3_Invoice.pdf',
    ]);
    expect(all.items.find((i) => i.fileName === 'Q3_Invoice.pdf')).toMatchObject({
      companyName: 'Acme',
      createdByName: 'Carla Creator',
      status: 'PENDING_APPROVER',
      currentPosition: 1,
      currentWith: ['Ann'],
      invoiceNumber: 'INV-100',
    });
  });

  it('stats count every status (screen 02 cards)', async () => {
    expect((await admin.get('/v1/admin/workflows/stats')).json()).toEqual({
      total: 5,
      pendingApprover: 2,
      pendingCfo: 1,
      completed: 1,
      rejected: 1,
    });
  });

  describe('filters', () => {
    it('status, including "pending at position N"', async () => {
      expect((await names({ status: 'PENDING_APPROVER' })).sort()).toEqual([
        'Lease_Agreement.pdf',
        'Q3_Invoice.pdf',
      ]);
      expect(await names({ status: 'PENDING_APPROVER', position: 2 })).toEqual([
        'Lease_Agreement.pdf',
      ]);
      expect(await names({ status: 'PENDING_CFO' })).toEqual(['Purchase_Order.pdf']);
      expect(await names({ status: 'COMPLETED' })).toEqual(['Budget.pdf']);
      expect(await names({ status: 'REJECTED' })).toEqual(['NDA.pdf']);
    });

    it('a position without the pending-approver status is refused', async () => {
      expect((await admin.get('/v1/admin/workflows?position=2')).statusCode).toBe(400);
    });

    it('company and creator', async () => {
      expect((await names({ companyId: co.zen! })).sort()).toEqual([
        'Budget.pdf',
        'Lease_Agreement.pdf',
      ]);
      expect((await names({ createdBy: ids.c2! })).sort()).toEqual([
        'Budget.pdf',
        'Purchase_Order.pdf',
      ]);
    });

    it('submitted date range is inclusive at both ends', async () => {
      const from = new Date(Date.UTC(2026, 8, 5, 0, 0, 0)).toISOString();
      const to = new Date(Date.UTC(2026, 8, 15, 23, 59, 59, 999)).toISOString();
      expect((await names({ submittedFrom: from, submittedTo: to })).sort()).toEqual([
        'Budget.pdf',
        'Lease_Agreement.pdf',
        'Purchase_Order.pdf',
      ]);
    });

    it('search matches document name, invoice number and vendor, case-insensitively', async () => {
      expect(await names({ q: 'lease' })).toEqual(['Lease_Agreement.pdf']);
      expect(await names({ q: 'inv-1' })).toEqual(['Q3_Invoice.pdf']);
      expect(await names({ q: 'GLOBEX' })).toEqual(['Q3_Invoice.pdf']);
    });

    it('search treats % and _ literally', async () => {
      expect(await names({ q: '50%_' })).toEqual(['NDA.pdf']);
      expect(await names({ q: '%' })).toEqual(['NDA.pdf']);
    });

    it('filters combine', async () => {
      expect(
        await names({ companyId: co.acme!, createdBy: ids.c1!, status: 'PENDING_APPROVER' }),
      ).toEqual(['Q3_Invoice.pdf']);
      expect(await names({ companyId: co.zen!, status: 'REJECTED' })).toEqual([]);
    });
  });

  describe('sorting and pages', () => {
    it('sorts by document, company and status in both directions', async () => {
      expect(await names({ sort: 'document', dir: 'asc' })).toEqual([
        'Budget.pdf',
        'Lease_Agreement.pdf',
        'NDA.pdf',
        'Purchase_Order.pdf',
        'Q3_Invoice.pdf',
      ]);
      const byCompany = await list({ sort: 'company', dir: 'desc' });
      expect(
        byCompany.items
          .slice(0, 2)
          .map((i) => i.fileName)
          .sort(),
      ).toEqual(['Budget.pdf', 'Lease_Agreement.pdf']);
      expect((await names({ sort: 'submitted', dir: 'asc' }))[0]).toBe('Q3_Invoice.pdf');
    });

    it('pages never overlap or skip, including the last and an empty page', async () => {
      const seen: string[] = [];
      for (let page = 1; page <= 3; page++) {
        const res = await list({ pageSize: 2, page });
        expect(res.total).toBe(5);
        seen.push(...res.items.map((i) => i.id));
      }
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
      expect((await list({ pageSize: 2, page: 4 })).items).toEqual([]);
      expect((await list({ pageSize: 1 })).items).toHaveLength(1);
    });
  });

  it('the audit trail has a readable summary for every event', async () => {
    const detail = (await admin.get(`/v1/workflows/${wf.rejected}`)).json();
    expect(detail.events.map((e: { summary: string }) => e.summary)).toEqual([
      'Submitted with the company’s default approval chain',
      'Rejected at position 1: “Unsigned”',
    ]);
    const done = (await admin.get(`/v1/workflows/${wf.done}`)).json();
    expect(done.events.map((e: { summary: string }) => e.summary)).toContain(
      'Final approval given',
    );
  });

  it('the Created By picker can list Creators only', async () => {
    const creators = (await admin.get('/v1/employees?permission=CREATOR')).json();
    expect(creators.items.map((e: { name: string }) => e.name)).toEqual([
      'Carla Creator',
      'Dev Creator',
    ]);
    expect(creators.total).toBe(2);
  });
});
