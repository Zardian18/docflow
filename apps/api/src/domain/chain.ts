import {
  normalizePositions,
  validateChain,
  type ChainEntry,
  type CompanyApprover,
} from '@docflow/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { companyDefaultApprovers, employees, roles } from '../db/schema.js';
import { AppError } from '../errors.js';

export interface CheckedApprover extends ChainEntry {
  name: string;
  email: string;
}

/**
 * Structural rules (shared with the web forms: min 2, no duplicates, positive steps) plus
 * eligibility: every approver must be an active employee whose active role has the
 * APPROVER permission (D3, invariant 11). Returns the chain with positions normalised
 * to 1..n and each approver's current name/email for snapshots.
 */
export async function checkChain(
  db: DbOrTx,
  approvers: readonly ChainEntry[],
): Promise<CheckedApprover[]> {
  const errors = validateChain(approvers);
  if (errors.length > 0) {
    throw new AppError(400, 'INVALID_CHAIN', 'The approval chain is not valid', { errors });
  }
  const ids = approvers.map((a) => a.employeeId);
  const eligible = await db
    .select({ id: employees.id, name: employees.name, email: employees.email })
    .from(employees)
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .where(
      and(
        inArray(employees.id, ids),
        eq(employees.isActive, true),
        eq(roles.isActive, true),
        eq(roles.permission, 'APPROVER'),
      ),
    );
  const byId = new Map(eligible.map((e) => [e.id, e]));
  const ineligible = ids.filter((id) => !byId.has(id));
  if (ineligible.length > 0) {
    throw new AppError(
      400,
      'INELIGIBLE_APPROVER',
      'Only active employees with an Approver role can be in an approval chain',
      { employeeIds: ineligible },
    );
  }
  return normalizePositions(approvers).map((a) => {
    const person = byId.get(a.employeeId)!;
    return { ...a, name: person.name, email: person.email };
  });
}

/** Default chains (ordered by step, then name) for a set of companies. */
export async function defaultApproversFor(db: DbOrTx, companyIds: string[]) {
  const byCompany = new Map<string, CompanyApprover[]>();
  if (companyIds.length === 0) return byCompany;
  const rows = await db
    .select({
      companyId: companyDefaultApprovers.companyId,
      employeeId: companyDefaultApprovers.employeeId,
      position: companyDefaultApprovers.position,
      name: employees.name,
      isActive: employees.isActive,
    })
    .from(companyDefaultApprovers)
    .innerJoin(employees, eq(employees.id, companyDefaultApprovers.employeeId))
    .where(inArray(companyDefaultApprovers.companyId, companyIds))
    .orderBy(asc(companyDefaultApprovers.position), asc(employees.name));
  for (const { companyId, ...approver } of rows) {
    const list = byCompany.get(companyId) ?? [];
    list.push(approver);
    byCompany.set(companyId, list);
  }
  return byCompany;
}

/** The single active CFO (invariant 4), or null (D18). */
export async function activeCfo(db: DbOrTx) {
  const [cfo] = await db
    .select({ id: employees.id, name: employees.name, email: employees.email })
    .from(employees)
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .where(and(eq(employees.isCfo, true), eq(employees.isActive, true), eq(roles.isActive, true)));
  return cfo ?? null;
}

/** True when two chains differ in who is in them or at which (normalised) step. */
export function chainsDiffer(a: readonly ChainEntry[], b: readonly ChainEntry[]): boolean {
  const key = (chain: readonly ChainEntry[]) =>
    normalizePositions(chain)
      .map((e) => `${e.position}:${e.employeeId}`)
      .sort()
      .join('|');
  return key(a) !== key(b);
}
