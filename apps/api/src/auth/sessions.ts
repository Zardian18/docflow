import type { Permission } from '@docflow/shared';
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { employees, roles, sessions } from '../db/schema.js';
import { hashToken, newToken } from './crypto.js';

export interface AuthUser {
  id: string;
  sessionId: string;
  name: string;
  email: string;
  employeeCode: string | null;
  roleName: string;
  permission: Permission;
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
 * Resolves a session token to its user. Permission is read from the role on every
 * request, so deactivating an employee or role takes effect immediately.
 */
export async function loadSession(db: DbOrTx, token: string): Promise<AuthUser | null> {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      id: employees.id,
      name: employees.name,
      email: employees.email,
      employeeCode: employees.employeeCode,
      roleName: roles.name,
      permission: roles.permission,
    })
    .from(sessions)
    .innerJoin(employees, eq(employees.id, sessions.employeeId))
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        eq(employees.isActive, true),
        eq(roles.isActive, true),
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
