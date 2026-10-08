import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CloudDownload, Lock, Pencil, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { RateInputDto, RateSaveResultDto, RatesPanelDto } from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Input } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { FetchRatesDialog } from './FetchRatesDialog';

const FIELDS = [
  ['opening', 'Opening'],
  ['closing', 'Closing'],
  ['average', 'Average'],
] as const;
type Field = (typeof FIELDS)[number][0];
const key = (currency: string, month: string) => `${currency}:${month}`;

/** Exchange rates the task needs (units per 1 USD), per month: present / missing, warnings. */
export function RatesPanel({ taskId, rates }: { taskId: string; rates: RatesPanelDto }) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, Record<Field, string>>>({});
  const [lastWarnings, setLastWarnings] = useState<RateSaveResultDto['warnings'] | null>(null);
  const [fetching, setFetching] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ['upload-step', taskId] });
  const done = async (r: RateSaveResultDto, what: string) => {
    toast(
      `${what}: ${r.changed} month${r.changed === 1 ? '' : 's'} changed, ${r.unchanged} unchanged.`,
    );
    setLastWarnings(r.warnings);
    await refresh();
  };
  const upload = useMutation({
    mutationFn: (f: File) => api.upload<RateSaveResultDto>('/exchange-rates/upload', f),
    onSuccess: (r) => done(r, 'Rate file loaded'),
  });
  const save = useMutation({
    mutationFn: (rows: RateInputDto[]) =>
      api.put<RateSaveResultDto>('/exchange-rates', { rates: rows }),
    onSuccess: async (r) => {
      setEditing(false);
      await done(r, 'Rates saved');
    },
  });

  const cell = (currency: string, month: string) =>
    rates.cells.find((c) => c.currency === currency && c.month === month)!;
  const monthLocked = (month: string) =>
    rates.months.find((m) => m.month === month)?.locked ?? false;

  const startEditing = () => {
    const d: typeof draft = {};
    for (const c of rates.cells) {
      d[key(c.currency, c.month)] = {
        opening: c.opening ?? '',
        closing: c.closing ?? '',
        average: c.average ?? '',
      };
    }
    setDraft(d);
    setEditing(true);
  };
  const submit = () => {
    const rows: RateInputDto[] = rates.cells
      .filter((c) => !monthLocked(c.month))
      .map((c) => {
        const d = draft[key(c.currency, c.month)]!;
        return {
          month: c.month,
          currency: c.currency,
          opening: d.opening.trim() || null,
          closing: d.closing.trim() || null,
          average: d.average.trim() || null,
        };
      });
    if (rows.length > 0) save.mutate(rows);
  };

  const allLocked = rates.months.every((m) => m.locked);
  const warnings = lastWarnings ?? rates.warnings;
  const error = upload.error ?? save.error;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Exchange rates for {rates.periodLabel}</CardTitle>
          <CardDescription>
            Units of currency per 1 USD. Rate source:{' '}
            <span className="font-medium text-foreground">{rates.sourceLabel}</span>
          </CardDescription>
        </div>
        {rates.canEdit && !allLocked && (
          <div className="flex gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) upload.mutate(f);
              }}
            />
            <Button variant="outline" size="sm" onClick={() => setFetching(true)}>
              <CloudDownload /> Fetch from free API
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={upload.isPending}
              onClick={() => fileInput.current?.click()}
            >
              <Upload /> Upload rate file
            </Button>
            {!editing && (
              <Button variant="outline" size="sm" onClick={startEditing}>
                <Pencil /> Enter manually
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {fetching && (
          <FetchRatesDialog
            months={rates.months.filter((m) => !m.locked).map((m) => m.month)}
            currencies={rates.currencies}
            onClose={() => setFetching(false)}
            onSaved={(r) => void done(r, 'Rates fetched')}
          />
        )}
        {rates.currencies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This task needs no exchange rates (USD only).
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th rowSpan={2}>Currency</Th>
                {rates.months.map((m) => (
                  <Th
                    key={m.month}
                    colSpan={3}
                    className="border-l text-center"
                    title={m.lockedReason ?? undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {m.locked && <Lock className="size-3" aria-label="Locked" />}
                      {m.label}
                    </span>
                  </Th>
                ))}
              </tr>
              <tr>
                {rates.months.flatMap((m) =>
                  FIELDS.map(([f, label], i) => (
                    <Th key={`${m.month}-${f}`} className={cn('text-right', i === 0 && 'border-l')}>
                      {label}
                    </Th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {rates.currencies.map((currency) => (
                <tr key={currency}>
                  <Td className="font-mono text-xs font-semibold">{currency}</Td>
                  {rates.months.flatMap((m) => {
                    const c = cell(currency, m.month);
                    return FIELDS.map(([f, label], i) => {
                      const value = c[f];
                      const editable = editing && !m.locked;
                      return (
                        <Td
                          key={`${m.month}-${f}`}
                          className={cn('text-right', i === 0 && 'border-l')}
                          title={
                            c.source
                              ? `${c.source}${c.enteredBy ? ` · ${c.enteredBy}` : ''}`
                              : undefined
                          }
                        >
                          {editable ? (
                            <Input
                              aria-label={`${currency} ${m.label} ${label}`}
                              inputMode="decimal"
                              className="h-8 w-28 text-right font-mono"
                              value={draft[key(currency, m.month)]?.[f] ?? ''}
                              onChange={(e) =>
                                setDraft((d) => ({
                                  ...d,
                                  [key(currency, m.month)]: {
                                    ...d[key(currency, m.month)]!,
                                    [f]: e.target.value,
                                  },
                                }))
                              }
                            />
                          ) : (
                            <span className="inline-flex flex-col items-end gap-0.5">
                              <span className="font-mono tabular-nums">{value ?? '—'}</span>
                              <Badge variant={value ? 'success' : 'destructive'}>
                                {value ? 'Present' : 'Missing'}
                              </Badge>
                            </span>
                          )}
                        </Td>
                      );
                    });
                  })}
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {editing && (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={save.isPending} onClick={submit}>
              Save rates
            </Button>
          </div>
        )}
        {error && <Alert>{errorMessage(error)}</Alert>}
        {rates.months.some((m) => m.locked) && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3" />{' '}
            {rates.months
              .filter((m) => m.locked)
              .map((m) => m.lockedReason)
              .join(' ')}{' '}
            Locked months are read-only.
          </p>
        )}
        {rates.assumption && <p className="text-xs text-warning-foreground">{rates.assumption}</p>}
        {warnings.length > 0 && (
          <ul className="space-y-1 rounded-md border border-warning/40 bg-amber-50 px-3 py-2 text-sm">
            {warnings.map((w) => (
              <li key={`${w.currency}-${w.month}-${w.code}-${w.message}`} className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
                {w.message}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
