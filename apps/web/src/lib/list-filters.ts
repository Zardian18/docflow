import { useState } from 'react';
import { useSearchParams } from 'react-router';

/**
 * Filters for the Creator, Approver and CFO lists, in the Admin Dashboard style. They live in
 * the page URL, so a filtered view survives a refresh and can be bookmarked.
 */
export interface ListFilterValues {
  status?: string;
  decision?: string;
  companyId?: string;
  /** Local calendar dates, YYYY-MM-DD */
  from?: string;
  to?: string;
  q?: string;
  sort: string;
  dir: 'asc' | 'desc';
  page: number;
}

export interface Choice {
  value: string;
  label: string;
}

export interface SortChoice extends Choice {
  /** Dates start newest first when picked; names A–Z; statuses in progress first */
  kind: 'date' | 'text' | 'status';
}

export const firstDir = (s: SortChoice) => (s.kind === 'date' ? 'desc' : 'asc');

export interface ListFilterSpec {
  sorts: readonly SortChoice[];
  defaultSort: string;
  defaultDir: 'asc' | 'desc';
  statuses?: readonly Choice[];
  decisions?: readonly Choice[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILTER_KEYS = ['status', 'decision', 'companyId', 'from', 'to', 'q'] as const;
const MANAGED = [...FILTER_KEYS, 'sort', 'dir', 'page'];

/** Reads the URL, ignoring anything malformed rather than failing. */
export function parseListFilters(params: URLSearchParams, spec: ListFilterSpec): ListFilterValues {
  const get = (k: string) => params.get(k) ?? undefined;
  const oneOf = (v: string | undefined, choices?: readonly Choice[]) =>
    v && choices?.some((c) => c.value === v) ? v : undefined;
  const date = (k: string) => {
    const v = get(k);
    return v && DATE.test(v) ? v : undefined;
  };
  const companyId = get('companyId');
  const page = Number(get('page'));
  const sort = get('sort');
  const dir = get('dir');
  return {
    status: oneOf(get('status'), spec.statuses),
    decision: oneOf(get('decision'), spec.decisions),
    companyId: companyId && UUID.test(companyId) ? companyId : undefined,
    from: date('from'),
    to: date('to'),
    q: get('q')?.trim() || undefined,
    sort: oneOf(sort, spec.sorts) ?? spec.defaultSort,
    dir: dir === 'asc' || dir === 'desc' ? dir : spec.defaultDir,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** Writes filters to the URL, leaving out defaults so the plain page address stays clean. */
export function listFilterParams(f: ListFilterValues, spec: ListFilterSpec): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) if (f[key]) params.set(key, f[key]);
  if (f.sort !== spec.defaultSort) params.set('sort', f.sort);
  if (f.dir !== spec.defaultDir) params.set('dir', f.dir);
  if (f.page > 1) params.set('page', String(f.page));
  return params;
}

/** Local dates as the start and end of those days, the way the API takes date ranges. */
export const dayStart = (d?: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
export const dayEnd = (d?: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined);

export function useListFilters(spec: ListFilterSpec) {
  const [params, setParams] = useSearchParams();
  const filters = parseListFilters(params, spec);
  // Bumped by "Clear filters" to remount the bar, which resets its search box
  const [barKey, setBarKey] = useState(0);
  // Other parameters on the page (the CFO's ?view= tab) are kept
  const write = (f: ListFilterValues, replace: boolean) => {
    const next = new URLSearchParams(params);
    for (const key of MANAGED) next.delete(key);
    for (const [key, value] of listFilterParams(f, spec)) next.set(key, value);
    setParams(next, { replace });
  };
  const update = (patch: Partial<ListFilterValues>) =>
    write({ ...filters, page: 1, ...patch }, true);
  return {
    filters,
    update,
    barKey,
    active: FILTER_KEYS.some((k) => Boolean(filters[k])),
    clear: () => {
      write({ sort: filters.sort, dir: filters.dir, page: 1 }, true);
      setBarKey((k) => k + 1);
    },
    setPage: (page: number) => write({ ...filters, page }, false),
    /** Column header click: the same column flips direction, a new one starts naturally */
    onSort: (key: string) => {
      const choice = spec.sorts.find((s) => s.value === key);
      if (!choice) return;
      const dir =
        filters.sort === key ? (filters.dir === 'asc' ? 'desc' : 'asc') : firstDir(choice);
      update({ sort: key, dir });
    },
  };
}

/** Status choices shared by My Submissions and the History pages */
export const STATUS_CHOICES: Choice[] = [
  { value: 'PENDING_APPROVER', label: 'Pending approver' },
  { value: 'PENDING_CFO', label: 'Pending CFO' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'REJECTED', label: 'Rejected' },
];
