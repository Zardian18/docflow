// Loads the demo data set into an EMPTY database (development, CI, staging). Usage:
//   pnpm --filter @docflow/api seed:demo
// Uses the same storage as the API (STORAGE_DRIVER), so seeded files open in the app.
import { localStorageFromEnv, storageFromEnv } from './app.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrations.js';
import { DEMO_DOMAIN, DEMO_PASSWORD, seedDemo } from './demo/seed.js';
import { loadEnv } from './env.js';

const env = loadEnv();
if (env.NODE_ENV === 'production') {
  console.error('seed:demo refuses to run with NODE_ENV=production');
  process.exit(1);
}

await runMigrations(env.DATABASE_URL_DIRECT ?? env.DATABASE_URL);
const { pool, db } = createDb(env.DATABASE_URL_DIRECT ?? env.DATABASE_URL);
try {
  const storage = localStorageFromEnv(env)?.storage ?? storageFromEnv(env);
  const result = await seedDemo(db, storage);
  console.log(
    `Seeded ${result.employees} employees, ${result.companies} companies and ${result.workflows.length} documents.`,
  );
  console.log(
    `Sign in as admin@${DEMO_DOMAIN} (or cfo@, rahul@, priya@ ...) with "${DEMO_PASSWORD}".`,
  );
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
