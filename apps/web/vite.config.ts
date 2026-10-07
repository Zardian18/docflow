import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/** Where the browser PUTs uploads (presigned B2 URLs). Override at build time if the bucket moves. */
const DEFAULT_STORAGE_ORIGIN = 'https://s3.eu-central-003.backblazeb2.com';

/**
 * Writes dist/_headers, which Cloudflare Workers static assets applies to every response
 * (Phase 7 finding 3). The API origin comes from the same build variable the app uses, so
 * the policy can't drift from where the app actually sends requests.
 */
function securityHeaders(apiBaseUrl: string | undefined, storageOrigin: string): Plugin {
  return {
    name: 'docflow-security-headers',
    apply: 'build',
    generateBundle() {
      if (!apiBaseUrl) throw new Error('VITE_API_BASE_URL must be set for a production build');
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
      const headers = [
        `Content-Security-Policy: ${csp}`,
        'X-Frame-Options: DENY',
        'X-Content-Type-Options: nosniff',
        'Referrer-Policy: strict-origin-when-cross-origin',
        'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        'Strict-Transport-Security: max-age=31536000',
      ];
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: `/*\n${headers.map((h) => `  ${h}`).join('\n')}\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      securityHeaders(env.VITE_API_BASE_URL, env.STORAGE_ORIGIN || DEFAULT_STORAGE_ORIGIN),
    ],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
  };
});
