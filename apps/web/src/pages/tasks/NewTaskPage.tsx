import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Info } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  PERIOD_TYPE_LABELS,
  type CreateTaskRequest,
  type PeriodType,
  type StatementType,
  type TaskDetailDto,
  type WizardEntityDto,
  type WizardLevelsDto,
  type WizardOptionsDto,
  type WizardPeriodDto,
} from '@finance-close/shared';
import { useCurrentUser } from '@/auth/AuthContext';
import { PageHeader } from '@/components/AppShell';
import { Alert } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { confirmLeave, setLeaveGuard } from '@/lib/leave-guard';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  StepEntities,
  StepFormat,
  StepLevels,
  StepPeriod,
  StepReview,
  StepType,
  StepYear,
  StepPeriodType,
} from './wizard-steps';

export interface WizardState {
  type: StatementType | null;
  fyId: string | null;
  periodType: PeriodType | null;
  periodId: string | null;
  formatCode: string | null;
  entityCodes: string[];
  description: string;
  descriptionEdited: boolean;
  reviewerNote: string;
}

const EMPTY: WizardState = {
  type: null,
  fyId: null,
  periodType: null,
  periodId: null,
  formatCode: null,
  entityCodes: [],
  description: '',
  descriptionEdited: false,
  reviewerNote: '',
};

const LEAVE_MESSAGE = 'Leave the new task? Your choices will be lost.';

