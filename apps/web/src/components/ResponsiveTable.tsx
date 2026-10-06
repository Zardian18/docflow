import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ErrorState, ListSkeleton } from './States';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Desktop cell classes (width, alignment). */
  className?: string;
  /** Mobile: shown as the card's title line instead of a label/value pair. */
  primary?: boolean;
  /** Mobile: rendered in the card footer (row actions). */
  action?: boolean;
}

/**
 * A table on md+ screens and a stacked card list below, so every field stays visible on a
 * phone instead of scrolling off the side. Shows skeleton, error and empty states.
 */
export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  isPending,
  error,
  onRetry,
  empty,
  caption,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  isPending: boolean;
  error: unknown;
  onRetry?: () => void;
  empty: ReactNode;
  caption: string;
}) {
  let body: ReactNode;
  if (isPending) body = <ListSkeleton />;
  else if (error) body = <ErrorState error={error} onRetry={onRetry} />;
  else if (!rows || rows.length === 0) body = empty;

  const primary = columns.find((c) => c.primary);
  const details = columns.filter((c) => !c.primary && !c.action);
  const actions = columns.filter((c) => c.action);

  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      {/* Desktop table */}
      <table className="hidden w-full text-left text-sm md:table">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-subtle text-muted-foreground text-[13px]">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn('px-5 py-3 font-medium', c.className)}>
                {c.action ? <span className="sr-only">{c.header}</span> : c.header}
              </th>
            ))}
          </tr>
        </thead>
        {!body && (
          <tbody className="divide-y">
            {rows!.map((row) => (
              <tr key={rowKey(row)} className="align-middle">
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-5 py-3.5', c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        )}
      </table>

      {/* Mobile cards */}
      {!body && (
        <ul className="divide-y md:hidden" aria-label={caption}>
          {rows!.map((row) => (
            <li key={rowKey(row)} className="flex flex-col gap-3 px-4 py-4">
              {primary && <div className="font-medium break-words">{primary.cell(row)}</div>}
              <dl className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                {details.map((c) => (
                  <div key={c.key} className="contents">
                    <dt className="text-muted-foreground">{c.header}</dt>
                    <dd className="min-w-0 break-words">{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
              {actions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {actions.map((c) => (
                    <div key={c.key}>{c.cell(row)}</div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {body}
    </div>
  );
}
