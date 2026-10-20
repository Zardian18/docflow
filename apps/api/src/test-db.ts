// Integration-test harness: a real Postgres (TEST_DATABASE_URL), migrated and wiped per file.
import type { Capability, Team } from '@docflow/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from './app.js';
import { hashPassword } from './auth/crypto.js';
import { SESSION_COOKIE } from './plugins/auth.js';
import { createDb, type Db } from './db/client.js';
import { runMigrations } from './db/migrations.js';
import { employeeCapabilities, employees, teamMembers } from './db/schema.js';
import { MemoryStorage } from './storage/memory.js';
import type { StorageService } from './storage/storage.js';
import { testEnv } from './test-helpers.js';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL;
export const TEST_PASSWORD = 'correct-horse-battery';

let passwordHash: Promise<string> | undefined;

export async function setupTestDb() {
  if (!TEST_DB_URL) throw new Error('TEST_DATABASE_URL is not set');
  await runMigrations(TEST_DB_URL);
  const { pool, db } = createDb(TEST_DB_URL);
  return { pool, db };
}

/** Empties every table (orders and their history included). */
export async function resetDb(db: Db) {
  await db.execute(
    sql`truncate order_events, orders, uploads, buyers, companies, sessions, password_tokens, employees cascade`,
  );
}

export async function createEmployee(
  db: Db,
  opts: {
    name: string;
    email: string;
    teams?: Team[];
    capabilities?: Capability[];
    password?: boolean;
    active?: boolean;
  },
) {
  passwordHash ??= hashPassword(TEST_PASSWORD);
  const [row] = await db
    .insert(employees)
    .values({
      name: opts.name,
      email: opts.email,
      passwordHash: opts.password === false ? null : await passwordHash,
      isActive: opts.active ?? true,
    })
    .returning({ id: employees.id });
  if (opts.teams?.length) {
    await db.insert(teamMembers).values(opts.teams.map((team) => ({ employeeId: row!.id, team })));
  }
  if (opts.capabilities?.length) {
    await db
      .insert(employeeCapabilities)
      .values(opts.capabilities.map((capability) => ({ employeeId: row!.id, capability })));
  }
  return row!.id;
}

export async function testApp(
  db: Db,
  overrides: Parameters<typeof testEnv>[0] = {},
  storage: StorageService = new MemoryStorage(),
) {
  return buildApp({
    env: testEnv({ DATABASE_URL: TEST_DB_URL ?? '', ...overrides }),
    db,
    limits: {
      authAttemptsPerMinute: 1000,
      loginAttemptsPerEmail: 1000,
      passwordChangesPerMinute: 1000,
      userActionsPerMinute: 1000,
    },
    storage,
  });
}

/** A browser-like client: sends the web Origin and JSON, and keeps the session cookie. */
export class Client {
  cookie: string | undefined;

  constructor(
    private readonly app: FastifyInstance,
    private readonly origin = testEnv().WEB_ORIGIN,
  ) {}

  async request(method: InjectOptions['method'], url: string, body?: unknown) {
    const res = await this.app.inject({
      method,
      url,
      headers: {
        origin: this.origin,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    const setCookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
    if (setCookie)
      this.cookie = setCookie.value ? `${SESSION_COOKIE}=${setCookie.value}` : undefined;
    return res;
  }

  get = (url: string) => this.request('GET', url);
  post = (url: string, body: unknown = {}) => this.request('POST', url, body);
  put = (url: string, body: unknown) => this.request('PUT', url, body);
  del = (url: string) => this.request('DELETE', url);

  async login(email: string, password = TEST_PASSWORD) {
    const res = await this.post('/v1/auth/login', { email, password });
    if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
    return this;
  }
}
