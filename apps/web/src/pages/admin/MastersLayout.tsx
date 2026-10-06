import { NavLink } from 'react-router';
import { cn } from '@/lib/utils';

const TABS = [
  { label: 'Company Master', to: '/admin/masters/companies' },
  { label: 'Employee Master', to: '/admin/masters/employees' },
  { label: 'Role Master', to: '/admin/masters/roles' },
];

/**
 * The tab strip from screen 03. Tabs are links to the same routes as the sidebar items, so
 * the two never disagree. On narrow screens the strip scrolls sideways instead of wrapping.
 */
export function MastersTabs() {
  return (
    <nav aria-label="Masters" className="bg-card -mx-4 mb-5 border-b sm:mx-0 sm:rounded-t-lg">
      <ul className="flex overflow-x-auto px-2 [scrollbar-width:none]">
        {TABS.map((tab) => (
          <li key={tab.to} className="shrink-0">
            <NavLink
              to={tab.to}
              className={({ isActive }) =>
                cn(
                  '-mb-px block border-b-2 px-3 py-3 text-[13px] whitespace-nowrap transition-colors sm:px-4 sm:text-sm',
                  isActive
                    ? 'border-primary text-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground border-transparent',
                )
              }
            >
              {tab.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
