import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/** Where the browser PUTs uploads (presigned B2 URLs). Override at build time if the bucket moves. */
const DEFAULT_STORAGE_ORIGIN = 'https://s3.eu-central-003.backblazeb2.com';

/**
 * The response headers for every page (Phase 7 finding 3). The API origin comes from the same
 * build variable the app uses, so the policy can't drift from where the app sends requests.
 */
function securityHeaders(apiBaseUrl: string, storageOrigin: string): Record<string, string> {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    // Radix positions popovers and sonner injects its stylesheet at runtime
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${new URL(apiBaseUrl).origin} ${new URL(storageOrigin).origin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Strict-Transport-Security': 'max-age=31536000',
  };
}

/** Writes dist/_headers, which Cloudflare Workers static assets applies to every response. */
function headersFile(headers: Record<string, string>): Plugin {
  return {
    name: 'docflow-security-headers',
    apply: 'build',
    generateBundle() {
      const lines = Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`);
      this.emitFile({ type: 'asset', fileName: '_headers', source: `/*\n${lines.join('\n')}\n` });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBaseUrl = env.VITE_API_BASE_URL;
  if (command === 'build' && !apiBaseUrl) {
    throw new Error('VITE_API_BASE_URL must be set for a production build');
  }
  const headers = apiBaseUrl
    ? securityHeaders(apiBaseUrl, env.STORAGE_ORIGIN || DEFAULT_STORAGE_ORIGIN)
    : {};
  return {
    plugins: [react(), tailwindcss(), headersFile(headers)],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    // `vite preview` (used by the E2E tests) serves the build with the production headers
    preview: { headers },
  };
});
