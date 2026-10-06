import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Lock } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { FinalisedViewDto, ReviewStepDto, SnapshotVersionDto } from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Field, Select } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { api, downloadPath, errorMessage } from '@/lib/api';
import { formatDateTime, statementAmount } from '@/lib/format';
import { toast } from '@/lib/toast';
import { EntityTabs } from '../EntityTabs';
import { useSelectedEntity } from '../useSelectedEntity';
import { useApiBase } from '../api-base';
import { SigningCard } from './SigningCard';
import { useEntityFromUrl } from './markers';

/** Step "Finalised": the read-only result, downloads, edit access and the version history. */
export function FinalisedStep({ taskId }: { taskId: string }) {
  const step = useQuery({
    queryKey: ['review-step', taskId],
    queryFn: () => api.get<ReviewStepDto>(`/tasks/${taskId}/review-step`),
  });
  const entities = useMemo(
    () => (step.data?.entities ?? []).map((e) => ({ ...e, hasValidatedTb: true })),
    [step.data],
  );
  const [selected, choose] = useSelectedEntity(taskId, entities);
  useEntityFromUrl(entities, choose);
  if (step.error) return <Alert>{errorMessage(step.error)}</Alert>;
  if (!step.data || !selected) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="space-y-5">
      <EntityTabs
        entities={entities}
        selected={selected}
        onSelect={choose}
        markerText={(e) => (e.itemStatus === 'FINALISED' ? 'finalised' : '')}
        marker={(e) =>
          e.itemStatus === 'FINALISED' ? (
            <Lock className="size-3 text-success" aria-label="Finalised" />
          ) : null
        }
      />
      <EntityFinalised key={selected} taskId={taskId} entityCode={selected} />
    </div>
  );
}

