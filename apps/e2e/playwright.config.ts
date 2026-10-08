import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the real API and the production web build, served with the same
 * security headers (CSP included) as Cloudflare. Files use the API's local storage driver,
 * so no B2 is needed. The database is a throwaway docflow_e2e, recreated and seeded with
 * seed:demo on every run.
 */
const API_PORT = 3100;
const WEB_PORT = 4173;
const API = `http://localhost:${API_PORT}`;
const WEB = `http://localhost:${WEB_PORT}`;
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://docflow:docflow@localhost:5432/docflow_e2e';

const apiEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'warn',
  PORT: String(API_PORT),
  DATABASE_URL,
  // Set explicitly so a value in the caller's environment can never redirect migrations
  DATABASE_URL_DIRECT: DATABASE_URL,
  WEB_ORIGIN: WEB,
  TRUSTED_PROXY_HOPS: '0',
  STORAGE_DRIVER: 'local',
  LOCAL_STORAGE_DIR: path.resolve(import.meta.dirname, '.storage'),
  API_PUBLIC_URL: API,
  TICK_SHARED_SECRET: 'e2e-tick-secret-not-used-anywhere-else-0123',
};

export default defineConfig({
  testDir: './tests',
  // One shared, seeded database: tests run in order, one at a time
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  webServer: [
    {
      command: [
        'node prepare-db.mjs',
        // seed:demo applies migrations first
        'pnpm --dir ../api exec tsx src/seed-demo.ts',
        'pnpm --dir ../api exec tsx src/server.ts',
      ].join(' && '),
      // The API binds 0.0.0.0 (IPv4); `localhost` may resolve to ::1 first on some machines
      url: `http://127.0.0.1:${API_PORT}/healthz`,
      env: apiEnv,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: `pnpm --dir ../web exec vite build && pnpm --dir ../web exec vite preview --port ${WEB_PORT} --strictPort`,
      url: WEB,
      env: { VITE_API_BASE_URL: API },
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
