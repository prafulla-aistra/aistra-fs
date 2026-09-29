import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Construction, Eye, Lock } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { taskStepLabel, type TaskDetailDto } from '@finance-close/shared';
import { PageHeader } from '@/components/AppShell';
import { ItemStatusBadge, TaskStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';

/** Placeholder for the task workspace (built on the next page): task number and saved step. */
export function TaskPlaceholderPage() {
  const { id = '' } = useParams();
  const task = useQuery({
    queryKey: ['task', id],
    queryFn: () => api.get<TaskDetailDto>(`/tasks/${id}`),
  });

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3">
        <Link to="/dashboard" className="no-underline">
          <ArrowLeft /> Back to dashboard
        </Link>
      </Button>
      {task.error ? (
        <Alert>{errorMessage(task.error)}</Alert>
      ) : !task.data ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <PageHeader title={task.data.number} description={task.data.description} />
          <Card>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <TaskStatusBadge status={task.data.status} />
                {task.data.readOnly ? (
                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                    {task.data.locked ? <Lock className="size-4" /> : <Eye className="size-4" />}
                    {task.data.locked ? 'Locked — read only' : 'Read only'}
                  </span>
                ) : null}
              </div>
              <p className="text-sm">
                {task.data.readOnly ? 'Viewing' : 'Continuing'} at{' '}
                <strong className="text-ink">{taskStepLabel(task.data.currentStep)}</strong>
              </p>
              <ul className="flex flex-wrap gap-x-5 gap-y-2">
                {task.data.items.map((i) => (
                  <li key={i.code} className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs font-semibold">{i.code}</span>
                    {i.label}
                    <ItemStatusBadge status={i.status} />
                  </li>
                ))}
              </ul>
              {task.data.reviewerNote && (
                <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                  <span className="font-medium">Note to reviewer:</span> {task.data.reviewerNote}
                </p>
              )}
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Construction className="size-4" /> The task workspace is coming in the next step.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
