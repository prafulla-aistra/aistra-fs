import { useQuery } from '@tanstack/react-query';
import { CircleCheck } from 'lucide-react';
import { useMemo } from 'react';
import type { MappingStepDto } from '@finance-close/shared';
import { Alert } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { EntityTabs } from '../EntityTabs';
import { useSelectedEntity } from '../useSelectedEntity';
import { EntityMapping } from './EntityMapping';

/** Step 2 "Review and map": one entity at a time, chosen with tabs (remembered per task). */
export function MappingStep({ taskId, onUpload }: { taskId: string; onUpload: () => void }) {
  const step = useQuery({
    queryKey: ['mapping-step', taskId],
    queryFn: () => api.get<MappingStepDto>(`/tasks/${taskId}/mapping-step`),
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
        markerText={(e) => (e.toMap === null ? 'No TB' : e.toMap === 0 ? '✓' : `${e.toMap} to map`)}
        marker={(e) =>
          e.toMap === 0 ? (
            <CircleCheck className="size-4 text-success" aria-label="Mapping complete" />
          ) : e.toMap !== null ? (
            <span className="rounded-full bg-amber-50 px-1.5 text-xs text-warning-foreground">
              {e.toMap} to map
            </span>
          ) : null
        }
      />
      <EntityMapping key={selected} taskId={taskId} entityCode={selected} onUpload={onUpload} />
    </div>
  );
}
