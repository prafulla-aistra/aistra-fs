import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Download,
  Plus,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  NOTE_STATUS_LABELS,
  type EntityNotesDto,
  type StatementUnitCode,
} from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, Checkbox, Field, Input, Label, Select } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { api, downloadPath, errorMessage } from '@/lib/api';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { statusVariant } from './figures';
import { NoteEditor } from './NoteEditor';

/** Notes for one entity: list on the left, the selected note on the right. */
export function EntityNotes({
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
  const [search, setSearch] = useSearchParams();
  const [opts, setOpts] = useState<{ currency?: string; unit: StatementUnitCode }>({
    unit: 'ACTUAL',
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [adding, setAdding] = useState(false);
  const qs = new URLSearchParams({
    ...(opts.currency ? { currency: opts.currency } : {}),
    unit: opts.unit,
  }).toString();
  const q = useQuery({
    queryKey: ['notes', taskId, entityCode, qs],
    queryFn: () => api.get<EntityNotesDto>(`/tasks/${taskId}/entities/${entityCode}/notes?${qs}`),
    placeholderData: (prev) => prev,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notes', taskId, entityCode] });
  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      api.put(`/tasks/${taskId}/entities/${entityCode}/notes-order`, { ids }),
    onSuccess: refresh,
  });
  const exportFile = useMutation({
    mutationFn: (type: 'docx' | 'pdf') =>
      downloadPath(
        `/tasks/${taskId}/entities/${entityCode}/notes/export?type=${type}&${qs}`,
        `${entityCode}-financial-statements.${type}`,
      ),
  });
  const next = useMutation({
    mutationFn: () => api.post(`/tasks/${taskId}/entities/${entityCode}/notes-continue`),
    onSuccess: async () => {
      toast(`${entityCode} moved to Review.`);
      await qc.invalidateQueries({ queryKey: ['notes-step', taskId] });
      onContinue();
    },
  });

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
            <Upload /> Go to step 1 · Upload
          </Button>
        </CardContent>
      </Card>
    );

  // A statement's Note column links here with ?note=<number>.
  const wanted = Number(search.get('note'));
  const fromLink = wanted ? d.notes.find((n) => n.number === wanted)?.id : undefined;
  const list = d.notes.filter((n) => showHidden || !n.hidden);
  const current = d.notes.find((n) => n.id === (selected ?? fromLink)) ?? list[0] ?? null;
  const ids = d.notes.map((n) => n.id);
  const move = (id: string, by: number) => {
    const i = ids.indexOf(id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    const nextIds = [...ids];
    [nextIds[i], nextIds[j]] = [nextIds[j]!, nextIds[i]!];
    reorder.mutate(nextIds);
  };
  const flags = d.notes.reduce((s, n) => s + n.stale.length, 0);

  return (
    <div className="space-y-4 pb-24">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <div>
          <p className="text-sm font-semibold text-ink" role="status">
            {d.progress.text}
          </p>
          <p className="text-xs text-muted-foreground">
            {d.formatName}
            {d.rolledFrom &&
              ` · carried forward from ${d.rolledFrom.periodLabel} (${d.rolledFrom.taskNumber})`}
            {flags > 0 && (
              <span className="ml-2 text-warning-foreground">
                <AlertTriangle className="inline size-3.5" /> {flags} possible stale figure
                {flags === 1 ? '' : 's'}
              </span>
            )}
          </p>
        </div>
        <div className="w-28">
          <Field label="Currency" htmlFor="nt-currency">
            <Select
              id="nt-currency"
              value={d.selection.currency}
              onChange={(e) => setOpts({ ...opts, currency: e.target.value })}
            >
              {d.options.currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-32">
          <Field label="Units" htmlFor="nt-units">
            <Select
              id="nt-units"
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
        <div className="ml-auto flex flex-wrap gap-2">
          {d.canEdit && (
            <Button variant="outline" onClick={() => setAdding(true)}>
              <Plus /> Add note
            </Button>
          )}
          <Button
            variant="outline"
            disabled={exportFile.isPending}
            onClick={() => exportFile.mutate('docx')}
          >
            <Download /> Export to Word
          </Button>
          <Button
            variant="outline"
            disabled={exportFile.isPending}
            onClick={() => exportFile.mutate('pdf')}
          >
            <Download /> Export to PDF
          </Button>
        </div>
      </div>
      {d.readOnlyReason && <p className="text-xs text-muted-foreground">{d.readOnlyReason}</p>}
      {exportFile.error && <Alert>{errorMessage(exportFile.error)}</Alert>}
      {d.roundingNote && <p className="text-xs text-muted-foreground">{d.roundingNote}</p>}

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <nav
          aria-label="Notes"
          className="space-y-1 rounded-lg border bg-card p-2 lg:max-h-[75vh] lg:overflow-y-auto"
        >
          <div className="flex items-center gap-2 px-2 py-1 text-xs">
            <Checkbox
              id="show-hidden"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            <Label htmlFor="show-hidden" className="text-xs font-normal">
              Show hidden notes ({d.notes.filter((n) => n.hidden).length})
            </Label>
          </div>
          {list.map((n) => (
            <div
              key={n.id}
              className={cn(
                'group flex items-start gap-1 rounded-md px-2 py-1.5 text-sm',
                current?.id === n.id ? 'bg-mint' : 'hover:bg-accent',
                n.hidden && 'opacity-60',
              )}
            >
              <button
                type="button"
                className="flex-1 text-left"
                aria-current={current?.id === n.id ? 'true' : undefined}
                onClick={() => {
                  setSelected(n.id);
                  if (search.get('note')) setSearch((s) => (s.delete('note'), s));
                }}
              >
                <span className="mr-1 font-semibold tabular-nums">{n.number ?? '–'}.</span>{' '}
                {n.title}
                <span className="mt-0.5 flex flex-wrap gap-1">
                  <Badge variant={statusVariant(n.status)} className="text-[10px]">
                    {NOTE_STATUS_LABELS[n.status]}
                  </Badge>
                  {n.stale.length > 0 && (
                    <Badge variant="warning" className="text-[10px]" title="Possible stale figures">
                      <AlertTriangle /> {n.stale.length}
                    </Badge>
                  )}
                </span>
              </button>
              {d.canEdit && (
                <span className="flex flex-col opacity-0 group-hover:opacity-100 [&_svg]:size-3.5">
                  <button
                    type="button"
                    aria-label={`Move ${n.title} up`}
                    onClick={() => move(n.id, -1)}
                  >
                    <ArrowUp />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${n.title} down`}
                    onClick={() => move(n.id, 1)}
                  >
                    <ArrowDown />
                  </button>
                </span>
              )}
            </div>
          ))}
        </nav>
        {current ? (
          <NoteEditor key={current.id} taskId={taskId} d={d} note={current} />
        ) : (
          <p className="text-sm text-muted-foreground">No notes.</p>
        )}
      </div>

      <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 px-4 py-3 backdrop-blur md:left-64">
        <div className="mx-auto flex max-w-7xl items-center justify-end gap-3">
          {next.error && (
            <span className="text-sm text-destructive">{errorMessage(next.error)}</span>
          )}
          <Button disabled={!d.canEdit || next.isPending} onClick={() => next.mutate()}>
            Continue to review <ArrowRight />
          </Button>
        </div>
      </div>
      {adding && current && (
        <AddNoteDialog
          taskId={taskId}
          entityCode={entityCode}
          after={current}
          onClose={() => setAdding(false)}
          onDone={async (id) => {
            setAdding(false);
            await refresh();
            setSelected(id);
          }}
        />
      )}
    </div>
  );
}

function AddNoteDialog({
  taskId,
  entityCode,
  after,
  onClose,
  onDone,
}: {
  taskId: string;
  entityCode: string;
  after: { id: string; title: string };
  onClose: () => void;
  onDone: (id: string) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [where, setWhere] = useState<'after' | 'end'>('after');
  const add = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>(`/tasks/${taskId}/entities/${entityCode}/notes`, {
        title,
        afterNoteId: where === 'after' ? after.id : null,
      }),
    onSuccess: async (r) => {
      toast(`Note "${title}" added.`);
      await onDone(r.id);
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add note"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!title.trim() || add.isPending} onClick={() => add.mutate()}>
            Add note
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {add.error && <Alert>{errorMessage(add.error)}</Alert>}
        <Field label="Title" htmlFor="note-title">
          <Input id="note-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Position" htmlFor="note-where">
          <Select
            id="note-where"
            value={where}
            onChange={(e) => setWhere(e.target.value as 'after' | 'end')}
          >
            <option value="after">After "{after.title}"</option>
            <option value="end">At the end</option>
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}
