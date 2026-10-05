import { PingResponse } from '@docflow/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrations.js';
import { testEnv } from './test-helpers.js';

// Runs against a real Postgres. CI provides one; locally set TEST_DATABASE_URL.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('database integration', () => {
  const env = testEnv({ DATABASE_URL: url ?? '' });
  const { pool, db } = createDb(env.DATABASE_URL);

  afterAll(() => pool.end());

  it('migrations apply, and re-applying is a no-op', async () => {
    await runMigrations(env.DATABASE_URL);
    await runMigrations(env.DATABASE_URL);
    const { rows } = await pool.query(
      `select column_name from information_schema.columns where table_name = 'roles'`,
    );
    expect(rows.map((r) => r.column_name)).toContain('permission');
  });

  it('roles.permission rejects values outside the enum', async () => {
    await expect(
      pool.query(`insert into roles (name, permission) values ('Bad', 'SUPERUSER')`),
    ).rejects.toThrow();
  });

  it('GET /v1/ping reads from the database', async () => {
    const app = await buildApp({ env, db });
    const res = await app.inject({ method: 'GET', url: '/v1/ping' });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(PingResponse.parse(res.json()).roleCount).toBeGreaterThanOrEqual(0);
  });
});
