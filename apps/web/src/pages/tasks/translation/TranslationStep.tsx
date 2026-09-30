import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleX } from 'lucide-react';
import { useMemo } from 'react';
import type { TranslationStepDto } from '@finance-close/shared';
import { Alert } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { EntityTabs } from '../EntityTabs';
import { useSelectedEntity } from '../useSelectedEntity';
import { EntityTranslation } from './EntityTranslation';

/** Step 4 "Currency translation": one entity at a time (same switcher as steps 2 and 3). */
export function TranslationStep({ taskId, onUpload }: { taskId: string; onUpload: () => void }) {
  const step = useQuery({
    queryKey: ['translation-step', taskId],
    queryFn: () => api.get<TranslationStepDto>(`/tasks/${taskId}/translation-step`),
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
        markerText={(e) =>
          e.failed === null
            ? 'No TB'
            : e.currencies === 0
              ? 'no translation'
              : e.failed > 0
                ? `${e.failed} failed`
                : '✓'
        }
        marker={(e) =>
          e.failed === null || e.currencies === 0 ? null : e.failed > 0 ? (
            <CircleX className="size-4 text-destructive" aria-label="Translation failed" />
          ) : (
            <CircleCheck className="size-4 text-success" aria-label="Translated" />
          )
        }
      />
      <EntityTranslation key={selected} taskId={taskId} entityCode={selected} onUpload={onUpload} />
    </div>
  );
}
