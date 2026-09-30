import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CircleCheck, CircleX, Lock, Upload } from 'lucide-react';
import type { ReactNode } from 'react';
import type { EntityMappingDto } from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { toast } from '@/lib/toast';
import { AccountsToMap } from './AccountsToMap';
import { RatesCard } from './RatesCard';
import { FsliSummaryCard, IntercompanyCard } from './Summaries';
import { TbMappingTable } from './TbMappingTable';

const mappingKey = (taskId: string, code: string) => ['mapping', taskId, code];

export function EntityMapping({
  taskId,
  entityCode,
  onUpload,
}: {
  taskId: string;
  entityCode: string;
  onUpload: () => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: mappingKey(taskId, entityCode),
    queryFn: () => api.get<EntityMappingDto>(`/tasks/${taskId}/entities/${entityCode}/mapping`),
  });
  /** After a save the API returns the whole refreshed entity. */
  const onSaved = async (m: EntityMappingDto) => {
    qc.setQueryData(mappingKey(taskId, entityCode), m);
    await qc.invalidateQueries({ queryKey: ['mapping-step', taskId] });
  };
  const next = useMutation({
    mutationFn: () =>
      api.post<{ currentStep: string }>(`/tasks/${taskId}/entities/${entityCode}/mapping/continue`),
    onSuccess: async () => {
      toast(`${entityCode} moved to Comparatives.`);
      await qc.invalidateQueries({ queryKey: mappingKey(taskId, entityCode) });
      await qc.invalidateQueries({ queryKey: ['mapping-step', taskId] });
      await qc.invalidateQueries({ queryKey: ['task', taskId] });
    },
  });

  if (q.error) return <Alert>{errorMessage(q.error)}</Alert>;
  if (!q.data) return <Skeleton className="h-96 w-full" />;
  const m = q.data;

  if (!m.tb) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            <strong>{m.entity.legalName}</strong>: upload a trial balance first. Mapping starts once
            it is validated in step 1.
          </p>
          <Button variant="outline" size="sm" onClick={onUpload}>
            <Upload /> Go to step 1 · Upload data
          </Button>
        </CardContent>
      </Card>
    );
  }

  const c = m.completion;
  return (
    <div className="space-y-5 pb-24">
      <p className="text-sm text-muted-foreground">
        {m.entity.legalName} · {m.entity.functionalCurrency} · trial balance v{m.tb.version} (
        {m.tb.fileName})
        {m.readOnlyReason && (
          <span className="ml-2 inline-flex items-center gap-1">
            <Lock className="size-3.5" /> {m.readOnlyReason}
          </span>
        )}
      </p>
      <RatesCard rates={m.rates} taskId={taskId} onUpload={onUpload} />
      {m.toMap.length > 0 && (
        <AccountsToMap
          key={m.toMap.map((a) => a.code).join(',')}
          taskId={taskId}
          mapping={m}
          onSaved={onSaved}
        />
      )}
      <TbMappingTable taskId={taskId} mapping={m} onSaved={onSaved} />
      <div className="grid gap-5 lg:grid-cols-2">
        {m.fsliSummary && (
          <FsliSummaryCard summary={m.fsliSummary} currency={m.entity.functionalCurrency} />
        )}
        <IntercompanyCard rows={m.intercompany} currency={m.entity.functionalCurrency} />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Check ok={c.balanced}>TB balanced</Check>
            <Check ok={c.toMap === 0}>
              {c.toMap === 0 ? '0 accounts to map' : `${c.toMap} accounts to map`}
            </Check>
            <Check ok={c.counterpartiesComplete}>Counterparties set</Check>
            {c.missingRates.length > 0 && (
              <li
                className="flex items-center gap-1 text-warning-foreground"
                title={c.missingRates.join('\n')}
              >
                <AlertTriangle className="size-4" /> {c.missingRates.length} rate(s) missing —
                needed for translation
              </li>
            )}
          </ul>
          <div className="flex items-center gap-3">
            {next.error && (
              <span className="text-sm text-destructive">{errorMessage(next.error)}</span>
            )}
            <Button disabled={!c.canContinue || next.isPending} onClick={() => next.mutate()}>
              Continue to comparatives <ArrowRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li
      className={
        ok ? 'flex items-center gap-1 text-success' : 'flex items-center gap-1 text-destructive'
      }
    >
      {ok ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}
      {children}
    </li>
  );
}
