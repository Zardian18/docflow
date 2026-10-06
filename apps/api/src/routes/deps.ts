import type { Db } from '../db/client.js';
import type { Env } from '../env.js';

export interface Limits {
  /** Login / set-password / forgot-password attempts per IP(+email) per minute. */
  authAttemptsPerMinute: number;
}

export interface RouteDeps {
  db: Db;
  env: Env;
  limits: Limits;
}
