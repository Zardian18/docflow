// Recreates the throwaway E2E database before the API starts (called by playwright.config.ts).
// Refuses any database not named docflow_e2e, so it can never touch real data.
import fs from 'node:fs/promises';
import pg from 'pg';

const url = new URL(process.env.DATABASE_URL ?? '');
if (url.pathname !== '/docflow_e2e') {
  console.error(`prepare-db: refusing to recreate "${url.pathname.slice(1)}" (only docflow_e2e)`);
  process.exit(1);
}
const admin = new URL(url);
admin.pathname = '/postgres';
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
await client.query('drop database if exists docflow_e2e with (force)');
await client.query('create database docflow_e2e');
await client.end();
if (process.env.LOCAL_STORAGE_DIR) {
  await fs.rm(process.env.LOCAL_STORAGE_DIR, { recursive: true, force: true });
}
console.log('prepare-db: docflow_e2e recreated');
