import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db/client.js';
import { DEMO_PASSWORD, demoEmail, seedDemo } from './demo/seed.js';
import { MemoryStorage } from './storage/memory.js';
import { Client, resetDb, setupTestDb, TEST_DB_URL, testApp } from './test-db.js';

describe.skipIf(!TEST_DB_URL)('seed:demo (v2)', () => {
  let db: Db;
  let end: () => Promise<void>;
  let app: Awaited<ReturnType<typeof testApp>>;
  const storage = new MemoryStorage();

  beforeAll(async () => {
    const setup = await setupTestDb();
    db = setup.db;
    end = () => setup.pool.end();
    app = await testApp(db, {}, storage);
    await resetDb(db);
  });
  afterAll(async () => {
    await app.close();
    await end();
  });

  it('loads orders parked in every phase through the real engine, spread over real days', async () => {
    const result = await seedDemo(db, storage);
    expect(result.orders).toBe(10);
    const { rows } = await db.execute<{ status: string; n: number }>(
      sql`select status::text, count(*)::int as n from orders group by status order by status`,
    );
    expect(rows).toEqual([
      { status: 'ACTIVE', n: 8 },
      { status: 'DONE', n: 1 },
      { status: 'NO_ACTION_NEEDED', n: 1 },
    ]);
    // Open work exists in every phase
    const phases = await db.execute<{ phase: number }>(
      sql`select distinct phase from tasks where status = 'OPEN' order by phase`,
    );
    expect(phases.rows.map((r) => r.phase)).toEqual([1, 2, 3]);
    // Timestamps were spread out: the oldest order started weeks ago
    const span = await db.execute<{ days: number }>(
      sql`select extract(day from now() - min(created_at))::int as days from orders`,
    );
    expect(span.rows[0]!.days).toBeGreaterThan(60);
    // Every step's "done" moment matches its latest finishing event (the spreading kept the
    // order); a step done twice, like a reworked PI, compares with its second completion
    const drift = await db.execute<{ bad: number }>(sql`
      select count(*)::int as bad from tasks t
       cross join lateral (
         select max(e.created_at) as at from order_events e
          where e.task_id = t.id and e.type in ('COMPLETED', 'CONFIRMED', 'CHAIN_APPROVED', 'LOGGED', 'CLOSED')) last
       where t.done_at is not null and last.at is not null
         and abs(extract(epoch from last.at - t.done_at)) > 60`);
    expect(drift.rows[0]).toEqual({ bad: 0 });
  }, 120_000);

  it('every demo account signs in; Materials has raw-material and packaging work waiting', async () => {
    const kabir = await new Client(app).login(demoEmail('kabir'), DEMO_PASSWORD);
    const work = (await kabir.get('/v1/work?tab=MATERIALS')).json();
    expect(work.items.length).toBeGreaterThan(0);
    const dev = await new Client(app).login(demoEmail('dev'), DEMO_PASSWORD);
    const tabs = (await dev.get('/v1/work')).json().tabs.map((t: { tab: string }) => t.tab);
    expect(tabs).toEqual(expect.arrayContaining(['REGULATION', 'PRODUCTION']));
    for (const who of ['admin', 'rohan', 'sara', 'priya', 'vikram', 'pooja', 'imran']) {
      await new Client(app).login(demoEmail(who), DEMO_PASSWORD);
    }
  });

  it('refuses to run on a database that already has data', async () => {
    await expect(seedDemo(db, storage)).rejects.toThrow(/only runs on an empty database/);
  });
});
