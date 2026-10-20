import type { Me } from '@docflow/shared';
import { hasWork } from '@/lib/people';

export interface NavItem {
  label: string;
  to: string;
  /** Match only the exact path (for section roots). */
  end?: boolean;
}

/** Sidebar items from what the person is: their work first, then orders, then masters. */
export function navFor(me: Pick<Me, 'teams' | 'capabilities'>): NavItem[] {
  const items: NavItem[] = [];
  const can = (c: Me['capabilities'][number]) => me.capabilities.includes(c);
  if (hasWork(me)) items.push({ label: 'My Work', to: '/work' });
  items.push({ label: 'Orders', to: '/orders', end: true });
  if (can('MARKETING')) items.push({ label: 'New Order', to: '/orders/new' });
  if (can('ADMIN')) {
    items.push({ label: 'Employees', to: '/admin/employees' });
    items.push({ label: 'Companies', to: '/admin/companies' });
  }
  if (can('ADMIN') || can('MARKETING')) items.push({ label: 'Buyers', to: '/admin/buyers' });
  return items;
}
