import { z } from 'zod';
import { Permission } from './enums.js';

/** NIST SP 800-63B style: length over composition rules. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

export const Password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(254));

export const LoginRequest = z.object({
  email: Email,
  // Not length-checked here: login must not reveal the password policy of existing hashes
  password: z.string().min(1, 'Enter your password').max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const Me = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  employeeCode: z.string().nullable(),
  roleName: z.string(),
  permission: Permission,
});
export type Me = z.infer<typeof Me>;

export const SetPasswordRequest = z.object({
  token: z.string().min(1).max(200),
  password: Password,
});
export type SetPasswordRequest = z.infer<typeof SetPasswordRequest>;

export const ChangePasswordRequest = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(PASSWORD_MAX_LENGTH),
  newPassword: Password,
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;

export const ForgotPasswordRequest = z.object({ email: Email });
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>;

export const PasswordLink = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type PasswordLink = z.infer<typeof PasswordLink>;
