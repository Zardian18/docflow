// The pre-go-live test-data wipe (D21). Run only on the owner's request, and only after a
// fresh backup (GitHub → Actions → Backup → Run workflow; docs/runbook-backup.md). Usage:
//   pnpm --filter @docflow/api reset:data --keep admin@example.com            dry run: counts only
//   pnpm --filter @docflow/api reset:data --keep admin@example.com --confirm  deletes
// Keeps the named Admins and the built-in roles; deletes everything else, stored files included.
import { parseArgs } from 'node:util';
import { localStorageFromEnv, storageFromEnv } from './app.js';
import { createDb } from './db/client.js';
import { planReset, resetData } from './demo/reset.js';
import { loadEnv } from './env.js';

const { values } = parseArgs({
  options: {
    keep: { type: 'string', multiple: true, default: [] },
    confirm: { type: 'boolean', default: false },
  },
});
const env = loadEnv();
const url = env.DATABASE_URL_DIRECT ?? env.DATABASE_URL;
const { pool, db } = createDb(url);
try {
  const local = localStorageFromEnv(env);
  const storage = local?.storage ?? storageFromEnv(env);
  const files = local
    ? `local (${env.LOCAL_STORAGE_DIR})`
    : `B2 ${env.B2_BUCKET ?? '(not configured)'}`;
  console.log(`Database: ${new URL(url).hostname}  Files: ${files}`);
  const plan = values.confirm
    ? await resetData(db, storage, values.keep)
    : await planReset(db, values.keep);
  console.log(`Keeping: ${plan.kept.map((k) => `${k.name} <${k.email}>`).join(', ')}`);
  console.log(values.confirm ? 'Deleted:' : 'Would delete:');
  for (const [table, n] of Object.entries(plan.rows)) console.log(`  ${table.padEnd(26)} ${n}`);
  console.log(`  ${'stored files'.padEnd(26)} ${plan.files}`);
  if ('failedFiles' in plan && (plan.failedFiles as number) > 0) {
    console.log(`${plan.failedFiles} files could not be deleted from storage (now unreferenced).`);
  }
  if (!values.confirm) console.log('Dry run: nothing was changed. Add --confirm to delete.');
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
