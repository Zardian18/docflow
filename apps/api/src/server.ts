import closeWithGrace from 'close-with-grace';
import { buildApp } from './app.js';
import { createDb } from './db/client.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const { pool, db } = createDb(env.DATABASE_URL);
const app = await buildApp({ env, db });

closeWithGrace({ delay: 10_000 }, async ({ signal, err }) => {
  if (err) app.log.error({ err }, 'shutting down after error');
  else app.log.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
});

// Render injects PORT (default 10000) and requires binding 0.0.0.0
await app.listen({ host: '0.0.0.0', port: env.PORT });
