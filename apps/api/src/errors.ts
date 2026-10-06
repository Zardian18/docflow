/** An expected failure with a stable `error` code for the client (body shape: shared ApiErrorBody). */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Please sign in') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have access to this') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);

/** Postgres unique_violation, optionally on a specific constraint/index. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string; cause?: unknown } | null;
  if (e?.code === '23505') return constraint === undefined || e.constraint === constraint;
  // drizzle wraps driver errors in `cause`
  return e?.cause !== undefined && isUniqueViolation(e.cause, constraint);
}
