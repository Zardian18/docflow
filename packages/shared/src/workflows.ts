import { z } from 'zod';
import { WorkflowStatus } from './enums.js';
import { CompanyApprover } from './masters.js';

// ---- Files (decisions.md D20) --------------------------------------------

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const FILE_TYPES = {
  'application/pdf': { label: 'PDF', extension: '.pdf' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    label: 'DOCX',
    extension: '.docx',
  },
} as const;
export type FileMime = keyof typeof FILE_TYPES;
export const FILE_MIMES = Object.keys(FILE_TYPES) as [FileMime, ...FileMime[]];
export const FileMime = z.enum(FILE_MIMES);

/** Maps a file name to an accepted MIME type by extension (browsers report DOCX inconsistently). */
export function mimeForFileName(name: string): FileMime | null {
  const lower = name.toLowerCase();
  for (const mime of FILE_MIMES) {
    if (lower.endsWith(FILE_TYPES[mime].extension)) return mime;
  }
  return null;
}

export const FileName = z
  .string()
  .trim()
  .min(1)
  .max(200, 'File name is too long')
  // No path separators or control characters
  .refine(
    (n) => ![...n].some((ch) => ch === '/' || ch === '\\' || ch.charCodeAt(0) < 0x20),
    'File name contains invalid characters',
  );

export const PresignRequest = z
  .object({
    fileName: FileName,
    contentType: FileMime,
    size: z
      .number()
      .int()
      .positive('The file is empty')
      .max(MAX_UPLOAD_BYTES, 'Files can be at most 10 MB'),
  })
  .refine((v) => mimeForFileName(v.fileName) === v.contentType, {
    path: ['fileName'],
    message: 'Only PDF and DOCX files can be uploaded',
  });
export type PresignRequest = z.infer<typeof PresignRequest>;

export const PresignResponse = z.object({
  uploadId: z.uuid(),
  url: z.url(),
  /** Headers the browser must send with the PUT exactly as given (they are signed). */
  headers: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type PresignResponse = z.infer<typeof PresignResponse>;

// ---- Invoice fields (decisions.md D6) ------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .default(null);

export const InvoiceFields = z.object({
  invoiceNumber: optionalText(60),
  vendorName: optionalText(120),
  invoiceDate: z
    .union([z.iso.date('Use a valid date'), z.literal('')])
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .default(null),
  /** Decimal string, up to 12 digits before the point and 2 after (numeric(14,2)). */
  amount: z
    .string()
    .trim()
    .transform((v) => v.replace(/,/g, ''))
    .refine((v) => v === '' || /^\d{1,12}(\.\d{1,2})?$/.test(v), 'Enter an amount like 12500.50')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .default(null),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code, e.g. INR')
    .default('INR'),
  notes: optionalText(1000),
});
export type InvoiceFields = z.output<typeof InvoiceFields>;

// ---- Creator lookups -------------------------------------------------------

export const CompanySearchQuery = z.object({ q: z.string().trim().max(100).default('') });

export const CompanyOption = z.object({
  id: z.uuid(),
  name: z.string(),
  code: z.string().nullable(),
  approvers: z.array(CompanyApprover),
});
export type CompanyOption = z.infer<typeof CompanyOption>;

// ---- Workflows ---------------------------------------------------------------

export const STEP_STATUSES = ['WAITING', 'PENDING', 'APPROVED', 'REJECTED', 'SKIPPED'] as const;
export const StepStatus = z.enum(STEP_STATUSES);
export type StepStatus = z.infer<typeof StepStatus>;

export const WorkflowCreate = InvoiceFields.extend({
  uploadId: z.uuid(),
  companyId: z.uuid('Choose a company'),
  approvers: z
    .array(z.object({ employeeId: z.uuid(), position: z.number().int().positive() }))
    .max(50),
});
export type WorkflowCreate = z.input<typeof WorkflowCreate>;

export const WorkflowStep = z.object({
  id: z.uuid(),
  position: z.number().int().positive(),
  employeeId: z.uuid(),
  name: z.string(),
  isCfo: z.boolean(),
  status: StepStatus,
  /** When this step became pending. */
  activatedAt: z.iso.datetime({ offset: true }).nullable(),
  decidedAt: z.iso.datetime({ offset: true }).nullable(),
  remarks: z.string().nullable(),
});
export type WorkflowStep = z.infer<typeof WorkflowStep>;

export const WorkflowSummary = z.object({
  id: z.uuid(),
  fileName: z.string(),
  companyName: z.string(),
  status: WorkflowStatus,
  currentPosition: z.number().int().positive(),
  /** Names of the people whose decision is awaited (empty once finished). */
  currentWith: z.array(z.string()),
  submittedAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type WorkflowSummary = z.infer<typeof WorkflowSummary>;

export const AuditEvent = z.object({
  id: z.uuid(),
  type: z.string(),
  actorName: z.string().nullable(),
  /** One readable line, e.g. “Reassigned position 2 from A to B: on leave”. */
  summary: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

/** The caller's own step in this document, if they are in its chain. */
export const MyStep = z.object({
  stepId: z.uuid(),
  position: z.number().int().positive(),
  isCfo: z.boolean(),
  status: StepStatus,
  /** True only while it is this person's turn and the document is still open. */
  canAct: z.boolean(),
});
export type MyStep = z.infer<typeof MyStep>;

export const WorkflowDetail = WorkflowSummary.extend({
  totalPositions: z.number().int().positive(),
  myStep: MyStep.nullable(),
  companyId: z.uuid(),
  companyCode: z.string().nullable(),
  createdByName: z.string(),
  fileMime: z.string(),
  fileSize: z.number().int(),
  chainCustomised: z.boolean(),
  invoiceNumber: z.string().nullable(),
  vendorName: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  amount: z.string().nullable(),
  currency: z.string(),
  notes: z.string().nullable(),
  steps: z.array(WorkflowStep),
  events: z.array(AuditEvent),
});
export type WorkflowDetail = z.infer<typeof WorkflowDetail>;

export const FileLink = z.object({ url: z.url(), expiresAt: z.iso.datetime({ offset: true }) });
export type FileLink = z.infer<typeof FileLink>;

/** Status wording agreed with the owner: no names in the label, even for parallel steps. */
export function workflowStatusLabel(status: WorkflowStatus, currentPosition: number): string {
  switch (status) {
    case 'PENDING_APPROVER':
      return `Pending Approver (Position ${currentPosition})`;
    case 'PENDING_CFO':
      return 'Pending CFO';
    case 'COMPLETED':
      return 'Completed';
    case 'REJECTED':
      return 'Rejected';
  }
}
