import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

// argon2id with the library defaults (OWASP-recommended parameters)
export const hashPassword = (password: string) => hash(password);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Opaque random token for cookies and one-time links. Only its hash is ever stored. */
export const newToken = () => randomBytes(32).toString('base64url');

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Verified against when the email is unknown, so login timing doesn't reveal which emails exist
let dummyHash: Promise<string> | undefined;
export const getDummyHash = () => (dummyHash ??= hashPassword(newToken()));
