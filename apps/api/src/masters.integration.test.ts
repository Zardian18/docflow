import type { Permission } from '@docflow/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db/client.js';
import {
  Client,
  createEmployee,
  resetDb,
  setupTestDb,
  systemRoleId,
  TEST_DB_URL,
  testApp,
} from './test-db.js';

const ZERO_ID = '00000000-0000-4000-8000-000000000000';

// Every Admin-only endpoint (plan.md §4.2). Each must be 401 anonymous and 403 for other permissions.
const ADMIN_ENDPOINTS: Array<[method: 'GET' | 'POST' | 'PUT', url: string]> = [
  ['GET', '/v1/roles'],
  ['POST', '/v1/roles'],
  ['PUT', `/v1/roles/${ZERO_ID}`],
  ['GET', '/v1/employees'],
  ['POST', '/v1/employees'],
  ['PUT', `/v1/employees/${ZERO_ID}`],
  ['GET', '/v1/employees/cfo'],
  ['POST', `/v1/employees/${ZERO_ID}/password-link`],
  ['GET', '/v1/companies'],
  ['GET', `/v1/companies/${ZERO_ID}`],
  ['POST', '/v1/companies'],
  ['PUT', `/v1/companies/${ZERO_ID}`],
];

describe.skipIf(!TEST_DB_URL)('masters', () => {
  let db: Db;
  let end: () => Promise<void>;
  let app: Awaited<ReturnType<typeof testApp>>;
  let admin: Client;
  let adminId: string;
  let approverA: string;
  let approverB: string;
  let approverC: string;
  let creatorId: string;

  beforeAll(async () => {
    const setup = await setupTestDb();
    db = setup.db;
    end = () => setup.pool.end();
    app = await testApp(db);
  });
  afterAll(async () => {
    await app.close();
    await end();
  });
  beforeEach(async () => {
    await resetDb(db);
    adminId = await createEmployee(db, {
      name: 'A. Mehta',
      email: 'admin@t.co',
      permission: 'ADMIN',
    });
    approverA = await createEmployee(db, {
      name: 'R. Shah',
      email: 'rshah@t.co',
      permission: 'APPROVER',
    });
    approverB = await createEmployee(db, {
      name: 'P. Kulkarni',
      email: 'pk@t.co',
      permission: 'APPROVER',
    });
    approverC = await createEmployee(db, {
      name: 'Rita Rao',
      email: 'rr@t.co',
      permission: 'APPROVER',
    });
    creatorId = await createEmployee(db, {
      name: 'Rahul Creator',
      email: 'rc@t.co',
      permission: 'CREATOR',
    });
    admin = await new Client(app).login('admin@t.co');
  });

  const company = (approvers: Array<[string, number]>, extra: Record<string, unknown> = {}) => ({
    name: 'Microtech Pvt Ltd',
    code: 'mic',
    approvers: approvers.map(([employeeId, position]) => ({ employeeId, position })),
    ...extra,
  });

  describe('authorization', () => {
    it('every admin endpoint is 401 when signed out', async () => {
      const anon = new Client(app);
      for (const [method, url] of ADMIN_ENDPOINTS) {
        const res = await anon.request(method, url, method === 'GET' ? undefined : {});
        expect(res.statusCode, `${method} ${url}`).toBe(401);
      }
    });

    it.each<Permission>(['CREATOR', 'APPROVER', 'CFO'])(
      'every admin endpoint is 403 for %s',
      async (permission) => {
        const email = `${permission.toLowerCase()}-user@t.co`;
        await createEmployee(db, { name: `${permission} user`, email, permission });
        const client = await new Client(app).login(email);
        for (const [method, url] of ADMIN_ENDPOINTS) {
          const res = await client.request(method, url, method === 'GET' ? undefined : {});
          expect(res.statusCode, `${method} ${url}`).toBe(403);
        }
      },
    );
  });

  describe('roles', () => {
    it('lists the four system roles with active employee counts', async () => {
      const res = await admin.get('/v1/roles');
      expect(res.json().items.map((r: { name: string }) => r.name)).toEqual([
        'Admin',
        'Approver',
        'CFO',
        'Creator',
      ]);
      const approver = res.json().items.find((r: { name: string }) => r.name === 'Approver');
      expect(approver.activeEmployeeCount).toBe(3);
    });

    it('creates custom-named roles that must carry a permission (D3)', async () => {
      expect((await admin.post('/v1/roles', { name: 'Regional Approver' })).statusCode).toBe(400);
      const res = await admin.post('/v1/roles', {
        name: 'Regional Approver',
        permission: 'APPROVER',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ permission: 'APPROVER', isSystem: false });
    });

    it('rejects duplicate names case-insensitively', async () => {
      const res = await admin.post('/v1/roles', { name: 'approver', permission: 'APPROVER' });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('ROLE_NAME_TAKEN');
    });

    it('cannot deactivate built-in roles or roles still in use', async () => {
      const approverRole = await systemRoleId(db, 'APPROVER');
      const sys = await admin.put(`/v1/roles/${approverRole}`, {
        name: 'Approver',
        isActive: false,
      });
      expect(sys.json().error).toBe('SYSTEM_ROLE');

      const custom = (
        await admin.post('/v1/roles', { name: 'Auditor', permission: 'APPROVER' })
      ).json();
      await admin.post('/v1/employees', { name: 'Aud', email: 'aud@t.co', roleId: custom.id });
      const inUse = await admin.put(`/v1/roles/${custom.id}`, { name: 'Auditor', isActive: false });
      expect(inUse.json().error).toBe('ROLE_IN_USE');
    });

    it('a role permission cannot be changed after creation', async () => {
      const custom = (
        await admin.post('/v1/roles', { name: 'Temp', permission: 'CREATOR' })
      ).json();
      const res = await admin.put(`/v1/roles/${custom.id}`, {
        name: 'Temp',
        isActive: true,
        permission: 'ADMIN',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().permission).toBe('CREATOR');
    });
  });

  describe('employees', () => {
    it('creates an employee without a password, with normalised email and code', async () => {
      const res = await admin.post('/v1/employees', {
        name: 'K. Verma',
        email: 'K.Verma@T.co',
        employeeCode: 'emp-7',
        roleId: await systemRoleId(db, 'APPROVER'),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        email: 'k.verma@t.co',
        employeeCode: 'EMP-7',
        hasPassword: false,
      });
    });

    it('rejects a duplicate email', async () => {
      const res = await admin.post('/v1/employees', {
        name: 'Dup',
        email: 'RSHAH@t.co',
        roleId: await systemRoleId(db, 'APPROVER'),
      });
      expect(res.json().error).toBe('EMAIL_TAKEN');
    });

    it('allows only one active CFO', async () => {
      const cfoRole = await systemRoleId(db, 'CFO');
      const first = await admin.post('/v1/employees', {
        name: 'V. Malhotra',
        email: 'cfo@t.co',
        roleId: cfoRole,
      });
      expect(first.statusCode).toBe(201);
      const second = await admin.post('/v1/employees', {
        name: 'Other CFO',
        email: 'cfo2@t.co',
        roleId: cfoRole,
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error).toBe('CFO_EXISTS');
      expect(second.json().message).toContain('V. Malhotra');

      // Moving an existing employee into the CFO role is blocked the same way
      const promote = await admin.put(`/v1/employees/${creatorId}`, {
        name: 'Rahul Creator',
        email: 'rc@t.co',
        roleId: cfoRole,
        isActive: true,
      });
      expect(promote.json().error).toBe('CFO_EXISTS');

      expect((await admin.get('/v1/employees/cfo')).json().cfo).toMatchObject({
        name: 'V. Malhotra',
      });
    });

    it('a replacement CFO can be added once the old one is deactivated', async () => {
      const cfoRole = await systemRoleId(db, 'CFO');
      const old = (
        await admin.post('/v1/employees', { name: 'Old CFO', email: 'old@t.co', roleId: cfoRole })
      ).json();
      await admin.put(`/v1/employees/${old.id}`, {
        name: 'Old CFO',
        email: 'old@t.co',
        roleId: cfoRole,
        isActive: false,
      });
      const next = await admin.post('/v1/employees', {
        name: 'New CFO',
        email: 'new@t.co',
        roleId: cfoRole,
      });
      expect(next.statusCode).toBe(201);
    });

    it('deactivating an employee ends their sessions immediately', async () => {
      const approver = await new Client(app).login('pk@t.co');
      await admin.put(`/v1/employees/${approverB}`, {
        name: 'P. Kulkarni',
        email: 'pk@t.co',
        roleId: await systemRoleId(db, 'APPROVER'),
        isActive: false,
      });
      expect((await approver.get('/v1/auth/me')).statusCode).toBe(401);
    });

    it('blocks deactivating or demoting an approver who is in a default chain (D17)', async () => {
      await admin.post(
        '/v1/companies',
        company([
          [approverA, 1],
          [approverB, 2],
        ]),
      );
      const approverRole = await systemRoleId(db, 'APPROVER');

      const deactivate = await admin.put(`/v1/employees/${approverA}`, {
        name: 'R. Shah',
        email: 'rshah@t.co',
        roleId: approverRole,
        isActive: false,
      });
      expect(deactivate.statusCode).toBe(409);
      expect(deactivate.json()).toMatchObject({
        error: 'EMPLOYEE_IN_CHAINS',
        details: { companies: [{ name: 'Microtech Pvt Ltd' }] },
      });

      const demote = await admin.put(`/v1/employees/${approverA}`, {
        name: 'R. Shah',
        email: 'rshah@t.co',
        roleId: await systemRoleId(db, 'CREATOR'),
        isActive: true,
      });
      expect(demote.json().error).toBe('EMPLOYEE_IN_CHAINS');
    });

    it('an Admin cannot deactivate or demote themselves', async () => {
      const adminRole = await systemRoleId(db, 'ADMIN');
      const res = await admin.put(`/v1/employees/${adminId}`, {
        name: 'A. Mehta',
        email: 'admin@t.co',
        roleId: adminRole,
        isActive: false,
      });
      expect(res.json().error).toBe('CANNOT_CHANGE_SELF');
    });

    it('protects the last active Admin', async () => {
      const second = await createEmployee(db, {
        name: 'B. Admin',
        email: 'b@t.co',
        permission: 'ADMIN',
      });
      const bClient = await new Client(app).login('b@t.co');
      const adminRole = await systemRoleId(db, 'ADMIN');
      // B can deactivate A while B remains an admin...
      const ok = await bClient.put(`/v1/employees/${adminId}`, {
        name: 'A. Mehta',
        email: 'admin@t.co',
        roleId: adminRole,
        isActive: false,
      });
      expect(ok.statusCode).toBe(200);
      // ...but B is now the last admin and cannot remove itself
      const last = await bClient.put(`/v1/employees/${second}`, {
        name: 'B. Admin',
        email: 'b@t.co',
        roleId: adminRole,
        isActive: false,
      });
      expect(last.statusCode).toBe(409);
    });

    it('approver search returns only active APPROVER-permission employees by name prefix (invariant 11)', async () => {
      await createEmployee(db, {
        name: 'Ravi Inactive',
        email: 'ri@t.co',
        permission: 'APPROVER',
        active: false,
      });
      const res = await admin.get('/v1/employees/approver-search?q=r');
      const names = res.json().map((e: { name: string }) => e.name);
      // Order depends on the database collation, so compare as a set
      expect([...names].sort()).toEqual(['R. Shah', 'Rita Rao']);
      expect(names).not.toContain('Rahul Creator');
    });

    it('a Creator-permission employee never appears in approver search, even with an exact name', async () => {
      const res = await admin.get('/v1/employees/approver-search?q=Rahul%20Creator');
      expect(res.json()).toEqual([]);
    });

    it('approver search treats LIKE wildcards literally', async () => {
      expect((await admin.get('/v1/employees/approver-search?q=%25')).json()).toEqual([]);
      expect((await admin.get('/v1/employees/approver-search?q=_')).json()).toEqual([]);
    });
  });

  describe('companies', () => {
    it('creates a company with a sequential chain and normalised code', async () => {
      const res = await admin.post(
        '/v1/companies',
        company([
          [approverA, 1],
          [approverB, 2],
        ]),
      );
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        code: 'MIC',
        approvers: [
          { name: 'R. Shah', position: 1 },
          { name: 'P. Kulkarni', position: 2 },
        ],
      });
    });

    it('supports a parallel group and renumbers steps densely (D1)', async () => {
      const res = await admin.post(
        '/v1/companies',
        company([
          [approverA, 1],
          [approverB, 1],
          [approverC, 5],
        ]),
      );
      expect(res.json().approvers.map((a: { position: number }) => a.position)).toEqual([1, 1, 2]);
    });

    it('cannot be saved with fewer than 2 approvers', async () => {
      const res = await admin.post('/v1/companies', company([[approverA, 1]]));
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: 'INVALID_CHAIN',
        details: { errors: [{ code: 'TOO_FEW_APPROVERS' }] },
      });
    });

    it('rejects the same approver twice', async () => {
      const res = await admin.post(
        '/v1/companies',
        company([
          [approverA, 1],
          [approverA, 2],
        ]),
      );
      expect(res.json().details.errors).toContainEqual({
        code: 'DUPLICATE_APPROVER',
        employeeId: approverA,
      });
    });

    it('rejects Creators, inactive employees and unknown ids as approvers (D3)', async () => {
      const inactive = await createEmployee(db, {
        name: 'Off',
        email: 'off@t.co',
        permission: 'APPROVER',
        active: false,
      });
      for (const bad of [creatorId, inactive, ZERO_ID]) {
        const res = await admin.post(
          '/v1/companies',
          company([
            [approverA, 1],
            [bad, 2],
          ]),
        );
        expect(res.json().error).toBe('INELIGIBLE_APPROVER');
      }
    });

    it('rejects duplicate names (case-insensitive) and codes', async () => {
      await admin.post(
        '/v1/companies',
        company([
          [approverA, 1],
          [approverB, 2],
        ]),
      );
      const name = await admin.post(
        '/v1/companies',
        company(
          [
            [approverA, 1],
            [approverB, 2],
          ],
          { name: 'MICROTECH PVT LTD', code: 'X1' },
        ),
      );
      expect(name.json().error).toBe('NAME_TAKEN');
      const code = await admin.post(
        '/v1/companies',
        company(
          [
            [approverA, 1],
            [approverB, 2],
          ],
          { name: 'Other' },
        ),
      );
      expect(code.json().error).toBe('CODE_TAKEN');
    });

    it('can be saved with no active CFO (D18)', async () => {
      expect((await admin.get('/v1/employees/cfo')).json().cfo).toBeNull();
      expect(
        (
          await admin.post(
            '/v1/companies',
            company([
              [approverA, 1],
              [approverB, 2],
            ]),
          )
        ).statusCode,
      ).toBe(201);
    });

    it('editing replaces the default chain', async () => {
      const created = (
        await admin.post(
          '/v1/companies',
          company([
            [approverA, 1],
            [approverB, 2],
          ]),
        )
      ).json();
      const res = await admin.put(
        `/v1/companies/${created.id}`,
        company(
          [
            [approverC, 1],
            [approverB, 2],
          ],
          { isActive: false },
        ),
      );
      expect(res.json()).toMatchObject({
        isActive: false,
        approvers: [{ name: 'Rita Rao' }, { name: 'P. Kulkarni' }],
      });
    });

    it('lists and searches by name or code', async () => {
      await admin.post(
        '/v1/companies',
        company([
          [approverA, 1],
          [approverB, 2],
        ]),
      );
      await admin.post(
        '/v1/companies',
        company(
          [
            [approverA, 1],
            [approverB, 2],
          ],
          { name: 'Orion Industries', code: 'ORI' },
        ),
      );
      expect(
        (await admin.get('/v1/companies?q=ori')).json().items.map((c: { name: string }) => c.name),
      ).toEqual(['Orion Industries']);
      expect((await admin.get('/v1/companies?q=mic')).json().total).toBe(1);
    });
  });
});
