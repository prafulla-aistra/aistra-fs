import { useQuery } from '@tanstack/react-query';
import {
  UPLOAD_STATUS_LABELS,
  type FileRefDto,
  type TbVersionDto,
  type UploadEntityCardDto,
} from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/form';
import { Dialog, Table, Td, Th } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { amountText, formatDateTime } from '@/lib/format';
import { FileLink } from './EntityCard';

/** Every trial-balance version (or chart-of-accounts file) uploaded for the entity in this task. */
export function VersionsDialog({
  taskId,
  entity,
  kind,
  onClose,
}: {
  taskId: string;
  entity: UploadEntityCardDto;
  kind: 'TB' | 'COA';
  onClose: () => void;
}) {
  const base = `/tasks/${taskId}/entities/${entity.code}`;
  const tb = useQuery({
    queryKey: ['tb-versions', taskId, entity.code],
    queryFn: () => api.get<TbVersionDto[]>(`${base}/tb/versions`),
    enabled: kind === 'TB',
  });
  const coa = useQuery({
    queryKey: ['coa-files', taskId, entity.code],
    queryFn: () => api.get<FileRefDto[]>(`${base}/files?kind=COA`),
    enabled: kind === 'COA',
  });
  const q = kind === 'TB' ? tb : coa;

  return (
    <Dialog
      open
      size="xl"
      onClose={onClose}
      title={`${entity.code} — ${kind === 'TB' ? 'trial balance versions' : 'chart of accounts uploads'}`}
      description="Earlier versions are kept. The latest is used."
    >
      {q.error ? (
        <Alert>{errorMessage(q.error)}</Alert>
      ) : !q.data ? (
        <Skeleton className="h-32 w-full" />
      ) : kind === 'TB' ? (
        <Table>
          <thead>
            <tr>
              <Th>Version</Th>
              <Th>File</Th>
              <Th>Status</Th>
              <Th className="text-right">Debits</Th>
              <Th className="text-right">Credits</Th>
              <Th className="text-right">Difference</Th>
              <Th>Uploaded</Th>
            </tr>
          </thead>
          <tbody>
            {(tb.data ?? []).map((v, i) => (
              <tr key={v.id}>
                <Td>
                  v{v.version}
                  {i === 0 && <span className="ml-1 text-xs text-muted-foreground">(latest)</span>}
                </Td>
                <Td>
                  <FileLink file={v.file} />
                </Td>
                <Td>
                  <Badge
                    variant={
                      v.status === 'ERROR'
                        ? 'destructive'
                        : v.status === 'VALIDATED'
                          ? 'success'
                          : 'warning'
                    }
                  >
                    {UPLOAD_STATUS_LABELS[v.status]}
                  </Badge>
                </Td>
                <Td className="text-right font-mono tabular-nums">{amountText(v.totals.debits)}</Td>
                <Td className="text-right font-mono tabular-nums">
                  {amountText(v.totals.credits)}
                </Td>
                <Td className="text-right font-mono tabular-nums">
                  {amountText(v.totals.difference)}
                </Td>
                <Td className="text-xs">
                  {v.createdBy}
                  <br />
                  {formatDateTime(v.createdAt)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>File</Th>
              <Th>Uploaded by</Th>
              <Th>When</Th>
            </tr>
          </thead>
          <tbody>
            {(coa.data ?? []).map((f) => (
              <tr key={f.id}>
                <Td>
                  <FileLink file={f} />
                </Td>
                <Td>{f.uploadedBy}</Td>
                <Td>{formatDateTime(f.uploadedAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Dialog>
  );
}
