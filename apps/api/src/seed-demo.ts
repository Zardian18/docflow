// Loads the demo data set. Usage:
//   pnpm --filter @docflow/api seed:demo          empty database (development, CI): adds a demo
//                                                 Admin; every account uses DEMO_PASSWORD
//   pnpm --filter @docflow/api seed:demo --live   the live site, right after reset:data: no demo
//                                                 Admin, and one random password, printed once
// Uses the same storage as the API (STORAGE_DRIVER), so seeded files open in the app.
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { localStorageFromEnv, storageFromEnv } from './app.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrations.js';
import { DEMO_DOMAIN, DEMO_PASSWORD, seedDemo } from './demo/seed.js';
import { loadEnv } from './env.js';

const { values } = parseArgs({ options: { live: { type: 'boolean', default: false } } });
const env = loadEnv();
if (env.NODE_ENV === 'production') {
  console.error('seed:demo refuses to run with NODE_ENV=production');
  process.exit(1);
}

await runMigrations(env.DATABASE_URL_DIRECT ?? env.DATABASE_URL);
const { pool, db } = createDb(env.DATABASE_URL_DIRECT ?? env.DATABASE_URL);
try {
  const storage = localStorageFromEnv(env)?.storage ?? storageFromEnv(env);
  // The demo password is public (it's in this repo), so it must never exist on the live site
  const password = values.live ? randomBytes(12).toString('base64url') : DEMO_PASSWORD;
  const result = await seedDemo(db, storage, { password, withAdmin: !values.live });
  console.log(
    `Seeded ${result.employees} active employees, ${result.companies} companies and ${result.workflows.length} documents.`,
  );
  const who = values.live ? 'cfo@, rahul@, priya@ ...' : 'admin@ (or cfo@, rahul@, priya@ ...)';
  console.log(`Sign in as ${who}${DEMO_DOMAIN} with the password: ${password}`);
  if (values.live) console.log('This password is shown only once. Store it now.');
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
