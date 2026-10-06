import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgres://u:p@host/db',
  WEB_ORIGIN: 'https://docflow.example.workers.dev',
  TICK_SHARED_SECRET: 'x'.repeat(32),
};

describe('loadEnv', () => {
  it('applies defaults for optional values', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.SESSION_COOKIE_SAMESITE).toBe('none');
    expect(env.NODE_ENV).toBe('development');
  });

  it('coerces PORT from a string', () => {
    expect(loadEnv({ ...valid, PORT: '10000' }).PORT).toBe(10000);
  });

  it('fails fast listing every missing variable', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL[\s\S]*WEB_ORIGIN[\s\S]*TICK_SHARED_SECRET/);
  });

  it('treats blank values as unset', () => {
    expect(loadEnv({ ...valid, DATABASE_URL_DIRECT: '', PORT: '' }).PORT).toBe(3000);
  });

  it('rejects a short tick secret', () => {
    expect(() => loadEnv({ ...valid, TICK_SHARED_SECRET: 'short' })).toThrow(/at least 32/);
  });
});
