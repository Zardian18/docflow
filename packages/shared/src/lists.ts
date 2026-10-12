import { z } from 'zod';
import { WorkflowStatus } from './enums.js';
import { paginated } from './masters.js';

/**
 * Filters and sort for the Creator, Approver and CFO lists, in the style of the Admin
 * Dashboard (URS §5.8). The same names are used in each page's URL.
 */
const Page = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};
/** Inclusive bounds as instants; the browser sends the start/end of the chosen local days. */
const Instant = z.iso.datetime({ offset: true }).optional();
const Search = z.string().trim().max(100).optional();
const Dir = z.enum(['asc', 'desc']);

/** A company that appears in this person's list, for the Company filter. */
export const CompanyFacet = z.object({ id: z.uuid(), name: z.string() });
export type CompanyFacet = z.infer<typeof CompanyFacet>;

/** A page of results plus every company in the person's whole (unfiltered) list. */
export function filteredPage<T extends z.ZodType>(item: T) {
  return paginated(item).extend({ companies: z.array(CompanyFacet) });
}

export const MY_SUBMISSION_SORTS = [
  'submitted',
  'updated',
  'document',
  'company',
  'status',
] as const;
export type MySubmissionSort = (typeof MY_SUBMISSION_SORTS)[number];
export const MySubmissionsQuery = z.object({
  ...Page,
  status: WorkflowStatus.optional(),
  companyId: z.uuid().optional(),
  submittedFrom: Instant,
  submittedTo: Instant,
  q: Search,
  sort: z.enum(MY_SUBMISSION_SORTS).default('submitted'),
  dir: Dir.default('desc'),
});
export type MySubmissionsQuery = z.input<typeof MySubmissionsQuery>;

export const HISTORY_SORTS = ['decided', 'document', 'company', 'status'] as const;
export type HistorySort = (typeof HISTORY_SORTS)[number];
export const DecisionHistoryQuery = z.object({
  ...Page,
  /** What I decided */
  decision: z.enum(['APPROVED', 'REJECTED']).optional(),
  /** Where the document is now */
  status: WorkflowStatus.optional(),
  companyId: z.uuid().optional(),
  decidedFrom: Instant,
  decidedTo: Instant,
  q: Search,
  sort: z.enum(HISTORY_SORTS).default('decided'),
  dir: Dir.default('desc'),
});
export type DecisionHistoryQuery = z.input<typeof DecisionHistoryQuery>;

export const PENDING_SORTS = ['waiting', 'document', 'company'] as const;
export type PendingSort = (typeof PENDING_SORTS)[number];
/** Everything pending has the same status, so there is no status filter. */
export const PendingQuery = z.object({
  companyId: z.uuid().optional(),
  q: Search,
  sort: z.enum(PENDING_SORTS).default('waiting'),
  /** Oldest first by default: what has waited longest comes first */
  dir: Dir.default('asc'),
});
export type PendingQuery = z.input<typeof PendingQuery>;

export const REJECTED_SORTS = ['rejected', 'document', 'company'] as const;
export type RejectedSort = (typeof REJECTED_SORTS)[number];
export const RejectedBeforeFinalQuery = z.object({
  ...Page,
  companyId: z.uuid().optional(),
  q: Search,
  sort: z.enum(REJECTED_SORTS).default('rejected'),
  dir: Dir.default('desc'),
});
export type RejectedBeforeFinalQuery = z.input<typeof RejectedBeforeFinalQuery>;
