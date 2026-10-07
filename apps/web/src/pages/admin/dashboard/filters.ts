import {
  ADMIN_SORTS,
  WORKFLOW_STATUSES,
  type AdminSort,
  type AdminWorkflowQuery,
  type WorkflowStatus,
} from '@docflow/shared';

/**
 * Admin Dashboard filters, kept in the page URL so a filtered view survives a refresh and
 * can be bookmarked or shared. Labels (company / creator names) ride along only for display.
 */
export interface DashboardFilters {
  status?: WorkflowStatus;
  position?: number;
  companyId?: string;
  companyName?: string;
  createdBy?: string;
  createdByName?: string;
  /** Local calendar dates, YYYY-MM-DD. */
  from?: string;
  to?: string;
  q?: string;
  sort: AdminSort;
  dir: 'asc' | 'desc';
  page: number;
}

export const DEFAULT_FILTERS: DashboardFilters = { sort: 'submitted', dir: 'desc', page: 1 };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads filters from the URL, ignoring anything malformed rather than failing. */
export function parseFilters(params: URLSearchParams): DashboardFilters {
  const get = (k: string) => params.get(k) ?? undefined;
  const status = get('status');
  const position = Number(get('position'));
  const page = Number(get('page'));
  const sort = get('sort');
  const id = (k: string) => {
    const v = get(k);
    return v && UUID.test(v) ? v : undefined;
  };
  const date = (k: string) => {
    const v = get(k);
    return v && DATE.test(v) ? v : undefined;
  };
  const validStatus = WORKFLOW_STATUSES.includes(status as WorkflowStatus)
    ? (status as WorkflowStatus)
    : undefined;
  return {
    status: validStatus,
    position:
      validStatus === 'PENDING_APPROVER' && Number.isInteger(position) && position > 0
        ? position
        : undefined,
    companyId: id('companyId'),
    companyName: id('companyId') ? get('companyName') : undefined,
    createdBy: id('createdBy'),
    createdByName: id('createdBy') ? get('createdByName') : undefined,
    from: date('from'),
    to: date('to'),
    q: get('q')?.trim() || undefined,
    sort: ADMIN_SORTS.includes(sort as AdminSort) ? (sort as AdminSort) : DEFAULT_FILTERS.sort,
    dir: get('dir') === 'asc' ? 'asc' : 'desc',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** Writes filters to the URL, leaving out defaults so plain /admin stays clean. */
export function toSearchParams(f: DashboardFilters): URLSearchParams {
  const params = new URLSearchParams();
  const set = (k: string, v: string | number | undefined) => {
    if (v !== undefined && v !== '') params.set(k, String(v));
  };
  set('status', f.status);
  set('position', f.status === 'PENDING_APPROVER' ? f.position : undefined);
  set('companyId', f.companyId);
  set('companyName', f.companyId ? f.companyName : undefined);
  set('createdBy', f.createdBy);
  set('createdByName', f.createdBy ? f.createdByName : undefined);
  set('from', f.from);
  set('to', f.to);
  set('q', f.q);
  if (f.sort !== DEFAULT_FILTERS.sort) set('sort', f.sort);
  if (f.dir !== DEFAULT_FILTERS.dir) set('dir', f.dir);
  if (f.page > 1) set('page', f.page);
  return params;
}

/** The API query: local dates become the start and end of those days as instants. */
export function toApiQuery(f: DashboardFilters, pageSize = 20): AdminWorkflowQuery {
  return {
    page: f.page,
    pageSize,
    status: f.status,
    position: f.status === 'PENDING_APPROVER' ? f.position : undefined,
    companyId: f.companyId,
    createdBy: f.createdBy,
    submittedFrom: f.from ? new Date(`${f.from}T00:00:00`).toISOString() : undefined,
    submittedTo: f.to ? new Date(`${f.to}T23:59:59.999`).toISOString() : undefined,
    q: f.q,
    sort: f.sort,
    dir: f.dir,
  };
}

export const hasActiveFilters = (f: DashboardFilters) =>
  Boolean(f.status || f.companyId || f.createdBy || f.from || f.to || f.q);
