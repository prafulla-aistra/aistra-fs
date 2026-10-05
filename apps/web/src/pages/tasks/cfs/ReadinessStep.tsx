import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { ITEM_STATUS_LABELS, type ReadinessDto } from '@finance-close/shared';
import { ItemStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Field, Select } from '@/components/ui/form';
import { Dialog, Table, Td, Th } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';

const STATUS_ICON = {
  OK: <CheckCircle2 className="size-4 text-success" aria-label="OK" />,
  WARNING: <AlertTriangle className="size-4 text-warning" aria-label="Warning" />,
  MISSING: <XCircle className="size-4 text-destructive" aria-label="Missing" />,
};

/** Step 1: readiness and the level currency. */
export function ReadinessStep({
  taskId,
  level,
  onContinue,
}: {
  taskId: string;
  level: number;
  onContinue: () => void;
}) {
  const qc = useQueryClient();
  const key = ['cfs', taskId, level, 'readiness'];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.get<ReadinessDto>(`/tasks/${taskId}/cfs/levels/${level}/readiness`),
  });
  const [currency, setCurrency] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: (c: string) =>
      api.put<ReadinessDto>(`/tasks/${taskId}/cfs/levels/${level}/currency`, { currency: c }),
    onSuccess: (r) => {
      qc.setQueryData(key, r);
      setCurrency(null);
      void qc.invalidateQueries({ queryKey: ['cfs', taskId] });
    },
  });
  const next = useMutation({
    mutationFn: () =>
      api.post(`/tasks/${taskId}/cfs/levels/${level}/continue`, { from: 'READINESS' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cfs', taskId] });
      onContinue();
    },
  });
  if (q.error) return <Alert>{errorMessage(q.error)}</Alert>;
  if (!q.data) return <Skeleton className="h-96 w-full" />;
  const r = q.data;
  return (
    <div className="space-y-5">
      {r.level.readOnlyReason && <Alert variant="info">{r.level.readOnlyReason}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>Level currency</CardTitle>
          <CardDescription>
            Every member is translated directly from its functional currency into{' '}
            {r.currency.current}. Configured: {r.currency.configured}
            {r.currency.current !== r.currency.configured ? ' (changed for this task)' : ''}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Field label="Currency" htmlFor="lvl-ccy">
            <Select
              id="lvl-ccy"
              value={r.currency.current}
              disabled={!r.currency.canChange || change.isPending}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {r.currency.options.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          {!r.currency.canChange && r.level.editable && (
            <p className="text-xs text-muted-foreground">
              Delete this level's manual adjustments to change the currency.
            </p>
          )}
          {change.error && <Alert>{errorMessage(change.error)}</Alert>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            Entity figures come only from the finalised standalone (SFS) snapshots.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Entity</Th>
                <Th>Role</Th>
                <Th className="text-right">% held</Th>
                <Th className="text-right">Group %</Th>
                <Th>Currency</Th>
                <Th>SFS {r.level.periodLabel}</Th>
                <Th>Translation into {r.currency.current}</Th>
                <Th>Comparative SFS</Th>
              </tr>
            </thead>
            <tbody>
              {r.members.map((m) => (
                <tr key={m.code} className="align-top">
                  <Td>
                    <span className="font-mono text-xs font-semibold">{m.code}</span> {m.shortName}
                  </Td>
                  <Td>{m.role}</Td>
                  <Td className="text-right tabular-nums">
                    {m.heldByParentPct ? `${m.heldByParentPct}%` : '–'}
                  </Td>
                  <Td className="text-right tabular-nums">{m.effectiveGroupPct}%</Td>
                  <Td>{m.functionalCurrency}</Td>
                  <Td>
                    {m.sfs.status === 'NONE' ? (
                      'No task'
                    ) : (
                      <ItemStatusBadge status={m.sfs.status} />
                    )}
                    <div className="text-xs text-muted-foreground">
                      {m.sfs.taskId ? (
                        <Link to={`/tasks/${m.sfs.taskId}`} className="text-primary">
                          {m.sfs.taskNumber}
                        </Link>
                      ) : null}
                      {m.sfs.snapshotVersion && ` · ${m.sfs.snapshotVersion}`}
                    </div>
                  </Td>
                  <Td className="max-w-72">
                    <div className={m.source.kind === 'MISSING' ? 'text-destructive' : undefined}>
                      {m.source.text}
                    </div>
                    {m.source.warning && (
                      <div className="mt-1 flex gap-1 text-xs text-warning-foreground">
                        <AlertTriangle className="size-3.5 shrink-0" /> {m.source.warning}
                      </div>
                    )}
                    {m.translationWarnings.map((w) => (
                      <div key={w} className="mt-1 text-xs text-warning-foreground">
                        {w}
                      </div>
                    ))}
                  </Td>
                  <Td>
                    {m.comparative.periodLabel}:{' '}
                    {m.comparative.status === 'NONE'
                      ? 'no task'
                      : ITEM_STATUS_LABELS[m.comparative.status]}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rates into {r.currency.current}</CardTitle>
          <CardDescription>
            Units of {r.currency.current} per 1 unit of each functional currency, from the rate
            master (cross rates via USD).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {r.rates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every member reports in {r.currency.current}.
            </p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>From</Th>
                  <Th className="text-right">Opening</Th>
                  <Th className="text-right">Closing</Th>
                  <Th className="text-right">Average</Th>
                  <Th>Closing formula</Th>
                </tr>
              </thead>
              <tbody>
                {r.rates.map((x) => (
                  <tr key={x.currency}>
                    <Td>{x.currency}</Td>
                    <Td className="text-right tabular-nums">{x.opening ?? '–'}</Td>
                    <Td className="text-right tabular-nums">{x.closing ?? '–'}</Td>
                    <Td className="text-right tabular-nums">{x.average ?? '–'}</Td>
                    <Td className="text-xs text-muted-foreground">
                      {x.formula ?? x.missing.join(', ')}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuration for this level</CardTitle>
          <CardDescription>
            Maintained under Configuration →{' '}
            <Link to="/configuration/intercompany-pairs">Intercompany pairs</Link> and{' '}
            <Link to="/configuration/acquisitions">Acquisitions</Link>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {r.checks.map((c) => (
            <div key={c.code} className="flex gap-2 text-sm">
              {STATUS_ICON[c.status]}
              <div>
                <div className="font-medium">{c.label}</div>
                <ul className="text-xs text-muted-foreground">
                  {c.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {r.continueBlockedBy.length > 0 && (
        <Alert>
          <div className="font-medium">Not ready:</div>
          <ul className="list-disc pl-5">
            {r.continueBlockedBy.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Alert>
      )}
      {next.error && <Alert>{errorMessage(next.error)}</Alert>}
      <div className="flex justify-end">
        <Button disabled={!r.canContinue || next.isPending} onClick={() => next.mutate()}>
          Continue to aggregation <ArrowRight />
        </Button>
      </div>

      {currency && (
        <Dialog
          open
          onClose={() => setCurrency(null)}
          title={`Change the level currency to ${currency}?`}
          footer={
            <>
              <Button variant="outline" onClick={() => setCurrency(null)}>
                Cancel
              </Button>
              <Button disabled={change.isPending} onClick={() => change.mutate(currency)}>
                Change to {currency}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            Every member is translated into {currency} instead of {r.currency.current}.
            {r.currency.eliminationsGenerated
              ? ' The generated eliminations are cleared; generate them again on step 3.'
              : ''}
          </p>
        </Dialog>
      )}
    </div>
  );
}
