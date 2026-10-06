import { z } from 'zod';
import { Email } from './auth.js';
import { Permission } from './enums.js';

// ---- Common ----------------------------------------------------------------

export const StatusFilter = z.enum(['active', 'inactive', 'all']);
export type StatusFilter = z.infer<typeof StatusFilter>;

export const ListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: StatusFilter.default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListQuery = z.infer<typeof ListQuery>;

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  });
}
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Every API error body. `details` carries structured context (e.g. blocking companies). */
export const ApiErrorBody = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export const IdParam = z.object({ id: z.uuid() });

const Name = z.string().trim().min(1, 'Required').max(120);

// ---- Roles -----------------------------------------------------------------

export const Role = z.object({
  id: z.uuid(),
  name: z.string(),
  permission: Permission,
  isSystem: z.boolean(),
  isActive: z.boolean(),
  activeEmployeeCount: z.number().int().nonnegative(),
});
export type Role = z.infer<typeof Role>;

export const RoleCreate = z.object({ name: Name, permission: Permission });
export type RoleCreate = z.infer<typeof RoleCreate>;

/** A role's permission is fixed once created (create a new role instead). */
export const RoleUpdate = z.object({ name: Name, isActive: z.boolean() });
export type RoleUpdate = z.infer<typeof RoleUpdate>;

// ---- Employees -------------------------------------------------------------

export const EmployeeCode = z
  .string()
  .trim()
  .max(40)
  .transform((v) => (v === '' ? null : v.toUpperCase()))
  .nullable();

export const Employee = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  employeeCode: z.string().nullable(),
  roleId: z.uuid(),
  roleName: z.string(),
  permission: Permission,
  isActive: z.boolean(),
  hasPassword: z.boolean(),
});
export type Employee = z.infer<typeof Employee>;

export const EmployeeCreate = z.object({
  name: Name,
  email: Email,
  employeeCode: EmployeeCode.optional().default(null),
  roleId: z.uuid('Choose a role'),
});
export type EmployeeCreate = z.input<typeof EmployeeCreate>;

export const EmployeeUpdate = EmployeeCreate.extend({ isActive: z.boolean() });
export type EmployeeUpdate = z.input<typeof EmployeeUpdate>;

export const ApproverOption = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  roleName: z.string(),
});
export type ApproverOption = z.infer<typeof ApproverOption>;

export const ApproverSearchQuery = z.object({ q: z.string().trim().max(100).default('') });

export const CfoInfo = z.object({
  cfo: z.object({ id: z.uuid(), name: z.string(), email: z.string() }).nullable(),
});
export type CfoInfo = z.infer<typeof CfoInfo>;

// ---- Companies -------------------------------------------------------------

export const CompanyApprover = z.object({
  employeeId: z.uuid(),
  name: z.string(),
  position: z.number().int().positive(),
  isActive: z.boolean(),
});
export type CompanyApprover = z.infer<typeof CompanyApprover>;

export const Company = z.object({
  id: z.uuid(),
  name: z.string(),
  code: z.string().nullable(),
  isActive: z.boolean(),
  approvers: z.array(CompanyApprover),
});
export type Company = z.infer<typeof Company>;

export const CompanyUpsert = z.object({
  name: Name,
  code: z
    .string()
    .trim()
    .max(20)
    .transform((v) => (v === '' ? null : v.toUpperCase()))
    .nullable()
    .optional()
    .default(null),
  isActive: z.boolean().default(true),
  approvers: z
    .array(z.object({ employeeId: z.uuid(), position: z.number().int().positive() }))
    .max(50),
});
export type CompanyUpsert = z.input<typeof CompanyUpsert>;
