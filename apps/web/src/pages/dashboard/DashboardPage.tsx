import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Permission, type DashboardDto } from '@finance-close/shared';
import { useAuth, useCurrentUser } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Alert, Select } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { DashboardCards } from './DashboardCards';
import { TaskTable, type TableFilters } from './TaskTable';

function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
const longDate = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Page 1 of the user journey: where the close stands, and what to do next. */
export function DashboardPage() {
  const user = useCurrentUser();
  const { hasAny } = useAuth();
  const canSeeTasks = hasAny(
    Permission.SfsPrepare,
    Permission.SfsReview,
    Permission.CfsPrepare,
    Permission.CfsReview,
    Permission.ReportsView,
  );
  const canCreate = hasAny(Permission.SfsPrepare, Permission.CfsPrepare);
  const firstName = user.name.split(/\s+/)[0] ?? user.name;

  // The selected month lives in the URL (?period=…) so a refresh or shared link keeps it.
  const [params, setParams] = useSearchParams();
  const periodParam = params.get('period') ?? undefined;
  const dashboard = useQuery({
    queryKey: ['dashboard', periodParam ?? 'default'],
    queryFn: () =>
      api.get<DashboardDto>(
        `/dashboard${periodParam ? `?period=${encodeURIComponent(periodParam)}` : ''}`,
      ),
    enabled: canSeeTasks,
    placeholderData: (prev) => prev,
  });
  const data = dashboard.data;

  const [filters, setFilters] = useState<TableFilters>({ search: '', page: 1 });
  const tableRef = useRef<HTMLDivElement>(null);
  // When the period in close changes, the table follows it.
  const selectedId = data?.period?.id;
  useEffect(() => {
    if (selectedId) setFilters((f) => ({ ...f, periodId: selectedId, page: 1 }));
  }, [selectedId]);

  const applyFilter = (next: Partial<TableFilters>) => {
    setFilters({ search: '', page: 1, ...next });
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const monthsByFy = useMemo(() => {
    const groups = new Map<string, DashboardDto['periods']>();
    for (const p of data?.periods ?? [])
      groups.set(p.fyLabel, [...(groups.get(p.fyLabel) ?? []), p]);
    return [...groups.entries()];
  }, [data?.periods]);

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl bg-sidebar px-6 py-6 text-white shadow-sm sm:px-8">
        <div
          aria-hidden
          className="absolute -top-24 -right-16 size-72 rounded-full bg-[#0E7C66] opacity-30 blur-3xl"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="flex items-center gap-2 text-sm text-sidebar-muted">
              <CalendarDays className="size-4" /> {longDate.format(new Date())}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
              {greeting()}, {firstName}
            </h1>
            <p className="mt-1 text-sidebar-muted">Here is where the close stands.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {canSeeTasks && (
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-sidebar-muted">
                  Period in close
                </span>
                <Select
                  aria-label="Period in close"
                  className="h-10 min-w-48 border-white/20 bg-white/10 text-white [&>optgroup]:text-ink [&>option]:text-ink"
                  value={data?.period?.id ?? ''}
                  disabled={!data}
                  onChange={(e) => setParams(e.target.value ? { period: e.target.value } : {})}
                >
                  {monthsByFy.map(([fy, months]) => (
                    <optgroup key={fy} label={fy}>
                      {months.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                          {m.status === 'CLOSED' ? ' (closed)' : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </label>
            )}
            {canCreate && (
              <Button asChild size="lg" className="bg-[#13A386] text-white hover:bg-[#10967B]">
                <Link to="/tasks/new" className="no-underline">
                  <Plus /> New task
                </Link>
              </Button>
            )}
          </div>
        </div>
      </section>

      {!canSeeTasks ? (
        <Alert variant="info">
          Your account has no access to close tasks. Use the menu on the left for the areas you can
          open.
        </Alert>
      ) : dashboard.isError && !data ? (
        <Alert className="flex flex-wrap items-center justify-between gap-3">
          <span>Could not load the dashboard. {errorMessage(dashboard.error)}</span>
          <Button variant="outline" size="sm" onClick={() => void dashboard.refetch()}>
            <RefreshCw /> Try again
          </Button>
        </Alert>
      ) : !data ? (
        <CardsSkeleton />
      ) : !data.period ? (
        <Alert variant="info">
          No financial year exists yet. Create one under Configuration → Financial years and
          periods.
        </Alert>
      ) : (
        <DashboardCards data={data} filters={filters} onFilter={applyFilter} />
      )}

      {canSeeTasks && data?.period && (
        <div ref={tableRef} className="scroll-mt-20">
          <TaskTable
            dashboard={data}
            filters={filters}
            onChange={setFilters}
            canCreate={canCreate}
          />
        </div>
      )}
    </div>
  );
}

function CardsSkeleton() {
  return (
    <div
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="space-y-3 rounded-xl border bg-card p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}
