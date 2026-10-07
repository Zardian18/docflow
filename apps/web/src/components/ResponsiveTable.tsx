import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
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
  /** Makes the header a sort button for this key. */
  sortKey?: string;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
}) {
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'hover:text-foreground -mx-1 inline-flex items-center gap-1 rounded px-1 font-medium',
        active && 'text-foreground',
      )}
    >
      {label}
      <Icon className={cn('size-3.5', !active && 'opacity-50')} aria-hidden />
    </button>
  );
}

/**
 * A table on md+ screens and a stacked card list below, so every field stays visible on a
 * phone instead of scrolling off the side. Shows skeleton, error and empty states.
 * Optional: sortable headers (keyboard-accessible, announced via aria-sort) and row clicks.
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
  sort,
  onSort,
  onRowClick,
  cardsBelow = 'md',
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  isPending: boolean;
  error: unknown;
  onRetry?: () => void;
  empty: ReactNode;
  caption: string;
  sort?: SortState;
  onSort?: (key: string) => void;
  /** Mouse convenience; each row must still contain a real link for keyboard users. */
  onRowClick?: (row: T) => void;
  /** Wide tables can stay as cards on tablets too, so no column is ever cut off. */
  cardsBelow?: 'md' | 'lg' | 'xl';
}) {
  // Literal class names so Tailwind generates them
  const tableClass = { md: 'hidden md:table', lg: 'hidden lg:table', xl: 'hidden xl:table' }[
    cardsBelow
  ];
  const cardsClass = { md: 'md:hidden', lg: 'lg:hidden', xl: 'xl:hidden' }[cardsBelow];
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
      <table className={cn('w-full text-left text-sm', tableClass)}>
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-subtle text-muted-foreground text-[13px]">
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.sortKey;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={cn('px-5 py-3 font-medium', c.className)}
                  aria-sort={
                    c.sortKey && active
                      ? sort!.dir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                >
                  {c.action ? (
                    <span className="sr-only">{c.header}</span>
                  ) : c.sortKey && onSort ? (
                    <SortHeader
                      label={c.header}
                      active={active}
                      dir={sort?.dir ?? 'desc'}
                      onClick={() => onSort(c.sortKey!)}
                    />
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        {!body && (
          <tbody className="divide-y">
            {rows!.map((row) => (
              <tr
                key={rowKey(row)}
                className={cn(
                  'align-middle',
                  onRowClick && 'hover:bg-surface-subtle cursor-pointer',
                )}
                onClick={
                  onRowClick
                    ? (e) => {
                        // Let links and buttons inside the row do their own thing
                        if ((e.target as HTMLElement).closest('a,button')) return;
                        onRowClick(row);
                      }
                    : undefined
                }
              >
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
        <ul className={cn('divide-y', cardsClass)} aria-label={caption}>
          {rows!.map((row) => (
            <li key={rowKey(row)} className="flex flex-col gap-3 px-4 py-4">
              {primary && <div className="font-medium break-words">{primary.cell(row)}</div>}
              {/* Label beside value from 420px; on the narrowest phones the label sits above it */}
              <dl className="flex flex-col gap-2.5 text-sm min-[420px]:grid min-[420px]:grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] min-[420px]:gap-x-3 min-[420px]:gap-y-2">
                {details.map((c) => (
                  <div key={c.key} className="flex flex-col gap-0.5 min-[420px]:contents">
                    <dt className="text-muted-foreground text-xs min-[420px]:text-sm">
                      {c.header}
                    </dt>
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
