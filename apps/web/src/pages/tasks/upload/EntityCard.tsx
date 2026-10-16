import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CloudDownload,
  FileSpreadsheet,
  FileText,
  History,
  Lock,
  RefreshCw,
  Upload,
} from 'lucide-react';
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
import { Alert, Select } from '@/components/ui/form';
import { api, downloadFile, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { TbColumnsDialog } from './TbColumnsDialog';
import { TbResult } from './TbResult';
import { VersionsDialog } from './VersionsDialog';

/** Coloured top edge of the card: the trial balance status at a glance. */
const STATUS_ACCENT: Record<EntityUploadStatus, string> = {
  PENDING: 'border-t-neutral/40',
  ERROR: 'border-t-destructive',
  VALIDATED_WITH_WARNINGS: 'border-t-warning',
  VALIDATED: 'border-t-success',
};

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
  // Zoho entities: fetch the TB for the task period → the same preview as an uploaded file.
  const zoho = useMutation({
    mutationFn: () => api.post<TbPreviewDto>(`${base}/tb/zoho`),
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
  const coaZoho = useMutation({
    mutationFn: () => api.post<CoaMergeSummaryDto>(`${base}/coa/zoho`),
    onSuccess: async (s) => {
      setCoaSummary(s);
      toast(
        `Chart of accounts from Zoho: ${s.added} added, ${s.updated} updated, ${s.unchanged} unchanged.`,
      );
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
  const basis = useMutation({
    mutationFn: (plBasis: 'PERIOD' | 'YTD') => api.put(`${base}/upload-profile`, { plBasis }),
    onSuccess: async () => {
      toast('P&L basis saved; it applies to the next trial balance upload.');
      await refresh();
    },
  });
  const error =
    localError ??
    ((tb.error ?? zoho.error ?? coa.error ?? coaZoho.error ?? docs.error ?? basis.error)
      ? errorMessage(
          tb.error ?? zoho.error ?? coa.error ?? coaZoho.error ?? docs.error ?? basis.error,
        )
      : null);
  const pick = (files: File[], run: (files: File[]) => void) => {
    setLocalError(null);
    const big = files.map(tooBig).find(Boolean);
    if (big) return setLocalError(big);
    if (files.length > 0) run(files);
  };

  const latest = card.tb.latest;
  return (
    <Card
      className={cn(
        'gap-0 overflow-hidden border-t-[3px] py-0',
        STATUS_ACCENT[card.uploadStatus],
        !card.canEdit && 'bg-muted/30',
      )}
    >
      <CardHeader className="gap-3 border-b bg-card px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-mint font-mono text-sm font-bold text-primary"
              aria-hidden="true"
            >
              {card.code}
            </span>
            <div className="min-w-0">
              <CardTitle className="truncate text-base text-ink" title={card.legalName}>
                {card.legalName}
              </CardTitle>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="rounded border bg-muted/60 px-1.5 py-px font-medium text-foreground">
                  {card.functionalCurrency}
                </span>
                <span className="rounded border bg-muted/60 px-1.5 py-px">
                  {ERP_LABELS[card.erp]}
                </span>
                <ItemStatusBadge status={card.itemStatus} />
              </div>
            </div>
          </div>
          <Badge variant={STATUS_VARIANT[card.uploadStatus]} className="shrink-0">
            {UPLOAD_STATUS_LABELS[card.uploadStatus]}
          </Badge>
        </div>
        {card.readOnlyReason && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3" /> {card.readOnlyReason}
          </p>
        )}
        <label className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs">
          <span className="font-medium text-muted-foreground">
            P&amp;L basis of the trial balance
          </span>
          <Select
            className="h-8 w-full bg-card text-xs sm:w-72"
            disabled={!card.canEdit || basis.isPending}
            value={card.plBasis}
            onChange={(e) => basis.mutate(e.target.value as 'PERIOD' | 'YTD')}
          >
            <option value="PERIOD">Period movement (default)</option>
            <option value="YTD">Year-to-date (converted using the previous month)</option>
          </Select>
        </label>
      </CardHeader>
      <CardContent className="divide-y px-0">
        <UploadRow
          icon={<FileSpreadsheet />}
          title="Trial balance"
          tag="Mandatory"
          accept={TB_FILE_EXTENSIONS.join(',')}
          canEdit={card.canEdit}
          busy={tb.isPending || zoho.isPending}
          last={latest ? latest.file : null}
          onFiles={(f) => pick(f.slice(0, 1), ([file]) => tb.mutate(file!))}
          onVersions={card.tb.versionCount > 0 ? () => setVersions('TB') : undefined}
          extra={
            card.erpFetch &&
            card.canEdit && (
              <Button
                size="sm"
                disabled={!card.erpFetch.available || tb.isPending || zoho.isPending}
                title={
                  card.erpFetch.available
                    ? `GL-wise trial balance of "${card.erpFetch.organizationName}" for the task period, from Zoho Books`
                    : (card.erpFetch.reason ?? undefined)
                }
                onClick={() => {
                  setLocalError(null);
                  zoho.mutate();
                }}
              >
                <CloudDownload /> {zoho.isPending ? 'Fetching from Zoho…' : 'Fetch from Zoho'}
              </Button>
            )
          }
        >
          {latest && <TbResult version={latest} compact />}
        </UploadRow>

        <UploadRow
          icon={<FileSpreadsheet />}
          title="Chart of accounts"
          tag="Optional"
          accept={TB_FILE_EXTENSIONS.join(',')}
          canEdit={card.canEdit}
          busy={coa.isPending || coaZoho.isPending}
          last={card.coa.latest}
          onFiles={(f) => pick(f.slice(0, 1), ([file]) => coa.mutate(file!))}
          onVersions={card.coa.count > 0 ? () => setVersions('COA') : undefined}
          extra={
            card.erpFetch &&
            card.canEdit && (
              <Button
                size="sm"
                variant="secondary"
                disabled={!card.erpFetch.available || coa.isPending || coaZoho.isPending}
                title={
                  card.erpFetch.available
                    ? `Chart of accounts of "${card.erpFetch.organizationName}" from Zoho Books (new accounts are added; existing mappings are not changed)`
                    : (card.erpFetch.reason ?? undefined)
                }
                onClick={() => {
                  setLocalError(null);
                  coaZoho.mutate();
                }}
              >
                <CloudDownload /> {coaZoho.isPending ? 'Fetching from Zoho…' : 'Fetch from Zoho'}
              </Button>
            )
          }
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

        {error && (
          <div className="px-5 py-3">
            <Alert>{error}</Alert>
          </div>
        )}
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
  extra,
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
  /** Another way to provide it (e.g. "Fetch from Zoho"), next to the file button. */
  extra?: ReactNode;
  children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (canEdit && !busy) onFiles?.([...e.dataTransfer.files]);
  };
  const mandatory = /mandatory/i.test(tag);
  return (
    <div
      className={cn(
        'relative px-5 py-4 transition-colors',
        over && 'bg-mint/70 outline-2 -outline-offset-4 outline-primary outline-dashed',
      )}
      onDragOver={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-mint text-primary [&>svg]:size-4">
          {icon}
        </span>
        <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-ink">
          {title}
          <span
            className={cn(
              'rounded-full px-2 py-px text-[10px] font-medium tracking-wide uppercase',
              mandatory ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
            )}
          >
            {tag}
          </span>
        </p>
      </div>
      <input
        ref={input}
        type="file"
        aria-label={`Choose ${title.toLowerCase()} file`}
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          onFiles?.(files);
        }}
      />
      {(extra || canEdit || onVersions) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-[42px]">
          {extra}
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
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-muted-foreground"
              onClick={onVersions}
              title="View versions"
            >
              <History /> Versions
            </Button>
          )}
        </div>
      )}
      <div className="mt-2 pl-[42px] text-xs text-muted-foreground">
        {last ? (
          <div className="space-y-0.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate" title={last.name}>
                <FileLink file={last} />
              </span>
              {last.source === 'ZOHO' && (
                <Badge
                  variant="review"
                  className="shrink-0 px-1.5 py-0 text-[10px]"
                  title="Fetched from Zoho Books"
                >
                  <CloudDownload className="size-3" /> From Zoho
                </Badge>
              )}
            </div>
            <p>
              {last.uploadedBy} · {formatDateTime(last.uploadedAt)}
            </p>
          </div>
        ) : canEdit ? (
          <p>Drop a file here or choose one ({accept.replaceAll(',', ', ')}; up to 10 MB).</p>
        ) : (
          <p>Nothing uploaded.</p>
        )}
      </div>
      {children && <div className="mt-3 pl-[42px]">{children}</div>}
    </div>
  );
}
