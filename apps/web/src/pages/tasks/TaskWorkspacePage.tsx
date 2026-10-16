import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Eye, Lock } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { TASK_STEPS, type TaskDetailDto, type TaskStepCode } from '@finance-close/shared';
import { PageHeader } from '@/components/AppShell';
import { TaskStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CfsWorkspace } from './cfs/CfsWorkspace';
import { ComparativesStep } from './comparatives/ComparativesStep';
import { MappingStep } from './mapping/MappingStep';
import { NotesStep } from './notes/NotesStep';
import { FinalisedStep } from './review/FinalisedStep';
import { ReviewStep } from './review/ReviewStep';
import { StatementsStep } from './statements/StatementsStep';
import { TranslationStep } from './translation/TranslationStep';
import { UploadStep } from './upload/UploadStep';

/**
 * Task workspace. SFS tasks: a stepper over the eight workflow steps, Upload to Finalised.
 * CFS tasks: the consolidation workspace (level path and level steps).
 */
export function TaskWorkspacePage() {
  const { id = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const task = useQuery({
    queryKey: ['task', id],
    queryFn: () => api.get<TaskDetailDto>(`/tasks/${id}`),
  });

  if (task.error) return <Alert>{errorMessage(task.error)}</Alert>;
  if (!task.data) return <Skeleton className="h-40 w-full" />;
  if (task.data.type !== 'SFS') return <CfsWorkspace taskId={task.data.id} />;

  const t = task.data;
  const requested = search.get('step') as TaskStepCode | null;
  const active: TaskStepCode = TASK_STEPS.some((s) => s.code === requested)
    ? requested!
    : 'UPLOAD_DATA';
  const goTo = (code: TaskStepCode) => setSearch(code === 'UPLOAD_DATA' ? {} : { step: code });

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="no-print mb-3">
        <Link to="/dashboard" className="no-underline">
          <ArrowLeft /> Back to dashboard
        </Link>
      </Button>
      <PageHeader
        title={`${t.number} · ${t.periodLabel}`}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t.description}</span>
            <span>Due {formatDate(t.dueDate)}</span>
            <TaskStatusBadge status={t.status} />
            {t.readOnly && (
              <span className="inline-flex items-center gap-1">
                {t.locked ? <Lock className="size-3.5" /> : <Eye className="size-3.5" />}
                {t.locked ? 'Locked — read only' : 'Read only'}
              </span>
            )}
          </span>
        }
      />
      <Stepper active={active} onSelect={goTo} />
      {active === 'UPLOAD_DATA' ? (
        <UploadStep taskId={t.id} onContinue={() => goTo('MAPPING')} />
      ) : active === 'MAPPING' ? (
        <MappingStep taskId={t.id} onUpload={() => goTo('UPLOAD_DATA')} />
      ) : active === 'COMPARATIVES' ? (
        <ComparativesStep taskId={t.id} onUpload={() => goTo('UPLOAD_DATA')} />
      ) : active === 'TRANSLATION' ? (
        <TranslationStep taskId={t.id} onUpload={() => goTo('UPLOAD_DATA')} />
      ) : active === 'STATEMENTS' ? (
        <StatementsStep
          taskId={t.id}
          onUpload={() => goTo('UPLOAD_DATA')}
          onContinue={() => goTo('NOTES')}
          onNote={(n) => setSearch({ step: 'NOTES', note: String(n) })}
        />
      ) : active === 'NOTES' ? (
        <NotesStep
          taskId={t.id}
          onUpload={() => goTo('UPLOAD_DATA')}
          onContinue={() => goTo('REVIEW')}
        />
      ) : active === 'REVIEW' ? (
        <ReviewStep
          taskId={t.id}
          onGo={(step, key) =>
            setSearch(
              step === 'NOTES' && key ? { step, noteId: key } : { step, ...(key ? { key } : {}) },
            )
          }
        />
      ) : (
        <FinalisedStep taskId={t.id} />
      )}
    </>
  );
}

function Stepper({
  active,
  onSelect,
}: {
  active: TaskStepCode;
  onSelect: (c: TaskStepCode) => void;
}) {
  const activeIndex = TASK_STEPS.findIndex((s) => s.code === active);
  return (
    <nav aria-label="Task steps" className="no-print mb-6 overflow-x-auto">
      <ol className="flex flex-nowrap items-center gap-1.5">
        {TASK_STEPS.map((s, i) => {
          const current = i === activeIndex;
          const done = i < activeIndex;
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
