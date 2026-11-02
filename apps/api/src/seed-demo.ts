// Loads the v2 demo data set. Usage:
//   pnpm --filter @docflow/api seed:demo          empty database (development, CI): adds a demo
//                                                 Admin; every account uses DEMO_PASSWORD
//   pnpm --filter @docflow/api seed:demo --live   the live site, right after reset:data: no demo
//                                                 Admin, and one random password, printed once
//   SEED_DEMO_PASSWORD=… … seed:demo --live        the same, reusing a password the owner already
//                                                 holds (given at run time, never stored)
//   pnpm --filter @docflow/api seed:demo --add-private
//                                                 adds only the orders full of private messages
//                                                 (D31) next to existing data, e.g. the live site;
//                                                 checks the people and buyers it needs first;
//                                                 --people MATERIALS=Shraddha,… picks who acts
// Uses the same storage as the API (STORAGE_DRIVER), so seeded files open in the app.
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { localStorageFromEnv, storageFromEnv } from './app.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrations.js';
import { DEMO_DOMAIN, DEMO_PASSWORD, seedDemo } from './demo/seed.js';
import { loadEnv } from './env.js';

const { values } = parseArgs({
  options: {
    live: { type: 'boolean', default: false },
    'add-private': { type: 'boolean', default: false },
    // e.g. MATERIALS=Shraddha,REGULATION=Dharmesh: who to act as per team (first names)
    people: { type: 'string', default: '' },
  },
});
const env = loadEnv();
if (env.NODE_ENV === 'production') {
  console.error('seed:demo refuses to run with NODE_ENV=production');
  process.exit(1);
}

await runMigrations(env.DATABASE_URL_DIRECT ?? env.DATABASE_URL);
const { pool, db } = createDb(env.DATABASE_URL_DIRECT ?? env.DATABASE_URL);
try {
  const storage = localStorageFromEnv(env)?.storage ?? storageFromEnv(env);
  if (values['add-private']) {
    const preferred = Object.fromEntries(
      values.people
        .split(',')
        .map((pair) => pair.split('=').map((x) => x.trim()))
        .filter((pair) => pair.length === 2 && pair[0] && pair[1])
        .map(([team, name]) => [team!.toUpperCase(), name]),
    );
    const added = await seedDemo(db, storage, { mode: 'add-private', preferred });
    console.log(`Added ${added.orders} orders with private messages.`);
    process.exit(0);
  }
  // The demo password is public (it's in this repo), so it must never exist on the live site
  const reused = process.env.SEED_DEMO_PASSWORD;
  if (values.live && reused !== undefined && (reused.length < 12 || reused === DEMO_PASSWORD)) {
    throw new Error('SEED_DEMO_PASSWORD must be at least 12 characters, and not the public one');
  }
  const password = values.live ? (reused ?? randomBytes(12).toString('base64url')) : DEMO_PASSWORD;
  const result = await seedDemo(db, storage, { password, withAdmin: !values.live });
  console.log(
    `Seeded ${result.employees} people, ${result.buyers} buyers and ${result.orders} orders.`,
  );
  if (values.live && reused) {
    console.log(`Demo accounts (<name>@${DEMO_DOMAIN}) use the password you gave.`);
  } else {
    console.log(`Demo accounts (<name>@${DEMO_DOMAIN}) use the password: ${password}`);
    if (values.live) console.log('This password is shown only once. Store it now.');
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
