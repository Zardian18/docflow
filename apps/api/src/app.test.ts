import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createDb } from './db/client.js';
import { TEST_TICK_SECRET, testEnv } from './test-helpers.js';

// No real queries run in this file; the pool connects lazily.
const env = testEnv();
const { pool, db } = createDb(env.DATABASE_URL);
const app = await buildApp({ env, db });

beforeAll(() => app.ready());
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('GET /healthz', () => {
  it('returns ok without touching the database', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', commit: null });
  });

  it('sends CORS headers for the configured web origin only', async () => {
    const allowed = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: env.WEB_ORIGIN },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe(env.WEB_ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const other = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'https://evil.example' },
    });
    expect(other.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });
});

describe('POST /internal/tick', () => {
  it('rejects a missing secret', async () => {
    const res = await app.inject({ method: 'POST', url: '/internal/tick' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a wrong secret', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/tick',
      headers: { 'x-tick-secret': 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('does not accept a near-miss secret', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/tick',
      headers: { 'x-tick-secret': `${TEST_TICK_SECRET}x` },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('error responses and request ids (Phase 7 findings 7 and 8)', () => {
  it('answers malformed JSON with a fixed message, not the parser’s text', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { origin: env.WEB_ORIGIN, 'content-type': 'application/json' },
      payload: '{"email": "a@b.c", "password": ',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'BAD_REQUEST',
      message: 'The request could not be processed.',
    });
  });

  it('tags every response with its own request id and ignores one sent by the client', async () => {
    const a = await app.inject({ method: 'GET', url: '/healthz' });
    const b = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': 'attacker-chosen' },
    });
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });

  it('no longer serves the temporary proxy diagnostic', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/diag-ip',
      headers: { 'x-tick-secret': TEST_TICK_SECRET, origin: env.WEB_ORIGIN },
    });
    expect(res.statusCode).toBe(404);
  });
});
