import { and, eq, gt, isNull } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { passwordTokens } from '../db/schema.js';
import { hashToken, newToken } from './crypto.js';

const TTL_HOURS = { SET: 72, RESET: 1 } as const;
export type PasswordTokenPurpose = keyof typeof TTL_HOURS;

/**
 * Issues a one-time set/reset link. Older unused links for the employee are
 * invalidated. The token goes only into the returned URL, never into logs (D16).
 */
export async function issuePasswordLink(
  db: DbOrTx,
  webOrigin: string,
  employeeId: string,
  purpose: PasswordTokenPurpose,
): Promise<{ url: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + TTL_HOURS[purpose] * 3_600_000);
  await db.transaction(async (tx) => {
    await tx
      .update(passwordTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordTokens.employeeId, employeeId), isNull(passwordTokens.usedAt)));
    await tx
      .insert(passwordTokens)
      .values({ employeeId, tokenHash: hashToken(token), purpose, expiresAt });
  });
  const url = new URL('/set-password', webOrigin);
  url.searchParams.set('token', token);
  return { url: url.toString(), expiresAt };
}

/** Atomically marks a valid token used and returns its employee, or null if invalid/expired/used. */
export async function consumePasswordToken(db: DbOrTx, token: string): Promise<string | null> {
  const [row] = await db
    .update(passwordTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordTokens.tokenHash, hashToken(token)),
        isNull(passwordTokens.usedAt),
        gt(passwordTokens.expiresAt, new Date()),
      ),
    )
    .returning({ employeeId: passwordTokens.employeeId });
  return row?.employeeId ?? null;
}
