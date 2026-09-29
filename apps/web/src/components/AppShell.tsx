import { LogOut } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth, useCurrentUser } from '@/auth/AuthContext';
import { NAV_ITEMS } from '@/auth/navigation';
import { BrandLockup } from '@/components/brand/BrandMark';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Signed-in layout: ink-navy left navigation (filtered by permission) and a light top bar. */
export function AppShell() {
  const user = useCurrentUser();
  const { hasAny, logout } = useAuth();
  const navigate = useNavigate();
  const items = NAV_ITEMS.filter((i) => i.anyOf.length === 0 || hasAny(...i.anyOf));

  const signOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-svh bg-background">
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-16 items-center border-b border-sidebar-border px-5">
          <BrandLockup />
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Main">
          <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">
            Workspace
          </p>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
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
          Aistra group · FY April–March
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
          <div className="hidden md:block" />
          <div className="flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-sm font-semibold text-ink">{user.name}</div>
              <div className="text-xs text-muted-foreground">{user.email}</div>
            </div>
            <div
              className="flex size-9 items-center justify-center rounded-full bg-mint text-sm font-semibold text-teal ring-1 ring-teal/20"
              aria-hidden
            >
              {initials(user.name)}
            </div>
            <Button variant="outline" size="sm" onClick={() => void signOut()}>
              <LogOut />
              Sign out
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
          <Outlet />
        </main>
      </div>
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
