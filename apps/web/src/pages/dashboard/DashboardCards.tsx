import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  Layers,
  Building2,
  History,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import {
  ITEM_STATUS_LABELS,
  type DashboardDto,
  type ItemCountsDto,
  type ItemStatus,
} from '@finance-close/shared';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import type { TableFilters } from './TaskTable';

interface Props {
  data: DashboardDto;
  filters: TableFilters;
  onFilter: (f: Partial<TableFilters>) => void;
}

/** The five summary cards. Every number comes from GET /api/dashboard. */
export function DashboardCards({ data, filters, onFilter }: Props) {
  const period = data.period!;
  const is = (f: Partial<TableFilters>) =>
    filters.periodId === f.periodId && filters.type === f.type && filters.status === f.status;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <CardButton
        title="Period in close"
        icon={CalendarClock}
        active={is({ periodId: period.id })}
        onClick={() => onFilter({ periodId: period.id })}
      >
        <div className="text-xl font-semibold text-ink">{period.label}</div>
        <div className="text-xs text-muted-foreground">{period.fyLabel}</div>
        <dl className="mt-3 space-y-1 text-xs">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">SFS due</dt>
            <dd className="font-medium">{formatDate(period.sfsDueDate)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">CFS due</dt>
            <dd className="font-medium">{formatDate(period.cfsDueDate)}</dd>
          </div>
        </dl>
        <Deadline deadline={period.deadline} />
      </CardButton>

      <CardButton
        title="Standalone FS"
        icon={Building2}
        active={is({ periodId: period.id, type: 'SFS' })}
        onClick={() => onFilter({ periodId: period.id, type: 'SFS' })}
      >
        <Fraction
          done={data.standalone.finalised}
          total={data.standalone.total}
          unit={data.standalone.total === 1 ? 'entity' : 'entities'}
        />
        <Progress done={data.standalone.finalised} total={data.standalone.total} />
        <Chips counts={data.standalone.counts} />
      </CardButton>

      <CardButton
        title="Consolidation"
        icon={Layers}
        active={is({ periodId: period.id, type: 'CFS' })}
        onClick={() => onFilter({ periodId: period.id, type: 'CFS' })}
      >
        <Fraction
          done={data.consolidation.finalised}
          total={data.consolidation.total}
          unit={data.consolidation.total === 1 ? 'level' : 'levels'}
        />
        <Progress done={data.consolidation.finalised} total={data.consolidation.total} />
        <p className="mt-3 text-xs text-muted-foreground">
          {data.consolidation.next ? (
            <>
              Next:{' '}
              <span className="font-medium text-ink">
                Level {data.consolidation.next.level} {data.consolidation.next.name}
              </span>
            </>
          ) : data.consolidation.total > 0 ? (
            <span className="font-medium text-success">Every level finalised</span>
          ) : (
            'No consolidation levels in your scope'
          )}
        </p>
      </CardButton>

      <CardButton
        title="Last period"
        icon={History}
        active={Boolean(data.lastPeriod) && is({ periodId: data.lastPeriod?.id })}
        onClick={() => data.lastPeriod && onFilter({ periodId: data.lastPeriod.id })}
        disabled={!data.lastPeriod}
      >
        {data.lastPeriod ? (
          <>
            <div className="text-xl font-semibold text-ink">{data.lastPeriod.label}</div>
            <div className="mt-3">
              {data.lastPeriod.done ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success-surface px-2.5 py-1 text-sm font-semibold text-success">
                  <CheckCircle2 className="size-4" /> Done
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-sm font-semibold text-warning-foreground ring-1 ring-warning/40">
                  <Clock className="size-4" /> {data.lastPeriod.openItems} item
                  {data.lastPeriod.openItems === 1 ? '' : 's'} open
                </span>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Every entity and every level</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No earlier month.</p>
        )}
      </CardButton>

      <AttentionCard data={data} filters={filters} onFilter={onFilter} />
    </div>
  );
}

function AttentionCard({ data, filters, onFilter }: Props) {
  const a = data.attention;
  const period = data.period!;
  const line = (
    label: string,
    count: number,
    onClick: () => void,
    active: boolean,
    tone: 'default' | 'danger' = 'default',
  ) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-mint/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        active && 'bg-mint',
      )}
    >
      <span className={cn(tone === 'danger' && count > 0 && 'font-medium text-destructive')}>
        <span className="mr-1.5 font-semibold tabular-nums">{count}</span>
        {label}
      </span>
      <ChevronRight className="size-3.5 text-muted-foreground" />
    </button>
  );
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <CardTitle icon={AlertTriangle} title="Needs your attention" />
      <div className="-mx-2 mt-2 space-y-0.5">
        {a.entitiesToPrepare !== undefined &&
          line(
            a.entitiesToPrepare === 1 ? 'entity to prepare' : 'entities to prepare',
            a.entitiesToPrepare,
            () => onFilter({ periodId: period.id, status: 'TO_PREPARE' }),
            filters.status === 'TO_PREPARE',
          )}
        {a.awaitingYourReview !== undefined &&
          line(
            a.awaitingYourReview === 1 ? 'item awaiting your review' : 'items awaiting your review',
            a.awaitingYourReview,
            () => onFilter({ status: 'AWAITING_REVIEW' }),
            filters.status === 'AWAITING_REVIEW',
          )}
        {a.openQueries !== undefined && (
          <div
            className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-sm"
            title="Open queries to answer, or answered queries you raised to close"
          >
            <span className={cn(a.openQueries > 0 && 'font-medium text-warning-foreground')}>
              <span className="mr-1.5 font-semibold tabular-nums">{a.openQueries}</span>
              open quer{a.openQueries === 1 ? 'y' : 'ies'}
            </span>
          </div>
        )}
        {a.editAccessRequests !== undefined && (
          <Link
            to="/edit-access"
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-foreground no-underline hover:bg-mint/60"
          >
            <span>
              <span className="mr-1.5 font-semibold tabular-nums">{a.editAccessRequests}</span>
              edit-access request{a.editAccessRequests === 1 ? '' : 's'}
            </span>
            <ChevronRight className="size-3.5 text-muted-foreground" />
          </Link>
        )}
        {line(
          'overdue',
          a.overdue,
          () => onFilter({ status: 'OVERDUE' }),
          filters.status === 'OVERDUE',
          'danger',
        )}
      </div>
    </div>
  );
}