/** Page 2: the new-task wizard. Steps appear one below another as each is answered. */
export function NewTaskPage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [s, setS] = useState<WizardState>(EMPTY);
  const [note, setNote] = useState<string | null>(null);

  const options = useQuery({
    queryKey: ['wizard', 'options'],
    queryFn: () => api.get<WizardOptionsDto>('/task-wizard/options'),
  });
  const periods = useQuery({
    queryKey: ['wizard', 'periods', s.type, s.fyId, s.periodType],
    queryFn: () =>
      api.get<WizardPeriodDto[]>(
        `/task-wizard/periods?type=${s.type}&fyId=${s.fyId}&periodType=${s.periodType}`,
      ),
    enabled: Boolean(s.type && s.fyId && s.periodType),
  });
  const entities = useQuery({
    queryKey: ['wizard', 'entities', s.periodId],
    queryFn: () => api.get<WizardEntityDto[]>(`/task-wizard/entities?periodId=${s.periodId}`),
    enabled: s.type === 'SFS' && Boolean(s.periodId),
  });
  const levels = useQuery({
    queryKey: ['wizard', 'levels', s.periodId],
    queryFn: () => api.get<WizardLevelsDto>(`/task-wizard/levels?periodId=${s.periodId}`),
    enabled: s.type === 'CFS' && Boolean(s.periodId),
  });

  const o = options.data;
  const fy = o?.financialYears.find((f) => f.id === s.fyId);
  const period = periods.data?.find((p) => p.id === s.periodId);
  const format = o?.formats.find((f) => f.code === s.formatCode);
  const available = useMemo(() => (entities.data ?? []).filter((e) => !e.inTask), [entities.data]);

  // Dirty once a choice is made: leaving asks for confirmation.
  useEffect(() => {
    setLeaveGuard(s.type ? LEAVE_MESSAGE : null);
    return () => setLeaveGuard(null);
  }, [s.type]);

  // Defaults: only task type offered; FY containing today; last-used format.
  useEffect(() => {
    if (!o) return;
    setS((prev) => {
      const enabled = o.types.filter((t) => t.enabled);
      const type = prev.type ?? (enabled.length === 1 ? (enabled[0]!.type as StatementType) : null);
      return {
        ...prev,
        type,
        fyId: prev.fyId ?? o.defaultFyId,
        formatCode: prev.formatCode ?? o.defaultFormatCode,
      };
    });
  }, [o]);

  // Default period: the dashboard's period in close, if it can be selected.
  useEffect(() => {
    if (!periods.data || s.periodId) return;
    const inClose = periods.data.find((p) => p.isPeriodInClose && p.selectable && p.remaining > 0);
    if (inClose) setS((prev) => ({ ...prev, periodId: inClose.id }));
  }, [periods.data, s.periodId]);

  // Entities: all available selected by default whenever the period changes.
  useEffect(() => {
    if (entities.data)
      setS((prev) => ({
        ...prev,
        entityCodes: entities.data.filter((e) => !e.inTask).map((e) => e.code),
      }));
  }, [entities.data]);

  // Description follows the choices until the user edits it.
  useEffect(() => {
    if (s.descriptionEdited || !s.type || !s.periodType || !period || !format) return;
    const label = s.periodType === 'MONTHLY' ? period.label : periodShortLabel(period, fy?.label);
    const auto = `${PERIOD_TYPE_LABELS[s.periodType]} ${s.type} – ${label} – ${format.name}`;
    setS((prev) => (prev.description === auto ? prev : { ...prev, description: auto }));
  }, [s.type, s.periodType, period, format, fy?.label, s.descriptionEdited]);

  /** Changing an earlier answer clears the later answers that depend on it. */
  const change = (patch: Partial<WizardState>, cleared?: string) => {
    setS((prev) => {
      const next = { ...prev, ...patch };
      const periodDependsOnChange = 'type' in patch || 'fyId' in patch || 'periodType' in patch;
      if (periodDependsOnChange && prev.periodId && !('periodId' in patch)) {
        next.periodId = null;
        next.entityCodes = [];
        if (cleared) setNote(`Period cleared because the ${cleared} changed.`);
      }
      return next;
    });
  };

  const create = useMutation({
    mutationFn: () => {
      const body: CreateTaskRequest = {
        type: s.type!,
        periodId: s.periodId!,
        formatCode: s.formatCode!,
        entityCodes: s.type === 'SFS' ? s.entityCodes : undefined,
        description: s.description,
        reviewerNote: s.reviewerNote || null,
      };
      return api.post<TaskDetailDto>('/tasks', body);
    },
    onSuccess: async (task) => {
      setLeaveGuard(null);
      await queryClient.invalidateQueries();
      toast(`Task ${task.number} created`);
      navigate(`/tasks/${task.id}`, { replace: true });
    },
  });

  const step6Ready =
    s.type === 'SFS'
      ? s.entityCodes.length > 0
      : s.type === 'CFS'
        ? Boolean(levels.data?.canCreate)
        : false;

  if (options.error) return <Alert>{errorMessage(options.error)}</Alert>;

  return (
    <>
      <Link
        to="/dashboard"
        onClick={(e) => {
          if (!confirmLeave()) e.preventDefault();
        }}
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium no-underline"
      >
        <ArrowLeft className="size-4" /> Back to dashboard
      </Link>
      <PageHeader
        title="New task"
        description="Answer each step; the next one appears below. Nothing is saved until you create the task."
      />
      {note && (
        <Alert variant="info" className="mb-4 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <Info className="size-4" /> {note}
          </span>
          <button type="button" className="text-xs underline" onClick={() => setNote(null)}>
            Dismiss
          </button>
        </Alert>
      )}

      {!o ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <Step n={1} title="Task type" done={Boolean(s.type)}>
              <StepType
                options={o}
                value={s.type}
                onChange={(type) => change({ type }, 'task type')}
              />
            </Step>
            {s.type && (
              <Step n={2} title="Financial year" done={Boolean(s.fyId)}>
                <StepYear
                  options={o}
                  value={s.fyId}
                  onChange={(fyId) => change({ fyId }, 'financial year')}
                />
              </Step>
            )}
            {s.type && s.fyId && (
              <Step n={3} title="Period type" done={Boolean(s.periodType)}>
                <StepPeriodType
                  value={s.periodType}
                  onChange={(periodType) => change({ periodType }, 'period type')}
                />
              </Step>
            )}
            {s.type && s.fyId && s.periodType && (
              <Step n={4} title="Period" done={Boolean(period)}>
                <StepPeriod
                  query={periods}
                  type={s.type}
                  value={s.periodId}
                  onChange={(periodId) => {
                    setNote(null);
                    change({ periodId, entityCodes: [] });
                  }}
                />
              </Step>
            )}
            {period && (
              <Step n={5} title="Format" done={Boolean(format)}>
                <StepFormat
                  options={o}
                  value={s.formatCode}
                  onChange={(formatCode) => change({ formatCode })}
                />
              </Step>
            )}
            {period && format && s.type === 'SFS' && (
              <Step n={6} title="Entities" done={s.entityCodes.length > 0}>
                <StepEntities
                  query={entities}
                  available={available}
                  selected={s.entityCodes}
                  periodLabel={period.label}
                  onChange={(entityCodes) => change({ entityCodes })}
                />
              </Step>
            )}
            {period && format && s.type === 'CFS' && (
              <Step n={6} title="Consolidation levels" done={step6Ready}>
                <StepLevels query={levels} periodLabel={period.label} />
              </Step>
            )}
            {period && format && step6Ready && (
              <Step n={7} title="Review and create" done={false}>
                <StepReview
                  state={s}
                  setState={setS}
                  period={period}
                  fyLabel={fy?.label ?? ''}
                  formatName={format.name}
                  entityNames={(entities.data ?? [])
                    .filter((e) => s.entityCodes.includes(e.code))
                    .map((e) => e.shortName)}
                  levels={levels.data?.levels ?? []}
                  preparer={user.name}
                  create={create}
                />
              </Step>
            )}
          </div>

          <Summary
            s={s}
            fyLabel={fy?.label}
            period={period}
            formatName={format?.name}
            count={s.type === 'SFS' ? s.entityCodes.length : (levels.data?.levels.length ?? 0)}
            typeLabel={o.types.find((t) => t.type === s.type)?.label}
          />
        </div>
      )}
    </>
  );
}

