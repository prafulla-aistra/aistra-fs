import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Download, Lock, Plus, Settings2, Upload } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import type {
  AppSettingsDto,
  CrossRateDto,
  RateGridDto,
  RateGridMonthDto,
  RatePreviewDto,
  RateSaveResultDto,
} from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Field, Input, Select } from '@/components/ui/form';
import { Dialog, Sheet, Table, Td, Th } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { api, downloadPath, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { WarningText } from './common';
import { ConfigPage, EditButton, EmptyState } from './ConfigPage';

const KINDS = ['opening', 'closing', 'average'] as const;
type Kind = (typeof KINDS)[number];
const KIND_LETTER: Record<Kind, string> = { opening: 'O', closing: 'C', average: 'A' };

/** Rate text at 10 decimals ("86.4" → "86.4000000000"); display only. */
function rate10(v: string | null): string {
  if (v === null) return '—';
  const [int, dec = ''] = v.split('.');
  return `${int}.${dec.padEnd(10, '0')}`;
}

function StatusBadge({ m }: { m: RateGridMonthDto }) {
  if (m.status === 'LOCKED')
    return (
      <Badge variant="neutral" title={m.lockedReason ?? undefined}>
        <Lock /> Locked
      </Badge>
    );
  if (m.status === 'MISSING') return <Badge variant="warning">Missing rates</Badge>;
  return <Badge variant="success">Complete</Badge>;
}

export function ExchangeRatesPage() {
  const qc = useQueryClient();
  const grid = useQuery({
    queryKey: ['config', 'rate-grid'],
    queryFn: () => api.get<RateGridDto>('/config/exchange-rates/grid'),
  });
  const [open, setOpen] = useState<{ month: string; label: string; isNew: boolean } | null>(null);
  const [preview, setPreview] = useState<{ file: File; result: RatePreviewDto } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['config', 'rate-grid'] });

  const check = useMutation({
    mutationFn: (f: File) =>
      api
        .upload<RatePreviewDto>('/config/exchange-rates/preview', f)
        .then((result) => ({ file: f, result })),
    onSuccess: setPreview,
  });
  const download = useMutation({
    mutationFn: ([path, name]: [string, string]) => downloadPath(path, name),
  });

  const data = grid.data;
  const byFy = new Map<string, RateGridMonthDto[]>();
  for (const m of data?.months ?? []) byFy.set(m.fyLabel, [...(byFy.get(m.fyLabel) ?? []), m]);

  return (
    <ConfigPage
      title="Exchange rates"
      purpose="Units of each currency per 1 USD, per month: opening, closing and average. A month locks once a report using it is finalised."
      count={data ? `${data.months.length} months · ${data.currencies.length} currencies` : null}
      action={
        <>
          <Button
            variant="outline"
            onClick={() =>
              download.mutate(['/config/exchange-rates/template', 'exchange-rates-template.xlsx'])
            }
          >
            <Download /> Template
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              download.mutate(['/config/exchange-rates/export', 'exchange-rates.xlsx'])
            }
          >
            <Download /> Download rates
          </Button>
          <input
            ref={file}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            aria-label="Choose a rate file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) check.mutate(f);
            }}
          />
          <EditButton
            variant="outline"
            disabled={check.isPending}
            onClick={() => file.current?.click()}
          >
            <Upload /> Upload rate file
          </EditButton>
          <EditButton
            disabled={!data}
            onClick={() =>
              data &&
              setOpen({ month: data.nextMonth.month, label: data.nextMonth.label, isNew: true })
            }
          >
            <Plus /> Add next month
          </EditButton>
        </>
      }
    >
      {(grid.error || check.error || download.error) && (
        <Alert>{errorMessage(grid.error ?? check.error ?? download.error)}</Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingsCard />
        {data && <CrossRateCard grid={data} />}
      </div>
      {!data ? (
        <Skeleton className="h-64 w-full" />
      ) : data.months.length === 0 ? (
        <EmptyState
          title="No exchange rates yet"
          text="Download the template, fill it in and upload it, or add the first month."
        />
      ) : (
        <Table aria-label="Exchange rates by month">
          <thead>
            <tr>
              <Th>Month</Th>
              <Th>Status</Th>
              {data.currencies.map((c) => (
                <Th key={c} className="text-right">
                  {c}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...byFy].map(([fy, months]) => (
              <Fragment key={fy}>
                <tr>
                  <td
                    colSpan={data.currencies.length + 2}
                    className="border-b bg-muted/40 px-3 py-1.5 text-xs font-semibold text-ink"
                  >
                    {fy}
                  </td>
                </tr>
                {months.map((m) => (
                  <tr
                    key={m.month}
                    className="cursor-pointer hover:bg-mint/60"
                    onClick={() => setOpen({ month: m.month, label: m.label, isNew: false })}
                  >
                    <Td className="whitespace-nowrap">
                      <button
                        type="button"
                        className="font-medium text-primary hover:underline"
                        aria-label={`Open ${m.label}`}
                      >
                        {m.label}
                      </button>
                    </Td>
                    <Td className="space-y-1">
                      <StatusBadge m={m} />
                      {m.status === 'LOCKED' && m.lockedBy.length > 0 && (
                        <div className="text-[11px] text-muted-foreground">
                          {m.lockedBy.join(', ')}
                        </div>
                      )}
                      {m.checks.filter((c) => c.code !== 'MISSING').length > 0 && (
                        <div className="text-[11px] text-warning-foreground">
                          {m.checks.filter((c) => c.code !== 'MISSING').length} check(s)
                        </div>
                      )}
                    </Td>
                    {m.cells.map((c) => (
                      <Td
                        key={c.currency}
                        className="text-right font-mono text-[11px] leading-4 tabular-nums"
                      >
                        {KINDS.map((k) => (
                          <div
                            key={k}
                            className={cn('whitespace-nowrap', c[k] === null && 'text-destructive')}
                          >
                            <span className="text-muted-foreground">{KIND_LETTER[k]} </span>
                            {c[k] === null ? 'missing' : rate10(c[k])}
                          </div>
                        ))}
                      </Td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </Table>
      )}
      {data && open && (
        <MonthDrawer
          grid={data}
          target={open}
          onClose={() => setOpen(null)}
          onSaved={async () => {
            setOpen(null);
            await refresh();
          }}
        />
      )}
      {preview && (
        <UploadPreviewDialog
          preview={preview}
          onClose={() => setPreview(null)}
          onSaved={async () => {
            setPreview(null);
            await refresh();
          }}
        />
      )}
    </ConfigPage>
  );
}

// ---------------------------------------------------------------------------------------

function MonthDrawer({
  grid,
  target,
  onClose,
  onSaved,
}: {
  grid: RateGridDto;
  target: { month: string; label: string; isNew: boolean };
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const m = grid.months.find((x) => x.month === target.month) ?? null;
  const locked = m?.status === 'LOCKED';
  const [values, setValues] = useState<Record<string, Record<Kind, string>>>(() =>
    Object.fromEntries(
      grid.currencies.map((c) => {
        const cell = m?.cells.find((x) => x.currency === c);
        return [
          c,
          {
            opening: cell?.opening ?? (target.isNew ? (grid.nextMonth.openings[c] ?? '') : ''),
            closing: cell?.closing ?? '',
            average: cell?.average ?? '',
          },
        ];
      }),
    ),
  );
  const save = useMutation({
    mutationFn: () =>
      api.put<RateSaveResultDto>('/config/exchange-rates', {
        rates: grid.currencies
          .filter((c) => KINDS.some((k) => values[c]![k].trim() !== ''))
          .map((c) => ({
            month: target.month,
            currency: c,
            ...Object.fromEntries(KINDS.map((k) => [k, values[c]![k].trim() || null])),
          })),
      }),
    onSuccess: async (r) => {
      toast(
        `${target.label}: ${r.changed} currency row(s) saved${r.warnings.length ? ` · ${r.warnings.length} check(s) to review` : ''}.`,
      );
      await onSaved();
    },
  });
  const canEdit = grid.canEdit && !locked;
  return (
    <Sheet
      open
      onClose={onClose}
      title={`${target.isNew && !m ? 'Add ' : ''}${target.label} rates`}
      description={
        target.isNew && !m
          ? 'Opening is pre-filled from the prior month’s closing.'
          : 'Units of currency per 1 USD, up to 10 decimals.'
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {canEdit ? 'Cancel' : 'Close'}
          </Button>
          {canEdit && (
            <EditButton disabled={save.isPending} onClick={() => save.mutate()}>
              Save rates
            </EditButton>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {locked && (
          <Alert variant="info">
            <Lock className="mr-1 inline size-3.5" />
            {m?.lockedReason} Locked months cannot be edited.
          </Alert>
        )}
        {m && m.checks.length > 0 && (
          <div className="space-y-1">
            {m.checks.map((c, i) => (
              <div key={i}>
                <WarningText>{c.message}</WarningText>
              </div>
            ))}
          </div>
        )}
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <Table>
          <thead>
            <tr>
              <Th>Currency</Th>
              {KINDS.map((k) => (
                <Th key={k} className="capitalize">
                  {k}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.currencies.map((c) => (
              <tr key={c}>
                <Td className="font-mono text-xs">{c}</Td>
                {KINDS.map((k) => (
                  <Td key={k} className="px-1.5">
                    <Input
                      aria-label={`${c} ${k}`}
                      className="h-8 font-mono text-xs tabular-nums"
                      inputMode="decimal"
                      value={values[c]![k]}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [c]: { ...v[c]!, [k]: e.target.value } }))
                      }
                    />
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
        {m && (
          <p className="text-xs text-muted-foreground">
            {m.cells
              .filter((c) => c.enteredAt)
              .slice(0, 1)
              .map(
                (c) =>
                  `Last entered: ${c.source ?? ''}${c.enteredBy ? `, ${c.enteredBy}` : ''}, ${formatDateTime(c.enteredAt)}`,
              )}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function UploadPreviewDialog({
  preview,
  onClose,
  onSaved,
}: {
  preview: { file: File; result: RatePreviewDto };
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const p = preview.result;
  const save = useMutation({
    mutationFn: () => api.upload<RateSaveResultDto>('/config/exchange-rates/upload', preview.file),
    onSuccess: async (r) => {
      toast(
        `Rates saved: ${r.changed} new or changed${r.skippedLocked ? `, ${r.skippedLocked} skipped because locked` : ''}.`,
      );
      await onSaved();
    },
  });
  const toSave = p.summary.new + p.summary.changed;
  const shown = p.rows.filter((r) => r.status !== 'UNCHANGED');
  return (
    <Dialog
      open
      size="xl"
      onClose={onClose}
      title={`Check ${p.fileName}`}
      description="Nothing is saved until you confirm."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || toSave === 0 || p.errors.length > 0}
            onClick={() => save.mutate()}
          >
            Save {toSave} rate row{toSave === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm font-medium" role="status">
          {p.summary.new} new, {p.summary.changed} changed, {p.summary.skippedLocked} skipped
          because locked, {p.summary.unchanged} unchanged
        </p>
        {p.errors.length > 0 && <Alert>{p.errors.map((e) => e.message).join(' ')}</Alert>}
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        {p.warnings.map((w, i) => (
          <div key={i}>
            <WarningText>{w.message}</WarningText>
          </div>
        ))}
        {shown.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Month</Th>
                <Th>Currency</Th>
                <Th>Result</Th>
                {KINDS.map((k) => (
                  <Th key={k} className="text-right capitalize">
                    {k}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={`${r.month}-${r.currency}`}>
                  <Td>{r.label}</Td>
                  <Td className="font-mono text-xs">{r.currency}</Td>
                  <Td>
                    {r.status === 'NEW' ? (
                      <Badge variant="success">New</Badge>
                    ) : r.status === 'CHANGED' ? (
                      <Badge variant="warning">Changed</Badge>
                    ) : (
                      <Badge variant="neutral">
                        <Lock /> Skipped – locked
                      </Badge>
                    )}
                  </Td>
                  {KINDS.map((k) => (
                    <Td key={k} className="text-right font-mono text-xs tabular-nums">
                      {r.before && r.before[k] !== r.after[k] && (
                        <div className="text-muted-foreground line-through">
                          {r.before[k] ?? '—'}
                        </div>
                      )}
                      {r.after[k] ?? '—'}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------

function SettingsCard() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['config', 'settings'],
    queryFn: () => api.get<AppSettingsDto>('/config/settings'),
  });
  const [editing, setEditing] = useState(false);
  const s = q.data;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <CardTitle className="text-sm">Rate settings</CardTitle>
        <EditButton variant="outline" size="sm" disabled={!s} onClick={() => setEditing(true)}>
          <Settings2 /> Edit settings
        </EditButton>
      </CardHeader>
      <CardContent>
        {!s ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Rate source</dt>
            <dd className={s.rateSource ? '' : 'text-warning-foreground'}>{s.rateSourceLabel}</dd>
            <dt className="text-muted-foreground">IC difference threshold</dt>
            <dd className="tabular-nums">{s.icDiffThreshold} (level currency)</dd>
            <dt className="text-muted-foreground">Variance threshold</dt>
            <dd className="tabular-nums">{s.variancePct}%</dd>
          </dl>
        )}
      </CardContent>
      {s && editing && (
        <SettingsDialog
          s={s}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await qc.invalidateQueries({ queryKey: ['config'] });
          }}
        />
      )}
    </Card>
  );
}

function SettingsDialog({
  s,
  onClose,
  onSaved,
}: {
  s: AppSettingsDto;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    rateSource: s.rateSource,
    icDiffThreshold: s.icDiffThreshold,
    variancePct: s.variancePct,
  });
  const save = useMutation({
    mutationFn: () => api.put<AppSettingsDto>('/config/settings', form),
    onSuccess: async () => {
      toast('Settings saved.');
      await onSaved();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Rate settings"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Save settings
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <Field
          label="Rate source"
          htmlFor="rate-source"
          hint="Website and which rate. Leave blank while Open question 2 is unresolved."
        >
          <Input
            id="rate-source"
            value={form.rateSource}
            onChange={(e) => setForm({ ...form, rateSource: e.target.value })}
          />
        </Field>
        <Field
          label="IC difference threshold"
          htmlFor="ic-threshold"
          hint="Differences above this go to “IC difference – unreconciled”; smaller ones are rounding to FCTR."
        >
          <Input
            id="ic-threshold"
            inputMode="decimal"
            value={form.icDiffThreshold}
            onChange={(e) => setForm({ ...form, icDiffThreshold: e.target.value })}
          />
        </Field>
        <Field
          label="Variance threshold (%)"
          htmlFor="variance-pct"
          hint="Comparatives flag a movement above this percentage (and above materiality)."
        >
          <Input
            id="variance-pct"
            inputMode="decimal"
            value={form.variancePct}
            onChange={(e) => setForm({ ...form, variancePct: e.target.value })}
          />
        </Field>
      </div>
    </Dialog>
  );
}

function CrossRateCard({ grid }: { grid: RateGridDto }) {
  const [month, setMonth] = useState(grid.months[0]?.month ?? '');
  const [from, setFrom] = useState('GBP');
  const [to, setTo] = useState('INR');
  useEffect(() => {
    if (!month && grid.months[0]) setMonth(grid.months[0].month);
  }, [grid.months, month]);
  const all = ['USD', ...grid.currencies];
  const q = useQuery({
    queryKey: ['config', 'cross', month, from, to],
    queryFn: () =>
      api.get<CrossRateDto>(`/config/exchange-rates/cross?month=${month}&from=${from}&to=${to}`),
    enabled: Boolean(month) && from !== to,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ArrowRightLeft className="size-4" /> Cross-rate viewer
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Select
            aria-label="Cross-rate month"
            className="w-32"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          >
            {grid.months.map((m) => (
              <option key={m.month} value={m.month}>
                {m.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="From currency"
            className="w-24"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          >
            {all.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <span className="self-center text-sm text-muted-foreground">to</span>
          <Select
            aria-label="To currency"
            className="w-24"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          >
            {all.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </div>
        {from === to ? (
          <p className="text-sm text-muted-foreground">Choose two different currencies.</p>
        ) : q.error ? (
          <Alert>{errorMessage(q.error)}</Alert>
        ) : !q.data ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {q.data.rates.map((r) => (
              <Fragment key={r.kind}>
                <dt className="capitalize text-muted-foreground">{r.kind}</dt>
                <dd>
                  {r.value ? (
                    <>
                      <span className="font-mono tabular-nums">
                        1 {from} = {r.value} {to}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        = {to} per USD ÷ {from} per USD = {r.formula}
                      </span>
                    </>
                  ) : (
                    <span className="text-destructive">Missing: {r.missing.join(', ')}</span>
                  )}
                </dd>
              </Fragment>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
