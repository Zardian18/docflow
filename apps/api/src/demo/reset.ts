import { sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db/client.js';
import type { StorageService } from '../storage/storage.js';

/** Tables the reset empties completely, in the order the counts are reported. */
const WIPED = [
  'workflows',
  'workflow_steps',
  'audit_events',
  'notification_outbox',
  'uploads',
  'companies',
  'company_default_approvers',
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
    select e.email, e.name, (e.is_active and r.is_system and r.permission = 'ADMIN') as ok
    from employees e join roles r on r.id = e.role_id
    where e.email in ${list(emails)}`);
  for (const email of emails) {
    const row = kept.find((k) => k.email === email);
    if (!row) throw new Error(`No employee with the email ${email}`);
    if (!row.ok)
      throw new Error(`${email} must be an active employee with the built-in Admin role`);
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
  rows.roles = await count(db, sql`select count(*)::int as n from roles where not is_system`);
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
    sql`select count(*)::int as n from (select file_key from workflows union select object_key from uploads where consumed_at is null) f`,
  );
  return { kept: kept.map(({ email, name }) => ({ email, name })), rows, files };
}

/**
 * The pre-go-live test-data wipe (D21): deletes every document with its steps, audit trail,
 * notifications and stored files, every company, every employee except `keepEmails` (who
 * must be Admins), and every custom role. Built-in roles stay and are reactivated.
 *
 * Never part of the app: it runs only from the `reset:data` CLI, on the owner's request,
 * after a fresh backup (docs/runbook-backup.md). It is the one sanctioned way audit events
 * are removed: TRUNCATE skips the append-only row trigger (invariant 7) by design.
 */
export async function resetData(db: Db, storage: StorageService, keepEmails: string[]) {
  const { plan, fileKeys } = await db.transaction(async (tx) => {
    // Nothing can be submitted, decided or signed in to until the wipe commits
    await tx.execute(
      sql`lock table ${sql.raw(WIPED.join(', '))}, employees in access exclusive mode`,
    );
    const plan = await planReset(tx, keepEmails);
    const { rows } = await tx.execute<{ key: string }>(
      sql`select file_key as key from workflows union select object_key from uploads where consumed_at is null`,
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
    await tx.execute(sql`delete from roles where not is_system`);
    await tx.execute(sql`update roles set is_active = true where is_system`);
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
