import { count, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  auditEvents,
  companies,
  companyDefaultApprovers,
  employees,
  passwordTokens,
  roles,
  sessions,
  uploads,
  workflowSteps,
  workflows,
} from '../db/schema.js';
import { conflict, notFound } from '../errors.js';
import type { StorageService } from '../storage/storage.js';

/**
 * Hard delete is allowed only for records that nothing else refers to (decisions.md D21):
 * mistakes and test entries. Anything with history must be deactivated instead, so audit
 * trails stay readable (URS §6, invariant 7).
 */
const hasHistory = (message: string) =>
  conflict('HAS_HISTORY', `${message} It can be deactivated instead.`);

async function countOf(query: Promise<{ n: number }[]>): Promise<number> {
  const [row] = await query;
  return row?.n ?? 0;
}

export async function deleteEmployee(
  db: Db,
  storage: StorageService,
  actorId: string,
  id: string,
): Promise<void> {
  if (id === actorId) throw conflict('CANNOT_CHANGE_SELF', 'You cannot delete your own account.');
  const [employee] = await db
    .select({ name: employees.name })
    .from(employees)
    .where(eq(employees.id, id));
  if (!employee) throw notFound('Employee');

  const history =
    (await countOf(
      db.select({ n: count() }).from(workflowSteps).where(eq(workflowSteps.employeeId, id)),
    )) +
    (await countOf(db.select({ n: count() }).from(workflows).where(eq(workflows.createdBy, id)))) +
    (await countOf(db.select({ n: count() }).from(auditEvents).where(eq(auditEvents.actorId, id))));
  if (history > 0) throw hasHistory(`${employee.name} is part of at least one submitted document.`);

  const chains = await db
    .select({ name: companies.name })
    .from(companyDefaultApprovers)
    .innerJoin(companies, eq(companies.id, companyDefaultApprovers.companyId))
    .where(eq(companyDefaultApprovers.employeeId, id));
  if (chains.length > 0) {
    throw conflict(
      'EMPLOYEE_IN_CHAINS',
      `${employee.name} is a default approver for ${chains.map((c) => c.name).join(', ')}. Remove them from those approval chains first.`,
      { companies: chains },
    );
  }

  // Files they uploaded but never submitted are leftovers, not history
  const leftovers = await db
    .select({ key: uploads.objectKey })
    .from(uploads)
    .where(eq(uploads.createdBy, id));
  await db.transaction(async (tx) => {
    await tx.delete(uploads).where(eq(uploads.createdBy, id));
    await tx.delete(sessions).where(eq(sessions.employeeId, id));
    await tx.delete(passwordTokens).where(eq(passwordTokens.employeeId, id));
    await tx.delete(employees).where(eq(employees.id, id));
  });
  await Promise.allSettled(leftovers.map((u) => storage.delete(u.key)));
}

export async function deleteCompany(db: Db, id: string): Promise<void> {
  const [company] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, id));
  if (!company) throw notFound('Company');
  if (await countOf(db.select({ n: count() }).from(workflows).where(eq(workflows.companyId, id)))) {
    throw hasHistory(`Documents have been submitted for ${company.name}.`);
  }
  // Its default approvers go with it (ON DELETE CASCADE)
  await db.delete(companies).where(eq(companies.id, id));
}

export async function deleteRole(db: Db, id: string): Promise<void> {
  const [role] = await db
    .select({ name: roles.name, isSystem: roles.isSystem })
    .from(roles)
    .where(eq(roles.id, id));
  if (!role) throw notFound('Role');
  if (role.isSystem) throw conflict('SYSTEM_ROLE', 'Built-in roles cannot be deleted.');
  const holders = await countOf(
    db.select({ n: count() }).from(employees).where(eq(employees.roleId, id)),
  );
  if (holders > 0) {
    throw conflict(
      'ROLE_IN_USE',
      `${holders} employee(s), active or inactive, still have the ${role.name} role. Move them to another role first.`,
    );
  }
  await db.delete(roles).where(eq(roles.id, id));
}
