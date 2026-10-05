import type { Env } from './env.js';

export const TEST_TICK_SECRET = 'test-tick-secret-0123456789abcdef0123';

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'test',
    PORT: 3000,
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://unused:unused@localhost:5432/unused',
    DATABASE_URL_DIRECT: undefined,
    WEB_ORIGIN: 'http://localhost:5173',
    SESSION_COOKIE_SAMESITE: 'none',
    TICK_SHARED_SECRET: TEST_TICK_SECRET,
    ...overrides,
  };
}
