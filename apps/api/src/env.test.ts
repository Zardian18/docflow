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

  it('requires the B2 settings in production only', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/B2_BUCKET/);
    expect(loadEnv({ ...valid, NODE_ENV: 'development' }).B2_BUCKET).toBeUndefined();
  });

  it('refuses the local storage driver in production', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: 'production', STORAGE_DRIVER: 'local' })).toThrow(
      /STORAGE_DRIVER: local storage is for development and CI only/,
    );
    expect(loadEnv({ ...valid, STORAGE_DRIVER: 'local' }).STORAGE_DRIVER).toBe('local');
  });

  it('normalises WEB_ORIGIN to a bare origin', () => {
    expect(
      loadEnv({ ...valid, WEB_ORIGIN: 'https://docflow.example.workers.dev/' }).WEB_ORIGIN,
    ).toBe('https://docflow.example.workers.dev');
    expect(loadEnv({ ...valid, WEB_ORIGIN: 'https://a.example/app?x=1' }).WEB_ORIGIN).toBe(
      'https://a.example',
    );
  });

  it('trusts the measured Render proxy hops by default', () => {
    expect(loadEnv(valid).TRUSTED_PROXY_HOPS).toBe(3);
    expect(loadEnv({ ...valid, TRUSTED_PROXY_HOPS: '0' }).TRUSTED_PROXY_HOPS).toBe(0);
  });

  it('rejects a short tick secret', () => {
    expect(() => loadEnv({ ...valid, TICK_SHARED_SECRET: 'short' })).toThrow(/at least 32/);
  });
});
