import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CircleCheck,
  CircleX,
  Info,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CurrencyTranslationDto, EntityTranslationDto } from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { RulesPanel } from './RulesPanel';
import { TranslatedTable } from './TranslatedTable';
import { FctrMovement, RatesCard, SummaryCard } from './TranslationCards';

const stampKey = (taskId: string, code: string) => `fc:translation-rates:${taskId}:${code}`;
function lastStamp(taskId: string, code: string): string | null {
  try {
    return localStorage.getItem(stampKey(taskId, code));
  } catch {
    return null;
  }
}

export function EntityTranslation({
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
    queryKey: ['translation', taskId, entityCode],
    queryFn: () =>
      api.get<EntityTranslationDto>(`/tasks/${taskId}/entities/${entityCode}/translation`),
  });
  const [target, setTarget] = useState<string | null>(null);
  const [ratesChanged, setRatesChanged] = useState(false);

  // "Rates changed since you last viewed": compare the rates stamp with the one seen last time.
  useEffect(() => {
    if (!q.data) return;
    const before = lastStamp(taskId, entityCode);
    setRatesChanged(before !== null && before !== q.data.ratesStamp);
    try {
      localStorage.setItem(stampKey(taskId, entityCode), q.data.ratesStamp);
    } catch {
      /* not remembered */
    }
  }, [q.data, taskId, entityCode]);

  const next = useMutation({
    mutationFn: () =>
      api.post<{ currentStep: string }>(
        `/tasks/${taskId}/entities/${entityCode}/translation/continue`,
      ),
    onSuccess: async () => {
      toast(`${entityCode} moved to Statements and notes.`);
      await qc.invalidateQueries({ queryKey: ['translation', taskId, entityCode] });
      await qc.invalidateQueries({ queryKey: ['translation-step', taskId] });
      await qc.invalidateQueries({ queryKey: ['task', taskId] });
    },
  });

  if (q.error) return <Alert>{errorMessage(q.error)}</Alert>;
  if (!q.data) return <Skeleton className="h-96 w-full" />;
  const t = q.data;

  if (!t.tb) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            <strong>{t.entity.legalName}</strong>: upload a trial balance first.
          </p>
          <Button variant="outline" size="sm" onClick={onUpload}>
            <Upload /> Go to step 1 · Upload data
          </Button>
        </CardContent>
      </Card>
    );
  }

  const current: CurrencyTranslationDto | undefined =
    t.currencies.find((c) => c.target === target) ?? t.currencies[0];

  return (
    <div className="space-y-5 pb-24">
      {ratesChanged && (
        <p className="flex items-center gap-2 rounded-md border border-warning/40 bg-amber-50 px-3 py-2 text-sm">
          <RefreshCw className="size-4 text-warning-foreground" /> Rates changed since you last
          viewed – figures updated.
        </p>
      )}
      {t.readOnlyReason && <p className="text-xs text-muted-foreground">{t.readOnlyReason}</p>}

      {t.noTranslation ? (
        <Card>
          <CardContent className="flex items-center gap-2 text-sm">
            <Info className="size-4 text-muted-foreground" /> {t.noTranslation}
          </CardContent>
        </Card>
      ) : (
        <>
          <div role="tablist" aria-label="Translations" className="flex flex-wrap gap-1">
            {t.currencies.map((c) => (
              <Button
                key={c.target}
                role="tab"
                aria-selected={c.target === current?.target}
                size="sm"
                variant={c.target === current?.target ? 'default' : 'outline'}
                onClick={() => setTarget(c.target)}
              >
                {c.status === 'FAIL' && <CircleX />}
                {c.label}
              </Button>
            ))}
          </div>
          {current && (
            <Translation
              c={current}
              functional={t.entity.functionalCurrency}
              periodLabel={t.periodLabel}
              periodType={t.periodType}
            />
          )}
        </>
      )}
      <RulesPanel />

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <ul className="flex flex-wrap gap-x-4 text-sm">
            {t.currencies.map((c) => (
              <li
                key={c.target}
                className={cn(
                  'flex items-center gap-1',
                  c.status === 'OK' ? 'text-success' : 'text-destructive',
                )}
              >
                {c.status === 'OK' ? (
                  <CircleCheck className="size-4" />
                ) : (
                  <CircleX className="size-4" />
                )}
                {c.label}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3">
            {next.error && (
              <span className="text-sm text-destructive">{errorMessage(next.error)}</span>
            )}
            <Button disabled={!t.canContinue || next.isPending} onClick={() => next.mutate()}>
              Continue to statements and notes <ArrowRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Translation({
  c,
  functional,
  periodLabel,
  periodType,
}: {
  c: CurrencyTranslationDto;
  functional: string;
  periodLabel: string;
  periodType: string;
}) {
  if (c.status === 'FAIL') {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <CircleX className="size-4" /> {c.label}: not translated
          </CardTitle>
          <CardDescription>
            Fix these, then the translation is recalculated automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {c.failures.map((f) => (
            <p key={f}>{f}</p>
          ))}
        </CardContent>
      </Card>
    );
  }
  return (
    <>
      <div className="grid gap-5 lg:grid-cols-2">
        <RatesCard
          c={c}
          functional={functional}
          periodLabel={periodLabel}
          showMonths={periodType !== 'MONTHLY'}
        />
        <Card>
          <CardHeader>
            <CardTitle>Method</CardTitle>
            <CardDescription>Retained earnings and anything to check.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p
              className={cn(
                'flex items-start gap-2',
                c.reMethod.kind === 'OPENING_RATE' ? 'text-warning-foreground' : '',
              )}
            >
              {c.reMethod.kind === 'ROLL_FORWARD' ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
              ) : (
                <Info className="mt-0.5 size-4 shrink-0" />
              )}
              <span>
                <strong>Retained earnings:</strong> {c.reMethod.text}
              </span>
            </p>
            {c.warnings.map((w) => (
              <p key={w} className="flex items-start gap-2 text-warning-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {w}
              </p>
            ))}
            {c.warnings.length === 0 && <p className="text-muted-foreground">No warnings.</p>}
          </CardContent>
        </Card>
      </div>
      <TranslatedTable c={c} functional={functional} />
      <div className="grid gap-5 lg:grid-cols-2">
        <SummaryCard c={c} />
        <FctrMovement c={c} periodLabel={periodLabel} />
      </div>
    </>
  );
}
