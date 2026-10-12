import type { Permission } from './enums.js';

/**
 * Multiple roles per person (decisions.md D23). Admin and CFO roles are always a person's only
 * role. Otherwise a person holds at most one Creator-type and one Approver-type role, unless
 * those two roles exclude each other.
 */
export const EXCLUSIVE_PERMISSIONS: readonly Permission[] = ['ADMIN', 'CFO'];

/** Which permission leads: it picks the landing page and is listed first. */
export const PERMISSION_PRIORITY: readonly Permission[] = ['ADMIN', 'CFO', 'CREATOR', 'APPROVER'];

export const isCombinable = (permission: Permission) => !EXCLUSIVE_PERMISSIONS.includes(permission);

export function primaryPermission(permissions: readonly Permission[]): Permission {
  const first = PERMISSION_PRIORITY.find((p) => permissions.includes(p));
  if (!first) throw new Error('A person must hold at least one role');
  return first;
}

/** Sorts roles in priority order (Creator before Approver), keeping the input untouched. */
export function byPriority<T extends { permission: Permission }>(roles: readonly T[]): T[] {
  return [...roles].sort(
    (a, b) => PERMISSION_PRIORITY.indexOf(a.permission) - PERMISSION_PRIORITY.indexOf(b.permission),
  );
}

export interface RoleForCheck {
  id: string;
  name: string;
  permission: Permission;
  excludedRoleIds: readonly string[];
}

/** Why this set of roles can't be held together, or null when it can. */
export function roleSetProblem(roles: readonly RoleForCheck[]): string | null {
  if (roles.length === 0) return 'Choose at least one role';
  if (new Set(roles.map((r) => r.id)).size !== roles.length) return 'A role is listed twice';
  const exclusive = roles.find((r) => !isCombinable(r.permission));
  if (exclusive && roles.length > 1) {
    return `${exclusive.name} can't be combined with any other role`;
  }
  if (roles.length > 2) return 'Choose at most one Creator role and one Approver role';
  const [a, b] = roles;
  if (a && b) {
    if (a.permission === b.permission) {
      return 'Choose at most one Creator role and one Approver role';
    }
    if (a.excludedRoleIds.includes(b.id) || b.excludedRoleIds.includes(a.id)) {
      return `${a.name} and ${b.name} can't be combined`;
    }
  }
  return null;
}
