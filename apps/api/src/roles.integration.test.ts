import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db/client.js';
import { MemoryStorage } from './storage/memory.js';
import {
  Client,
  createEmployee,
  resetDb,
  setupTestDb,
  systemRoleId,
  TEST_DB_URL,
  testApp,
} from './test-db.js';

const PDF = 'application/pdf';
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(55, 0x20)]);

/** D23: several roles per person, exclusions, and never approving your own document. */
describe.skipIf(!TEST_DB_URL)('multiple roles per person (D23)', () => {
  let db: Db;
  let end: () => Promise<void>;
  let app: Awaited<ReturnType<typeof testApp>>;
  const storage = new MemoryStorage();
  let ids: Record<string, string>;
  let role: Record<'ADMIN' | 'CREATOR' | 'APPROVER' | 'CFO', string>;
  let admin: Client;
  let dual: Client;
  let companyId: string;

  beforeAll(async () => {
    const setup = await setupTestDb();
    db = setup.db;
    end = () => setup.pool.end();
    app = await testApp(db, {}, storage);
  });
  afterAll(async () => {
    await app.close();
    await end();
  });

  beforeEach(async () => {
    await resetDb(db);
    storage.objects.clear();
    role = {
      ADMIN: await systemRoleId(db, 'ADMIN'),
      CREATOR: await systemRoleId(db, 'CREATOR'),
      APPROVER: await systemRoleId(db, 'APPROVER'),
      CFO: await systemRoleId(db, 'CFO'),
    };
    ids = {
      admin: await createEmployee(db, { name: 'Admin', email: 'admin@t.co', permission: 'ADMIN' }),
      dual: await createEmployee(db, {
        name: 'Dee Dual',
        email: 'dual@t.co',
        permission: ['CREATOR', 'APPROVER'],
      }),
      creator: await createEmployee(db, {
        name: 'Cora',
        email: 'cora@t.co',
        permission: 'CREATOR',
      }),
      a: await createEmployee(db, { name: 'Ann', email: 'a@t.co', permission: 'APPROVER' }),
      b: await createEmployee(db, { name: 'Bob', email: 'b@t.co', permission: 'APPROVER' }),
      cfo: await createEmployee(db, { name: 'Vee', email: 'cfo@t.co', permission: 'CFO' }),
    };
    admin = await new Client(app).login('admin@t.co');
    dual = await new Client(app).login('dual@t.co');
    // Dee is in the company's default chain, as an approver for other people's documents
    companyId = (
      await admin.post('/v1/companies', {
        name: 'Acme',
        approvers: [
          { employeeId: ids.dual, position: 1 },
          { employeeId: ids.a, position: 2 },
          { employeeId: ids.b, position: 3 },
        ],
      })
    ).json().id;
  });

  async function submitAs(client: Client, chain: Array<[string, number]>) {
    const { uploadId } = (
      await client.post('/v1/uploads/presign', {
        fileName: 'Invoice.pdf',
        contentType: PDF,
        size: pdf.length,
      })
    ).json();
    const { rows } = await db.execute<{ object_key: string }>(
      sql`select object_key from uploads where id = ${uploadId}`,
    );
    storage.upload(rows[0]!.object_key, pdf, PDF);
    return client.post('/v1/workflows', {
      uploadId,
      companyId,
      approvers: chain.map(([who, position]) => ({ employeeId: ids[who], position })),
    });
  }

  const employee = (body: Record<string, unknown>) =>
    admin.post('/v1/employees', { name: 'New', email: 'new@t.co', ...body });

  describe('combinations', () => {
    it('a Creator + Approver signs in with both permissions, Creator first', async () => {
      const me = (await dual.get('/v1/auth/me')).json();
      expect(me).toMatchObject({
        roleName: 'Creator + Approver',
        permission: 'CREATOR',
        permissions: ['CREATOR', 'APPROVER'],
      });
      // Both sides of the app are open to them
      expect((await dual.get('/v1/workflows/mine')).statusCode).toBe(200);
      expect((await dual.get('/v1/approvals/pending')).statusCode).toBe(200);
      expect((await dual.get('/v1/approvals/history')).statusCode).toBe(200);
      // ...but nothing else
      expect((await dual.get('/v1/employees')).statusCode).toBe(403);
      expect((await dual.get('/v1/approvals/rejected-before-final')).statusCode).toBe(403);
    });

    it('creates and lists someone with two roles, in priority order', async () => {
      const res = await employee({ roleIds: [role.APPROVER, role.CREATOR] });
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json().roles.map((r: { permission: string }) => r.permission)).toEqual([
        'CREATOR',
        'APPROVER',
      ]);
    });

    it.each([
      ['Admin with anything', ['ADMIN', 'CREATOR'], /Admin can't be combined/],
      ['CFO with anything', ['CFO', 'APPROVER'], /CFO can't be combined/],
      ['two roles of the same kind', ['APPROVER', 'APPROVER2'], /at most one Creator role/],
      ['more than two roles', ['CREATOR', 'APPROVER', 'APPROVER2'], /at most two roles/],
    ])('refuses %s', async (_label, kinds, message) => {
      const approver2 = (
        await admin.post('/v1/roles', { name: 'Regional Approver', permission: 'APPROVER' })
      ).json().id;
      const roleIds = kinds.map((k) => (k === 'APPROVER2' ? approver2 : role[k as 'ADMIN']));
      const res = await employee({ roleIds });
      expect(res.statusCode).toBe(400);
      expect(res.body).toMatch(message);
    });

    it('marks someone with a CFO role as the CFO, and still allows only one', async () => {
      const res = await employee({ roleIds: [role.CFO] });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('CFO_EXISTS');
    });

    it('keeps an approver in a default chain from losing their Approver role (D17)', async () => {
      const update = (roleIds: string[]) =>
        admin.put(`/v1/employees/${ids.dual}`, {
          name: 'Dee Dual',
          email: 'dual@t.co',
          roleIds,
          isActive: true,
        });
      const blocked = await update([role.CREATOR]);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error).toBe('EMPLOYEE_IN_CHAINS');
      // Dropping the Creator role is fine
      const ok = await update([role.APPROVER]);
      expect(ok.statusCode, ok.body).toBe(200);
      expect((await dual.get('/v1/workflows/mine')).statusCode).toBe(403);
    });
  });

  describe('exclusions', () => {
    it('are mutual and show on both roles', async () => {
      const auditor = (
        await admin.post('/v1/roles', { name: 'Auditor', permission: 'APPROVER' })
      ).json().id;
      const res = await admin.post('/v1/roles', {
        name: 'Field Creator',
        permission: 'CREATOR',
        excludedRoleIds: [auditor],
      });
      expect(res.statusCode, res.body).toBe(201);
      const field = res.json();
      expect(field.excludedRoleIds).toEqual([auditor]);
      const all = (await admin.get('/v1/roles?pageSize=100')).json().items;
      expect(all.find((r: { id: string }) => r.id === auditor).excludedRoleIds).toEqual([field.id]);
      // ...and stop anyone holding the pair
      const refused = await employee({ roleIds: [field.id, auditor] });
      expect(refused.statusCode).toBe(400);
      expect(refused.body).toMatch(/Field Creator and Auditor can't be combined/);
      // Removing it from one side removes it from both
      await admin.put(`/v1/roles/${auditor}`, {
        name: 'Auditor',
        isActive: true,
        excludedRoleIds: [],
      });
      const after = (await admin.get('/v1/roles?pageSize=100')).json().items;
      expect(after.find((r: { id: string }) => r.id === field.id).excludedRoleIds).toEqual([]);
    });

    it('only pair a Creator role with an Approver role', async () => {
      const bad = [
        { name: 'X', permission: 'ADMIN', excludedRoleIds: [role.CREATOR] },
        { name: 'Y', permission: 'CREATOR', excludedRoleIds: [role.CFO] },
        { name: 'Z', permission: 'CREATOR', excludedRoleIds: [role.CREATOR] },
      ];
      for (const body of bad) {
        const res = await admin.post('/v1/roles', body);
        expect(res.statusCode, body.name).toBe(400);
        expect(res.json().error).toBe('INVALID_EXCLUSION');
      }
    });

    it('cannot be added while someone holds both roles; the error names them', async () => {
      const res = await admin.put(`/v1/roles/${role.CREATOR}`, {
        name: 'Creator',
        isActive: true,
        excludedRoleIds: [role.APPROVER],
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: 'ROLES_HELD_TOGETHER',
        details: { employees: ['Dee Dual'] },
      });
    });
  });

  describe('nobody approves their own document', () => {
    it('the approver search never offers the person searching', async () => {
      const names = (await dual.get('/v1/employees/approver-search'))
        .json()
        .map((o: { name: string }) => o.name);
      expect(names).toEqual(['Ann', 'Bob']);
      const forOthers = (
        await (await new Client(app).login('cora@t.co')).get('/v1/employees/approver-search')
      ).json();
      expect(forOthers.map((o: { name: string }) => o.name)).toEqual(['Ann', 'Bob', 'Dee Dual']);
    });

    it('a chain that includes its creator is refused at submit', async () => {
      const res = await submitAs(dual, [
        ['dual', 1],
        ['a', 2],
      ]);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('CREATOR_IN_CHAIN');
    });

    it('without themself the creator submits, and approves only other people’s documents', async () => {
      const own = await submitAs(dual, [
        ['a', 1],
        ['b', 2],
      ]);
      expect(own.statusCode, own.body).toBe(201);
      const cora = await new Client(app).login('cora@t.co');
      const theirs = await submitAs(cora, [
        ['dual', 1],
        ['a', 2],
      ]);
      expect(theirs.statusCode, theirs.body).toBe(201);
      const pending = (await dual.get('/v1/approvals/pending')).json();
      expect(pending.items.map((i: { workflowId: string }) => i.workflowId)).toEqual([
        theirs.json().id,
      ]);
      const decided = await dual.post(`/v1/workflows/${theirs.json().id}/decision`, {
        decision: 'APPROVE',
      });
      expect(decided.statusCode, decided.body).toBe(200);
      // Their own document is never theirs to decide
      const self = await dual.post(`/v1/workflows/${own.json().id}/decision`, {
        decision: 'APPROVE',
      });
      expect(self.statusCode).toBe(404);
    });

    it('Admin cannot reassign a step to the document’s creator', async () => {
      const own = (
        await submitAs(dual, [
          ['a', 1],
          ['b', 2],
        ])
      ).json().id;
      const detail = (await admin.get(`/v1/workflows/${own}`)).json();
      const step = detail.steps.find((s: { name: string }) => s.name === 'Ann');
      const res = await admin.post(`/v1/workflows/${own}/steps/${step.id}/reassign`, {
        employeeId: ids.dual,
        reason: 'Ann is away',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('CREATOR_IN_CHAIN');
    });
  });
});
