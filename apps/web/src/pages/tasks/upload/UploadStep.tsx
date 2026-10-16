import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CircleCheck, Info } from 'lucide-react';
import type { UploadStepDto } from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { toast } from '@/lib/toast';
import { EntityCard } from './EntityCard';
import { RatesPanel } from './RatesPanel';

const uploadStepKey = (taskId: string) => ['upload-step', taskId];

/** Step 1 "Upload data": exchange rates, one card per entity, and the summary bar. */
export function UploadStep({ taskId, onContinue }: { taskId: string; onContinue: () => void }) {
  const qc = useQueryClient();
  const step = useQuery({
    queryKey: uploadStepKey(taskId),
    queryFn: () => api.get<UploadStepDto>(`/tasks/${taskId}/upload-step`),
  });
  const next = useMutation({
    mutationFn: () => api.post<{ moved: string[] }>(`/tasks/${taskId}/continue`),
    onSuccess: async (r) => {
      toast(
        r.moved.length > 0
          ? `Moved to Mapping: ${r.moved.join(', ')}.`
          : 'Validated entities are already past this step.',
      );
      await qc.invalidateQueries({ queryKey: uploadStepKey(taskId) });
      await qc.invalidateQueries({ queryKey: ['task', taskId] });
      onContinue();
    },
  });

  if (step.error) return <Alert>{errorMessage(step.error)}</Alert>;
  if (!step.data) return <Skeleton className="h-96 w-full" />;
  const s = step.data;

  return (
    <div className="space-y-6 pb-24">
      <RatesPanel taskId={taskId} rates={s.rates} />
      <section aria-label="Entities" className="grid items-start gap-4 lg:grid-cols-2">
        {s.entities.map((e) => (
          <EntityCard key={e.code} taskId={taskId} card={e} />
        ))}
      </section>

      <div className="fixed inset-x-0 bottom-0 md:left-(--shell-left) z-30 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <p className="flex items-center gap-2 text-sm">
            {s.summary.validated === s.summary.total && s.summary.ratesComplete ? (
              <CircleCheck className="size-4 text-success" />
            ) : (
              <Info className="size-4 text-muted-foreground" />
            )}
            <span className="font-medium">{s.summary.text}</span>
          </p>
          <div className="flex items-center gap-3">
            {next.error && (
              <span className="text-sm text-destructive">{errorMessage(next.error)}</span>
            )}
            {!s.canContinue && !s.task.locked && (
              <span className="text-xs text-muted-foreground">
                Validate at least one entity’s trial balance to continue.
              </span>
            )}
            <Button disabled={!s.canContinue || next.isPending} onClick={() => next.mutate()}>
              Continue to review and map <ArrowRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
