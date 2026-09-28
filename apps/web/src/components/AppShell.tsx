import { LogOut } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth, useCurrentUser } from '@/auth/AuthContext';
import { NAV_ITEMS } from '@/auth/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Signed-in layout: left navigation (filtered by permission) and a top bar. */
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
    <div className="flex min-h-svh bg-muted/30">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-background md:flex">
        <div className="flex h-14 items-center gap-2 border-b px-5">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            FC
          </div>
          <span className="font-semibold tracking-tight">Finance Close</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-3" aria-label="Main">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                  isActive && 'bg-accent text-foreground',
                )
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <p className="px-5 py-4 text-xs text-muted-foreground">Aistra group · FY Apr–Mar</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-background px-6">
          {/* Compact navigation for narrow screens */}
          <nav className="flex gap-3 overflow-x-auto text-sm md:hidden" aria-label="Main (compact)">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className="whitespace-nowrap text-muted-foreground"
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden md:block" />
          <div className="flex items-center gap-4">
            <div className="text-right leading-tight">
              <div className="text-sm font-medium">{user.name}</div>
              <div className="text-xs text-muted-foreground">{user.email}</div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void signOut()}>
              <LogOut />
              Sign out
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
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
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
