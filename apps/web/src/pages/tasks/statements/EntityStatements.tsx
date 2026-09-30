import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Download, Info, Lock, Printer, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EntityStatementsDto, StatementUnitCode } from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, Checkbox, Field, Label, Select } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { api, downloadPath, errorMessage } from '@/lib/api';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { NotesView } from './NotesView';
import { StatementView } from './StatementView';

type Tab = 'BS' | 'PL' | 'NOTES';
const TABS: { code: Tab; label: string }[] = [
  { code: 'BS', label: 'Balance sheet' },
  { code: 'PL', label: 'Profit and loss' },
  { code: 'NOTES', label: 'Notes to accounts' },
];

export function EntityStatements({
  taskId,
  entityCode,
  onUpload,
  onContinue,
}: {
  taskId: string;
  entityCode: string;
  onUpload: () => void;
  onContinue: () => void;
}) {
  const qc = useQueryClient();
  const [opts, setOpts] = useState<{
    format?: string;
    currency?: string;
    unit: StatementUnitCode;
    showNil: boolean;
  }>({
    unit: 'ACTUAL',
    showNil: false,
  });
  const [tab, setTab] = useState<Tab>('BS');
  const [printing, setPrinting] = useState(false);
  const [goToNote, setGoToNote] = useState<number | null>(null);
  const qs = new URLSearchParams({
    ...(opts.format ? { format: opts.format } : {}),
    ...(opts.currency ? { currency: opts.currency } : {}),
    unit: opts.unit,
    showNil: String(opts.showNil),
  }).toString();
  const q = useQuery({
    queryKey: ['statements', taskId, entityCode, qs],
    queryFn: () =>
      api.get<EntityStatementsDto>(`/tasks/${taskId}/entities/${entityCode}/statements?${qs}`),
    placeholderData: (prev) => prev,
  });
  const exportFile = useMutation({
    mutationFn: (all: boolean) => {
      const d = q.data!;
      const p = new URLSearchParams({
        format: d.selection.format,
        currency: all ? 'ALL' : d.selection.currency,
        showNil: String(d.selection.showNil),
      });
      return downloadPath(
        `/tasks/${taskId}/entities/${entityCode}/statements/export?${p.toString()}`,
        `${entityCode}-statements-${all ? 'all-currencies' : d.selection.currency}.xlsx`,
      );
    },
  });
  const next = useMutation({
    mutationFn: () =>
      api.post<{ currentStep: string }>(
        `/tasks/${taskId}/entities/${entityCode}/statements/continue`,
      ),
    onSuccess: async () => {
      toast(`${entityCode} moved to Review and finalise.`);
      await qc.invalidateQueries({ queryKey: ['statements-step', taskId] });
      await qc.invalidateQueries({ queryKey: ['task', taskId] });
      onContinue();
    },
  });

  // Line → its note: switch to the notes tab, then scroll there.
  useEffect(() => {
    if (goToNote === null || tab !== 'NOTES') return;
    const el = document.getElementById(`note-${goToNote}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el?.classList.add('ring-2', 'ring-primary');
    const t = setTimeout(() => el?.classList.remove('ring-2', 'ring-primary'), 1800);
    setGoToNote(null);
    return () => clearTimeout(t);
  }, [goToNote, tab]);

  // Print / PDF: all three sections, then back.
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done, { once: true });
    const t = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', done);
    };
  }, [printing]);

  if (q.error) return <Alert>{errorMessage(q.error)}</Alert>;
  if (!q.data) return <Skeleton className="h-96 w-full" />;
  const d = q.data;

  if (!d.hasTb)
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            <strong>{d.entity.legalName}</strong>: upload a trial balance first.
          </p>
          <Button variant="outline" size="sm" onClick={onUpload}>
            <Upload /> Go to step 1 · Upload data
          </Button>
        </CardContent>
      </Card>
    );

  const onNote = (n: number) => {
    setTab('NOTES');
    setGoToNote(n);
  };

  return (
    <div className="space-y-5 pb-24">
      <div className="no-print flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <div className="w-80">
          <Field label="Format" htmlFor="st-format">
            <Select
              id="st-format"
              value={d.selection.format}
              onChange={(e) => setOpts({ ...opts, format: e.target.value })}
            >
              {d.options.formats.map((f) => (
                <option key={f.code} value={f.code}>
                  {f.name}
                  {f.isTaskFormat ? ' (task format)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-44">
          <Field label="Currency" htmlFor="st-currency">
            <Select
              id="st-currency"
              value={d.selection.currency}
              onChange={(e) => setOpts({ ...opts, currency: e.target.value })}
            >
              {d.options.currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                  {c.translatedFrom ? ` (translated from ${c.translatedFrom})` : ' (functional)'}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-36">
          <Field label="Units" htmlFor="st-units">
            <Select
              id="st-units"
              value={d.selection.unit}
              onChange={(e) => setOpts({ ...opts, unit: e.target.value as StatementUnitCode })}
            >
              {d.options.units.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex h-9 items-center gap-2">
          <Checkbox
            id="st-nil"
            checked={d.selection.showNil}
            onChange={(e) => setOpts({ ...opts, showNil: e.target.checked })}
          />
          <Label htmlFor="st-nil">Show nil lines</Label>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={exportFile.isPending}
            onClick={() => exportFile.mutate(false)}
          >
            <Download /> Export to Excel
          </Button>
          <Button
            variant="outline"
            disabled={exportFile.isPending}
            onClick={() => exportFile.mutate(true)}
          >
            <Download /> All currencies
          </Button>
          <Button variant="outline" onClick={() => setPrinting(true)}>
            <Printer /> Print / PDF
          </Button>
        </div>
      </div>

      <div className="no-print flex flex-wrap items-center gap-2 text-xs">
        {!d.selection.isTaskFormat && (
          <Badge variant="warning">Preview – not the task format</Badge>
        )}
        {d.fromSnapshot && (
          <Badge variant="neutral">
            <Lock /> Stored figures (finalised) – not recalculated
          </Badge>
        )}
        {d.readOnlyReason && <span className="text-muted-foreground">{d.readOnlyReason}</span>}
        {q.isFetching && <span className="text-muted-foreground">Updating…</span>}
      </div>
      {exportFile.error && <Alert>{errorMessage(exportFile.error)}</Alert>}
      {d.failures.length > 0 && (
        <Alert>
          {d.selection.currency} could not be translated: {d.failures.join(' ')} Fix it on step 4 ·
          Currency translation.
        </Alert>
      )}
      {d.warnings.map((w, i) => (
        <p key={i} className="no-print flex items-start gap-2 text-xs text-warning-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w}
        </p>
      ))}

      <div role="tablist" aria-label="Statements" className="no-print flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.code}
            role="tab"
            type="button"
            aria-selected={tab === t.code}
            onClick={() => setTab(t.code)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              tab === t.code
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {(printing || tab === 'BS') && <StatementView d={d} view={d.balanceSheet} onNote={onNote} />}
      {(printing || tab === 'PL') && <StatementView d={d} view={d.profitAndLoss} onNote={onNote} />}
      {(printing || tab === 'NOTES') && <NotesView d={d} taskId={taskId} />}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" /> {d.footer}
      </p>

      <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 px-4 py-3 backdrop-blur md:left-64">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-end gap-3">
          {next.error && (
            <span className="text-sm text-destructive">{errorMessage(next.error)}</span>
          )}
          <Button
            disabled={!d.canContinue || next.isPending}
            onClick={() => next.mutate()}
            title={d.readOnlyReason ?? undefined}
          >
            Continue to review and finalise <ArrowRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
