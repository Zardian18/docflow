import type { Permission } from '@docflow/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db/client.js';
import { Client, createEmployee, resetDb, setupTestDb, TEST_DB_URL, testApp } from './test-db.js';

const ZERO = '00000000-0000-4000-8000-000000000000';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
type Access = 'public' | 'signed-in' | Permission[];

/**
 * Every API endpoint and who may call it (plan.md §4.2; published in docs/security.md).
 * "Allowed" means the guard lets the caller through; the response may still be 400/404/409.
 * Not allowed means 401 when signed out and 403 when signed in with the wrong permission.
 */
export const MATRIX: Array<[Method, string, Access]> = [
  ['GET', '/healthz', 'public'],
  ['GET', '/v1/ping', 'public'],
  ['POST', '/v1/auth/login', 'public'],
  ['POST', '/v1/auth/logout', 'public'],
  ['POST', '/v1/auth/set-password', 'public'],
  ['POST', '/v1/auth/forgot-password', 'public'],
  ['GET', '/v1/auth/me', 'signed-in'],
  ['POST', '/v1/auth/change-password', 'signed-in'],
  // Workflow detail and file: any signed-in user, then the visibility rule (404 if not theirs)
  ['GET', `/v1/workflows/${ZERO}`, 'signed-in'],
  ['GET', `/v1/workflows/${ZERO}/file`, 'signed-in'],

  ['GET', '/v1/roles', ['ADMIN']],
  ['POST', '/v1/roles', ['ADMIN']],
  ['PUT', `/v1/roles/${ZERO}`, ['ADMIN']],
  ['DELETE', `/v1/roles/${ZERO}`, ['ADMIN']],
  ['GET', '/v1/employees', ['ADMIN']],
  ['POST', '/v1/employees', ['ADMIN']],
  ['GET', '/v1/employees/cfo', ['ADMIN']],
  ['PUT', `/v1/employees/${ZERO}`, ['ADMIN']],
  ['DELETE', `/v1/employees/${ZERO}`, ['ADMIN']],
  ['POST', `/v1/employees/${ZERO}/password-link`, ['ADMIN']],
  ['GET', '/v1/companies', ['ADMIN']],
  ['POST', '/v1/companies', ['ADMIN']],
  ['GET', `/v1/companies/${ZERO}`, ['ADMIN']],
  ['PUT', `/v1/companies/${ZERO}`, ['ADMIN']],
  ['DELETE', `/v1/companies/${ZERO}`, ['ADMIN']],
  ['GET', '/v1/admin/workflows', ['ADMIN']],
  ['GET', '/v1/admin/workflows/stats', ['ADMIN']],
  ['POST', `/v1/workflows/${ZERO}/steps/${ZERO}/reassign`, ['ADMIN']],

  // Pickers: Admin (company masters) and Creator (per-document chain), invariant 11
  ['GET', '/v1/employees/approver-search', ['ADMIN', 'CREATOR']],
  ['GET', '/v1/companies/search', ['ADMIN', 'CREATOR']],

  ['POST', '/v1/uploads/presign', ['CREATOR']],
  ['POST', '/v1/workflows', ['CREATOR']],
  ['GET', '/v1/workflows/mine', ['CREATOR']],

  ['GET', '/v1/approvals/pending', ['APPROVER', 'CFO']],
  ['GET', '/v1/approvals/history', ['APPROVER', 'CFO']],
  ['POST', `/v1/workflows/${ZERO}/decision`, ['APPROVER', 'CFO']],
  ['GET', '/v1/approvals/rejected-before-final', ['CFO']],
];

// Authenticated by the shared secret instead of a session (app.test.ts)
const OUTSIDE_MATRIX = ['POST /internal/tick'];

const PERMISSIONS: Permission[] = ['ADMIN', 'CREATOR', 'APPROVER', 'CFO'];

describe.skipIf(!TEST_DB_URL)('endpoint × permission matrix', () => {
  let db: Db;
  let end: () => Promise<void>;
  let app: Awaited<ReturnType<typeof testApp>>;
  const clients = new Map<Permission | 'anon', Client>();

  beforeAll(async () => {
    const setup = await setupTestDb();
    db = setup.db;
    end = () => setup.pool.end();
    app = await testApp(db);
    await resetDb(db);
    clients.set('anon', new Client(app));
    for (const permission of PERMISSIONS) {
      const email = `${permission.toLowerCase()}@matrix.test`;
      await createEmployee(db, { name: `${permission} user`, email, permission });
      clients.set(permission, await new Client(app).login(email));
    }
  });
  afterAll(async () => {
    await app.close();
    await end();
  });

  const call = (who: Permission | 'anon', method: Method, url: string) =>
    clients
      .get(who)!
      .request(method, url, method === 'GET' || method === 'DELETE' ? undefined : {});

  it('lists every route the API serves', () => {
    const served = new Set<string>();
    // printRoutes draws a tree; rebuild each full path from the indentation depth
    const stack: string[] = [];
    for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
      const m = line.match(/^([│ ]*)[└├]── (\S+)(?: \(([^)]+)\))?/);
      if (!m) continue;
      stack.length = m[1]!.length / 4;
      stack.push(m[2]!);
      for (const method of m[3]?.split(', ') ?? []) {
        if (method !== 'HEAD' && method !== 'OPTIONS') served.add(`${method} ${stack.join('')}`);
      }
    }
    expect(served.size).toBeGreaterThan(30);
    const listed = new Set([
      ...OUTSIDE_MATRIX,
      ...MATRIX.map(([method, url]) => `${method} ${url.replaceAll(ZERO, ':id')}`),
    ]);
    // Prefixed '/' routes answer both with and without a trailing slash
    const normalise = (r: string) => r.replace(/:\w+/g, ':id').replace(/(.)\/$/, '$1');
    const missing = [...served].map(normalise).filter((r) => !listed.has(r));
    expect(missing, 'routes missing from MATRIX').toEqual([]);
  });

  it.each(MATRIX)('%s %s', async (method, url, access) => {
    if (access === 'public') return; // reachable by anyone by design
    const anon = await call('anon', method, url);
    expect(anon.statusCode, 'signed out').toBe(401);
    for (const permission of PERMISSIONS) {
      const res = await call(permission, method, url);
      const allowed = access === 'signed-in' || access.includes(permission);
      if (allowed) {
        expect([401, 403], `${permission} should get past the guard`).not.toContain(res.statusCode);
      } else {
        expect(res.statusCode, `${permission} should be refused`).toBe(403);
      }
    }
  });
});
