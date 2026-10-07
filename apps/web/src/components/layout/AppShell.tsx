import type { Me } from '@docflow/shared';
import { useMutation } from '@tanstack/react-query';
import { ChevronsUpDown, KeyRound, LogOut, Menu } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Logo } from '@/components/Logo';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { api, errorMessage } from '@/lib/api';
import { useSignOutLocally } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { NAV_BY_PERMISSION } from './nav';

function NavLinks({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-1">
      {NAV_BY_PERMISSION[me.permission].map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm transition-colors',
                isActive
                  ? 'bg-primary-soft text-primary font-medium'
                  : 'text-foreground hover:bg-muted',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  aria-hidden
                  className={cn('size-1.5 rounded-full', isActive ? 'bg-primary' : 'bg-border')}
                />
                {item.label}
              </>
            )}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function UserMenu({ me }: { me: Me }) {
  const navigate = useNavigate();
  const signOutLocally = useSignOutLocally();
  const logout = useMutation({
    mutationFn: api.auth.logout,
    onSettled: () => {
      signOutLocally();
      navigate('/login', { replace: true });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="bg-muted/70 hover:bg-muted flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
        >
          <UserAvatar name={me.name} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{me.name}</span>
            <span className="text-muted-foreground block truncate text-xs">{me.roleName}</span>
          </span>
          <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <span className="sr-only">Account menu</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
      >
        <DropdownMenuLabel className="font-normal">
          <span className="block text-sm font-medium">{me.name}</span>
          <span className="text-muted-foreground block truncate text-xs">{me.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/account/password')}>
          <KeyRound aria-hidden />
          Change password
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => logout.mutate()} disabled={logout.isPending}>
          <LogOut aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarContents({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 p-5">
      <Logo className="px-1" />
      <nav aria-label="Main" className="flex-1">
        <NavLinks me={me} onNavigate={onNavigate} />
      </nav>
      <UserMenu me={me} />
    </div>
  );
}

/**
 * Desktop (lg+): full-height fixed sidebar, as in the designs (where it stopped short).
 * Smaller screens: a sticky top bar whose menu button opens the same sidebar as a drawer.
 */
/** Announces when another tab signed this browser in as someone else (tabs share one cookie). */
function useAccountSwitchNotice(me: Me) {
  const previous = useRef(me);
  useEffect(() => {
    if (previous.current.id !== me.id) {
      toast.info(`You’re now signed in as ${me.name} (${me.roleName}) in this browser.`, {
        description:
          'All tabs share one sign-in. Use a private window to test another account at the same time.',
        duration: 8000,
      });
    }
    previous.current = me;
  }, [me]);
}

export function AppShell({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  useAccountSwitchNotice(me);

  return (
    <div className="min-h-svh">
      <a
        href="#main"
        className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside className="bg-card fixed inset-y-0 left-0 z-30 hidden w-60 border-r lg:block">
        <SidebarContents me={me} />
      </aside>

      <div className="bg-card/95 sticky top-0 z-30 flex h-14 items-center justify-between border-b px-4 backdrop-blur lg:hidden">
        <Logo />
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu">
          <Menu />
        </Button>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 p-0 sm:max-w-72">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Navigation and account</SheetDescription>
          <SidebarContents me={me} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <main id="main" className="min-w-0 lg:pl-60">
        <Outlet />
      </main>
    </div>
  );
}
