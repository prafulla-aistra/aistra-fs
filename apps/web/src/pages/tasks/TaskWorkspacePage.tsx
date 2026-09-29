import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Construction, Eye, Lock } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { TASK_STEPS, type TaskDetailDto, type TaskStepCode } from '@finance-close/shared';
import { PageHeader } from '@/components/AppShell';
import { TaskStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { TaskPlaceholderPage } from './TaskPlaceholderPage';
import { UploadStep } from './upload/UploadStep';

/**
 * Task workspace. SFS tasks: a stepper over the workflow steps; step 1 "Upload data" is built
 * (page 3), later steps come on the next pages. CFS tasks keep the summary placeholder.
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
  if (task.data.type !== 'SFS') return <TaskPlaceholderPage />;

  const t = task.data;
  const requested = search.get('step') as TaskStepCode | null;
  const active: TaskStepCode = TASK_STEPS.some((s) => s.code === requested)
    ? requested!
    : 'UPLOAD_DATA';
  const goTo = (code: TaskStepCode) => setSearch(code === 'UPLOAD_DATA' ? {} : { step: code });

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3">
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
      ) : (
        <Card>
          <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
            <Construction className="size-4" />
            {TASK_STEPS.find((s) => s.code === active)!.label} is built on the next page. Entities
            that passed step 1 wait here.
          </CardContent>
        </Card>
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
    <nav aria-label="Task steps" className="mb-6">
      <ol className="flex flex-wrap items-center gap-2">
        {TASK_STEPS.map((s, i) => {
          const current = i === activeIndex;
          const done = i < activeIndex;
          return (
            <li key={s.code} className="flex items-center gap-2">
              {i > 0 && <span className="h-px w-6 bg-border sm:w-10" aria-hidden />}
              <button
                type="button"
                onClick={() => onSelect(s.code)}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
                  current
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full text-xs font-semibold',
                    current ? 'bg-white/20' : done ? 'bg-mint text-success' : 'bg-muted',
                  )}
                >
                  {done ? <Check className="size-3" /> : i + 1}
                </span>
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
