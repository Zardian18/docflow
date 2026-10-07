import { z } from 'zod';
import { WorkflowStatus } from './enums.js';

/** Admin Dashboard filters (URS §5.8). The same names are used in the page URL. */
export const ADMIN_SORTS = ['submitted', 'updated', 'document', 'company', 'status'] as const;
export const AdminSort = z.enum(ADMIN_SORTS);
export type AdminSort = z.infer<typeof AdminSort>;

export const AdminWorkflowQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: WorkflowStatus.optional(),
    /** With status=PENDING_APPROVER: only documents waiting at this position. */
    position: z.coerce.number().int().positive().optional(),
    companyId: z.uuid().optional(),
    createdBy: z.uuid().optional(),
    /** Inclusive bounds as instants; the browser sends the start/end of the chosen local days. */
    submittedFrom: z.iso.datetime({ offset: true }).optional(),
    submittedTo: z.iso.datetime({ offset: true }).optional(),
    q: z.string().trim().max(100).optional(),
    sort: AdminSort.default('submitted'),
    dir: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((v) => v.position === undefined || v.status === 'PENDING_APPROVER', {
    path: ['position'],
    message: 'A position only applies to documents pending with an approver',
  });
export type AdminWorkflowQuery = z.input<typeof AdminWorkflowQuery>;

export const AdminWorkflowRow = z.object({
  id: z.uuid(),
  fileName: z.string(),
  companyName: z.string(),
  createdByName: z.string(),
  status: WorkflowStatus,
  currentPosition: z.number().int().positive(),
  currentWith: z.array(z.string()),
  submittedAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  invoiceNumber: z.string().nullable(),
  amount: z.string().nullable(),
  currency: z.string(),
});
export type AdminWorkflowRow = z.infer<typeof AdminWorkflowRow>;

/** The count cards on screen 02 (D7: kept; no Export). */
export const AdminStats = z.object({
  total: z.number().int().nonnegative(),
  pendingApprover: z.number().int().nonnegative(),
  pendingCfo: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
});
export type AdminStats = z.infer<typeof AdminStats>;
