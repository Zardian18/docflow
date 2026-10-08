import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
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
import { DEFAULT_LIMITS, type Limits } from './routes/deps.js';
import { employeeRoutes } from './routes/employees.js';
import { lookupRoutes } from './routes/lookups.js';
import { roleRoutes } from './routes/roles.js';
import { uploadRoutes } from './routes/uploads.js';
import { workflowRoutes } from './routes/workflows.js';
import { adminWorkflowRoutes } from './routes/admin-workflows.js';
import { approvalRoutes } from './routes/approvals.js';
import { runMaintenance } from './maintenance.js';
import type { EmailProvider } from './notify/outbox.js';
import { createB2Storage } from './storage/b2.js';
import { createLocalStorage, LOCAL_STORAGE_PATH } from './storage/local.js';
import type { StorageService } from './storage/storage.js';

export interface AppDeps {
  env: Env;
  db: Db;
  limits?: Partial<Limits>;
  /** Defaults to Backblaze B2 from env; tests pass in-memory storage. */
  storage?: StorageService;
  /** Email delivery; null until Phase 5 wires a real provider (rows are marked skipped). */
  email?: EmailProvider | null;
}

/** The development/CI disk driver when STORAGE_DRIVER=local (refused in production by env.ts). */
export function localStorageFromEnv(env: Env) {
  if (env.STORAGE_DRIVER !== 'local') return null;
  return createLocalStorage({
    dir: env.LOCAL_STORAGE_DIR ?? path.join(os.tmpdir(), 'docflow-storage'),
    publicUrl: env.API_PUBLIC_URL ?? `http://localhost:${env.PORT}`,
    // A key of its own, derived so there's no extra secret to configure in dev/CI
    secret: createHash('sha256').update(`local-storage|${env.TICK_SHARED_SECRET}`).digest('hex'),
  });
}

/** Real storage when configured; otherwise every file operation fails with a clear 503. */
export function storageFromEnv(env: Env): StorageService {
  const { B2_ENDPOINT, B2_REGION, B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET } = env;
  if (B2_ENDPOINT && B2_REGION && B2_KEY_ID && B2_APPLICATION_KEY && B2_BUCKET) {
    return createB2Storage({
      endpoint: B2_ENDPOINT,
      region: B2_REGION,
      keyId: B2_KEY_ID,
      applicationKey: B2_APPLICATION_KEY,
      bucket: B2_BUCKET,
    });
  }
  const unavailable = async (): Promise<never> => {
    throw new AppError(
      503,
      'STORAGE_UNAVAILABLE',
      'File storage is not configured on this server.',
    );
  };
  return {
    presignPut: unavailable,
    presignGet: unavailable,
    head: unavailable,
    readRange: unavailable,
    stream: unavailable,
    put: unavailable,
    copy: unavailable,
    delete: unavailable,
  };
}

const TICK_PATH = '/internal/tick';

function secretsMatch(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  // Hash both sides so timingSafeEqual always compares equal-length buffers
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function buildApp({
  email = null,
  env,
  db,
  limits: limitOverrides,
  storage: storageOverride,
}: AppDeps) {
  const local = storageOverride ? null : localStorageFromEnv(env);
  const storage = storageOverride ?? local?.storage ?? storageFromEnv(env);
  const limits: Limits = { ...DEFAULT_LIMITS, ...limitOverrides };

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Method and path only: query strings carry search terms (names, emails) and links
      // carry tokens, and neither belongs in logs (Phase 7 finding 8)
      serializers: {
        req: (req: { method: string; url: string }) => ({
          method: req.method,
          path: req.url.split('?')[0],
        }),
      },
      ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
    // Our own id per request; a client-sent x-request-id is not trusted
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    // Only the measured proxy hops; a client-supplied X-Forwarded-For entry can't become
    // request.ip, which keys the rate limits (Phase 7 finding 1)
    trustProxy: (_address: string, hop: number) => hop < env.TRUSTED_PROXY_HOPS,
  }).withTypeProvider<ZodTypeProvider>();

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

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
      // Framework errors (bad JSON, wrong content type, body too large) get a fixed message
      // rather than the parser's own text (Phase 7 finding 7)
      request.log.info({ code: (error as { code?: string }).code, statusCode }, 'request refused');
      return reply.code(statusCode).send({
        error: 'BAD_REQUEST',
        message:
          statusCode === 413 ? 'The request is too large.' : 'The request could not be processed.',
      });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({
      error: 'INTERNAL',
      message: `Something went wrong. Reference: ${request.id}`,
    });
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
  await app.register(csrfPlugin, {
    webOrigin: env.WEB_ORIGIN,
    // Local-storage URLs are authorised by their signature, like B2's presigned URLs
    exemptPaths: local ? [TICK_PATH, LOCAL_STORAGE_PATH] : [TICK_PATH],
  });
  await app.register(authPlugin, { db });

  app.get(
    '/healthz',
    {
      schema: {
        response: { 200: z.object({ status: z.literal('ok'), commit: z.string().nullable() }) },
      },
    },
    () => ({ status: 'ok' as const, commit: env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null }),
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

  if (local) {
    app.log.warn('STORAGE_DRIVER=local: files are stored on this machine (development/CI only)');
    await app.register(local.routes);
  }

  const deps = { db, env, limits };
  await app.register(authRoutes, { ...deps, prefix: '/v1/auth' });
  await app.register(roleRoutes, { ...deps, prefix: '/v1/roles' });
  await app.register(employeeRoutes, { ...deps, storage, prefix: '/v1/employees' });
  await app.register(lookupRoutes, deps);
  await app.register(companyRoutes, { ...deps, prefix: '/v1/companies' });
  await app.register(uploadRoutes, { ...deps, storage, prefix: '/v1/uploads' });
  await app.register(workflowRoutes, { ...deps, storage, email, prefix: '/v1/workflows' });
  await app.register(approvalRoutes, { ...deps, prefix: '/v1/approvals' });
  await app.register(adminWorkflowRoutes, { ...deps, prefix: '/v1/admin/workflows' });

  // Called by infra/cron-worker. Housekeeping now; Phase 5 adds the outbox retry.
  app.post(
    TICK_PATH,
    {
      schema: {
        response: {
          200: z.object({
            retried: z.number().int(),
            uploadsRemoved: z.number().int(),
            sessionsPurged: z.number().int(),
          }),
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
      const housekeeping = await runMaintenance(db, storage, request.log);
      request.log.info(housekeeping, 'tick');
      return { retried: 0, ...housekeeping };
    },
  );

  return app;
}
