import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CircleCheck, CircleX, Download } from 'lucide-react';
import { useState } from 'react';
import type { AggregationDto, AggregationRowDto } from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { api, downloadPath, errorMessage } from '@/lib/api';
import { drCr, statementAmount } from '@/lib/format';
import { cn } from '@/lib/utils';

type Tab = 'BS' | 'PL' | 'FSLI';

/** Step 2: entity-wise statements in the level currency, plus the aggregate. */
export function AggregationStep({
  taskId,
  level,
  onContinue,
}: {
  taskId: string;
  level: number;
  onContinue: () => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['cfs', taskId, level, 'aggregation'],
    queryFn: () => api.get<AggregationDto>(`/tasks/${taskId}/cfs/levels/${level}/aggregation`),
  });
  const [tab, setTab] = useState<Tab>('BS');
  const exportFile = useMutation({
    mutationFn: () =>
      downloadPath(
        `/tasks/${taskId}/cfs/levels/${level}/aggregation/export`,
        `L${level}-entity-wise-${q.data?.currency ?? ''}.xlsx`,
      ),
  });
  const next = useMutation({
    mutationFn: () =>
      api.post(`/tasks/${taskId}/cfs/levels/${level}/continue`, { from: 'AGGREGATION' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cfs', taskId] });
      onContinue();
    },
  });
  if (q.error) return <Alert>{errorMessage(q.error)}</Alert>;
  if (!q.data) return <Skeleton className="h-96 w-full" />;
  const a = q.data;
  const ticks = new Map(a.balances.map((b) => [b.code, b]));
  const cols = [
    ...a.entities.map((e) => ({ code: e.code, label: `${e.code} ${e.shortName}` })),
    { code: 'AGGREGATE', label: 'Aggregate' },
  ];
  const value = (r: AggregationRowDto, code: string) =>
    code === 'AGGREGATE' ? r.aggregate : (r.values[code] ?? null);
  const rows = tab === 'BS' ? a.balanceSheet : a.profitAndLoss;
  return (
    <div className="space-y-4">
      {a.missing.length > 0 && <Alert>{a.missing.join(' ')}</Alert>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Statement" className="flex gap-1">
          {(
            [
              ['BS', 'Balance sheet'],
              ['PL', 'Profit and loss'],
              ['FSLI', 'FSLI view'],
            ] as const
          ).map(([k, label]) => (
            <Button
              key={k}
              role="tab"
              aria-selected={tab === k}
              size="sm"
              variant={tab === k ? 'default' : 'outline'}
              onClick={() => setTab(k)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {a.formatName} · {a.currency}
          <Button
            variant="outline"
            size="sm"
            disabled={exportFile.isPending}
            onClick={() => exportFile.mutate()}
          >
            <Download /> Excel
          </Button>
        </div>
      </div>
      {exportFile.error && <Alert>{errorMessage(exportFile.error)}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>
            Level {a.level.level} {a.level.name} — entity-wise in {a.currency}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 text-left font-medium">
                  {tab === 'FSLI' ? 'FSLI (debit + / credit −)' : 'Particulars'}
                </th>
                {cols.map((c) => (
                  <th
                    key={c.code}
                    className={cn(
                      'w-40 py-2 text-right font-medium',
                      c.code === 'AGGREGATE' && 'text-ink',
                    )}
                  >
                    <div>{c.label}</div>
                    {tab !== 'FSLI' && (
                      <div
                        className="mt-0.5 flex justify-end"
                        aria-label={`${c.label}: ${ticks.get(c.code)?.balanced && ticks.get(c.code)?.profitTies ? 'balances' : 'does not balance'}`}
                      >
                        {ticks.get(c.code)?.balanced && ticks.get(c.code)?.profitTies ? (
                          <CircleCheck className="size-4 text-success" />
                        ) : (
                          <span className="inline-flex items-center gap-1 text-destructive">
                            <CircleX className="size-4" /> {ticks.get(c.code)?.difference}
                          </span>
                        )}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tab === 'FSLI'
                ? a.fslis.map((f) => (
                    <tr key={f.code} className="border-b last:border-0">
                      <td className="py-1">
                        <span className="font-mono text-xs">{f.code}</span> {f.name}
                        <span className="ml-1 text-xs text-muted-foreground">{f.statement}</span>
                      </td>
                      {cols.map((c) => (
                        <td key={c.code} className="py-1 text-right">
                          {drCr(
                            c.code === 'AGGREGATE' ? f.aggregate : (f.values[c.code] ?? '0.00'),
                          )}
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((r) => (
                    <tr
                      key={r.key}
                      className={cn(
                        r.type === 'TOTAL' && 'font-semibold',
                        r.type === 'HEADING' && 'font-semibold text-ink',
                      )}
                    >
                      <td className="py-1" style={{ paddingLeft: `${r.indent * 1.25}rem` }}>
                        {r.label}
                      </td>
                      {cols.map((c) => (
                        <td
                          key={c.code}
                          className={cn('py-1 text-right', r.type === 'TOTAL' && 'border-t')}
                        >
                          {r.type === 'HEADING' ? '' : statementAmount(value(r, c.code))}
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {next.error && <Alert>{errorMessage(next.error)}</Alert>}
      <div className="flex justify-end">
        <Button
          disabled={
            !a.level.editable ||
            next.isPending ||
            a.balances.some((b) => !b.balanced || !b.profitTies)
          }
          onClick={() => next.mutate()}
        >
          Continue to eliminations <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
