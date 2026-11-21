import { runMigrations } from './db/migrations.js';

// Production must use the direct URL: the migration lock is a session advisory lock, which
// doesn't hold through PgBouncer's transaction pooling on the pooled URL
const url =
  process.env.DATABASE_URL_DIRECT ??
  (process.env.NODE_ENV === 'production' ? undefined : process.env.DATABASE_URL);
if (!url) {
  console.error(
    'DATABASE_URL_DIRECT is required to run migrations (or DATABASE_URL outside production)',
  );
  process.exit(1);
}

await runMigrations(url);
console.log('migrations applied');
