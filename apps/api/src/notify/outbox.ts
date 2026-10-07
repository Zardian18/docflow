import type { NotificationTemplate } from '@docflow/shared';
import type { FastifyBaseLogger } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db/client.js';
import { notificationOutbox } from '../db/schema.js';

export interface OutboxMessage {
  workflowId: string;
  recipientId: string;
  toEmail: string;
  template: NotificationTemplate;
  payload: Record<string, unknown>;
  /** Unique per logical notification: a retried or replayed event never queues it twice. */
  dedupeKey: string;
}

export interface OutboundEmail {
  to: string;
  template: NotificationTemplate;
  payload: Record<string, unknown>;
}

/**
 * Email delivery behind an interface (CLAUDE.md: swappable by config). Phase 5 adds the
 * Brevo/Resend adapters; until then `null` means "no provider", and rows are marked skipped
 * so switching email on later doesn't flush a backlog of stale messages.
 */
export interface EmailProvider {
  readonly name: string;
  send(email: OutboundEmail): Promise<void>;
}

/** Inserts outbox rows inside the caller's transaction. Returns ids of rows actually added. */
export async function enqueue(tx: DbOrTx, messages: OutboxMessage[]): Promise<string[]> {
  if (messages.length === 0) return [];
  const rows = await tx
    .insert(notificationOutbox)
    .values(messages)
    .onConflictDoNothing({ target: notificationOutbox.dedupeKey })
    .returning({ id: notificationOutbox.id });
  return rows.map((r) => r.id);
}

const RETRY_BASE_MINUTES = 5;

/**
 * Best-effort delivery of just-committed rows, inside the request that caused them
 * (invariant 10). Never throws: a failure leaves the row for the cron tick to retry.
 * Logs ids and templates only, never addresses (no PII in logs).
 */
export async function deliver(
  db: Db,
  provider: EmailProvider | null,
  ids: string[],
  log: FastifyBaseLogger,
): Promise<void> {
  if (ids.length === 0) return;
  if (!provider) {
    await db
      .update(notificationOutbox)
      .set({ status: 'skipped' })
      .where(and(inArray(notificationOutbox.id, ids), eq(notificationOutbox.status, 'pending')));
    log.info({ outboxIds: ids }, 'email not configured; notifications skipped');
    return;
  }
  const rows = await db
    .select()
    .from(notificationOutbox)
    .where(and(inArray(notificationOutbox.id, ids), eq(notificationOutbox.status, 'pending')));
  for (const row of rows) {
    try {
      await provider.send({
        to: row.toEmail,
        template: row.template as NotificationTemplate,
        payload: row.payload as Record<string, unknown>,
      });
      await db
        .update(notificationOutbox)
        .set({
          status: 'sent',
          sentAt: new Date(),
          attempts: sql`${notificationOutbox.attempts} + 1`,
        })
        .where(eq(notificationOutbox.id, row.id));
      log.info({ outboxId: row.id, template: row.template, provider: provider.name }, 'email sent');
    } catch (err) {
      await db
        .update(notificationOutbox)
        .set({
          status: 'failed',
          attempts: sql`${notificationOutbox.attempts} + 1`,
          lastError: (err as Error).message.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + RETRY_BASE_MINUTES * 60_000),
        })
        .where(eq(notificationOutbox.id, row.id));
      log.warn({ outboxId: row.id, template: row.template }, 'email send failed; will retry');
    }
  }
}
