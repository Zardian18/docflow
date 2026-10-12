import { byPriority, roleSetProblem, type HeldRole, type Permission } from '@docflow/shared';
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { employeeRoles, roleExclusions, roles } from '../db/schema.js';
import { AppError } from '../errors.js';

// Correlated subqueries name the outer row explicitly: in a single-table select the ORM writes
// a bare "id", which inside a subquery would resolve to the subquery's own table
const EMPLOYEE_ID = sql.raw('"employees"."id"');
const ROLE_ID = sql.raw('"roles"."id"');

/**
 * SQL condition: `employees` holds an active role with this permission (D23). Use it wherever
 * the code used to compare an employee's single role.
 */
export function holdsPermission(permission: Permission): SQL {
  return sql`exists (
    select 1 from ${employeeRoles} er join ${roles} r on r.id = er.role_id
    where er.employee_id = ${EMPLOYEE_ID} and er.permission = ${permission} and r.is_active
  )`;
}

/**
 * The roles `employees` holds, as a JSON array for a select list (sort with byPriority).
 * `activeOnly` leaves out deactivated roles: what the person may actually do right now.
 */
export function heldRoles({ activeOnly }: { activeOnly: boolean }) {
  return sql<HeldRole[]>`coalesce((
    select json_agg(json_build_object('id', r.id, 'name', r.name, 'permission', r.permission))
      from ${employeeRoles} er join ${roles} r on r.id = er.role_id
     where er.employee_id = ${EMPLOYEE_ID} ${activeOnly ? sql`and r.is_active` : sql``}
  ), '[]'::json)`;
}

/** Roles with their exclusions, for checking a combination. Unknown ids are reported. */
export async function rolesForCheck(db: DbOrTx, roleIds: string[]) {
  const found = await db
    .select({
      id: roles.id,
      name: roles.name,
      permission: roles.permission,
      isActive: roles.isActive,
      excludedRoleIds: sql<string[]>`coalesce(
        (select array_agg(x.excluded_role_id) from ${roleExclusions} x where x.role_id = ${ROLE_ID}),
        '{}'::uuid[])`,
    })
    .from(roles)
    .where(inArray(roles.id, roleIds));
  if (found.length !== new Set(roleIds).size) {
    throw new AppError(400, 'ROLE_NOT_FOUND', 'Choose a valid role');
  }
  return roleIds.map((id) => found.find((r) => r.id === id)!);
}

/**
 * Validates the roles a person will hold. Newly added roles must be active; roles they
 * already hold may stay even if since deactivated (only possible for inactive people).
 */
export async function checkRoleSet(db: DbOrTx, roleIds: string[], alreadyHeld: string[] = []) {
  const held = await rolesForCheck(db, roleIds);
  const inactive = held.find((r) => !r.isActive && !alreadyHeld.includes(r.id));
  if (inactive) throw new AppError(400, 'ROLE_INACTIVE', `${inactive.name} is inactive`);
  const problem = roleSetProblem(held);
  if (problem) throw new AppError(400, 'INVALID_ROLES', problem);
  return byPriority(held);
}

/** Replaces a person's roles (already checked with checkRoleSet). */
export async function setRoles(
  db: DbOrTx,
  employeeId: string,
  held: Array<{ id: string; permission: Permission }>,
) {
  await db.delete(employeeRoles).where(eq(employeeRoles.employeeId, employeeId));
  await db
    .insert(employeeRoles)
    .values(held.map((r) => ({ employeeId, roleId: r.id, permission: r.permission })));
}
