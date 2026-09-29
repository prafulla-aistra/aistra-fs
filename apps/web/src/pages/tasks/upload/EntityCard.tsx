import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, History, Lock, RefreshCw, Upload } from 'lucide-react';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  DOCUMENT_FILE_EXTENSIONS,
  ERP_LABELS,
  MAX_UPLOAD_BYTES,
  TB_FILE_EXTENSIONS,
  UPLOAD_STATUS_LABELS,
  type CoaMergeSummaryDto,
  type EntityUploadStatus,
  type FileRefDto,
  type TbPreviewDto,
  type UploadEntityCardDto,
} from '@finance-close/shared';
import { Badge, ItemStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { api, downloadFile, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { TbColumnsDialog } from './TbColumnsDialog';
import { TbResult } from './TbResult';
import { VersionsDialog } from './VersionsDialog';

const STATUS_VARIANT: Record<
  EntityUploadStatus,
  'neutral' | 'destructive' | 'warning' | 'success'
> = {
  PENDING: 'neutral',
  ERROR: 'destructive',
  VALIDATED_WITH_WARNINGS: 'warning',
  VALIDATED: 'success',
};

function tooBig(f: File): string | null {
  return f.size > MAX_UPLOAD_BYTES ? `${f.name} is larger than the 10 MB limit.` : null;
}

export function EntityCard({ taskId, card }: { taskId: string; card: UploadEntityCardDto }) {
  const qc = useQueryClient();
  const base = `/tasks/${taskId}/entities/${card.code}`;
  const refresh = () => qc.invalidateQueries({ queryKey: ['upload-step', taskId] });
  const [preview, setPreview] = useState<TbPreviewDto | null>(null);
  const [versions, setVersions] = useState<'TB' | 'COA' | null>(null);
  const [coaSummary, setCoaSummary] = useState<CoaMergeSummaryDto | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const tb = useMutation({
    mutationFn: (f: File) => api.upload<TbPreviewDto>(`${base}/tb`, f),
    onSuccess: setPreview,
  });
  const coa = useMutation({
    mutationFn: (f: File) => api.upload<CoaMergeSummaryDto>(`${base}/coa`, f),
    onSuccess: async (s) => {
      setCoaSummary(s);
      toast(`Chart of accounts: ${s.added} added, ${s.updated} updated, ${s.unchanged} unchanged.`);
      await refresh();
    },
  });
  const docs = useMutation({
    mutationFn: async (files: File[]) => {
      for (const f of files) await api.upload<FileRefDto>(`${base}/documents`, f);
      return files.length;
    },
    onSuccess: async (n) => {
      toast(`${n} document${n === 1 ? '' : 's'} uploaded.`);
      await refresh();
    },
  });
  const error =
    localError ??
    ((tb.error ?? coa.error ?? docs.error)
      ? errorMessage(tb.error ?? coa.error ?? docs.error)
      : null);
  const pick = (files: File[], run: (files: File[]) => void) => {
    setLocalError(null);
    const big = files.map(tooBig).find(Boolean);
    if (big) return setLocalError(big);
    if (files.length > 0) run(files);
  };

  const latest = card.tb.latest;
  return (
    <Card className={cn(!card.canEdit && 'bg-muted/30')}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold text-muted-foreground">
              {card.code}
            </span>
            <span className="truncate">{card.legalName}</span>
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {card.functionalCurrency} · {ERP_LABELS[card.erp]} ·{' '}
            <ItemStatusBadge status={card.itemStatus} />
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[card.uploadStatus]}>
          {UPLOAD_STATUS_LABELS[card.uploadStatus]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {card.readOnlyReason && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3" /> {card.readOnlyReason}
          </p>
        )}

        <UploadRow
          icon={<FileSpreadsheet />}
          title="Trial balance"
          tag="Mandatory"
          accept={TB_FILE_EXTENSIONS.join(',')}
          canEdit={card.canEdit}
          busy={tb.isPending}
          last={latest ? latest.file : null}
          onFiles={(f) => pick(f.slice(0, 1), ([file]) => tb.mutate(file!))}
          onVersions={card.tb.versionCount > 0 ? () => setVersions('TB') : undefined}
        >
          {latest && <TbResult version={latest} compact />}
        </UploadRow>

        <UploadRow
          icon={<FileSpreadsheet />}
          title="Chart of accounts"
          tag="Optional"
          accept={TB_FILE_EXTENSIONS.join(',')}
          canEdit={card.canEdit}
          busy={coa.isPending}
          last={card.coa.latest}
          onFiles={(f) => pick(f.slice(0, 1), ([file]) => coa.mutate(file!))}
          onVersions={card.coa.count > 0 ? () => setVersions('COA') : undefined}
        >
          {coaSummary && (
            <p className="text-xs">
              {coaSummary.added} added (FSLI suggested from the account type), {coaSummary.updated}{' '}
              updated, {coaSummary.unchanged} unchanged.
              {coaSummary.warnings.map((w) => (
                <span key={w.code} className="block text-warning-foreground">
                  {w.message}
                </span>
              ))}
            </p>
          )}
        </UploadRow>

        <UploadRow
          icon={<FileText />}
          title="Other documents"
          tag="Optional · multiple files"
          accept={DOCUMENT_FILE_EXTENSIONS.join(',')}
          multiple
          canEdit={card.canEdit}
          busy={docs.isPending}
          last={card.documents[0] ?? null}
        >
          {card.documents.length > 0 && (
            <ul className="space-y-0.5 text-xs">
              {card.documents.map((d) => (
                <li key={d.id}>
                  <FileLink file={d} />{' '}
                  <span className="text-muted-foreground">
                    · {d.uploadedBy}, {formatDateTime(d.uploadedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </UploadRow>

        {error && <Alert>{error}</Alert>}
      </CardContent>

      {preview && (
        <TbColumnsDialog
          taskId={taskId}
          entity={card}
          initial={preview}
          onClose={() => setPreview(null)}
          onSaved={async () => {
            setPreview(null);
            await refresh();
          }}
        />
      )}
      {versions && (
        <VersionsDialog
          taskId={taskId}
          entity={card}
          kind={versions}
          onClose={() => setVersions(null)}
        />
      )}
    </Card>
  );
}

export function FileLink({ file }: { file: FileRefDto }) {
  return (
    <button
      type="button"
      className="font-medium text-primary underline-offset-2 hover:underline"
      onClick={() => downloadFile(file.id, file.name).catch((e: unknown) => toast(errorMessage(e)))}
    >
      {file.name}
    </button>
  );
}

function UploadRow({
  icon,
  title,
  tag,
  accept,
  multiple,
  canEdit,
  busy,
  last,
  onFiles,
  onVersions,
  children,
}: {
  icon: ReactNode;
  title: string;
  tag: string;
  accept: string;
  multiple?: boolean;
  canEdit: boolean;
  busy: boolean;
  last: FileRefDto | null;
  onFiles?: (files: File[]) => void;
  onVersions?: () => void;
  children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (canEdit && !busy) onFiles?.([...e.dataTransfer.files]);
  };
  return (
    <div
      className={cn(
        'rounded-lg border border-dashed p-3 transition-colors',
        over && 'border-primary bg-mint/60',
        !canEdit && 'border-solid',
      )}
      onDragOver={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium [&>svg]:size-4 [&>svg]:text-muted-foreground">
          {icon}
          {title}
          <span className="text-xs font-normal text-muted-foreground">{tag}</span>
        </div>
        <div className="flex gap-1.5">
          <input
            ref={input}
            type="file"
            accept={accept}
            multiple={multiple}
            className="hidden"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              onFiles?.(files);
            }}
          />
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {last && !multiple ? <RefreshCw /> : <Upload />}
              {busy ? 'Uploading…' : last && !multiple ? 'Replace' : 'Choose file'}
            </Button>
          )}
          {onVersions && (
            <Button size="sm" variant="ghost" onClick={onVersions}>
              <History /> View versions
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {last ? (
          <>
            Last: <FileLink file={last} /> · {last.uploadedBy}, {formatDateTime(last.uploadedAt)}
          </>
        ) : canEdit ? (
          `Drop a file here or choose one (${accept.replaceAll(',', ', ')}; up to 10 MB).`
        ) : (
          'Nothing uploaded.'
        )}
      </p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}
