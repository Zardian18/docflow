import type { Permission } from '@docflow/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { loadSession, type AuthUser } from '../auth/sessions.js';
import type { Db } from '../db/client.js';
import { forbidden, unauthorized } from '../errors.js';

export const SESSION_COOKIE = 'df_session';

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

/** preHandler factory: 401 unless signed in, 403 unless the role carries one of `allowed`. */
export function requirePermission(...allowed: Permission[]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.user) throw unauthorized();
    if (!allowed.includes(request.user.permission)) throw forbidden();
  };
}

/** Narrowing helper for handlers behind requireUser/requirePermission. */
export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.user) throw unauthorized();
  return request.user;
}
