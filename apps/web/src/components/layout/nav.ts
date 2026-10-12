import type { Permission } from '@docflow/shared';

export interface NavItem {
  label: string;
  to: string;
  /** Match only the exact path (for section roots). */
  end?: boolean;
}

/** Sidebar items per permission, as in the Figma screens. */
export const NAV_BY_PERMISSION: Record<Permission, NavItem[]> = {
  ADMIN: [
    { label: 'Dashboard', to: '/admin', end: true },
    { label: 'Company Master', to: '/admin/masters/companies' },
    { label: 'Employee Master', to: '/admin/masters/employees' },
    { label: 'Role Master', to: '/admin/masters/roles' },
  ],
  CREATOR: [
    { label: 'New Submission', to: '/submit' },
    { label: 'My Submissions', to: '/submissions' },
  ],
  APPROVER: [
    { label: 'Pending Approvals', to: '/approvals', end: true },
    { label: 'History', to: '/approvals/history' },
  ],
  CFO: [
    { label: 'Pending Final Approval', to: '/final-approvals', end: true },
    { label: 'History', to: '/final-approvals/history' },
  ],
};

/**
 * Someone with both a Creator and an Approver role (D23) gets both sets, Creator first:
 * creating, then approving, then each side's history.
 */
const CREATOR_AND_APPROVER: NavItem[] = [
  { label: 'New Submission', to: '/submit' },
  { label: 'Pending Approvals', to: '/approvals', end: true },
  { label: 'My Submissions', to: '/submissions' },
  { label: 'Approval History', to: '/approvals/history' },
];

export function navFor(me: { permission: Permission; permissions: Permission[] }): NavItem[] {
  if (me.permissions.includes('CREATOR') && me.permissions.includes('APPROVER')) {
    return CREATOR_AND_APPROVER;
  }
  return NAV_BY_PERMISSION[me.permission];
}
