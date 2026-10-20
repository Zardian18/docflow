import { sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db/client.js';
import type { StorageService } from '../storage/storage.js';

/** Tables the reset empties completely, in the order the counts are reported. */
const WIPED = [
  'orders',
  'tasks',
  'holder_intervals',
  'approval_votes',
  'channel_rounds',
  'documents',
  'payments',
  'order_components',
  'component_changes',
  'shipment_checkpoints',
  'order_events',
  'order_products',
  'order_slot_people',
  'order_slot_gates',
  'uploads',
  'buyers',
  'companies',
  'company_slot_people',
  'company_slot_gates',
] as const;

export interface ResetPlan {
  kept: Array<{ email: string; name: string }>;
  /** Rows that will be deleted, per table */
  rows: Record<string, number>;
  files: number;
}

/** `(e1, e2, …)` as bound parameters */
const list = (values: string[]) =>
  sql`(${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;

async function count(db: DbOrTx, query: ReturnType<typeof sql>) {
  const { rows } = await db.execute<{ n: number }>(query);
  return rows[0]!.n;
}

/**
 * Checks the accounts to keep and counts what would go. Every kept account must exist, be
 * active and hold the built-in Admin role, so the app is still manageable afterwards.
 */
export async function planReset(db: DbOrTx, keepEmails: string[]): Promise<ResetPlan> {
  const emails = keepEmails.map((e) => e.trim().toLowerCase());
  if (emails.length === 0) throw new Error('Name at least one Admin account to keep');
  const { rows: kept } = await db.execute<{
    email: string;
    name: string;
    ok: boolean;
  }>(sql`
    select e.email, e.name, e.is_active and exists (
             select 1 from employee_capabilities c
              where c.employee_id = e.id and c.capability = 'ADMIN') as ok
    from employees e
    where e.email in ${list(emails)}`);
  for (const email of emails) {
    const row = kept.find((k) => k.email === email);
    if (!row) throw new Error(`No employee with the email ${email}`);
    if (!row.ok) throw new Error(`${email} must be an active employee with Admin access`);
  }

  const keep = sql`(select id from employees where email in ${list(emails)})`;
  const rows: Record<string, number> = {};
  for (const table of WIPED) {
    rows[table] = await count(db, sql`select count(*)::int as n from ${sql.identifier(table)}`);
  }
  rows.employees = await count(
    db,
    sql`select count(*)::int as n from employees where id not in ${keep}`,
  );
  rows.sessions = await count(
    db,
    sql`select count(*)::int as n from sessions where employee_id not in ${keep}`,
  );
  rows.password_tokens = await count(
    db,
    sql`select count(*)::int as n from password_tokens where employee_id not in ${keep}`,
  );
  // A submitted upload's own object was already removed when it was copied to documents/
  const files = await count(
    db,
    sql`select count(*)::int as n from (select file_key from documents union select object_key from uploads where consumed_at is null) f`,
  );
  return { kept: kept.map(({ email, name }) => ({ email, name })), rows, files };
}

/**
 * The pre-go-live test-data wipe (D21, v2): deletes every order with its tasks, history and
 * stored files, every buyer and company, and every employee except `keepEmails` (who must be
 * Admins, and keep their teams and capabilities).
 *
 * Never part of the app: it runs only from the `reset:data` CLI, on the owner's request,
 * after a fresh backup (docs/runbook-backup.md). It is the one sanctioned way order events
 * are removed: TRUNCATE skips the append-only row trigger by design.
 */
export async function resetData(db: Db, storage: StorageService, keepEmails: string[]) {
  const { plan, fileKeys } = await db.transaction(async (tx) => {
    // Nothing can be submitted, decided or signed in to until the wipe commits
    await tx.execute(
      sql`lock table ${sql.raw(WIPED.join(', '))}, employees in access exclusive mode`,
    );
    const plan = await planReset(tx, keepEmails);
    const { rows } = await tx.execute<{ key: string }>(
      sql`select file_key as key from documents union select object_key from uploads where consumed_at is null`,
    );
    const emails = list(plan.kept.map((k) => k.email));
    await tx.execute(sql`truncate ${sql.raw(WIPED.join(', '))}`);
    await tx.execute(
      sql`delete from sessions where employee_id not in (select id from employees where email in ${emails})`,
    );
    await tx.execute(
      sql`delete from password_tokens where employee_id not in (select id from employees where email in ${emails})`,
    );
    await tx.execute(sql`delete from employees where email not in ${emails}`);
    return { plan, fileKeys: rows.map((r) => r.key) };
  });

  // Files go after the commit: a failure leaves an unreferenced file, never a broken record
  let failedFiles = 0;
  for (const key of fileKeys) {
    try {
      await storage.delete(key);
    } catch {
      failedFiles++;
    }
  }
  return { ...plan, deletedFiles: fileKeys.length - failedFiles, failedFiles };
}
