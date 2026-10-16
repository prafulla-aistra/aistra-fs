import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CircleCheck, Info, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { EntityComparativesDto, TbPreviewDto } from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { amountText } from '@/lib/format';
import { toast } from '@/lib/toast';
import { AccountsToMap } from '../mapping/AccountsToMap';
import { TbColumnsDialog } from '../upload/TbColumnsDialog';
import { ComparisonTable } from './ComparisonTable';

const SOURCE_VARIANT = {
  FINALISED: 'success',
  DRAFT: 'warning',
  UPLOADED: 'review',
  NONE: 'neutral',
} as const;

export function EntityComparatives({
  taskId,
  entityCode,
  onUpload,
}: {
  taskId: string;
  entityCode: string;
  onUpload: () => void;
}) {
  const qc = useQueryClient();
  const key = ['comparatives', taskId, entityCode];
  const q = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<EntityComparativesDto>(`/tasks/${taskId}/entities/${entityCode}/comparatives`),
  });
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: key });
    await qc.invalidateQueries({ queryKey: ['comparatives-step', taskId] });
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<TbPreviewDto | null>(null);
  const upload = useMutation({
    mutationFn: (f: File) =>
      api.upload<TbPreviewDto>(`/tasks/${taskId}/entities/${entityCode}/comparative-tb`, f),
    onSuccess: setPreview,
  });
  const next = useMutation({
    mutationFn: () =>
      api.post<{ currentStep: string; unexplained: number }>(
        `/tasks/${taskId}/entities/${entityCode}/comparatives/continue`,
      ),
    onSuccess: async (r) => {
      toast(
        r.unexplained > 0
          ? `${entityCode} moved on. ${r.unexplained} flagged variance(s) are unexplained — a warning at review.`
          : `${entityCode} moved to Currency translation.`,
      );
      await refresh();
      await qc.invalidateQueries({ queryKey: ['task', taskId] });
    },
  });

  if (q.error) return <Alert>{errorMessage(q.error)}</Alert>;
  if (!q.data) return <Skeleton className="h-96 w-full" />;
  const c = q.data;

  if (!c.tb) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            <strong>{c.entity.legalName}</strong>: upload a trial balance first.
          </p>
          <Button variant="outline" size="sm" onClick={onUpload}>
            <Upload /> Go to step 1 · Upload data
          </Button>
        </CardContent>
      </Card>
    );
  }

  const unexplained = c.flagged - c.explained;
  return (
    <div className="space-y-5 pb-24">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              Comparative: {c.comparativePeriod.label}
              <Badge variant={SOURCE_VARIANT[c.source.kind]}>{c.source.label}</Badge>
            </CardTitle>
            <CardDescription>
              {c.source.kind === 'NONE'
                ? 'No comparative trial balance.'
                : `${c.source.taskNumber ? `${c.source.taskNumber} · ` : ''}${c.source.fileName ?? ''} (v${c.source.version}) · ${c.source.lineCount} accounts · debits ${amountText(c.source.debits!)} = credits ${amountText(c.source.credits!)}`}
            </CardDescription>
          </div>
          {c.canUpload && (
            <>
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
              <Button
                variant="outline"
                size="sm"
                disabled={upload.isPending}
                onClick={() => fileInput.current?.click()}
              >
                <Upload />{' '}
                {c.source.kind === 'UPLOADED'
                  ? 'Replace comparative TB'
                  : `Upload ${c.comparativePeriod.label} TB`}
              </Button>
            </>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {c.warning && (
            <p className="flex items-center gap-1.5 text-sm text-warning-foreground">
              <AlertTriangle className="size-4" /> {c.warning}
            </p>
          )}
          {c.blankReason && (
            <p className="flex items-center gap-1.5 text-sm">
              <Info className="size-4 text-muted-foreground" /> {c.blankReason}
            </p>
          )}
          {c.source.kind === 'UPLOADED' && (
            <p className="text-xs text-muted-foreground">
              Uploaded here as a comparative for this task only; it is not the official TB of{' '}
              {c.comparativePeriod.label}.
            </p>
          )}
          {upload.error && <Alert>{errorMessage(upload.error)}</Alert>}
        </CardContent>
      </Card>

      {c.toMap.length > 0 && (
        <AccountsToMap
          key={c.toMap.map((a) => a.code).join(',')}
          taskId={taskId}
          mapping={{ toMap: c.toMap, options: c.options, canEdit: c.canEdit, entity: c.entity }}
          onSaved={refresh}
        />
      )}

      <RollForward c={c} />
      <ComparisonTable taskId={taskId} data={c} onSaved={(d) => qc.setQueryData(key, d)} />

      <div className="fixed inset-x-0 bottom-0 md:left-(--shell-left) z-30 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <p className="text-sm">
            {c.flagged === 0 ? (
              'No flagged variances.'
            ) : unexplained > 0 ? (
              <span className="text-warning-foreground">
                {unexplained} flagged variance{unexplained === 1 ? '' : 's'} unexplained — this will
                be a warning at review and finalise.
              </span>
            ) : (
              'All flagged variances explained.'
            )}
          </p>
          <div className="flex items-center gap-3">
            {next.error && (
              <span className="text-sm text-destructive">{errorMessage(next.error)}</span>
            )}
            <Button disabled={!c.canEdit || next.isPending} onClick={() => next.mutate()}>
              Continue to currency translation <ArrowRight />
            </Button>
          </div>
        </div>
      </div>

      {preview && (
        <TbColumnsDialog
          taskId={taskId}
          entity={c.entity}
          initial={preview}
          basePath={`/tasks/${taskId}/entities/${entityCode}/comparative-tb`}
          title={`Confirm columns — ${entityCode} comparative trial balance (${c.comparativePeriod.label})`}
          onClose={() => setPreview(null)}
          onSaved={async () => {
            setPreview(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function RollForward({ c }: { c: EntityComparativesDto }) {
  const r = c.rollForward;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Retained earnings roll-forward</CardTitle>
        <CardDescription>
          Opening retained earnings = {c.comparativePeriod.label} retained earnings +{' '}
          {c.comparativePeriod.label} profit (tolerance 1.00 {c.entity.functionalCurrency}). Used by
          the translation step.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p
          className={
            r.status === 'PASS'
              ? 'flex items-start gap-2 text-sm text-success'
              : r.status === 'FAIL'
                ? 'flex items-start gap-2 text-sm text-warning-foreground'
                : 'flex items-start gap-2 text-sm text-muted-foreground'
          }
        >
          {r.status === 'PASS' ? (
            <CircleCheck className="mt-0.5 size-4 shrink-0" />
          ) : r.status === 'FAIL' ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0" />
          )}
          {r.message}
        </p>
      </CardContent>
    </Card>
  );
}
