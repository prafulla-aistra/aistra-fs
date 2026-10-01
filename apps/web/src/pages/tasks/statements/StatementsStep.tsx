import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleX } from 'lucide-react';
import { useMemo } from 'react';
import type { StatementsStepDto } from '@finance-close/shared';
import { Alert } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { EntityTabs } from '../EntityTabs';
import { useSelectedEntity } from '../useSelectedEntity';
import { EntityStatements } from './EntityStatements';

/** Step "Statements": one entity at a time (same switcher as the earlier steps). */
export function StatementsStep({
  taskId,
  onUpload,
  onContinue,
  onNote,
}: {
  taskId: string;
  onUpload: () => void;
  onContinue: () => void;
  onNote: (n: number) => void;
}) {
  const step = useQuery({
    queryKey: ['statements-step', taskId],
    queryFn: () => api.get<StatementsStepDto>(`/tasks/${taskId}/statements-step`),
  });
  const entities = useMemo(() => step.data?.entities ?? [], [step.data]);
  const [selected, choose] = useSelectedEntity(taskId, entities);

  if (step.error) return <Alert>{errorMessage(step.error)}</Alert>;
  if (!step.data || !selected) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="space-y-5">
      <div className="no-print">
        <EntityTabs
          entities={entities}
          selected={selected}
          onSelect={choose}
          markerText={(e) => (e.ties === null ? 'No TB' : e.ties ? '✓' : 'does not tie')}
          marker={(e) =>
            e.ties === null ? null : e.ties ? (
              <CircleCheck className="size-4 text-success" aria-label="Statements tie" />
            ) : (
              <CircleX className="size-4 text-destructive" aria-label="Statements do not tie" />
            )
          }
        />
      </div>
      <EntityStatements
        key={selected}
        taskId={taskId}
        entityCode={selected}
        onUpload={onUpload}
        onContinue={onContinue}
        onNote={onNote}
      />
    </div>
  );
}
