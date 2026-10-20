import { z } from 'zod';
import { Email } from './auth.js';
import { Capability, Gate, Slot, Team } from './people.js';

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
const OptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .default(null);

// ---- Employees (D24) ----------------------------------------------------------

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
  teams: z.array(Team),
  capabilities: z.array(Capability),
  isActive: z.boolean(),
  hasPassword: z.boolean(),
});
export type Employee = z.infer<typeof Employee>;

export const EmployeeCreate = z
  .object({
    name: Name,
    email: Email,
    employeeCode: EmployeeCode.optional().default(null),
    teams: z.array(Team).max(10).default([]),
    capabilities: z.array(Capability).max(10).default([]),
  })
  .refine((v) => v.teams.length + v.capabilities.length > 0, {
    path: ['teams'],
    message: 'Give them at least one team or capability',
  });
export type EmployeeCreate = z.input<typeof EmployeeCreate>;

export const EmployeeUpdate = z
  .object({
    name: Name,
    email: Email,
    employeeCode: EmployeeCode.optional().default(null),
    teams: z.array(Team).max(10).default([]),
    capabilities: z.array(Capability).max(10).default([]),
    isActive: z.boolean(),
  })
  .refine((v) => v.teams.length + v.capabilities.length > 0, {
    path: ['teams'],
    message: 'Give them at least one team or capability',
  });
export type EmployeeUpdate = z.input<typeof EmployeeUpdate>;

export const EmployeeListQuery = ListQuery.extend({
  team: Team.optional(),
  capability: Capability.optional(),
});
export type EmployeeListQuery = z.input<typeof EmployeeListQuery>;

/** A person in a picker */
export const PersonOption = z.object({ id: z.uuid(), name: z.string(), email: z.string() });
export type PersonOption = z.infer<typeof PersonOption>;

export const PeopleSearchQuery = z.object({
  q: z.string().trim().max(100).default(''),
  capability: Capability,
});

// ---- Companies (Q60: who fills each named slot, and ALL/ANY per approval slot) ----------

export const SlotAssignment = z.object({
  slot: Slot,
  people: z.array(PersonOption),
  /** Approval slots only; ALL when not set */
  gate: Gate.nullable(),
});
export type SlotAssignment = z.infer<typeof SlotAssignment>;

export const Company = z.object({
  id: z.uuid(),
  name: z.string(),
  code: z.string().nullable(),
  isActive: z.boolean(),
  slots: z.array(SlotAssignment),
});
export type Company = z.infer<typeof Company>;

export const SlotInput = z.object({
  slot: Slot,
  employeeIds: z.array(z.uuid()).max(20),
  gate: Gate.nullable().optional().default(null),
});
export type SlotInput = z.input<typeof SlotInput>;

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
  slots: z.array(SlotInput).max(20).default([]),
});
export type CompanyUpsert = z.input<typeof CompanyUpsert>;

export const CompanyOption = z.object({
  id: z.uuid(),
  name: z.string(),
  code: z.string().nullable(),
});
export type CompanyOption = z.infer<typeof CompanyOption>;

// ---- Buyers (Q3) --------------------------------------------------------------

export const Buyer = z.object({
  id: z.uuid(),
  name: z.string(),
  country: z.string().nullable(),
  address: z.string().nullable(),
  contact: z.string().nullable(),
  isActive: z.boolean(),
});
export type Buyer = z.infer<typeof Buyer>;

export const BuyerUpsert = z.object({
  name: Name,
  country: OptionalText(80),
  address: OptionalText(500),
  contact: OptionalText(200),
  isActive: z.boolean().default(true),
});
export type BuyerUpsert = z.input<typeof BuyerUpsert>;
