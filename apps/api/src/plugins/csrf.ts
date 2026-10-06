import fp from 'fastify-plugin';
import { forbidden } from '../errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The session cookie is SameSite=None until a real domain exists (plan.md §2.3), so the
 * browser would attach it to cross-site requests. Every state-changing request must come
 * from the web origin and be JSON (which forces a CORS preflight for cross-origin callers).
 * Routes that authenticate by other means (the cron tick's shared secret) opt out.
 */
export const csrfPlugin = fp<{ webOrigin: string; exemptPaths: string[] }>(
  async (app, { webOrigin, exemptPaths }) => {
    const exempt = new Set(exemptPaths);
    app.addHook('onRequest', async (request) => {
      if (SAFE_METHODS.has(request.method)) return;
      if (exempt.has(request.routeOptions.url ?? '')) return;
      if (request.headers.origin !== webOrigin) {
        throw forbidden('Request origin not allowed');
      }
      const contentType = request.headers['content-type'] ?? '';
      const hasBody = Number(request.headers['content-length'] ?? 0) > 0;
      if (hasBody && !contentType.startsWith('application/json')) {
        throw forbidden('Requests must be JSON');
      }
    });
  },
);
