import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { PERMISSIONS } from '@docflow/shared';

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
