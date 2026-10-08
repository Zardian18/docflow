import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db/client.js';
import { DEMO_PASSWORD, demoEmail, demoPdf, seedDemo } from './demo/seed.js';
import { MemoryStorage } from './storage/memory.js';
import { Client, resetDb, setupTestDb, TEST_DB_URL, testApp } from './test-db.js';

describe.skipIf(!TEST_DB_URL)('seed:demo', () => {
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

  it('loads documents in every state through the real engine', async () => {
    const result = await seedDemo(db, storage);
    expect(result.workflows).toHaveLength(7);
    const rows = (
      await db.execute(
        sql`select status, current_position as pos, count(*)::int as n from workflows group by 1, 2 order by 1, 2`,
      )
    ).rows;
    // Ordered by the status enum: one part-approved parallel step stays at position 1
    expect(rows).toEqual([
      { status: 'PENDING_APPROVER', pos: 1, n: 2 },
      { status: 'PENDING_APPROVER', pos: 2, n: 1 },
      { status: 'PENDING_CFO', pos: 3, n: 1 },
      { status: 'COMPLETED', pos: 3, n: 1 },
      { status: 'REJECTED', pos: 1, n: 1 },
      { status: 'REJECTED', pos: 3, n: 1 },
    ]);
    // Every stored document is a real file under the locked prefix
    const keys = [...storage.objects.keys()];
    expect(keys).toHaveLength(7);
    expect(keys.every((k) => k.startsWith('documents/'))).toBe(true);
  });

  it('lets every demo account sign in, and the CFO sees the early rejection (D22)', async () => {
    for (const who of ['admin', 'cfo', 'rahul', 'priya']) {
      await new Client(app).login(demoEmail(who), DEMO_PASSWORD);
    }
    const cfo = await new Client(app).login(demoEmail('cfo'), DEMO_PASSWORD);
    const pending = (await cfo.get('/v1/approvals/pending')).json();
    expect(pending.items).toHaveLength(1);
    expect(pending.stats.rejectedBeforeFinal).toBe(1);
  });

  it('refuses to run on a database that already has employees', async () => {
    await expect(seedDemo(db, storage)).rejects.toThrow(/only runs on an empty database/);
  });

  it('makes a well-formed PDF', () => {
    const pdf = demoPdf('Q3 (Vendor) Invoice').toString();
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(xref, xref + 4)).toBe('xref');
  });
});