function CardButton({
  title,
  icon,
  active,
  onClick,
  disabled,
  children,
}: {
  title: string;
  icon: typeof Clock;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'group flex flex-col rounded-xl border bg-card p-4 text-left shadow-xs transition-all hover:border-teal/50 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:hover:border-border',
        active && 'border-teal ring-2 ring-teal/25',
      )}
    >
      <CardTitle icon={icon} title={title} />
      <div className="mt-2 flex-1">{children}</div>
      <span className="mt-3 text-xs font-medium text-teal opacity-0 transition-opacity group-hover:opacity-100 group-disabled:hidden">
        Show tasks →
      </span>
    </button>
  );
}

function CardTitle({ icon: Icon, title }: { icon: typeof Clock; title: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      <Icon className="size-3.5 text-teal" /> {title}
    </div>
  );
}

function Deadline({ deadline }: { deadline: NonNullable<DashboardDto['period']>['deadline'] }) {
  if (deadline.kind === 'COMPLETE') {
    return (
      <p className="mt-3 text-sm font-semibold text-success">
        Close complete{deadline.completedOn ? ` · ${formatDate(deadline.completedOn)}` : ''}
      </p>
    );
  }
  return deadline.status === 'OVERDUE' ? (
    <p
      className="mt-3 text-sm font-semibold text-destructive"
      title={`${deadline.overdueDays} calendar day${deadline.overdueDays === 1 ? '' : 's'} after the ${deadline.kind} due date (${formatDate(deadline.dueDate)}), counting weekends and holidays`}
    >
      {deadline.kind} overdue by {deadline.overdueDays} day{deadline.overdueDays === 1 ? '' : 's'}
    </p>
  ) : (
    <p className="mt-3 text-sm font-semibold text-ink">
      {deadline.workingDaysLeft} working day{deadline.workingDaysLeft === 1 ? '' : 's'} left
      <span className="font-normal text-muted-foreground"> · {deadline.kind}</span>
    </p>
  );
}

function Fraction({ done, total, unit }: { done: number; total: number; unit: string }) {
  return (
    <div>
      <span className="text-2xl font-semibold text-ink tabular-nums">{done}</span>
      <span className="text-sm text-muted-foreground">
        {' '}
        of {total} {unit} finalised
      </span>
    </div>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  // Display only: the share is computed from counts the API supplied.
  const pct = total === 0 ? 0 : (done / total) * 100;
  return (
    <div
      className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label={`${done} of ${total} finalised`}
    >
      <div className="h-full rounded-full bg-success transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

const CHIP: Record<ItemStatus, string> = {
  NOT_STARTED: 'bg-slate-100 text-slate-700',
  IN_PROGRESS: 'bg-amber-50 text-warning-foreground',
  IN_REVIEW: 'bg-[#E6EDF3] text-ink',
  FINALISED: 'bg-success-surface text-success',
};

function Chips({ counts }: { counts: ItemCountsDto }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1">
      {(Object.keys(CHIP) as ItemStatus[]).map((s) => (
        <span key={s} className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', CHIP[s])}>
          {counts[s]} {ITEM_STATUS_LABELS[s].toLowerCase()}
        </span>
      ))}
    </div>
  );
}
