import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, ChevronRight, Lock } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import {
  CFS_LEVEL_STEPS,
  type CfsLevelDto,
  type CfsLevelStepCode,
  type CfsWorkspaceDto,
} from '@finance-close/shared';
import { PageHeader } from '@/components/AppShell';
import { ItemStatusBadge, TaskStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ApiBaseContext } from '../api-base';
import { EntityNotes } from '../notes/EntityNotes';
import { EntityFinalised } from '../review/FinalisedStep';
import { EntityReview } from '../review/ReviewStep';
import { AggregationStep } from './AggregationStep';
import { EliminationsStep } from './EliminationsStep';
import { ReadinessStep } from './ReadinessStep';
import { StatementsStep } from './StatementsStep';

const BUILT: CfsLevelStepCode[] = CFS_LEVEL_STEPS.map((s) => s.code);

/** CFS task workspace (page 9): the level path, then the selected level's steps. */
export function CfsWorkspace({ taskId }: { taskId: string }) {
  const [search, setSearch] = useSearchParams();
  const q = useQuery({
    queryKey: ['cfs', taskId],
    queryFn: () => api.get<CfsWorkspaceDto>(`/tasks/${taskId}/cfs`),
  });
  if (q.error) return <Alert>{errorMessage(q.error)}</Alert>;
  if (!q.data) return <Skeleton className="h-40 w-full" />;
  const w = q.data;
  const wanted = Number(search.get('level'));
  const selected =
    w.levels.find((l) => l.level === wanted && l.available) ??
    w.levels.find((l) => l.available && l.status !== 'FINALISED') ??
    w.levels.find((l) => l.available) ??
    null;
  const stepParam = search.get('step') as CfsLevelStepCode | null;
  const step: CfsLevelStepCode =
    stepParam && CFS_LEVEL_STEPS.some((s) => s.code === stepParam)
      ? stepParam
      : selected &&
          CFS_LEVEL_STEPS.some((s) => s.code === selected.currentStep) &&
          BUILT.includes(selected.currentStep as CfsLevelStepCode)
        ? (selected.currentStep as CfsLevelStepCode)
        : 'READINESS';
  const go = (level: number, s?: CfsLevelStepCode) =>
    setSearch(s ? { level: String(level), step: s } : { level: String(level) });

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="no-print mb-3">
        <Link to="/dashboard" className="no-underline">
          <ArrowLeft /> Back to dashboard
        </Link>
      </Button>
      <PageHeader
        title={`${w.task.number} · ${w.task.periodLabel}`}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{w.task.description}</span>
            <span>Due {formatDate(w.task.dueDate)}</span>
            <TaskStatusBadge status={w.task.status} />
            {w.task.locked && (
              <span className="inline-flex items-center gap-1">
                <Lock className="size-3.5" /> Locked — read only
              </span>
            )}
          </span>
        }
      />
      <LevelPath levels={w.levels} selected={selected?.level ?? null} onSelect={(l) => go(l)} />
      {!selected ? (
        <Alert variant="info">
          No level is available yet: each level needs every member's standalone statements finalised
          for {w.task.periodLabel}, and every level below it finalised.
        </Alert>
      ) : (
        <>
          <Stepper active={step} level={selected} onSelect={(s) => go(selected.level, s)} />
          {step === 'READINESS' ? (
            <ReadinessStep
              key={selected.level}
              taskId={taskId}
              level={selected.level}
              onContinue={() => go(selected.level, 'AGGREGATION')}
            />
          ) : step === 'AGGREGATION' ? (
            <AggregationStep
              key={selected.level}
              taskId={taskId}
              level={selected.level}
              onContinue={() => go(selected.level, 'ELIMINATIONS')}
            />
          ) : step === 'ELIMINATIONS' ? (
            <EliminationsStep
              key={selected.level}
              taskId={taskId}
              level={selected.level}
              onContinue={() => go(selected.level, 'STATEMENTS')}
            />
          ) : step === 'STATEMENTS' ? (
            <StatementsStep
              key={selected.level}
              taskId={taskId}
              level={selected.level}
              onContinue={() => go(selected.level, 'NOTES')}
              onNote={(n) =>
                setSearch({ level: String(selected.level), step: 'NOTES', note: String(n) })
              }
            />
          ) : (
            <ApiBaseContext.Provider value={`/tasks/${taskId}/cfs/levels/${selected.level}`}>
              {step === 'NOTES' ? (
                <EntityNotes
                  key={selected.level}
                  taskId={taskId}
                  entityCode={`L${selected.level}`}
                  onUpload={() => go(selected.level, 'ELIMINATIONS')}
                  onContinue={() => go(selected.level, 'REVIEW')}
                />
              ) : step === 'REVIEW' ? (
                <EntityReview
                  key={selected.level}
                  taskId={taskId}
                  entityCode={`L${selected.level}`}
                  onGo={(s, key) =>
                    setSearch({
                      level: String(selected.level),
                      step: s,
                      ...(s === 'NOTES' && key ? { noteId: key } : {}),
                    })
                  }
                />
              ) : (
                <EntityFinalised
                  key={selected.level}
                  taskId={taskId}
                  entityCode={`L${selected.level}`}
                />
              )}
            </ApiBaseContext.Provider>
          )}
        </>
      )}
    </>
  );
}