export function EntityFinalised({ taskId, entityCode }: { taskId: string; entityCode: string }) {
  const qc = useQueryClient();
  const base = useApiBase(taskId, entityCode);
  const cfs = base.includes('/cfs/');
  const q = useQuery({
    queryKey: ['finalised', taskId, entityCode],
    queryFn: () => api.get<FinalisedViewDto>(`${base}/finalised`),
  });
  const [reason, setReason] = useState('');
  const request = useMutation({
    mutationFn: () => api.post('/edit-access-requests', { taskId, entityCode, reason }),
    onSuccess: () => {
      setReason('');
      toast('Edit access requested; the approvers are notified.');
      void qc.invalidateQueries({ queryKey: ['finalised', taskId, entityCode] });
    },
  });
  const download = useMutation({
    mutationFn: (kind: 'xlsx' | 'docx' | 'pdf' | 'record') =>
      cfs && kind !== 'record'
        ? downloadPath(
            `${base}/statements/export?type=${kind}`,
            `${entityCode}-${kind === 'xlsx' ? 'group-pack' : 'consolidated-financial-statements'}.${kind}`,
          )
        : kind === 'xlsx'
          ? downloadPath(`${base}/statements/export?currency=ALL`, `${entityCode}-statements.xlsx`)
          : kind === 'record'
            ? downloadPath(`${base}/finalised/review-record`, `${entityCode}-review-record.pdf`)
            : downloadPath(
                `${base}/notes/export?type=${kind}`,
                `${entityCode}-financial-statements.${kind}`,
              ),
  });
  if (q.error) return <Alert>{errorMessage(q.error)}</Alert>;
  if (!q.data) return <Skeleton className="h-64 w-full" />;
  const v = q.data;
  const finals = v.versions.filter((x) => x.state === 'FINAL');
  return (
    <div className="space-y-4">
      {v.finalised ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-success/30 bg-mint px-4 py-3 text-sm"
        >
          <Lock className="size-4 text-success" />
          <span className="font-medium">{v.banner}</span>
          <code className="text-xs break-all text-muted-foreground">
            SHA-256 {v.finalised.hash}
          </code>
        </div>
      ) : (
        <Alert variant="info">
          {v.entity.shortName} is not finalised
          {finals.length > 0
            ? ` (a new working version is open; v${finals.at(-1)!.version} stays viewable below)`
            : ''}
          .
        </Alert>
      )}

      <SigningCard taskId={taskId} itemKey={entityCode} />

      {v.finalised && (
        <Card>
          <CardHeader>
            <CardTitle>Downloads</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {download.error && <Alert>{errorMessage(download.error)}</Alert>}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={download.isPending}
                onClick={() => download.mutate('xlsx')}
              >
                <Download /> {cfs ? 'Group reporting pack (Excel)' : 'Statements (Excel)'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={download.isPending}
                onClick={() => download.mutate('docx')}
              >
                <Download /> {cfs ? 'Consolidated statements (Word)' : 'Full set (Word)'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={download.isPending}
                onClick={() => download.mutate('pdf')}
              >
                <Download /> {cfs ? 'Consolidated statements (PDF)' : 'Full set (PDF)'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={download.isPending}
                onClick={() => download.mutate('record')}
              >
                <Download /> Review record (PDF)
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {v.finalised && (
        <Card>
          <CardHeader>
            <CardTitle>Request edit access</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {request.error && <Alert>{errorMessage(request.error)}</Alert>}
            {v.reopenBlocked && <Alert>{v.reopenBlocked}</Alert>}
            {v.pendingRequest ? (
              <Alert variant="info">
                Requested by {v.pendingRequest.requestedBy} on{' '}
                {formatDateTime(v.pendingRequest.requestedAt)}: “{v.pendingRequest.reason}”. Waiting
                for an approver.
              </Alert>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Finalised data is read-only. If approved, the entity reopens as version{' '}
                  {(finals.at(-1)?.version ?? 0) + 1}; this version is kept.
                </p>
                <Field label="Reason (at least 10 characters)" htmlFor="ea-reason">
                  <textarea
                    id="ea-reason"
                    className="min-h-16 w-full rounded-md border bg-card px-3 py-2 text-sm"
                    value={reason}
                    maxLength={1000}
                    disabled={!v.canRequestEditAccess}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
                <Button
                  disabled={
                    !v.canRequestEditAccess || reason.trim().length < 10 || request.isPending
                  }
                  onClick={() => request.mutate()}
                >
                  Request edit access
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {v.versions.length > 0 && <Versions versions={v.versions} base={base} />}
    </div>
  );
}

function Versions({ versions, base }: { versions: SnapshotVersionDto[]; base: string }) {
  const finals = versions.filter((x) => x.state === 'FINAL');
  const [a, setA] = useState(finals.at(-1)?.version ?? versions[0]!.version);
  const [b, setB] = useState<number | null>(finals.length > 1 ? finals.at(-2)!.version : null);
  const va = versions.find((x) => x.version === a)!;
  const vb = b === null ? null : (versions.find((x) => x.version === b) ?? null);
  const record = useMutation({
    mutationFn: (n: number) =>
      downloadPath(`${base}/finalised/review-record?version=${n}`, `review-record-v${n}.pdf`),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Versions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <thead>
            <tr>
              <Th>Version</Th>
              <Th>State</Th>
              <Th>Finalised</Th>
              <Th>Hash</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {versions.map((x) => (
              <tr key={x.version}>
                <Td>v{x.version}</Td>
                <Td>
                  <Badge variant={x.state === 'FINAL' ? 'success' : 'warning'}>
                    {x.state === 'FINAL' ? 'Finalised' : 'Working copy'}
                  </Badge>
                </Td>
                <Td>{x.finalisedAt ? formatDateTime(x.finalisedAt) : '–'}</Td>
                <Td>{x.hash ? <code className="text-xs">{x.hash.slice(0, 16)}…</code> : '–'}</Td>
                <Td>
                  {x.state === 'FINAL' && (
                    <Button variant="link" size="sm" onClick={() => record.mutate(x.version)}>
                      Review record
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {finals.length > 0 && (
          <>
            <div className="flex flex-wrap gap-3">
              <Field label="Show version" htmlFor="ver-a">
                <Select id="ver-a" value={a} onChange={(e) => setA(Number(e.target.value))}>
                  {finals.map((x) => (
                    <option key={x.version} value={x.version}>
                      v{x.version}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Compare with" htmlFor="ver-b">
                <Select
                  id="ver-b"
                  value={b ?? ''}
                  onChange={(e) => setB(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">No comparison</option>
                  {finals
                    .filter((x) => x.version !== a)
                    .map((x) => (
                      <option key={x.version} value={x.version}>
                        v{x.version}
                      </option>
                    ))}
                </Select>
              </Field>
            </div>
            {va.keyFigures.map((k) => {
              const other = vb?.keyFigures.find((x) => x.currency === k.currency);
              return (
                <Table key={k.currency}>
                  <thead>
                    <tr>
                      <Th>{k.currency}</Th>
                      <Th className="text-right">v{va.version}</Th>
                      {vb && <Th className="text-right">v{vb.version}</Th>}
                      {vb && <Th className="text-right">Difference</Th>}
                    </tr>
                  </thead>
                  <tbody>
                    {k.rows.map((r) => {
                      const o = other?.rows.find((x) => x.label === r.label);
                      return (
                        <tr key={r.label}>
                          <Td>{r.label}</Td>
                          <Td className="text-right tabular-nums">{statementAmount(r.current)}</Td>
                          {vb && (
                            <Td className="text-right tabular-nums">
                              {statementAmount(o?.current ?? null)}
                            </Td>
                          )}
                          {vb && (
                            <Td className="text-right tabular-nums">
                              {o?.current === r.current ? 'Same' : 'Changed'}
                            </Td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              );
            })}
          </>
        )}
      </CardContent>
    </Card>
  );
}
