import type { ListQuery } from '@docflow/shared';
import { eq, type AnyColumn, type SQL } from 'drizzle-orm';

/** Escapes LIKE wildcards so user input matches literally. Use with `ESCAPE '\'` (Postgres default). */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export const prefixPattern = (q: string) => `${escapeLike(q.toLowerCase())}%`;
export const containsPattern = (q: string) => `%${escapeLike(q.toLowerCase())}%`;

export function statusCondition(column: AnyColumn, status: ListQuery['status']): SQL | undefined {
  if (status === 'active') return eq(column, true);
  if (status === 'inactive') return eq(column, false);
  return undefined;
}

export const pageOffset = ({ page, pageSize }: ListQuery) => (page - 1) * pageSize;
