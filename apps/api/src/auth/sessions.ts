import type { Capability, Team } from '@docflow/shared';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { employeeCapabilities, employees, sessions, teamMembers } from '../db/schema.js';
import { hashToken, newToken } from './crypto.js';

export interface AuthUser {
  id: string;
  sessionId: string;
  name: string;
  email: string;
  employeeCode: string | null;
  /** Team pools this person is in (any number, D24) */
  teams: Team[];
  /** What they may be named as, and Admin */
  capabilities: Capability[];
}

// The outer row is named explicitly: in a single-table select the ORM writes a bare "id",
// which inside a subquery would resolve to the subquery's own table
const EMPLOYEE_ID = sql.raw('"employees"."id"');

/** A person's teams and capabilities as arrays, for a select list */
export const teamsOf = sql<Team[]>`coalesce(
  (select array_agg(tm.team::text order by tm.team) from ${teamMembers} tm where tm.employee_id = ${EMPLOYEE_ID}),
  '{}')`;
export const capabilitiesOf = sql<Capability[]>`coalesce(
  (select array_agg(ec.capability::text order by ec.capability) from ${employeeCapabilities} ec where ec.employee_id = ${EMPLOYEE_ID}),
  '{}')`;

export async function createSession(
  db: DbOrTx,
  employeeId: string,
  ttlHours: number,
  meta: { ip?: string; userAgent?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
  await db.insert(sessions).values({
    employeeId,
    tokenHash: hashToken(token),
    expiresAt,
    ip: meta.ip,
    userAgent: meta.userAgent?.slice(0, 300),
  });
  return { token, expiresAt };
}

/**
 * Resolves a session token to its user. Teams and capabilities are read on every request,
 * so deactivating someone or changing their teams takes effect immediately.
 */
export async function loadSession(db: DbOrTx, token: string): Promise<AuthUser | null> {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      id: employees.id,
      name: employees.name,
      email: employees.email,
      employeeCode: employees.employeeCode,
      teams: teamsOf,
      capabilities: capabilitiesOf,
    })
    .from(sessions)
    .innerJoin(employees, eq(employees.id, sessions.employeeId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        eq(employees.isActive, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function revokeSession(db: DbOrTx, sessionId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

/** Revokes every live session of an employee, optionally keeping one (the caller's). */
export async function revokeEmployeeSessions(
  db: DbOrTx,
  employeeId: string,
  exceptSessionId?: string,
): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.employeeId, employeeId),
        isNull(sessions.revokedAt),
        exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined,
      ),
    );
}
