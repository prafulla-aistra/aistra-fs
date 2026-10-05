import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CircleCheck, CircleX, Download } from 'lucide-react';
import { useState } from 'react';
import type {
  CfsAttributionDto,
  CfsStatementRowDto,
  CfsStatementsDto,
} from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Checkbox, Field, Select } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { api, downloadPath, errorMessage } from '@/lib/api';
import { statementAmount } from '@/lib/format';
import { cn } from '@/lib/utils';

type Tab = 'BS' | 'PL' | 'FSLI';

/** Step 4: consolidated statements of a level (entity columns, eliminations, consolidated). */
export function StatementsStep({
  taskId,
  level,
  onContinue,
  onNote,
}: {
  taskId: string;
  level: number;
  onContinue: () => void;
  onNote: (n: number) => void;
}) {
  const qc = useQueryClient();
  const base = `/tasks/${taskId}/cfs/levels/${level}`;
  const [tab, setTab] = useState<Tab>('BS');
  const [opts, setOpts] = useState<{
    format?: string;
    unit: string;
    showNil: boolean;
    showEntities: boolean;
  }>({ unit: 'ACTUAL', showNil: false, showEntities: true });
  const qs = new URLSearchParams({
    ...(opts.format ? { format: opts.format } : {}),
    unit: opts.unit,
    showNil: String(opts.showNil),
    showEntities: String(opts.showEntities),
  }).toString();
  const q = useQuery({
    queryKey: ['cfs', taskId, level, 'statements', qs],
    queryFn: () => api.get<CfsStatementsDto>(`${base}/statements?${qs}`),
    placeholderData: (prev) => prev,
  });
  const exportFile = useMutation({
    mutationFn: (type: 'xlsx' | 'docx' | 'pdf') =>
      downloadPath(
        `${base}/statements/export?type=${type}&unit=${opts.unit}`,
        `L${level}-${type === 'xlsx' ? 'group-pack' : 'consolidated-financial-statements'}.${type}`,
      ),
  });
  const next = useMutation({
    mutationFn: () => api.post(`${base}/continue`, { from: 'STATEMENTS' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cfs', taskId] });
      onContinue();
    },
  });
  if (q.error) return <Alert>{errorMessage(q.error)}</Alert>;
  if (!q.data) return <Skeleton className="h-96 w-full" />;
  const s = q.data;
  const indian = s.selection.unit === 'LAKHS' || s.selection.unit === 'CRORES';
  const amt = (v: string | null | undefined) => statementAmount(v ?? null, indian);
  const tick = (ok: boolean, label: string) => (
    <span className="inline-flex items-center gap-1 text-xs">
      {ok ? (
        <CircleCheck className="size-4 text-success" aria-label="ties" />
      ) : (
        <CircleX className="size-4 text-destructive" aria-label="does not tie" />
      )}
      {label}
    </span>
  );
  const attribution = (
    title: string,
    rows: { label: string; key: keyof CfsAttributionDto }[],
    values: Record<string, CfsAttributionDto | null>,
  ) => (
    <>
      <tr>
        <td colSpan={s.columns.length + 2} className="pt-3 text-sm font-semibold text-ink">
          {title}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.label}>
          <td className="py-1 pl-5">{r.label}</td>
          <td />
          {s.columns.map((c) => (
            <td
              key={c.code}
              className={cn('py-1 text-right', r.key === 'total' && 'border-t font-semibold')}
            >
              {c.kind === 'CONSOLIDATED' || c.kind === 'COMPARATIVE'
                ? amt(values[c.kind]?.[r.key])
                : ''}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
  const grid = (rows: CfsStatementRowDto[], footer: React.ReactNode) => (
    <table className="w-full text-sm tabular-nums">
      <thead>
        <tr className="border-b text-xs text-muted-foreground">
          <th className="py-2 text-left font-medium">Particulars</th>
          <th className="w-12 py-2 text-center font-medium">Note</th>
          {s.columns.map((c) => (
            <th
              key={c.code}
              className={cn(
                'w-36 py-2 text-right font-medium',
                c.kind === 'CONSOLIDATED' && 'text-ink',
                (c.kind === 'ELIM_BF' || c.kind === 'ELIM_LEVEL') && 'bg-mint/40',
              )}
            >
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
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
            <td className="py-1 text-center">
              {r.note !== null && (
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => onNote(r.note!)}
                  title={`Go to note ${r.note}`}
                >
                  {r.note}
                </button>
              )}
            </td>
            {s.columns.map((c) => (
              <td
                key={c.code}
                className={cn(
                  'py-1 text-right',
                  r.type === 'TOTAL' && 'border-t',
                  (c.kind === 'ELIM_BF' || c.kind === 'ELIM_LEVEL') && 'bg-mint/20',
                )}
              >
                {r.type === 'HEADING' ? '' : amt(r.values[c.code])}
              </td>
            ))}
          </tr>
        ))}
        {footer}
      </tbody>
    </table>
  );
  return (
    <div className="space-y-4">
      {s.warnings.map((w) => (
        <Alert key={w}>{w}</Alert>
      ))}
      {s.level.readOnlyReason && <Alert variant="info">{s.level.readOnlyReason}</Alert>}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <Field label="Format" htmlFor="cfs-fmt">
          <Select
            id="cfs-fmt"
            value={s.selection.format}
            onChange={(e) => setOpts({ ...opts, format: e.target.value })}
          >
            {s.options.formats.map((f) => (
              <option key={f.code} value={f.code}>
                {f.name}
                {f.isTaskFormat ? ' (task format)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Units" htmlFor="cfs-unit">
          <Select
            id="cfs-unit"
            value={s.selection.unit}
            onChange={(e) => setOpts({ ...opts, unit: e.target.value })}
          >
            {s.options.units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.label}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={opts.showEntities}
            onChange={(e) => setOpts({ ...opts, showEntities: e.target.checked })}
          />{' '}
          Show entity columns
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={opts.showNil}
            onChange={(e) => setOpts({ ...opts, showNil: e.target.checked })}
          />{' '}
          Show nil lines
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={exportFile.isPending}
            onClick={() => exportFile.mutate('xlsx')}
          >
            <Download /> Group pack (Excel)
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={exportFile.isPending}
            onClick={() => exportFile.mutate('docx')}
          >
            <Download /> Word
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={exportFile.isPending}
            onClick={() => exportFile.mutate('pdf')}
          >
            <Download /> PDF
          </Button>
        </div>
      </div>
      {exportFile.error && <Alert>{errorMessage(exportFile.error)}</Alert>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Statement" className="flex gap-1">
          {(
            [
              ['BS', 'Balance sheet'],
              ['PL', 'Profit and loss'],
              ['FSLI', 'FSLI breakdown'],
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
        <div className="flex flex-wrap gap-3" aria-label="Ticks">
          {tick(
            s.ticks.bsBalances,
            `Balance sheet balances${s.ticks.bsBalances ? '' : ` (${s.ticks.bsDifference})`}`,
          )}
          {tick(s.ticks.profitTies, 'Profit = profit carried to the balance sheet')}
          {tick(s.ticks.crossFoots, 'Entities + eliminations = consolidated')}
          {tick(s.ticks.attributionTies, 'Owners + NCI = profit')}
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            {s.header.legalName} —{' '}
            {tab === 'BS'
              ? s.balanceSheet.title
              : tab === 'PL'
                ? s.profitAndLoss.title
                : 'FSLI breakdown'}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {s.header.currencyUnits} · Comparative: {s.header.comparativeSource.label}
            {s.fromSnapshot && ' · from the finalised level snapshot'}
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {tab === 'BS' &&
            grid(
              s.balanceSheet.rows,
              attribution(
                'Equity',
                [
                  { label: 'Equity attributable to owners of the parent', key: 'owners' },
                  { label: 'Non-controlling interests', key: 'nci' },
                  { label: 'Total equity', key: 'total' },
                ],
                s.balanceSheet.equity,
              ),
            )}
          {tab === 'PL' && (
            <>
              {grid(
                s.profitAndLoss.rows,
                attribution(
                  'Profit attributable to:',
                  [
                    { label: 'Owners of the parent', key: 'owners' },
                    { label: 'Non-controlling interests', key: 'nci' },
                  ],
                  s.profitAndLoss.attribution,
                ),
              )}
              <div className="mt-4 rounded-md bg-muted/40 p-3 text-sm">
                <div className="font-medium">{s.fctrMemo.label}</div>
                {s.fctrMemo.available && s.fctrMemo.movement ? (
                  <div className="mt-1 flex flex-wrap gap-6 tabular-nums">
                    <span>Owners of the parent {amt(s.fctrMemo.movement.owners)}</span>
                    <span>Non-controlling interests {amt(s.fctrMemo.movement.nci)}</span>
                    <span className="font-semibold">Total {amt(s.fctrMemo.movement.total)}</span>
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-muted-foreground">{s.fctrMemo.reason}</div>
                )}
              </div>
            </>
          )}
          {tab === 'FSLI' && (
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 text-left font-medium">FSLI</th>
                  {s.columns.map((c) => (
                    <th key={c.code} className="w-36 py-2 text-right font-medium">
                      {c.label}
                    </th>
                  ))}
                  <th className="w-10 py-2 text-center font-medium">✓</th>
                </tr>
              </thead>
              <tbody>
                {s.fslis.map((f) => (
                  <tr key={f.code} className="border-b last:border-0">
                    <td className="py-1">
                      <span className="font-mono text-xs">{f.code}</span> {f.name}
                    </td>
                    {s.columns.map((c) => (
                      <td key={c.code} className="py-1 text-right">
                        {amt(f.values[c.code])}
                      </td>
                    ))}
                    <td className="py-1 text-center">
                      {f.crossFoots ? (
                        <CircleCheck
                          className="inline size-4 text-success"
                          aria-label="cross-foots"
                        />
                      ) : (
                        <CircleX
                          className="inline size-4 text-destructive"
                          aria-label="does not cross-foot"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {s.roundingNote && <p className="mt-2 text-xs text-muted-foreground">{s.roundingNote}</p>}
        </CardContent>
      </Card>
      {next.error && <Alert>{errorMessage(next.error)}</Alert>}
      <div className="flex justify-end">
        <Button disabled={!s.level.editable || next.isPending} onClick={() => next.mutate()}>
          Continue to notes <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
