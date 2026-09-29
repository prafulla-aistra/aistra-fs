import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FilePlus2, Lock, X } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  PERIOD_TYPE_LABELS,
  type DashboardDto,
  type PeriodType,
  type StatementType,
  type TaskFilterStatus,
  type TaskListPage,
  type TaskRowDto,
} from '@finance-close/shared';
import { Badge, ItemStatusBadge, TaskStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Input, Select } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface TableFilters {
  periodId?: string;
  fyId?: string;
  periodType?: PeriodType;
  type?: StatementType;
  status?: TaskFilterStatus;
  search: string;
  page: number;
}

const PAGE_SIZE = 20;

const STATUS_OPTIONS: { value: TaskFilterStatus; label: string }[] = [
  { value: 'NOT_STARTED', label: 'Not started' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'IN_REVIEW', label: 'In review' },
  { value: 'DONE', label: 'Done' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'TO_CONTINUE', label: 'To continue' },
  { value: 'AWAITING_REVIEW', label: 'Awaiting review' },
];

function toQuery(f: TableFilters): string {
  const q = new URLSearchParams({ page: String(f.page), pageSize: String(PAGE_SIZE) });
  if (f.periodId) q.set('periodId', f.periodId);
  if (f.fyId) q.set('fyId', f.fyId);
  if (f.periodType) q.set('periodType', f.periodType);
  if (f.type) q.set('type', f.type);
  if (f.status) q.set('status', f.status);
  if (f.search.trim()) q.set('search', f.search.trim());
  return q.toString();
}

