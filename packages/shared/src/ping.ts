import { z } from 'zod';

/** Response of GET /v1/ping — proves web, API, and database are wired together. */
export const PingResponse = z.object({
  message: z.literal('pong'),
  dbTime: z.iso.datetime({ offset: true }),
  roleCount: z.number().int().nonnegative(),
});
export type PingResponse = z.infer<typeof PingResponse>;
