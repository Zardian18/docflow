import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { PERMISSIONS, STEP_STATUSES, WORKFLOW_STATUSES } from '@docflow/shared';

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const permissionEnum = pgEnum('permission', PERMISSIONS);
export const passwordTokenPurpose = pgEnum('password_token_purpose', ['SET', 'RESET']);

// plan.md §4.1 — custom-named roles, each carrying one mandatory permission (D3)
export const roles = pgTable(
  'roles',
  {
    id: id(),
    name: text('name').notNull(),
    permission: permissionEnum('permission').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('roles_name_lower_unique').on(sql`lower(${t.name})`)],
);

export const employees = pgTable(
  'employees',
  {
    id: id(),
    // Optional display/search field; login is by email (D4). Stored uppercase.
    employeeCode: text('employee_code'),
    name: text('name').notNull(),
    // Stored lowercase; the login identifier
    email: text('email').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    passwordHash: text('password_hash'),
    isActive: boolean('is_active').notNull().default(true),
    // Mirrors roles.permission = 'CFO' so the DB can enforce a single active CFO
    isCfo: boolean('is_cfo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('employees_email_unique').on(t.email),
    uniqueIndex('employees_code_unique').on(t.employeeCode),
    uniqueIndex('employees_one_active_cfo')
      .on(t.isCfo)
      .where(sql`${t.isCfo} and ${t.isActive}`),
    index('employees_role_idx').on(t.roleId),
    index('employees_name_lower_idx').on(sql`lower(${t.name}) text_pattern_ops`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    tokenHash: text('token_hash').notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    index('sessions_employee_idx').on(t.employeeId),
  ],
);

export const passwordTokens = pgTable(
  'password_tokens',
  {
    id: id(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    tokenHash: text('token_hash').notNull(),
    purpose: passwordTokenPurpose('purpose').notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('password_tokens_hash_unique').on(t.tokenHash),
    index('password_tokens_employee_idx').on(t.employeeId),
  ],
);

export const companies = pgTable(
  'companies',
  {
    id: id(),
    name: text('name').notNull(),
    // Optional short code, stored uppercase
    code: text('code'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('companies_name_lower_unique').on(sql`lower(${t.name})`),
    uniqueIndex('companies_code_unique').on(t.code),
  ],
);

// position may repeat within a company: a repeated value is a parallel group (D1)
export const companyDefaultApprovers = pgTable(
  'company_default_approvers',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    position: integer('position').notNull(),
  },
  (t) => [
    uniqueIndex('company_default_approvers_unique').on(t.companyId, t.employeeId),
    index('company_default_approvers_employee_idx').on(t.employeeId),
    check('company_default_approvers_position_positive', sql`${t.position} > 0`),
  ],
);

// ---- Phase 3: uploads and workflows (plan.md §4.1) -------------------------

export const workflowStatusEnum = pgEnum('workflow_status', WORKFLOW_STATUSES);
export const stepStatusEnum = pgEnum('step_status', STEP_STATUSES);

/** A presigned upload, before it becomes a workflow. One upload backs at most one workflow. */
export const uploads = pgTable(
  'uploads',
  {
    id: uuid('id').primaryKey(),
    objectKey: text('object_key').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => employees.id),
    fileName: text('file_name').notNull(),
    fileMime: text('file_mime').notNull(),
    fileSize: integer('file_size').notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uploads_object_key_unique').on(t.objectKey),
    index('uploads_created_by_idx').on(t.createdBy),
  ],
);

export const workflows = pgTable(
  'workflows',
  {
    id: id(),
    uploadId: uuid('upload_id')
      .notNull()
      .references(() => uploads.id),
    title: text('title').notNull(),
    fileKey: text('file_key').notNull(),
    fileName: text('file_name').notNull(),
    fileMime: text('file_mime').notNull(),
    fileSize: integer('file_size').notNull(),
    fileSha256: text('file_sha256').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => employees.id),
    status: workflowStatusEnum('status').notNull(),
    currentPosition: integer('current_position').notNull(),
    chainCustomised: boolean('chain_customised').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
    version: integer('version').notNull().default(1),
    // Invoice fields (decisions.md D6), all optional
    invoiceNumber: text('invoice_number'),
    vendorName: text('vendor_name'),
    invoiceDate: date('invoice_date', { mode: 'string' }),
    amount: numeric('amount', { precision: 14, scale: 2 }),
    currency: text('currency').notNull().default('INR'),
    notes: text('notes'),
  },
  (t) => [
    uniqueIndex('workflows_upload_unique').on(t.uploadId),
    index('workflows_created_by_idx').on(t.createdBy, t.submittedAt),
    index('workflows_company_idx').on(t.companyId),
    index('workflows_status_idx').on(t.status),
    // Admin Dashboard default view: newest first, id as tie-breaker (EXPLAIN in PR for Phase 6)
    // Ascending: Postgres scans it backwards for the default newest-first order
    index('workflows_submitted_idx').on(t.submittedAt, t.id),
  ],
);

/**
 * The chain snapshot (invariant 2): names and emails are copied at submit so history stays
 * readable after master edits. A repeated position is a parallel group (D1); the CFO row is
 * always the highest position and alone.
 */
export const workflowSteps = pgTable(
  'workflow_steps',
  {
    id: id(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    position: integer('position').notNull(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    employeeName: text('employee_name').notNull(),
    employeeEmail: text('employee_email').notNull(),
    isCfo: boolean('is_cfo').notNull().default(false),
    status: stepStatusEnum('status').notNull(),
    /** When this step became PENDING (drives “Waiting since”). */
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    remarks: text('remarks'),
  },
  (t) => [
    uniqueIndex('workflow_steps_unique').on(t.workflowId, t.employeeId),
    index('workflow_steps_workflow_position_idx').on(t.workflowId, t.position),
    index('workflow_steps_employee_status_idx').on(t.employeeId, t.status),
    check('workflow_steps_position_positive', sql`${t.position} > 0`),
  ],
);

/** Append-only (invariant 7): a trigger rejects UPDATE and DELETE (see migration). */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: id(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    actorId: uuid('actor_id').references(() => employees.id),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    // clock_timestamp(), not now(): several events in one transaction must keep their order
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [index('audit_events_workflow_idx').on(t.workflowId, t.createdAt)],
);

// ---- Phase 4: notifications outbox (plan.md §2.4, invariants 6 and 10) ------

export const outboxStatusEnum = pgEnum('outbox_status', ['pending', 'sent', 'failed', 'skipped']);

/**
 * Written in the same transaction as the decision that causes it; delivery is attempted
 * synchronously right after commit, and the cron tick retries only pending/failed rows.
 */
export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: id(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => employees.id),
    toEmail: text('to_email').notNull(),
    template: text('template').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: outboxStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    lastError: text('last_error'),
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('notification_outbox_dedupe_unique').on(t.dedupeKey),
    index('notification_outbox_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} in ('pending', 'failed')`),
    index('notification_outbox_workflow_idx').on(t.workflowId),
  ],
);
