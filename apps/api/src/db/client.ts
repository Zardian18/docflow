import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

/**
 * Standard TCP driver on Neon's pooled endpoint. Interactive transactions
 * (SELECT ... FOR UPDATE, plan.md §4.8) must run on one client from pool.connect().
 */
export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  return { pool, db };
}

export type Db = ReturnType<typeof createDb>['db'];
