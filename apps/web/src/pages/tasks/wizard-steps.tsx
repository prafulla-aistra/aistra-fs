import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Clock, ExternalLink, Layers, Lock } from 'lucide-react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { Link } from 'react-router';
import {
  ERP_LABELS,
  GAAP_LABELS,
  PERIOD_TYPE_LABELS,
  TASK_STATUS_LABELS,
  type PeriodType,
  type StatementType,
  type TaskDetailDto,
  type TaskRefDto,
  type WizardEntityDto,
  type WizardLevelDto,
  type WizardLevelsDto,
  type WizardOptionsDto,
  type WizardPeriodDto,
} from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Checkbox, Field, Input } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { TbcBadge } from '@/pages/configuration/common';
import type { WizardState } from './NewTaskPage';

/** A selectable card (radio behaviour). */
function Choice({
  selected,
  disabled,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-lg border bg-card p-4 text-left transition-all hover:border-teal/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-border',
        selected && 'border-teal bg-mint/50 ring-2 ring-teal/25',
        className,
      )}
    >
      {children}
    </button>
  );
}

function TaskLink({ task }: { task: TaskRefDto }) {
  return (
    <Link
      to={`/tasks/${task.id}`}
      className="inline-flex items-center gap-1 font-medium"
      onClick={(e) => e.stopPropagation()}
    >
      {task.number} ({TASK_STATUS_LABELS[task.status]}) · Open <ExternalLink className="size-3" />
    </Link>
  );
}

// 1 ---------------------------------------------------------------------------------
export function StepType({
  options,
  value,
  onChange,
}: {
  options: WizardOptionsDto;
  value: StatementType | null;
  onChange: (t: StatementType) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Task type" className="grid gap-3 sm:grid-cols-3">
      {options.types.map((t) => (
        <Choice
          key={t.type}
          selected={value === t.type}
          disabled={!t.enabled}
          onClick={() => onChange(t.type as StatementType)}
        >
          <div className="font-semibold text-ink">{t.label}</div>
          <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
          {!t.enabled && t.reason && (
            <Badge variant="neutral" className="mt-2">
              {t.reason}
            </Badge>
          )}
        </Choice>
      ))}
    </div>
  );
}

// 2 ---------------------------------------------------------------------------------
export function StepYear({
  options,
  value,
  onChange,
}: {
  options: WizardOptionsDto;
  value: string | null;
  onChange: (id: string) => void;
}) {
  if (options.financialYears.length === 0) {
    return (
      <Alert>
        No open financial year. Create one under Configuration → Financial years and periods.
      </Alert>
    );
  }
  return (
    <div role="radiogroup" aria-label="Financial year" className="flex flex-wrap gap-2">
      {options.financialYears.map((f) => (
        <Choice
          key={f.id}
          selected={value === f.id}
          onClick={() => onChange(f.id)}
          className="px-4 py-2.5"
        >
          <span className="font-semibold text-ink">{f.label}</span>
          {f.id === options.defaultFyId && (
            <span className="ml-2 text-xs text-muted-foreground">current</span>
          )}
        </Choice>
      ))}
    </div>
  );
}

// 3 ---------------------------------------------------------------------------------
export function StepPeriodType({
  value,
  onChange,
}: {
  value: PeriodType | null;
  onChange: (t: PeriodType) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Period type" className="flex flex-wrap gap-2">
      {(Object.keys(PERIOD_TYPE_LABELS) as PeriodType[]).map((t) => (
        <Choice key={t} selected={value === t} onClick={() => onChange(t)} className="px-4 py-2.5">
          <span className="font-semibold text-ink">{PERIOD_TYPE_LABELS[t]}</span>
        </Choice>
      ))}
    </div>
  );
}

