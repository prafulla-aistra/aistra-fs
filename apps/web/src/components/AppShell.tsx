import { ChevronDown, ChevronsLeft, KeyRound, LogOut, PanelLeftOpen } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth, useCurrentUser } from '@/auth/AuthContext';
import { NAV_ITEMS } from '@/auth/navigation';
import { BrandLockup } from '@/components/brand/BrandMark';
import { NotificationsBell } from '@/components/NotificationsBell';
import { Toaster } from '@/components/Toaster';
import { Button } from '@/components/ui/button';
import { ChangePasswordDialog } from '@/components/ChangePasswordDialog';
import { confirmLeave } from '@/lib/leave-guard';
import { cn } from '@/lib/utils';

const SIDEBAR_KEY = 'fc.sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Signed-in layout: ink-navy left navigation (filtered by permission, collapsible to the left
 * so the page uses the full width) and a light top bar with the user menu.
 */
export function AppShell() {
  const user = useCurrentUser();
  const { hasAny, logout } = useAuth();
  const navigate = useNavigate();
  const items = NAV_ITEMS.filter((i) => i.anyOf.length === 0 || hasAny(...i.anyOf));
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [changingPassword, setChangingPassword] = useState(false);
  const toggle = (v: boolean) => {
    setCollapsed(v);
    try {
      localStorage.setItem(SIDEBAR_KEY, v ? '1' : '0');
    } catch {
      /* the choice is just not remembered */
    }
  };

  const signOut = async () => {
    if (!confirmLeave()) return;
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-svh bg-background">
      <aside
        className={cn(
          'sticky top-0 hidden h-svh w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground',
          !collapsed && 'md:flex',
        )}
      >
        <div className="flex h-16 items-center justify-between gap-2 border-b border-sidebar-border pr-2 pl-5">
          <BrandLockup />
          <button
            type="button"
            onClick={() => toggle(true)}
            className="rounded-md p-1.5 text-sidebar-muted hover:bg-sidebar-hover hover:text-white"
            aria-label="Collapse the menu"
            title="Collapse the menu"
          >
            <ChevronsLeft className="size-4" />
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Main">
          <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">
            Workspace
          </p>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={(e) => {
                if (!confirmLeave()) e.preventDefault();
              }}
              className={({ isActive }) =>
                cn(
                  'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-muted no-underline transition-colors hover:bg-sidebar-hover hover:text-white',
                  isActive &&
                    'bg-sidebar-active text-white before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-[#3FD0AE]',
                )
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-sidebar-border px-5 py-4 text-xs text-sidebar-muted">
          Aistra Group
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b bg-card/95 px-4 backdrop-blur sm:px-6">
          {/* Narrow screens: brand + compact navigation */}
          <div className="flex min-w-0 items-center gap-3 md:hidden">
            <nav className="flex gap-3 overflow-x-auto text-sm" aria-label="Main (compact)">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={(e) => {
                    if (!confirmLeave()) e.preventDefault();
                  }}
                  className={({ isActive }) =>
                    cn(
                      'whitespace-nowrap text-muted-foreground no-underline',
                      isActive && 'font-semibold text-teal',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="hidden items-center gap-3 md:flex">
            {collapsed && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggle(false)}
                  aria-label="Show the menu"
                  title="Show the menu"
                >
                  <PanelLeftOpen />
                </Button>
                <BrandLockup tone="light" />
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <NotificationsBell />
            <UserMenu
              name={user.name}
              email={user.email}
              onChangePassword={() => setChangingPassword(true)}
              onSignOut={() => void signOut()}
            />
          </div>
        </header>
        <main
          className={cn(
            'mx-auto w-full flex-1 px-4 py-8 sm:px-6',
            collapsed ? 'max-w-none lg:px-8' : 'max-w-7xl',
          )}
        >
          <Outlet />
        </main>
        <Toaster />
        <ChangePasswordDialog
          open={changingPassword}
          email={user.email}
          onClose={() => setChangingPassword(false)}
        />
      </div>
    </div>
  );
}

/** The signed-in user's name; a click opens Change password and Sign out. */
function UserMenu({
  name,
  email,
  onChangePassword,
  onSignOut,
}: {
  name: string;
  email: string;
  onChangePassword: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const item =
    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-mint';
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-muted"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="hidden text-right leading-tight sm:block">
          <span className="block text-sm font-semibold text-ink">{name}</span>
          <span className="block text-xs text-muted-foreground">{email}</span>
        </span>
        <span
          className="flex size-9 items-center justify-center rounded-full bg-mint text-sm font-semibold text-teal ring-1 ring-teal/20"
          aria-hidden
        >
          {initials(name)}
        </span>
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-56 rounded-lg border bg-card p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onChangePassword();
            }}
          >
            <KeyRound className="size-4" /> Change password
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
