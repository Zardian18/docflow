import { describe, expect, it } from 'vitest';
import { byPriority, primaryPermission, roleSetProblem, type RoleForCheck } from './roles.js';

const role = (
  id: string,
  permission: RoleForCheck['permission'],
  excludedRoleIds: string[] = [],
): RoleForCheck => ({ id, name: id, permission, excludedRoleIds });

describe('role combinations (D23)', () => {
  it('allows one role, or one Creator role plus one Approver role', () => {
    expect(roleSetProblem([role('Admin', 'ADMIN')])).toBeNull();
    expect(roleSetProblem([role('Creator', 'CREATOR'), role('Approver', 'APPROVER')])).toBeNull();
  });

  it('keeps Admin and CFO roles alone', () => {
    expect(roleSetProblem([role('Admin', 'ADMIN'), role('Creator', 'CREATOR')])).toMatch(
      /Admin can't be combined/,
    );
    expect(roleSetProblem([role('Approver', 'APPROVER'), role('CFO', 'CFO')])).toMatch(
      /CFO can't be combined/,
    );
  });

  it('refuses no role, repeats, two of a kind, more than two, and excluded pairs', () => {
    expect(roleSetProblem([])).toMatch(/at least one/);
    expect(roleSetProblem([role('A', 'APPROVER'), role('A', 'APPROVER')])).toMatch(/twice/);
    expect(roleSetProblem([role('A', 'APPROVER'), role('B', 'APPROVER')])).toMatch(/at most one/);
    expect(
      roleSetProblem([role('C', 'CREATOR'), role('A', 'APPROVER'), role('B', 'APPROVER')]),
    ).toMatch(/at most one/);
    // An exclusion on either side is enough
    expect(roleSetProblem([role('C', 'CREATOR', ['A']), role('A', 'APPROVER')])).toBe(
      "C and A can't be combined",
    );
    expect(roleSetProblem([role('C', 'CREATOR'), role('A', 'APPROVER', ['C'])])).not.toBeNull();
  });

  it('puts the Creator permission ahead of the Approver one', () => {
    expect(primaryPermission(['APPROVER', 'CREATOR'])).toBe('CREATOR');
    expect(byPriority([role('A', 'APPROVER'), role('C', 'CREATOR')]).map((r) => r.id)).toEqual([
      'C',
      'A',
    ]);
  });
});
