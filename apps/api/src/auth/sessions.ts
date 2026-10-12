import { byPriority, primaryPermission, type HeldRole, type Permission } from '@docflow/shared';
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { employees, sessions } from '../db/schema.js';
import { heldRoles } from '../domain/roles.js';
import { hashToken, newToken } from './crypto.js';

export interface AuthUser {
  id: string;
  sessionId: string;
  name: string;
  email: string;
  employeeCode: string | null;
  /** Role names joined, for display */
  roleName: string;
  /** The leading permission (Creator before Approver), which picks the landing page */
  permission: Permission;
  /** Every permission of the person's active roles, in priority order (D23) */
  permissions: Permission[];
}

/** The signed-in shape of a person, from their active roles (none means no access). */
export function withRoles<T extends object>(
  person: T,
  held: HeldRole[],
): (T & Pick<AuthUser, 'roleName' | 'permission' | 'permissions'>) | null {
  if (held.length === 0) return null;
  const sorted = byPriority(held);
  const permissions = sorted.map((r) => r.permission);
  return {
    ...person,
    roleName: sorted.map((r) => r.name).join(' + '),
    permission: primaryPermission(permissions),
    permissions,
  };
}

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
 * Resolves a session token to its user. Permissions are read from the roles on every
 * request, so deactivating an employee or a role takes effect immediately.
 */
export async function loadSession(db: DbOrTx, token: string): Promise<AuthUser | null> {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      id: employees.id,
      name: employees.name,
      email: employees.email,
      employeeCode: employees.employeeCode,
      roles: heldRoles({ activeOnly: true }),
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
  if (!row) return null;
  const { roles: held, ...person } = row;
  return withRoles(person, held);
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
