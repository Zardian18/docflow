import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import type { Db } from './db/client.js';
import { testEnv } from './test-helpers.js';
import {
  Client,
  createEmployee,
  resetDb,
  setupTestDb,
  TEST_DB_URL,
  TEST_PASSWORD,
  testApp,
} from './test-db.js';

describe.skipIf(!TEST_DB_URL)('auth', () => {
  let db: Db;
  let end: () => Promise<void>;
  let app: Awaited<ReturnType<typeof testApp>>;

  beforeAll(async () => {
    const setup = await setupTestDb();
    db = setup.db;
    end = () => setup.pool.end();
    app = await testApp(db);
  });
  afterAll(async () => {
    await app.close();
    await end();
  });
  beforeEach(async () => {
    await resetDb(db);
    await createEmployee(db, {
      name: 'A. Mehta',
      email: 'admin@docflow.test',
      permission: 'ADMIN',
    });
  });

  describe('login', () => {
    it('signs in by email (case-insensitive) and sets a Secure, HttpOnly, SameSite=None cookie', async () => {
      const res = await new Client(app).post('/v1/auth/login', {
        email: '  Admin@DocFlow.TEST ',
        password: TEST_PASSWORD,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ email: 'admin@docflow.test', permission: 'ADMIN' });
      const cookie = res.cookies.find((c) => c.name === 'df_session');
      expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'None', path: '/' });
    });

    it('gives the same generic error for an unknown email and a wrong password', async () => {
      const unknown = await new Client(app).post('/v1/auth/login', {
        email: 'nobody@docflow.test',
        password: TEST_PASSWORD,
      });
      const wrong = await new Client(app).post('/v1/auth/login', {
        email: 'admin@docflow.test',
        password: 'wrong-password-123',
      });
      expect(unknown.statusCode).toBe(401);
      expect(wrong.statusCode).toBe(401);
      expect(unknown.json()).toEqual(wrong.json());
    });

    it('refuses deactivated employees and employees without a password yet', async () => {
      await createEmployee(db, {
        name: 'Gone',
        email: 'gone@docflow.test',
        permission: 'APPROVER',
        active: false,
      });
      await createEmployee(db, {
        name: 'New',
        email: 'new@docflow.test',
        permission: 'APPROVER',
        password: false,
      });
      for (const email of ['gone@docflow.test', 'new@docflow.test']) {
        const res = await new Client(app).post('/v1/auth/login', {
          email,
          password: TEST_PASSWORD,
        });
        expect(res.statusCode).toBe(401);
      }
    });

    it('does not authenticate by employee code (D4)', async () => {
      const res = await new Client(app).post('/v1/auth/login', {
        email: 'EMP-0231',
        password: TEST_PASSWORD,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('session', () => {
    it('me returns the user; logout revokes the session server-side', async () => {
      const client = await new Client(app).login('admin@docflow.test');
      const stolenCookie = client.cookie;
      expect((await client.get('/v1/auth/me')).json()).toMatchObject({ name: 'A. Mehta' });

      expect((await client.post('/v1/auth/logout')).statusCode).toBe(204);
      const replay = new Client(app);
      replay.cookie = stolenCookie;
      expect((await replay.get('/v1/auth/me')).statusCode).toBe(401);
    });

    it('rejects a missing or forged cookie with 401', async () => {
      expect((await new Client(app).get('/v1/auth/me')).statusCode).toBe(401);
      const forged = new Client(app);
      forged.cookie = 'df_session=not-a-real-token';
      expect((await forged.get('/v1/auth/me')).statusCode).toBe(401);
    });

    it('expires sessions after the TTL', async () => {
      const shortApp = await buildApp({
        env: testEnv({ DATABASE_URL: TEST_DB_URL ?? '', SESSION_TTL_HOURS: 0.0000001 }),
        db,
      });
      const client = await new Client(shortApp).login('admin@docflow.test');
      await new Promise((r) => setTimeout(r, 20));
      expect((await client.get('/v1/auth/me')).statusCode).toBe(401);
      await shortApp.close();
    });
  });

  describe('CSRF protection (cookie is SameSite=None)', () => {
    it('rejects state-changing requests from another origin', async () => {
      const evil = new Client(app, 'https://evil.example');
      const res = await evil.post('/v1/auth/login', {
        email: 'admin@docflow.test',
        password: TEST_PASSWORD,
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects non-JSON bodies', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: {
          origin: testEnv().WEB_ORIGIN,
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: 'email=admin%40docflow.test&password=x',
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('passwords', () => {
    it('change-password checks the current one and signs out other devices', async () => {
      const laptop = await new Client(app).login('admin@docflow.test');
      const phone = await new Client(app).login('admin@docflow.test');

      const wrong = await laptop.post('/v1/auth/change-password', {
        currentPassword: 'nope-nope-nope',
        newPassword: 'a-brand-new-password',
      });
      expect(wrong.statusCode).toBe(400);

      const ok = await laptop.post('/v1/auth/change-password', {
        currentPassword: TEST_PASSWORD,
        newPassword: 'a-brand-new-password',
      });
      expect(ok.statusCode).toBe(204);
      expect((await laptop.get('/v1/auth/me')).statusCode).toBe(200);
      expect((await phone.get('/v1/auth/me')).statusCode).toBe(401);
      await new Client(app).login('admin@docflow.test', 'a-brand-new-password');
    });

    it('enforces the 12-character minimum', async () => {
      const client = await new Client(app).login('admin@docflow.test');
      const res = await client.post('/v1/auth/change-password', {
        currentPassword: TEST_PASSWORD,
        newPassword: 'short',
      });
      expect(res.statusCode).toBe(400);
    });

    it('a set-password link works exactly once', async () => {
      const id = await createEmployee(db, {
        name: 'P. Kulkarni',
        email: 'pk@docflow.test',
        permission: 'APPROVER',
        password: false,
      });
      const admin = await new Client(app).login('admin@docflow.test');
      const link = await admin.post(`/v1/employees/${id}/password-link`);
      expect(link.statusCode).toBe(200);
      const url = new URL(link.json().url);
      expect(url.origin).toBe(testEnv().WEB_ORIGIN);
      const token = url.searchParams.get('token');

      const anon = new Client(app);
      expect(
        (await anon.post('/v1/auth/set-password', { token, password: 'my-first-password' }))
          .statusCode,
      ).toBe(204);
      expect(
        (await anon.post('/v1/auth/set-password', { token, password: 'second-try-password' }))
          .statusCode,
      ).toBe(400);
      await new Client(app).login('pk@docflow.test', 'my-first-password');
    });

    it('issuing a new link invalidates the previous one', async () => {
      const id = await createEmployee(db, {
        name: 'X',
        email: 'x@docflow.test',
        permission: 'APPROVER',
        password: false,
      });
      const admin = await new Client(app).login('admin@docflow.test');
      const first = new URL((await admin.post(`/v1/employees/${id}/password-link`)).json().url);
      await admin.post(`/v1/employees/${id}/password-link`);
      const res = await new Client(app).post('/v1/auth/set-password', {
        token: first.searchParams.get('token'),
        password: 'my-first-password',
      });
      expect(res.statusCode).toBe(400);
    });

    it('forgot-password always answers 202 (no account enumeration)', async () => {
      for (const email of ['admin@docflow.test', 'nobody@docflow.test']) {
        expect((await new Client(app).post('/v1/auth/forgot-password', { email })).statusCode).toBe(
          202,
        );
      }
    });
  });

  it('rate-limits login attempts per IP and email', async () => {
    const limited = await buildApp({
      env: testEnv({ DATABASE_URL: TEST_DB_URL ?? '' }),
      db,
      limits: { authAttemptsPerMinute: 3 },
    });
    const client = new Client(limited);
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push(
        (
          await client.post('/v1/auth/login', {
            email: 'admin@docflow.test',
            password: 'wrong-wrong-wrong',
          })
        ).statusCode,
      );
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
    await limited.close();
  });
});
