import {
  ChangePasswordRequest,
  ForgotPasswordRequest,
  LoginRequest,
  Me,
  SetPasswordRequest,
  type ForgotPasswordRequest as ForgotBody,
  type LoginRequest as LoginBody,
} from '@docflow/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { getDummyHash, hashPassword, verifyPassword } from '../auth/crypto.js';
import { consumePasswordToken } from '../auth/password-links.js';
import { createSession, revokeEmployeeSessions, revokeSession } from '../auth/sessions.js';
import { employees, roles } from '../db/schema.js';
import type { RouteDeps } from './deps.js';
import { AppError, badRequest } from '../errors.js';
import { currentUser, requireUser, SESSION_COOKIE } from '../plugins/auth.js';

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');

export const authRoutes: FastifyPluginAsyncZod<RouteDeps> = async (app, { db, env, limits }) => {
  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: env.SESSION_COOKIE_SAMESITE,
    path: '/',
  } as const;

  // Keyed by IP + email so one attacker can't lock out everyone, nor hammer one account
  const rateLimit = (keyField?: 'email') => ({
    rateLimit: {
      max: limits.authAttemptsPerMinute,
      timeWindow: '1 minute',
      keyGenerator: (request: { ip: string; body?: unknown }) => {
        const email = keyField ? (request.body as Partial<LoginBody | ForgotBody>)?.email : '';
        return `${request.ip}|${typeof email === 'string' ? email.toLowerCase() : ''}`;
      },
    },
  });

  app.post(
    '/login',
    { schema: { body: LoginRequest, response: { 200: Me } }, config: rateLimit('email') },
    async (request, reply) => {
      const { email, password } = request.body;
      const [row] = await db
        .select({
          id: employees.id,
          name: employees.name,
          email: employees.email,
          employeeCode: employees.employeeCode,
          passwordHash: employees.passwordHash,
          roleName: roles.name,
          permission: roles.permission,
        })
        .from(employees)
        .innerJoin(roles, eq(roles.id, employees.roleId))
        .where(
          and(eq(employees.email, email), eq(employees.isActive, true), eq(roles.isActive, true)),
        )
        .limit(1);

      if (!row?.passwordHash) {
        await verifyPassword(await getDummyHash(), password);
        throw invalidCredentials();
      }
      if (!(await verifyPassword(row.passwordHash, password))) throw invalidCredentials();

      const { token, expiresAt } = await createSession(db, row.id, env.SESSION_TTL_HOURS, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
      request.log.info({ employeeId: row.id }, 'login');
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        employeeCode: row.employeeCode,
        roleName: row.roleName,
        permission: row.permission,
      };
    },
  );

  app.post('/logout', async (request, reply) => {
    if (request.user) await revokeSession(db, request.user.sessionId);
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return reply.code(204).send();
  });

  app.get(
    '/me',
    { preHandler: requireUser, schema: { response: { 200: Me } } },
    async (request) => {
      const user = currentUser(request);
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        employeeCode: user.employeeCode,
        roleName: user.roleName,
        permission: user.permission,
      };
    },
  );

  app.post(
    '/change-password',
    { preHandler: requireUser, schema: { body: ChangePasswordRequest } },
    async (request, reply) => {
      const user = currentUser(request);
      const { currentPassword, newPassword } = request.body;
      if (currentPassword === newPassword) {
        throw badRequest('Choose a password different from your current one');
      }
      const [row] = await db
        .select({ passwordHash: employees.passwordHash })
        .from(employees)
        .where(eq(employees.id, user.id));
      if (!row?.passwordHash || !(await verifyPassword(row.passwordHash, currentPassword))) {
        throw new AppError(400, 'WRONG_PASSWORD', 'Your current password is incorrect');
      }
      await db
        .update(employees)
        .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
        .where(eq(employees.id, user.id));
      // Sign out every other device; keep this one
      await revokeEmployeeSessions(db, user.id, user.sessionId);
      return reply.code(204).send();
    },
  );

  // Handles both first-time "set" links and "reset" links
  app.post(
    '/set-password',
    { schema: { body: SetPasswordRequest }, config: rateLimit() },
    async (request, reply) => {
      const { token, password } = request.body;
      const employeeId = await consumePasswordToken(db, token);
      if (!employeeId) {
        throw new AppError(
          400,
          'INVALID_TOKEN',
          'This link is invalid or has expired. Ask your administrator for a new one.',
        );
      }
      const updated = await db
        .update(employees)
        .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
        .where(and(eq(employees.id, employeeId), eq(employees.isActive, true)))
        .returning({ id: employees.id });
      if (updated.length === 0) {
        throw new AppError(400, 'INVALID_TOKEN', 'This account is not active.');
      }
      await revokeEmployeeSessions(db, employeeId);
      request.log.info({ employeeId }, 'password set');
      return reply.code(204).send();
    },
  );

  // Always 202 so the response never reveals whether an email exists.
  // Phase 5 sends the reset email; until then Admin issues links (D16).
  app.post(
    '/forgot-password',
    { schema: { body: ForgotPasswordRequest }, config: rateLimit('email') },
    async (_request, reply) => reply.code(202).send(),
  );
};
