import { and, inArray, isNull, lt, or } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from './db/client.js';
import { sessions, uploads } from './db/schema.js';
import type { StorageService } from './storage/storage.js';

/** Expired or revoked sessions are kept this long (for "signed in from" questions), then purged. */
const SESSION_RETENTION_DAYS = 30;
/** Bounded work per tick, so one call never runs long on a cold instance. */
const BATCH = 100;

export interface MaintenanceResult {
  uploadsRemoved: number;
  sessionsPurged: number;
}

/**
 * Housekeeping run by the cron tick (Phase 7 findings 5 and 13). Never touches anything that
 * backs a workflow: only uploads that expired without being submitted, and dead sessions.
 */
export async function runMaintenance(
  db: Db,
  storage: StorageService,
  log: FastifyBaseLogger,
  now = new Date(),
): Promise<MaintenanceResult> {
  const abandoned = await db
    .select({ id: uploads.id, key: uploads.objectKey })
    .from(uploads)
    .where(and(isNull(uploads.consumedAt), lt(uploads.expiresAt, now)))
    .limit(BATCH);
  // Delete the file first: a row without a file is harmless, a file without a row is a leak
  const removed: string[] = [];
  for (const u of abandoned) {
    try {
      await storage.delete(u.key);
      removed.push(u.id);
    } catch (err) {
      log.warn({ err, uploadId: u.id }, 'could not delete abandoned upload; will retry');
    }
  }
  if (removed.length > 0) {
    await db.delete(uploads).where(and(inArray(uploads.id, removed), isNull(uploads.consumedAt)));
  }

  const cutoff = new Date(now.getTime() - SESSION_RETENTION_DAYS * 86_400_000);
  const purged = await db
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, cutoff), lt(sessions.revokedAt, cutoff)))
    .returning({ id: sessions.id });

  return { uploadsRemoved: removed.length, sessionsPurged: purged.length };
}
