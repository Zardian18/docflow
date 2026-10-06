import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Neon pooled connection string (runtime queries)
  DATABASE_URL: z.url(),
  // Neon direct connection string (migrations); falls back to DATABASE_URL
  DATABASE_URL_DIRECT: z.url().optional(),

  // Exact origin of the web app, for CORS with credentials
  WEB_ORIGIN: z.url(),

  // None until a real domain exists (plan.md §2.3), then lax
  SESSION_COOKIE_SAMESITE: z.enum(['none', 'lax', 'strict']).default('none'),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .positive()
    .max(24 * 30)
    .default(12),

  // Shared with the cron worker's TICK_SECRET
  TICK_SHARED_SECRET: z.string().min(32, 'TICK_SHARED_SECRET must be at least 32 characters'),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parse and validate environment variables. Throws (listing every problem) if invalid. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // A blank line like `DATABASE_URL_DIRECT=` in .env means "not set", not an empty value
  const defined = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const result = EnvSchema.safeParse(defined);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
