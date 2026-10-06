import type { Permission } from '@docflow/shared';

export const PERMISSION_LABEL: Record<Permission, string> = {
  ADMIN: 'Admin',
  CREATOR: 'Creator',
  APPROVER: 'Approver',
  CFO: 'CFO',
};

export const PERMISSION_DESCRIPTION: Record<Permission, string> = {
  ADMIN: 'Manages masters and sees every workflow',
  CREATOR: 'Uploads documents and starts workflows',
  APPROVER: 'Reviews documents when their step is reached',
  CFO: 'Gives the final approval on every workflow',
};
