import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag } from 'lucide-react';
import { useMemo } from 'react';
import {
  COMPARATIVE_BASIS_OPTIONS,
  type ComparativeBasis,
  type ComparativesStepDto,
} from '@finance-close/shared';
import { Alert, Field, Select } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { toast } from '@/lib/toast';
import { EntityTabs } from '../EntityTabs';
import { useSelectedEntity } from '../useSelectedEntity';
import { EntityComparatives } from './EntityComparatives';

/** Step 3 "Comparatives": the comparative basis for the task, then one entity at a time. */
export function ComparativesStep({ taskId, onUpload }: { taskId: string; onUpload: () => void }) {
  const qc = useQueryClient();
  const step = useQuery({
    queryKey: ['comparatives-step', taskId],
    queryFn: () => api.get<ComparativesStepDto>(`/tasks/${taskId}/comparatives-step`),
  });
  const entities = useMemo(() => step.data?.entities ?? [], [step.data]);
  const [selected, choose] = useSelectedEntity(taskId, entities);
  const basis = useMutation({
    mutationFn: (b: ComparativeBasis) =>
      api.put<ComparativesStepDto>(`/tasks/${taskId}/comparatives/basis`, { basis: b }),
    onSuccess: async (s) => {
      qc.setQueryData(['comparatives-step', taskId], s);
      toast(`Comparing ${s.currentPeriodLabel} with ${s.comparativePeriodLabel}.`);
      await qc.invalidateQueries({ queryKey: ['comparatives', taskId] });
    },
  });

  if (step.error) return <Alert>{errorMessage(step.error)}</Alert>;
  if (!step.data || !selected) return <Skeleton className="h-96 w-full" />;
  const s = step.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-64">
          <Field label="Compare with" htmlFor="comparative-basis">
            <Select
              id="comparative-basis"
              value={s.basis}
              disabled={!s.canChangeBasis || basis.isPending}
              onChange={(e) => basis.mutate(e.target.value as ComparativeBasis)}
            >
              {COMPARATIVE_BASIS_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="pb-2 text-sm text-muted-foreground">
          {s.currentPeriodLabel} compared with{' '}
          <strong className="text-foreground">{s.comparativePeriodLabel}</strong> (saved for this
          task)
        </p>
        {basis.error && <Alert>{errorMessage(basis.error)}</Alert>}
      </div>
      <EntityTabs
        entities={entities}
        selected={selected}
        onSelect={choose}
        markerText={(e) =>
          e.flagged === null
            ? 'No TB'
            : e.flagged === 0
              ? 'no flags'
              : `${e.explained} of ${e.flagged} explained`
        }
        marker={(e) =>
          e.flagged ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 text-xs text-warning-foreground">
              <Flag className="size-3" /> {e.explained}/{e.flagged}
            </span>
          ) : null
        }
      />
      <EntityComparatives
        key={`${selected}:${s.basis}`}
        taskId={taskId}
        entityCode={selected}
        onUpload={onUpload}
      />
    </div>
  );
}
