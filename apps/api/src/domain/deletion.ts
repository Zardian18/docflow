import { count, eq, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  approvalVotes,
  buyers,
  companies,
  companySlotPeople,
  componentChanges,
  documents,
  employees,
  orderEvents,
  orders,
  orderSlotPeople,
  passwordTokens,
  payments,
  sessions,
  shipmentCheckpoints,
  uploads,
} from '../db/schema.js';
import { conflict, notFound } from '../errors.js';
import type { StorageService } from '../storage/storage.js';

/**
 * Hard delete is allowed only for records nothing refers to (D21): mistakes and test entries.
 * Anything with history must be deactivated instead, so order histories stay readable.
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

  const counts = await Promise.all([
    countOf(db.select({ n: count() }).from(orders).where(eq(orders.createdBy, id))),
    countOf(
      db.select({ n: count() }).from(orderSlotPeople).where(eq(orderSlotPeople.employeeId, id)),
    ),
    countOf(db.select({ n: count() }).from(orderEvents).where(eq(orderEvents.actorId, id))),
    countOf(db.select({ n: count() }).from(documents).where(eq(documents.uploadedBy, id))),
    countOf(db.select({ n: count() }).from(approvalVotes).where(eq(approvalVotes.employeeId, id))),
    countOf(db.select({ n: count() }).from(payments).where(eq(payments.verifiedBy, id))),
    countOf(
      db
        .select({ n: count() })
        .from(shipmentCheckpoints)
        .where(eq(shipmentCheckpoints.loggedBy, id)),
    ),
    countOf(
      db.select({ n: count() }).from(componentChanges).where(eq(componentChanges.actorId, id)),
    ),
  ]);
  if (counts.some((n) => n > 0))
    throw hasHistory(`${employee.name} is part of at least one order.`);

  const named = await db
    .selectDistinct({ name: companies.name })
    .from(companySlotPeople)
    .innerJoin(companies, eq(companies.id, companySlotPeople.companyId))
    .where(eq(companySlotPeople.employeeId, id));
  if (named.length > 0) {
    throw conflict(
      'EMPLOYEE_NAMED',
      `${employee.name} is named in ${named.map((c) => c.name).join(', ')}. Change those companies first.`,
      { companies: named },
    );
  }

  // Files they uploaded but never attached are leftovers, not history
  const leftovers = await db
    .select({ key: uploads.objectKey })
    .from(uploads)
    .where(eq(uploads.createdBy, id));
  await db.transaction(async (tx) => {
    await tx.delete(uploads).where(eq(uploads.createdBy, id));
    await tx.delete(sessions).where(eq(sessions.employeeId, id));
    await tx.delete(passwordTokens).where(eq(passwordTokens.employeeId, id));
    // Team memberships and capabilities go with them (ON DELETE CASCADE)
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
  if (await countOf(db.select({ n: count() }).from(orders).where(eq(orders.companyId, id)))) {
    throw hasHistory(`Orders exist for ${company.name}.`);
  }
  // Its named people and gates go with it (ON DELETE CASCADE)
  await db.delete(companies).where(eq(companies.id, id));
}

export async function deleteBuyer(db: Db, id: string): Promise<void> {
  const [buyer] = await db.select({ name: buyers.name }).from(buyers).where(eq(buyers.id, id));
  if (!buyer) throw notFound('Buyer');
  if (
    await countOf(
      db
        .select({ n: count() })
        .from(orders)
        .where(or(eq(orders.buyerId, id))),
    )
  ) {
    throw hasHistory(`Orders exist for ${buyer.name}.`);
  }
  await db.delete(buyers).where(eq(buyers.id, id));
}
