import { useQuery } from '@tanstack/react-query';
import { CircleCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { MappingStepDto } from '@finance-close/shared';
import { ItemStatusBadge } from '@/components/ui/badge';
import { Alert, Select } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EntityMapping } from './EntityMapping';

const storageKey = (taskId: string) => `fc:mapping-entity:${taskId}`;
function remembered(taskId: string): string | null {
  try {
    return localStorage.getItem(storageKey(taskId));
  } catch {
    return null;
  }
}

/** Step 2 "Review and map": one entity at a time, chosen with tabs (remembered per task). */
export function MappingStep({ taskId, onUpload }: { taskId: string; onUpload: () => void }) {
  const step = useQuery({
    queryKey: ['mapping-step', taskId],
    queryFn: () => api.get<MappingStepDto>(`/tasks/${taskId}/mapping-step`),
  });
  const [selected, setSelected] = useState<string | null>(() => remembered(taskId));

  const entities = useMemo(() => step.data?.entities ?? [], [step.data]);
  useEffect(() => {
    if (entities.length > 0 && !entities.some((e) => e.code === selected)) {
      setSelected((entities.find((e) => e.hasValidatedTb) ?? entities[0])!.code);
    }
  }, [entities, selected]);
  const choose = (code: string) => {
    setSelected(code);
    try {
      localStorage.setItem(storageKey(taskId), code);
    } catch {
      /* private window: not remembered */
    }
  };

  if (step.error) return <Alert>{errorMessage(step.error)}</Alert>;
  if (!step.data || !selected) return <Skeleton className="h-96 w-full" />;

  const label = (e: (typeof entities)[number]) =>
    e.toMap === null ? 'No TB' : e.toMap === 0 ? '✓' : `${e.toMap} to map`;

  return (
    <div className="space-y-5">
      <Select
        className="md:hidden"
        aria-label="Entity"
        value={selected}
        onChange={(e) => choose(e.target.value)}
      >
        {entities.map((e) => (
          <option key={e.code} value={e.code}>
            {e.code} · {e.shortName} — {label(e)}
          </option>
        ))}
      </Select>
      <div role="tablist" aria-label="Entities" className="hidden flex-wrap gap-1 border-b md:flex">
        {entities.map((e) => (
          <button
            key={e.code}
            role="tab"
            type="button"
            aria-selected={e.code === selected}
            onClick={() => choose(e.code)}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm',
              e.code === selected
                ? 'border-primary font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="font-mono text-xs font-semibold">{e.code}</span>
            {e.shortName}
            <ItemStatusBadge status={e.itemStatus} />
            {e.toMap === 0 ? (
              <CircleCheck className="size-4 text-success" aria-label="Mapping complete" />
            ) : e.toMap !== null ? (
              <span className="rounded-full bg-amber-50 px-1.5 text-xs text-warning-foreground">
                {e.toMap} to map
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <EntityMapping key={selected} taskId={taskId} entityCode={selected} onUpload={onUpload} />
    </div>
  );
}
