import { Eye } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { PageHeader } from '@/components/AppShell';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CONFIG_TABS, useCanEditConfig } from './hooks';

export function ConfigurationLayout() {
  const canEdit = useCanEditConfig();
  return (
    <>
      <PageHeader
        title="Configuration"
        description="Master data used by every statement: currencies, entities, group structure, calendar and due dates."
        actions={
          !canEdit && (
            <Badge variant="secondary" className="gap-1.5 px-2.5 py-1 text-sm">
              <Eye /> View only
            </Badge>
          )
        }
      />
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b" aria-label="Configuration">
        {CONFIG_TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              cn(
                '-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground hover:text-foreground',
                isActive && 'border-primary text-foreground',
                'later' in t && 'text-muted-foreground/60',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
