import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

// Arbitrary constant identifying the DocFlow migration lock
const MIGRATION_LOCK_ID = 727_001;

// apps/api/drizzle, resolved the same way from src/db and dist/db
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Applies pending migrations over the DIRECT (non-pooled) connection — Neon
 * recommends this, and session advisory locks don't work through PgBouncer.
 * The advisory lock stops two starting instances migrating at once.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    await client.end();
  }
}
