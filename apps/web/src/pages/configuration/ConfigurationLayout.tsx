import { Eye } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Permission } from '@finance-close/shared';
import { useAuth } from '@/auth/AuthContext';
import { PageHeader } from '@/components/AppShell';
import { Select } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { CONFIG_SECTIONS, useCanEditConfig } from './hooks';

/** Configuration: a grouped left sub-menu, and the view-only banner for read-only users. */
export function ConfigurationLayout() {
  const canEdit = useCanEditConfig();
  const isAdmin = useAuth().hasAny(Permission.UserAdmin);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const sections = CONFIG_SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((i) => !('adminOnly' in i) || isAdmin),
  })).filter((s) => s.items.length > 0);
  const all = sections.flatMap((s) => s.items);
  const current = all.find((i) => pathname.startsWith(i.to))?.to ?? '';

  return (
    <>
      <PageHeader
        title="Configuration"
        description="Master data used by every statement: entities, group structure, currencies, calendar and reporting set-up."
      />
      {!canEdit && (
        <p
          role="status"
          className="mb-5 flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm"
        >
          <Eye className="size-4 text-muted-foreground" />
          View only – you can see configuration but not change it.
        </p>
      )}
      {/* Small screens: a dropdown instead of the side menu. */}
      <Select
        className="mb-4 md:hidden"
        aria-label="Configuration page"
        value={current}
        onChange={(e) => navigate(e.target.value)}
      >
        {sections.map((s) => (
          <optgroup key={s.title} label={s.title}>
            {s.items.map((i) => (
              <option key={i.to} value={i.to}>
                {i.label}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      <div className="flex gap-8">
        <nav aria-label="Configuration" className="hidden w-56 shrink-0 md:block">
          {sections.map((s) => (
            <div key={s.title} className="mb-5">
              <p className="mb-1.5 px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {s.title}
              </p>
              <ul className="space-y-0.5">
                {s.items.map((i) => (
                  <li key={i.to}>
                    <NavLink
                      to={i.to}
                      end={false}
                      className={({ isActive }) =>
                        cn(
                          'block rounded-md px-3 py-1.5 text-sm no-underline text-foreground hover:bg-accent',
                          isActive && 'bg-mint font-medium text-primary',
                        )
                      }
                    >
                      {i.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </>
  );
}