// 4 ---------------------------------------------------------------------------------
export function StepPeriod({
  query,
  type,
  value,
  onChange,
}: {
  query: UseQueryResult<WizardPeriodDto[]>;
  type: StatementType;
  value: string | null;
  onChange: (id: string) => void;
}) {
  if (query.error) return <Alert>{errorMessage(query.error)}</Alert>;
  if (!query.data) return <Skeleton className="h-28 w-full" />;
  const chosen = query.data.find((p) => p.id === value);
  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label="Period"
        className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
      >
        {query.data.map((p) => (
          <div key={p.id} className="flex flex-col gap-1">
            {/* The tile selects the period; links to existing tasks sit below it (never inside a button). */}
            <Choice
              selected={value === p.id}
              disabled={!p.selectable}
              onClick={() => onChange(p.id)}
              className="p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold text-ink">{p.label}</span>
                {p.isPeriodInClose && (
                  <span className="text-[11px] font-medium text-teal">In close</span>
                )}
              </div>
              <div className="mt-1.5">
                <PeriodTag p={p} type={type} />
              </div>
            </Choice>
            {p.existingTasks.map((t) => (
              <div key={t.id} className="px-1 text-xs">
                <TaskLink task={t} />
              </div>
            ))}
          </div>
        ))}
      </div>
      {chosen && (
        <p className="flex items-center gap-2 text-sm">
          <CalendarClock className="size-4 text-teal" />
          {type} due date for {chosen.label}:{' '}
          <strong className="text-ink">{formatDate(chosen.dueDate)}</strong>
          <span className="text-muted-foreground">(from the due-date rules)</span>
        </p>
      )}
    </div>
  );
}

function PeriodTag({ p, type }: { p: WizardPeriodDto; type: StatementType }) {
  switch (p.availability) {
    case 'AVAILABLE':
      return (
        <Badge variant="success">
          <CheckCircle2 /> Available
        </Badge>
      );
    case 'NOT_ENDED':
      return (
        <Badge variant="neutral" className="h-auto rounded-md text-left whitespace-normal">
          <Clock /> Not ended yet (ends {formatDate(p.endDate)})
        </Badge>
      );
    case 'CLOSED':
      return (
        <Badge variant="neutral">
          <Lock /> Closed
        </Badge>
      );
    case 'TASK_EXISTS':
      return (
        <div className="space-y-1 text-xs">
          {p.existingTasks.map((t) => (
            <div key={t.id}>
              <Badge variant="review">Task exists: {TASK_STATUS_LABELS[t.status]}</Badge>
            </div>
          ))}
          {type === 'SFS' && p.remaining > 0 && (
            <div className="text-muted-foreground">
              {p.remaining} entit{p.remaining === 1 ? 'y' : 'ies'} not yet in a task
            </div>
          )}
        </div>
      );
  }
}

// 5 ---------------------------------------------------------------------------------
export function StepFormat({
  options,
  value,
  onChange,
}: {
  options: WizardOptionsDto;
  value: string | null;
  onChange: (code: string) => void;
}) {
  if (options.formats.length === 0)
    return <Alert>No active format. Formats are maintained in Configuration.</Alert>;
  return (
    <div role="radiogroup" aria-label="Format" className="grid gap-3 sm:grid-cols-2">
      {options.formats.map((f) => (
        <Choice key={f.code} selected={value === f.code} onClick={() => onChange(f.code)}>
          <div className="font-semibold text-ink">{f.name}</div>
          <p className="mt-1 text-xs text-muted-foreground">{f.description}</p>
          {f.code === options.defaultFormatCode && (
            <span className="mt-2 inline-block text-[11px] text-teal">Your last choice</span>
          )}
        </Choice>
      ))}
    </div>
  );
}

