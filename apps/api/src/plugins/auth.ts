import type { Capability, Team } from '@docflow/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { loadSession, type AuthUser } from '../auth/sessions.js';
import type { Db } from '../db/client.js';
import { forbidden, unauthorized } from '../errors.js';

// __Host- makes the browser refuse it unless Secure, Path=/ and host-only (Phase 7 finding 10)
export const SESSION_COOKIE = '__Host-df_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

/** Resolves the session cookie (if any) into request.user on every request. */
export const authPlugin = fp<{ db: Db }>(async (app, { db }) => {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    request.user = token ? await loadSession(db, token) : null;
  });
});

/** preHandler: 401 unless signed in. */
export async function requireUser(request: FastifyRequest, _reply: FastifyReply) {
  if (!request.user) throw unauthorized();
}

/** preHandler factory: 401 unless signed in, 403 unless they hold one of `allowed`. */
export function requireCapability(...allowed: Capability[]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.user) throw unauthorized();
    if (!request.user.capabilities.some((c) => allowed.includes(c))) throw forbidden();
  };
}

/** preHandler factory: 401 unless signed in, 403 unless they are in one of `allowed`. */
export function requireTeam(...allowed: Team[]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.user) throw unauthorized();
    if (!request.user.teams.some((t) => allowed.includes(t))) throw forbidden();
  };
}

/** Narrowing helper for handlers behind requireUser/requirePermission. */
export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.user) throw unauthorized();
  return request.user;
}
