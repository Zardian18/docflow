import { and, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from './db/client.js';
import { sessions, uploads } from './db/schema.js';
import { UPLOAD_URL_SECONDS } from './engine/files.js';
import type { StorageService } from './storage/storage.js';

/** Expired or revoked sessions are kept this long (for "signed in from" questions), then purged. */
const SESSION_RETENTION_DAYS = 30;
/** Bounded work per tick, so one call never runs long on a cold instance. */
const BATCH = 100;
const MAX_BATCHES = 20;

export interface MaintenanceResult {
  uploadsRemoved: number;
  sessionsPurged: number;
}

/**
 * Housekeeping run by the cron tick (Phase 7 findings 5 and 13). Never touches anything that
 * backs a workflow: only browser-writable upload objects (documents are copies elsewhere),
 * and dead sessions.
 */
export async function runMaintenance(
  db: Db,
  storage: StorageService,
  log: FastifyBaseLogger,
  now = new Date(),
): Promise<MaintenanceResult> {
  // Uploads that expired unsent, and attached ones whose upload URL has run out (the browser
  // could PUT the same key again until then, so its object is deleted once more): F5
  const urlDead = new Date(now.getTime() - UPLOAD_URL_SECONDS * 1000);
  const done = or(
    and(isNull(uploads.consumedAt), lt(uploads.expiresAt, now)),
    and(isNotNull(uploads.consumedAt), lt(uploads.createdAt, urlDead)),
  );
  let removed = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const rows = await db
      .select({ id: uploads.id, key: uploads.objectKey })
      .from(uploads)
      .where(done)
      .limit(BATCH);
    // Delete the file first: a row without a file is harmless, a file without a row is a leak
    const gone: string[] = [];
    for (const u of rows) {
      try {
        await storage.delete(u.key);
        gone.push(u.id);
      } catch (err) {
        log.warn({ err, uploadId: u.id }, 'could not delete upload; will retry');
      }
    }
    if (gone.length > 0) await db.delete(uploads).where(and(inArray(uploads.id, gone), done));
    removed += gone.length;
    if (rows.length < BATCH || gone.length === 0) break;
  }

  const cutoff = new Date(now.getTime() - SESSION_RETENTION_DAYS * 86_400_000);
  const purged = await db
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, cutoff), lt(sessions.revokedAt, cutoff)))
    .returning({ id: sessions.id });

  return { uploadsRemoved: removed, sessionsPurged: purged.length };
}