// 6a --------------------------------------------------------------------------------
export function StepEntities({
  query,
  available,
  selected,
  periodLabel,
  onChange,
}: {
  query: UseQueryResult<WizardEntityDto[]>;
  available: WizardEntityDto[];
  selected: string[];
  periodLabel: string;
  onChange: (codes: string[]) => void;
}) {
  if (query.error) return <Alert>{errorMessage(query.error)}</Alert>;
  if (!query.data) return <Skeleton className="h-40 w-full" />;
  if (available.length === 0) {
    const task = query.data.find((e) => e.inTask)?.inTask;
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border bg-mint/40 p-4">
        <p className="font-medium text-ink">All entities already have a task for {periodLabel}.</p>
        {task && (
          <Button asChild>
            <Link to={`/tasks/${task.id}`} className="no-underline">
              Open task {task.number}
            </Link>
          </Button>
        )}
      </div>
    );
  }
  const allSelected = available.every((e) => selected.includes(e.code));
  const tbc = query.data.filter((e) => e.toBeConfirmed);
  const toggle = (code: string, on: boolean) =>
    onChange(on ? [...new Set([...selected, code])] : selected.filter((c) => c !== code));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={allSelected}
            onChange={(e) => onChange(e.target.checked ? available.map((a) => a.code) : [])}
            aria-label="Select all available entities"
          />
          Select all available ({available.length})
        </label>
        <span className="text-sm text-muted-foreground">
          {selected.length} of {available.length} selected
        </span>
      </div>
      <Table>
        <thead>
          <tr>
            <Th className="w-10">
              <span className="sr-only">Include</span>
            </Th>
            <Th>Entity</Th>
            <Th>Code</Th>
            <Th>Functional</Th>
            <Th>Translated into</Th>
            <Th>GAAP</Th>
            <Th>ERP</Th>
            <Th>Already in task</Th>
          </tr>
        </thead>
        <tbody>
          {query.data.map((e) => (
            <tr
              key={e.code}
              className={cn(
                e.inTask
                  ? 'bg-muted/40 text-muted-foreground'
                  : selected.includes(e.code) && 'bg-mint/30',
              )}
            >
              <Td>
                <Checkbox
                  aria-label={`Include ${e.shortName}`}
                  disabled={Boolean(e.inTask)}
                  checked={!e.inTask && selected.includes(e.code)}
                  onChange={(ev) => toggle(e.code, ev.target.checked)}
                />
              </Td>
              <Td>
                <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
                  {e.shortName}
                  {e.toBeConfirmed && <TbcBadge note={e.toBeConfirmedNote} />}
                </div>
                <div className="text-xs text-muted-foreground">{e.legalName}</div>
              </Td>
              <Td className="font-mono text-xs">{e.code}</Td>
              <Td className="font-mono text-xs">{e.functionalCurrency}</Td>
              <Td className="font-mono text-xs">{e.translatedCurrencies.join(', ') || '—'}</Td>
              <Td className="text-xs">{GAAP_LABELS[e.gaap]}</Td>
              <Td className="text-xs">{ERP_LABELS[e.erp]}</Td>
              <Td className="text-xs">
                {e.inTask ? (
                  <>
                    In <TaskLink task={e.inTask} />
                  </>
                ) : (
                  '—'
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {tbc.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <TbcBadge /> {tbc.map((e) => e.code).join(', ')}: master data is not final yet (
          {tbc
            .map((e) => e.toBeConfirmedNote)
            .filter(Boolean)
            .join(' ')}
          ).
        </p>
      )}
      {selected.length === 0 && (
        <p className="text-sm text-destructive">Choose at least one entity.</p>
      )}
    </div>
  );
}

// 6b --------------------------------------------------------------------------------
export function StepLevels({
  query,
  periodLabel,
}: {
  query: UseQueryResult<WizardLevelsDto>;
  periodLabel: string;
}) {
  if (query.error) return <Alert>{errorMessage(query.error)}</Alert>;
  if (!query.data) return <Skeleton className="h-40 w-full" />;
  const d = query.data;
  return (
    <div className="space-y-3">
      {d.existingTask ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border bg-mint/40 p-4">
          <p className="font-medium text-ink">
            A consolidation task already exists for {periodLabel}. Only one CFS task per period.
          </p>
          <Button asChild>
            <Link to={`/tasks/${d.existingTask.id}`} className="no-underline">
              Open task {d.existingTask.number}
            </Link>
          </Button>
        </div>
      ) : d.blockedReason ? (
        <Alert>{d.blockedReason}</Alert>
      ) : (
        <Alert variant="info">
          You can create the task now. Each level can be worked on only when all its entities' SFS
          are finalised and the level below is finalised.
        </Alert>
      )}
      <ol className="space-y-2">
        {d.levels.map((l) => (
          <LevelRow key={l.level} l={l} periodLabel={periodLabel} />
        ))}
      </ol>
    </div>
  );
}

function LevelRow({ l, periodLabel }: { l: WizardLevelDto; periodLabel: string }) {
  const ready = l.sfsFinalised === l.sfsTotal;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div>
        <div className="flex items-center gap-2 font-semibold text-ink">
          <Layers className="size-4 text-teal" /> Level {l.level} {l.name}
          <Badge variant="outline" className="font-mono">
            {l.currency}
          </Badge>
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {l.members.map((m) => (
            <Badge key={m.code} variant="secondary" title={m.shortName} className="font-mono">
              {m.code}
            </Badge>
          ))}
        </div>
      </div>
      <Badge variant={ready ? 'success' : 'warning'}>
        SFS ready: {l.sfsFinalised} of {l.sfsTotal} finalised for {periodLabel}
      </Badge>
    </li>
  );
}

