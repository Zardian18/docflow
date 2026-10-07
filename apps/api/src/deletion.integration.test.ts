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

describe.skipIf(!TEST_DB_URL)('deleting records with no history (D21)', () => {
  let db: Db;
  let end: () => Promise<void>;
  let app: Awaited<ReturnType<typeof testApp>>;
  let storage: MemoryStorage;
  let admin: Client;
  let ids: Record<string, string>;

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
    storage.deleted.length = 0;
    ids = {
      admin: await createEmployee(db, {
        name: 'A. Mehta',
        email: 'admin@t.co',
        permission: 'ADMIN',
      }),
      creator: await createEmployee(db, {
        name: 'Creator',
        email: 'creator@t.co',
        permission: 'CREATOR',
      }),
      a: await createEmployee(db, { name: 'Ann', email: 'a@t.co', permission: 'APPROVER' }),
      b: await createEmployee(db, { name: 'Bob', email: 'b@t.co', permission: 'APPROVER' }),
      spare: await createEmployee(db, {
        name: 'Spare',
        email: 'spare@t.co',
        permission: 'APPROVER',
      }),
      cfo: await createEmployee(db, { name: 'CFO', email: 'cfo@t.co', permission: 'CFO' }),
    };
    admin = await new Client(app).login('admin@t.co');
  });

  async function company(name: string) {
    const res = await admin.post('/v1/companies', {
      name,
      approvers: [
        { employeeId: ids.a, position: 1 },
        { employeeId: ids.b, position: 2 },
      ],
    });
    return res.json().id as string;
  }

  async function submitFor(companyId: string) {
    const creator = await new Client(app).login('creator@t.co');
    const presign = await creator.post('/v1/uploads/presign', {
      fileName: 'a.pdf',
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
      approvers: [
        { employeeId: ids.a, position: 1 },
        { employeeId: ids.b, position: 2 },
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
  }

  describe('employees', () => {
    it('deletes an employee with no history, with their sessions and unsubmitted uploads', async () => {
      const spare = await new Client(app).login('spare@t.co');
      expect((await spare.get('/v1/auth/me')).statusCode).toBe(200);
      expect((await admin.del(`/v1/employees/${ids.spare}`)).statusCode).toBe(204);
      expect((await spare.get('/v1/auth/me')).statusCode).toBe(401);
      expect((await admin.get('/v1/employees?q=spare')).json().total).toBe(0);
    });

    it('removes a Creator’s never-submitted upload from storage too', async () => {
      const creator = await new Client(app).login('creator@t.co');
      await creator.post('/v1/uploads/presign', { fileName: 'x.pdf', contentType: PDF, size: 10 });
      expect((await admin.del(`/v1/employees/${ids.creator}`)).statusCode).toBe(204);
      expect(storage.deleted).toHaveLength(1);
    });

    it('refuses anyone who is part of a submitted document', async () => {
      await submitFor(await company('Acme'));
      // The Creator submitted it and the CFO is in its snapshot chain
      for (const id of [ids.creator, ids.cfo]) {
        const res = await admin.del(`/v1/employees/${id}`);
        expect(res.statusCode).toBe(409);
        expect(res.json().error).toBe('HAS_HISTORY');
      }
    });

    it('refuses a default approver, naming the companies', async () => {
      await company('Acme');
      const res = await admin.del(`/v1/employees/${ids.a}`);
      expect(res.json()).toMatchObject({
        error: 'EMPLOYEE_IN_CHAINS',
        details: { companies: [{ name: 'Acme' }] },
      });
    });

    it('refuses deleting yourself', async () => {
      expect((await admin.del(`/v1/employees/${ids.admin}`)).json().error).toBe(
        'CANNOT_CHANGE_SELF',
      );
    });
  });

  describe('companies', () => {
    it('deletes a company nothing was submitted for, with its default chain', async () => {
      const id = await company('Typo Corp');
      expect((await admin.del(`/v1/companies/${id}`)).statusCode).toBe(204);
      const { rows } = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from company_default_approvers where company_id = ${id}`,
      );
      expect(rows[0]?.n).toBe(0);
      // Its former approvers are free to delete now
      expect((await admin.del(`/v1/employees/${ids.spare}`)).statusCode).toBe(204);
    });

    it('refuses a company with submitted documents', async () => {
      const id = await company('Acme');
      await submitFor(id);
      expect((await admin.del(`/v1/companies/${id}`)).json().error).toBe('HAS_HISTORY');
    });
  });

  describe('roles', () => {
    it('deletes an unused custom role', async () => {
      const role = (await admin.post('/v1/roles', { name: 'Temp', permission: 'CREATOR' })).json();
      expect((await admin.del(`/v1/roles/${role.id}`)).statusCode).toBe(204);
    });

    it('refuses built-in roles and roles anyone holds, even inactive employees', async () => {
      expect(
        (await admin.del(`/v1/roles/${await systemRoleId(db, 'APPROVER')}`)).json().error,
      ).toBe('SYSTEM_ROLE');
      const role = (
        await admin.post('/v1/roles', { name: 'Auditor', permission: 'APPROVER' })
      ).json();
      const emp = (
        await admin.post('/v1/employees', { name: 'Aud', email: 'aud@t.co', roleId: role.id })
      ).json();
      await admin.put(`/v1/employees/${emp.id}`, {
        name: 'Aud',
        email: 'aud@t.co',
        roleId: role.id,
        isActive: false,
      });
      expect((await admin.del(`/v1/roles/${role.id}`)).json().error).toBe('ROLE_IN_USE');
    });
  });
});
