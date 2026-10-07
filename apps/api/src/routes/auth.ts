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
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { getDummyHash, hashPassword, verifyPassword } from '../auth/crypto.js';
import { consumePasswordToken } from '../auth/password-links.js';
import { createSession, revokeEmployeeSessions, revokeSession } from '../auth/sessions.js';
import { employees, roles } from '../db/schema.js';
import { perUserLimit, type RouteDeps } from './deps.js';
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

  // A second, slower limit per account from any number of IPs (Phase 7 finding 1). The
  // plugin runs only one hook-style limiter per request, so this one is checked by hand.
  const checkEmail = app.createRateLimit({
    max: limits.loginAttemptsPerEmail,
    timeWindow: '15 minutes',
    keyGenerator: (request) => {
      const email = (request.body as Partial<LoginBody> | undefined)?.email;
      return `email|${typeof email === 'string' ? email.trim().toLowerCase() : ''}`;
    },
  });
  const perEmail = async (request: FastifyRequest) => {
    const result = await checkEmail(request);
    if (!result.isAllowed && result.isExceeded) {
      throw new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please wait and try again.');
    }
  };

  app.post(
    '/login',
    {
      schema: { body: LoginRequest, response: { 200: Me } },
      config: rateLimit('email'),
      preHandler: perEmail,
    },
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

      const { token, expiresAt } = await db.transaction(async (tx) => {
        // Signing in over an existing session (another account, or the same one) ends it
        if (request.user) await revokeSession(tx, request.user.sessionId);
        return createSession(tx, row.id, env.SESSION_TTL_HOURS, {
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        });
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
    {
      onRequest: requireUser,
      config: perUserLimit(limits.passwordChangesPerMinute),
      schema: { body: ChangePasswordRequest },
    },
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
      const passwordHash = await hashPassword(newPassword);
      await db.transaction(async (tx) => {
        await tx
          .update(employees)
          .set({ passwordHash, updatedAt: new Date() })
          .where(eq(employees.id, user.id));
        // Sign out every other device; keep this one
        await revokeEmployeeSessions(tx, user.id, user.sessionId);
      });
      return reply.code(204).send();
    },
  );

  // Handles both first-time "set" links and "reset" links
  app.post(
    '/set-password',
    { schema: { body: SetPasswordRequest }, config: rateLimit() },
    async (request, reply) => {
      const { token, password } = request.body;
      const passwordHash = await hashPassword(password);
      // Token use, new password and sign-out everywhere succeed or fail together
      const employeeId = await db.transaction(async (tx) => {
        const id = await consumePasswordToken(tx, token);
        if (!id) {
          throw new AppError(
            400,
            'INVALID_TOKEN',
            'This link is invalid or has expired. Ask your administrator for a new one.',
          );
        }
        const updated = await tx
          .update(employees)
          .set({ passwordHash, updatedAt: new Date() })
          .where(and(eq(employees.id, id), eq(employees.isActive, true)))
          .returning({ id: employees.id });
        if (updated.length === 0) {
          throw new AppError(400, 'INVALID_TOKEN', 'This account is not active.');
        }
        await revokeEmployeeSessions(tx, id);
        return id;
      });
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
