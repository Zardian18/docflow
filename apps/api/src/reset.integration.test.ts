import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db/client.js';
import { planReset, resetData } from './demo/reset.js';
import { demoEmail, seedDemo } from './demo/seed.js';
import { MemoryStorage } from './storage/memory.js';
import { Client, resetDb, setupTestDb, TEST_DB_URL, testApp } from './test-db.js';

const ADMIN = demoEmail('admin');

describe.skipIf(!TEST_DB_URL)('reset:data (D21 test-data wipe)', () => {
  let db: Db;
  let end: () => Promise<void>;
  const storage = new MemoryStorage();
  const apps: Array<Awaited<ReturnType<typeof testApp>>> = [];
  const app = async () => {
    apps.push(await testApp(db, {}, storage));
    return apps.at(-1)!;
  };
  const total = async (table: string) =>
    (await db.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(table)}`))
      .rows[0]!.n;

  beforeAll(async () => {
    const setup = await setupTestDb();
    db = setup.db;
    end = () => setup.pool.end();
    await resetDb(db);
    await seedDemo(db, storage);
    await db.execute(
      sql`insert into roles (name, permission) values ('Regional Approver', 'APPROVER')`,
    );
  });
  afterAll(async () => {
    for (const a of apps) await a.close();
    await end();
  });

  it('refuses to keep an unknown account or one that is not an Admin', async () => {
    await expect(planReset(db, [])).rejects.toThrow(/at least one Admin/);
    await expect(planReset(db, ['nobody@example.com'])).rejects.toThrow(/No employee/);
    await expect(planReset(db, [demoEmail('cfo')])).rejects.toThrow(/built-in Admin role/);
  });

  it('counts what it would delete without changing anything (dry run)', async () => {
    const plan = await planReset(db, [ADMIN.toUpperCase()]);
    expect(plan.kept).toEqual([{ email: ADMIN, name: 'Anita Mehta' }]);
    expect(plan.rows).toMatchObject({ workflows: 7, employees: 8, roles: 1, companies: 3 });
    expect(plan.files).toBe(7);
    expect(await total('workflows')).toBe(7);
  });

  it('deletes everything but the kept Admin and the built-in roles, files included', async () => {
    const admin = await new Client(await app()).login(ADMIN, 'demo-password-1');
    await db.execute(
      sql`update roles set is_active = false where is_system and permission = 'APPROVER'`,
    );

    const result = await resetData(db, storage, [ADMIN]);
    expect(result).toMatchObject({ deletedFiles: 7, failedFiles: 0 });
    expect(storage.objects.size).toBe(0);
    for (const table of [
      'workflows',
      'workflow_steps',
      'audit_events',
      'notification_outbox',
      'uploads',
      'companies',
      'company_default_approvers',
    ]) {
      expect(await total(table), table).toBe(0);
    }
    const people = await db.execute(sql`select email from employees`);
    expect(people.rows).toEqual([{ email: ADMIN }]);
    const roles = await db.execute(
      sql`select bool_and(is_system and is_active) as ok, count(*)::int as n from roles`,
    );
    expect(roles.rows[0]).toEqual({ ok: true, n: 4 });
    // The kept Admin stays signed in
    expect((await admin.get('/v1/auth/me')).statusCode).toBe(200);
  });

  it('is followed by the live demo seed, which keeps the real Admin in charge', async () => {
    const result = await seedDemo(db, storage, { password: 'one-time-pass', withAdmin: false });
    expect(result.workflows).toHaveLength(7);
    expect(await total('employees')).toBe(9);
    const api = await app();
    await new Client(api).login(demoEmail('cfo'), 'one-time-pass');
    expect(
      (
        await new Client(api).post('/v1/auth/login', {
          email: demoEmail('cfo'),
          password: 'demo-password-1',
        })
      ).statusCode,
    ).toBe(401);
    // Demo addresses can't receive mail, so nothing is left waiting to be sent
    const waiting = await db.execute(
      sql`select count(*)::int as n from notification_outbox where status = 'pending'`,
    );
    expect(waiting.rows[0]).toEqual({ n: 0 });
    await expect(seedDemo(db, storage, { withAdmin: false })).rejects.toThrow(/right after reset/);
  });
});
