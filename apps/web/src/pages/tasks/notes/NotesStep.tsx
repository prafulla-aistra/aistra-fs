import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { NotesStepDto } from '@finance-close/shared';
import { Alert } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { EntityTabs } from '../EntityTabs';
import { useSelectedEntity } from '../useSelectedEntity';
import { EntityNotes } from './EntityNotes';

/** Step "Notes": notes to accounts, one entity at a time (same switcher as the other steps). */
export function NotesStep({
  taskId,
  onUpload,
  onContinue,
}: {
  taskId: string;
  onUpload: () => void;
  onContinue: () => void;
}) {
  const step = useQuery({
    queryKey: ['notes-step', taskId],
    queryFn: () => api.get<NotesStepDto>(`/tasks/${taskId}/notes-step`),
  });
  const entities = useMemo(() => step.data?.entities ?? [], [step.data]);
  const [selected, choose] = useSelectedEntity(taskId, entities);
  if (step.error) return <Alert>{errorMessage(step.error)}</Alert>;
  if (!step.data || !selected) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="space-y-5">
      <EntityTabs
        entities={entities}
        selected={selected}
        onSelect={choose}
        markerText={(e) => (e.total === null ? 'not started' : `${e.reviewed} reviewed`)}
        marker={(e) =>
          e.total === null ? null : (
            <span className="text-xs text-muted-foreground tabular-nums">
              {e.reviewed} reviewed
            </span>
          )
        }
      />
      <EntityNotes
        key={selected}
        taskId={taskId}
        entityCode={selected}
        onUpload={onUpload}
        onContinue={onContinue}
      />
    </div>
  );
}
