import { runMigrations } from './db/migrations.js';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL_DIRECT (or DATABASE_URL) is required to run migrations');
  process.exit(1);
}

await runMigrations(url);
console.log('migrations applied');