export function TaskTable({
  dashboard,
  filters,
  onChange,
  canCreate,
}: {
  dashboard: DashboardDto;
  filters: TableFilters;
  onChange: (f: TableFilters) => void;
  canCreate: boolean;
}) {
  const tasks = useQuery({
    queryKey: ['tasks', filters],
    queryFn: () => api.get<TaskListPage>(`/tasks?${toQuery(filters)}`),
    placeholderData: keepPreviousData,
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const set = (patch: Partial<TableFilters>) =>
    onChange({ ...filters, ...patch, page: patch.page ?? 1 });

  const fys = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of dashboard.periods) m.set(p.fyId, p.fyLabel);
    return [...m.entries()];
  }, [dashboard.periods]);
  const periodLabel = dashboard.periods.find((p) => p.id === filters.periodId)?.label;
  const filtered = Boolean(
    filters.fyId || filters.periodType || filters.type || filters.status || filters.search.trim(),
  );
  const totalPages = tasks.data ? Math.max(1, Math.ceil(tasks.data.total / PAGE_SIZE)) : 1;

  return (
    <section className="rounded-xl border bg-card shadow-xs" aria-labelledby="tasks-title">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="tasks-title" className="text-base font-semibold">
            Tasks
          </h2>
          {filters.periodId && (
            <FilterChip
              label={`Period: ${periodLabel ?? 'selected'}`}
              onClear={() => set({ periodId: undefined })}
            />
          )}
          {filters.type && (
            <FilterChip label={`Type: ${filters.type}`} onClear={() => set({ type: undefined })} />
          )}
          {filters.status && (
            <FilterChip
              label={`Status: ${STATUS_OPTIONS.find((o) => o.value === filters.status)?.label}`}
              onClear={() => set({ status: undefined })}
            />
          )}
        </div>
        <Input
          aria-label="Search task descriptions"
          placeholder="Search descriptions"
          className="w-full max-w-64"
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
        />
      </div>

      <div className="grid gap-2 border-b bg-muted/30 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          aria-label="Financial year"
          value={filters.fyId ?? ''}
          onChange={(e) => set({ fyId: e.target.value || undefined })}
        >
          <option value="">All financial years</option>
          {fys.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Period type"
          value={filters.periodType ?? ''}
          onChange={(e) =>
            set({ periodType: (e.target.value || undefined) as PeriodType | undefined })
          }
        >
          <option value="">All period types</option>
          {(Object.keys(PERIOD_TYPE_LABELS) as PeriodType[]).map((t) => (
            <option key={t} value={t}>
              {PERIOD_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Task type"
          value={filters.type ?? ''}
          onChange={(e) =>
            set({ type: (e.target.value || undefined) as StatementType | undefined })
          }
        >
          <option value="">All task types</option>
          <option value="SFS">Standalone (SFS)</option>
          <option value="CFS">Consolidated (CFS)</option>
        </Select>
        <Select
          aria-label="Status"
          value={filters.status ?? ''}
          onChange={(e) =>
            set({ status: (e.target.value || undefined) as TaskFilterStatus | undefined })
          }
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      {tasks.isError && !tasks.data ? (
        <div className="p-4">
          <Alert>Could not load tasks. {errorMessage(tasks.error)}</Alert>
        </div>
      ) : !tasks.data ? (
        <div className="space-y-2 p-4" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : tasks.data.items.length === 0 ? (
        <EmptyState
          filtered={filtered}
          canCreate={canCreate}
          onClear={() => onChange({ search: '', page: 1, periodId: filters.periodId })}
        />
      ) : (
        <div className="p-2 sm:p-4">
          <Table>
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>Description of task</Th>
                <Th>Entities considered</Th>
                <Th>Date</Th>
                <Th>Due date</Th>
                <Th>Status</Th>
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {tasks.data.items.map((t) => (
                <Fragment key={t.id}>
                  <Row
                    task={t}
                    expanded={expanded === t.id}
                    onToggle={() => setExpanded(expanded === t.id ? null : t.id)}
                  />
                  {expanded === t.id && (
                    <tr className="bg-mint/30">
                      <Td colSpan={7}>
                        <ul className="flex flex-wrap gap-x-5 gap-y-2 py-1">
                          {t.items.map((i) => (
                            <li key={i.code} className="flex items-center gap-2 text-sm">
                              <span className="font-mono text-xs font-semibold">{i.code}</span>
                              <span>{i.label}</span>
                              <ItemStatusBadge status={i.status} />
                            </li>
                          ))}
                        </ul>
                      </Td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </Table>
          <div className="mt-3 flex items-center justify-between px-1 text-sm text-muted-foreground">
            <span>
              {tasks.data.total} task{tasks.data.total === 1 ? '' : 's'} · newest first
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={filters.page <= 1}
                  onClick={() => set({ page: filters.page - 1 })}
                >
                  Previous
                </Button>
                <span>
                  Page {filters.page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={filters.page >= totalPages}
                  onClick={() => set({ page: filters.page + 1 })}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Row({
  task: t,
  expanded,
  onToggle,
}: {
  task: TaskRowDto;
  expanded: boolean;
  onToggle: () => void;
}) {
  const noun =
    t.itemKind === 'ENTITY'
      ? t.itemTotal === 1
        ? 'entity'
        : 'entities'
      : t.itemTotal === 1
        ? 'level'
        : 'levels';
  const count =
    t.items.length === t.itemTotal
      ? `${t.itemTotal} ${noun}`
      : `${t.items.length} of ${t.itemTotal} ${noun}`;
  const summary = t.items
    .map((i) => `${i.code}: ${i.status.replace('_', ' ').toLowerCase()}`)
    .join('\n');
  return (
    <tr className={cn('align-top hover:bg-muted/30', t.locked && 'bg-muted/20')}>
      <Td className="whitespace-nowrap">
        <div className="font-medium text-ink">{t.periodLabel}</div>
        <div className="text-xs text-muted-foreground">
          {PERIOD_TYPE_LABELS[t.periodType]} · {t.fyLabel}
        </div>
      </Td>
      <Td>
        <div className="flex items-start gap-2">
          <Badge variant="outline" className="mt-0.5 font-mono">
            {t.type}
          </Badge>
          <div>
            <div className="font-medium">{t.description}</div>
            <div className="font-mono text-xs text-muted-foreground">{t.number}</div>
          </div>
        </div>
      </Td>
      <Td>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          title={summary}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-medium text-teal hover:bg-mint focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          {count}
        </button>
      </Td>
      <Td
        className="whitespace-nowrap"
        title={`Created ${formatDateTime(t.createdAt)} by ${t.createdBy}`}
      >
        {formatDateTime(t.updatedAt)}
      </Td>
      <Td className={cn('whitespace-nowrap', t.overdue && 'font-medium text-destructive')}>
        {formatDate(t.dueDate)}
      </Td>
      <Td>
        <div className="flex flex-wrap items-center gap-1">
          <TaskStatusBadge status={t.status} />
          {t.overdue && <Badge variant="destructive">Overdue</Badge>}
          {t.locked && <Lock className="size-3.5 text-muted-foreground" aria-label="Locked" />}
        </div>
      </Td>
      <Td className="text-right">
        <Button asChild size="sm" variant={t.action === 'CONTINUE' ? 'default' : 'outline'}>
          <Link to={`/tasks/${t.id}`} className="no-underline">
            {t.action === 'CONTINUE' ? 'Continue' : 'View'}
          </Link>
        </Button>
      </Td>
    </tr>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-teal/30 bg-mint px-2.5 py-0.5 text-xs font-medium text-teal">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remove filter ${label}`}
        className="rounded-full hover:bg-teal/10"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

function EmptyState({
  filtered,
  canCreate,
  onClear,
}: {
  filtered: boolean;
  canCreate: boolean;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-mint">
        <FilePlus2 className="size-5 text-teal" />
      </div>
      {filtered ? (
        <>
          <p className="font-medium text-ink">No tasks match these filters.</p>
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        </>
      ) : (
        <>
          <p className="font-medium text-ink">No tasks for this period. Start your close.</p>
          {canCreate && (
            <Button asChild>
              <Link to="/tasks/new" className="no-underline">
                New task
              </Link>
            </Button>
          )}
        </>
      )}
    </div>
  );
}
