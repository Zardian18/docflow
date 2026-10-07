import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import type { Env } from '../env.js';

export interface Limits {
  /** Login / set-password / forgot-password attempts per IP(+email) per minute. */
  authAttemptsPerMinute: number;
  /** Login attempts per email per 15 minutes, from any number of IPs. */
  loginAttemptsPerEmail: number;
  /** Change-password attempts per signed-in user per minute. */
  passwordChangesPerMinute: number;
  /** Uploads, submissions and decisions per signed-in user per minute. */
  userActionsPerMinute: number;
}

export const DEFAULT_LIMITS: Limits = {
  authAttemptsPerMinute: 5,
  loginAttemptsPerEmail: 20,
  passwordChangesPerMinute: 5,
  userActionsPerMinute: 30,
};

export interface RouteDeps {
  db: Db;
  env: Env;
  limits: Limits;
}

/**
 * Route config for a limit keyed by the signed-in user (Phase 7 finding 4). The auth guard
 * runs in onRequest and the limiter in preHandler, so `request.user` is always set here.
 */
export function perUserLimit(max: number) {
  return {
    rateLimit: {
      max,
      timeWindow: '1 minute',
      keyGenerator: (request: FastifyRequest) => `user|${request.user?.id ?? request.ip}`,
    },
  };
}
