import { createHash, timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { PingResponse } from '@docflow/shared';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from './db/client.js';
import type { Env } from './env.js';
import { AppError } from './errors.js';
import { authPlugin } from './plugins/auth.js';
import { csrfPlugin } from './plugins/csrf.js';
import { authRoutes } from './routes/auth.js';
import { companyRoutes } from './routes/companies.js';
import type { Limits } from './routes/deps.js';
import { employeeRoutes } from './routes/employees.js';
import { roleRoutes } from './routes/roles.js';

export interface AppDeps {
  env: Env;
  db: Db;
  limits?: Partial<Limits>;
}

const TICK_PATH = '/internal/tick';

function secretsMatch(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  // Hash both sides so timingSafeEqual always compares equal-length buffers
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function buildApp({ env, db, limits: limitOverrides }: AppDeps) {
  const limits: Limits = { authAttemptsPerMinute: 5, ...limitOverrides };

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

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .code(error.statusCode)
        .send({ error: error.code, message: error.message, details: error.details });
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({
        error: 'VALIDATION',
        message: 'Some fields are invalid',
        details: error.validation.map((v) => ({
          path: v.instancePath,
          message: v.message,
        })),
      });
    }
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    if (statusCode === 429) {
      return reply.code(429).send({
        error: 'RATE_LIMITED',
        message: 'Too many attempts. Please wait a minute and try again.',
      });
    }
    if (statusCode < 500) {
      return reply
        .code(statusCode)
        .send({ error: 'BAD_REQUEST', message: (error as Error).message });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({ error: 'INTERNAL', message: 'Something went wrong' });
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });
  await app.register(cookie);
  // Per-route limits only (auth endpoints); runs after body parsing so keys can use the email
  await app.register(rateLimit, { global: false, hook: 'preHandler' });
  await app.register(csrfPlugin, { webOrigin: env.WEB_ORIGIN, exemptPaths: [TICK_PATH] });
  await app.register(authPlugin, { db });

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

  const deps = { db, env, limits };
  await app.register(authRoutes, { ...deps, prefix: '/v1/auth' });
  await app.register(roleRoutes, { ...deps, prefix: '/v1/roles' });
  await app.register(employeeRoutes, { ...deps, prefix: '/v1/employees' });
  await app.register(companyRoutes, { ...deps, prefix: '/v1/companies' });

  // Retry tick, called by infra/cron-worker. Phase 5 adds the outbox retry logic.
  app.post(
    TICK_PATH,
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