/** "Q1 FY 2026-27" / "FY 2026-27" for descriptions (the tile label is longer). */
function periodShortLabel(p: WizardPeriodDto, fyLabel?: string): string {
  if (p.type === 'QUARTERLY') return `${p.label.split(' ')[0]} ${fyLabel ?? ''}`.trim();
  return fyLabel ?? p.label;
}

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className="rounded-xl border bg-card p-5 shadow-xs animate-in fade-in-0 slide-in-from-top-1"
      aria-labelledby={`step-${n}`}
    >
      <h2 id={`step-${n}`} className="mb-4 flex items-center gap-3 text-base font-semibold">
        <span
          className={cn(
            'flex size-7 items-center justify-center rounded-full text-sm font-semibold',
            done ? 'bg-teal text-white' : 'bg-mint text-teal',
          )}
        >
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Summary({
  s,
  fyLabel,
  period,
  formatName,
  count,
  typeLabel,
}: {
  s: WizardState;
  fyLabel?: string;
  period?: WizardPeriodDto;
  formatName?: string;
  count: number;
  typeLabel?: string;
}) {
  const row = (label: string, value?: ReactNode) => (
    <div className="flex justify-between gap-3 border-b py-2 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-ink">
        {value ?? <span className="font-normal text-muted-foreground">—</span>}
      </dd>
    </div>
  );
  return (
    <aside
      className="rounded-xl border bg-card p-5 shadow-xs lg:sticky lg:top-24"
      aria-label="Your choices"
    >
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        Summary
      </h2>
      <dl>
        {row('Task type', s.type ? (typeLabel?.replace(/ \(.*\)$/, '') ?? s.type) : undefined)}
        {row('Financial year', fyLabel)}
        {row('Period type', s.periodType ? PERIOD_TYPE_LABELS[s.periodType] : undefined)}
        {row('Period', period?.label)}
        {row('Due date', period ? formatDate(period.dueDate) : undefined)}
        {row('Format', formatName)}
        {row(
          s.type === 'CFS' ? 'Levels' : 'Entities',
          period && s.type ? String(count) : undefined,
        )}
      </dl>
    </aside>
  );
}
