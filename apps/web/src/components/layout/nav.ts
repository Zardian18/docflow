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