// 7 ---------------------------------------------------------------------------------
export function StepReview({
  state: s,
  setState,
  period,
  fyLabel,
  formatName,
  entityNames,
  levels,
  preparer,
  create,
}: {
  state: WizardState;
  setState: Dispatch<SetStateAction<WizardState>>;
  period: WizardPeriodDto;
  fyLabel: string;
  formatName: string;
  entityNames: string[];
  levels: WizardLevelDto[];
  preparer: string;
  create: UseMutationResult<TaskDetailDto, Error, void>;
}) {
  const items = s.type === 'SFS' ? entityNames : levels.map((l) => `L${l.level} ${l.name}`);
  const row = (label: string, value: ReactNode) => (
    <div className="grid grid-cols-[10rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
  return (
    <div className="space-y-5">
      <dl className="rounded-lg border bg-muted/30 px-4 py-2">
        {row(
          'Task type',
          s.type === 'SFS'
            ? 'Standalone financial statements (SFS)'
            : 'Consolidated financial statements (CFS)',
        )}
        {row('Financial year', fyLabel)}
        {row('Period', `${period.label} · ${PERIOD_TYPE_LABELS[period.type]}`)}
        {row('Format', formatName)}
        {row(s.type === 'SFS' ? 'Entities' : 'Levels', `${items.length}: ${items.join(', ')}`)}
        {row('Due date', formatDate(period.dueDate))}
        {row('Preparer', `${preparer} (you)`)}
      </dl>
      <Field
        label="Description"
        htmlFor="task-description"
        hint="Generated from your choices; you can edit it."
      >
        <Input
          id="task-description"
          value={s.description}
          maxLength={300}
          onChange={(e) =>
            setState((prev) => ({ ...prev, description: e.target.value, descriptionEdited: true }))
          }
        />
      </Field>
      <Field label="Note to reviewer (optional)" htmlFor="task-note">
        <textarea
          id="task-note"
          rows={3}
          maxLength={1000}
          value={s.reviewerNote}
          onChange={(e) => setState((prev) => ({ ...prev, reviewerNote: e.target.value }))}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </Field>
      {create.error && <Alert>{errorMessage(create.error)}</Alert>}
      <Button
        size="lg"
        onClick={() => create.mutate()}
        disabled={create.isPending || !s.description.trim()}
      >
        {create.isPending ? 'Creating…' : 'Create task'}
      </Button>
    </div>
  );
}