function LevelPath({
  levels,
  selected,
  onSelect,
}: {
  levels: CfsLevelDto[];
  selected: number | null;
  onSelect: (level: number) => void;
}) {
  return (
    <nav aria-label="Consolidation levels" className="no-print mb-5 overflow-x-auto">
      <ol className="flex flex-nowrap items-stretch gap-1.5">
        {levels.map((l, i) => (
          <li key={l.level} className="flex shrink-0 items-center gap-1.5">
            {i > 0 && <ChevronRight className="size-4 text-muted-foreground" aria-hidden />}
            <button
              type="button"
              disabled={!l.available}
              onClick={() => onSelect(l.level)}
              aria-current={selected === l.level ? 'true' : undefined}
              title={
                l.available
                  ? `${l.members.map((m) => m.code).join(', ')}`
                  : `Waiting for: ${l.waitingFor.join(' ')}`
              }
              className={cn(
                'min-w-52 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                selected === l.level ? 'border-primary bg-mint' : 'bg-card hover:bg-mint/50',
                !l.available && 'cursor-not-allowed opacity-70 hover:bg-card',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink">
                  Level {l.level} {l.name}
                </span>
                {!l.available && (
                  <Lock className="size-3.5 text-muted-foreground" aria-label="Not available" />
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {l.memberCount} members · {l.currency}
                </span>
                <ItemStatusBadge status={l.status} />
              </div>
              {!l.available && (
                <div className="mt-1 line-clamp-2 max-w-60 text-xs text-muted-foreground">
                  Waiting for: {l.waitingFor[0]}
                  {l.waitingFor.length > 1 ? ` (+${l.waitingFor.length - 1} more)` : ''}
                </div>
              )}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Stepper({
  active,
  level,
  onSelect,
}: {
  active: CfsLevelStepCode;
  level: CfsLevelDto;
  onSelect: (c: CfsLevelStepCode) => void;
}) {
  const activeIndex = CFS_LEVEL_STEPS.findIndex((s) => s.code === active);
  const savedIndex = CFS_LEVEL_STEPS.findIndex((s) => s.code === level.currentStep);
  return (
    <nav aria-label={`Level ${level.level} steps`} className="no-print mb-6 overflow-x-auto">
      <ol className="flex flex-nowrap items-center gap-1.5">
        {CFS_LEVEL_STEPS.map((s, i) => {
          const current = i === activeIndex;
          const done = i < savedIndex;
          return (
            <li key={s.code} className="flex shrink-0 items-center gap-1.5">
              {i > 0 && <span className="h-px w-3 bg-border lg:w-5" aria-hidden />}
              <button
                type="button"
                onClick={() => onSelect(s.code)}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors',
                  current
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full text-xs font-semibold',
                    current ? 'bg-white/20' : done ? 'bg-success-surface text-success' : 'bg-muted',
                  )}
                >
                  {done ? <Check className="size-3" /> : i + 1}
                </span>
                <span title={s.label}>{s.short}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
