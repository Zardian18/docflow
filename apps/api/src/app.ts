import { createHash, timingSafeEqual } from 'node:crypto';
import cookie, { type CookieSerializeOptions } from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { PingResponse } from '@docflow/shared';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from './db/client.js';
import type { Env } from './env.js';

export interface AppDeps {
  env: Env;
  db: Db;
}

/**
 * Session cookie attributes. Web (*.workers.dev) and API (*.onrender.com) are
 * cross-site until a real domain exists, so SameSite=None; Secure (plan.md §2.3).
 */
export function sessionCookieOptions(env: Env): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: env.SESSION_COOKIE_SAMESITE,
    path: '/',
  };
}

function secretsMatch(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  // Hash both sides so timingSafeEqual always compares equal-length buffers
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function buildApp({ env, db }: AppDeps) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-tick-secret"]'],
      ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet);
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(cookie);

  app.get(
    '/healthz',
    { schema: { response: { 200: z.object({ status: z.literal('ok') }) } } },
    () => ({
      status: 'ok' as const,
    }),
  );

  app.get('/v1/ping', { schema: { response: { 200: PingResponse } } }, async () => {
    const result = await db.execute<{ db_time: Date; role_count: number }>(
      sql`select now() as db_time, (select count(*)::int from roles) as role_count`,
    );
    const row = result.rows[0];
    if (!row) throw new Error('ping query returned no rows');
    return {
      message: 'pong' as const,
      dbTime: new Date(row.db_time).toISOString(),
      roleCount: row.role_count,
    };
  });

  // Retry tick, called by infra/cron-worker. Phase 5 adds the outbox retry logic.
  app.post(
    '/internal/tick',
    {
      schema: {
        response: {
          200: z.object({ retried: z.number().int() }),
          401: z.object({ error: z.literal('unauthorized') }),
        },
      },
    },
    async (request, reply) => {
      const provided = request.headers['x-tick-secret'];
      if (
        !secretsMatch(typeof provided === 'string' ? provided : undefined, env.TICK_SHARED_SECRET)
      ) {
        return reply.code(401).send({ error: 'unauthorized' as const });
      }
      return { retried: 0 };
    },
  );

  return app;
}
