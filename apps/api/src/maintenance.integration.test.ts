import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db/client.js';
import { MemoryStorage } from './storage/memory.js';
import { Client, createEmployee, resetDb, setupTestDb, TEST_DB_URL, testApp } from './test-db.js';
import { TEST_TICK_SECRET } from './test-helpers.js';

const PDF = 'application/pdf';

describe.skipIf(!TEST_DB_URL)('cron tick housekeeping (Phase 7 findings 5 and 13)', () => {
  let db: Db;
  let end: () => Promise<void>;
  let app: Awaited<ReturnType<typeof testApp>>;
  let storage: MemoryStorage;
  let creator: Client;

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
    await createEmployee(db, { name: 'R. Creator', email: 'creator@t.co', permission: 'CREATOR' });
    creator = await new Client(app).login('creator@t.co');
  });

  const tick = () =>
    app.inject({
      method: 'POST',
      url: '/internal/tick',
      headers: { 'x-tick-secret': TEST_TICK_SECRET },
    });

  async function presign() {
    const res = await creator.post('/v1/uploads/presign', {
      fileName: 'a.pdf',
      contentType: PDF,
      size: 64,
    });
    const { uploadId } = res.json();
    const [row] = (await db.execute(sql`select object_key from uploads where id = ${uploadId}`))
      .rows as { object_key: string }[];
    storage.upload(row!.object_key, Buffer.alloc(64), PDF);
    return { uploadId: uploadId as string, key: row!.object_key };
  }

  it('removes uploads that expired without being submitted, file first', async () => {
    const stale = await presign();
    const fresh = await presign();
    await db.execute(
      sql`update uploads set expires_at = now() - interval '1 minute' where id = ${stale.uploadId}`,
    );
    const res = await tick();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ retried: 0, uploadsRemoved: 1 });
    expect(storage.objects.has(stale.key)).toBe(false);
    expect(storage.objects.has(fresh.key)).toBe(true);
    const left = (await db.execute(sql`select id from uploads`)).rows as { id: string }[];
    expect(left.map((r) => r.id)).toEqual([fresh.uploadId]);
  });

  it('keeps the row for a retry when the file can’t be deleted', async () => {
    const stale = await presign();
    await db.execute(
      sql`update uploads set expires_at = now() - interval '1 minute' where id = ${stale.uploadId}`,
    );
    const original = storage.delete.bind(storage);
    storage.delete = async () => {
      throw new Error('storage down');
    };
    try {
      expect((await tick()).json()).toMatchObject({ uploadsRemoved: 0 });
    } finally {
      storage.delete = original;
    }
    expect((await db.execute(sql`select id from uploads`)).rows).toHaveLength(1);
    expect((await tick()).json()).toMatchObject({ uploadsRemoved: 1 });
  });

  it('purges sessions that expired or were revoked over 30 days ago, and no others', async () => {
    const other = await new Client(app).login('creator@t.co');
    await db.execute(
      sql`update sessions set expires_at = now() - interval '31 days' where id = (
        select id from sessions order by created_at asc limit 1)`,
    );
    const res = await tick();
    expect(res.json()).toMatchObject({ sessionsPurged: 1 });
    expect((await other.get('/v1/auth/me')).statusCode).toBe(200);
  });
});
