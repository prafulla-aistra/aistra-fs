import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  History,
  Plus,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  NOTE_KIND_LABELS,
  NOTE_STATUS_LABELS,
  type EntityNotesDto,
  type FigureRefDto,
  type NoteBlockDto,
  type NoteDto,
} from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Input } from '@/components/ui/form';
import { ApiError, api, errorMessage } from '@/lib/api';
import { toast } from '@/lib/toast';
import { FiguresBlockEditor, TableBlockEditor } from './BlockEditors';
import { newTableBlock, newTextBlock } from './blocks';
import { FigurePicker } from './FigurePicker';
import { indianGrouping, statusVariant } from './figures';
import { PriorPanel } from './PriorPanel';
import { CatalogContext } from './catalog-context';
import { RichTextEditor, type RichTextHandle } from './RichTextEditor';

/** One note: title, ordered blocks, review. Every change auto-saves (versioned, audited). */
export function NoteEditor({
  taskId,
  d,
  note,
}: {
  taskId: string;
  d: EntityNotesDto;
  note: NoteDto;
}) {
  const qc = useQueryClient();
  const editable = d.canEdit;
  const [draft, setDraft] = useState({ title: note.title, blocks: note.blocks });
  const version = useRef(note.version);
  const dirty = useRef(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [picker, setPicker] = useState<{ blockId: string; replace: string | null } | null>(null);
  const [showPrior, setShowPrior] = useState(note.carriedFrom);
  const editors = useRef(new Map<string, RichTextHandle>());
  const refresh = () => qc.invalidateQueries({ queryKey: ['notes', taskId, d.entity.code] });

  const save = useMutation({
    mutationFn: (body: typeof draft) =>
      api.put<{ version: number; status: string }>(
        `/tasks/${taskId}/entities/${d.entity.code}/notes/${note.id}`,
        {
          ...body,
          baseVersion: version.current,
        },
      ),
    onMutate: () => setSaveState('saving'),
    onSuccess: async (r) => {
      version.current = r.version;
      setSaveState('saved');
      await refresh();
    },
    onError: () => setSaveState('error'),
  });

  // Auto-save shortly after the last change.
  useEffect(() => {
    if (!dirty.current || !editable) return;
    const t = setTimeout(() => save.mutate(draft), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  const change = (next: Partial<typeof draft>) => {
    dirty.current = true;
    setDraft((x) => ({ ...x, ...next }));
  };
  const setBlock = (b: NoteBlockDto) =>
    change({ blocks: draft.blocks.map((x) => (x.id === b.id ? b : x)) });
  const moveBlock = (i: number, j: number) => {
    const next = [...draft.blocks];
    const [b] = next.splice(i, 1);
    next.splice(j, 0, b!);
    change({ blocks: next });
  };

  const review = useMutation({
    mutationFn: (reviewed: boolean) =>
      api.post<{ status: string }>(
        `/tasks/${taskId}/entities/${d.entity.code}/notes/${note.id}/review`,
        { reviewed },
      ),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/tasks/${taskId}/entities/${d.entity.code}/notes/${note.id}`),
    onSuccess: async () => {
      toast('Note deleted.');
      await refresh();
    },
  });

  const onPick = (ref: FigureRefDto) => {
    if (!picker) return;
    const ed = editors.current.get(picker.blockId);
    if (picker.replace) {
      if (!ed?.replaceText(picker.replace, ref))
        toast(`"${picker.replace}" was not found in the text.`);
    } else ed?.insertFigure(ref);
    setPicker(null);
  };

  const indian = indianGrouping(d);
  const conflict = save.error instanceof ApiError && save.error.status === 409;
  return (
    <CatalogContext.Provider value={{ catalog: d.catalog, indian }}>
      <div className="grid gap-4 2xl:grid-cols-[1fr_22rem]">
        <section
          className="space-y-4 rounded-lg border bg-card p-5"
          aria-label={`Note ${note.number ?? ''} ${draft.title}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold text-ink">{note.number ?? '–'}.</span>
            <Input
              aria-label="Note title"
              className="h-9 min-w-0 flex-1 basis-80 text-base font-semibold"
              value={draft.title}
              disabled={!editable}
              onChange={(e) => change({ title: e.target.value })}
            />
            <Badge variant={statusVariant(note.status)}>{NOTE_STATUS_LABELS[note.status]}</Badge>
            <Badge variant="outline">{NOTE_KIND_LABELS[note.kind]}</Badge>
            {note.hidden && <Badge variant="neutral">Hidden – nil and empty</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span role="status">
              {saveState === 'saving'
                ? 'Saving…'
                : saveState === 'saved'
                  ? `Saved · version ${version.current}`
                  : saveState === 'error'
                    ? 'Not saved'
                    : `Version ${note.version}`}
              {note.updatedBy && ` · last edited by ${note.updatedBy}`}
            </span>
            {d.rolledFrom && note.carriedFrom && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() => setShowPrior((x) => !x)}
              >
                <History /> {showPrior ? 'Hide' : 'Show'} last finalised ({d.rolledFrom.periodLabel}
                )
              </Button>
            )}
          </div>
          {save.error && (
            <Alert>
              {errorMessage(save.error)}
              {conflict && (
                <Button size="sm" variant="outline" className="ml-2" onClick={() => void refresh()}>
                  Reload
                </Button>
              )}
            </Alert>
          )}

          {draft.blocks.map((b, i) => {
            const flags = note.stale.filter((f) => f.blockId === b.id);
            return (
              <div key={b.id} className="space-y-2 rounded-md border border-dashed p-3">
                <div className="flex items-center gap-2">
                  {b.type === 'TEXT' || b.type === 'TABLE' ? (
                    <Input
                      aria-label="Block label"
                      placeholder={
                        b.type === 'TEXT' ? 'Label (e.g. Terms and conditions)' : 'Table title'
                      }
                      className="h-8 max-w-sm text-sm"
                      value={b.label}
                      disabled={!editable}
                      onChange={(e) => setBlock({ ...b, label: e.target.value })}
                    />
                  ) : (
                    <span className="text-xs font-semibold text-muted-foreground">
                      Figures (from the statement line)
                    </span>
                  )}
                  {editable && (
                    <span className="ml-auto flex">
                      <IconBtn
                        label="Move block up"
                        disabled={i === 0}
                        onClick={() => moveBlock(i, i - 1)}
                      >
                        <ArrowUp />
                      </IconBtn>
                      <IconBtn
                        label="Move block down"
                        disabled={i === draft.blocks.length - 1}
                        onClick={() => moveBlock(i, i + 1)}
                      >
                        <ArrowDown />
                      </IconBtn>
                      {b.type !== 'FIGURES' && (
                        <IconBtn
                          label="Delete block"
                          onClick={() =>
                            change({ blocks: draft.blocks.filter((x) => x.id !== b.id) })
                          }
                        >
                          <Trash2 />
                        </IconBtn>
                      )}
                    </span>
                  )}
                </div>
                {b.type === 'FIGURES' && (
                  <FiguresBlockEditor
                    block={b}
                    view={note.figures[b.id]}
                    d={d}
                    editable={editable}
                    onChange={setBlock}
                  />
                )}
                {b.type === 'TEXT' && (
                  <RichTextEditor
                    ref={(h) => {
                      if (h) editors.current.set(b.id, h);
                      else editors.current.delete(b.id);
                    }}
                    label={b.label || 'Note text'}
                    doc={b.doc}
                    editable={editable}
                    onChange={(doc) => setBlock({ ...b, doc })}
                    onInsertFigure={() => setPicker({ blockId: b.id, replace: null })}
                  />
                )}
                {b.type === 'TABLE' && (
                  <TableBlockEditor
                    block={b}
                    view={note.tables[b.id]}
                    d={d}
                    editable={editable}
                    onChange={setBlock}
                  />
                )}
                {flags.map((f, k) => (
                  <div
                    key={k}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-amber-50 px-2 py-1.5 text-xs text-warning-foreground"
                    role="alert"
                  >
                    <AlertTriangle className="size-3.5" /> {f.message}
                    {editable && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        onClick={() => setPicker({ blockId: b.id, replace: f.number })}
                      >
                        Replace with a live figure
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            );
          })}

          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => change({ blocks: [...draft.blocks, newTextBlock()] })}
              >
                <Plus /> Text block
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => change({ blocks: [...draft.blocks, newTableBlock()] })}
              >
                <Plus /> Table
              </Button>
              <span className="ml-auto flex gap-2">
                {note.status === 'REVIEWED' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={review.isPending}
                    onClick={() => review.mutate(false)}
                  >
                    Undo reviewed
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={review.isPending || save.isPending}
                    onClick={() => review.mutate(true)}
                  >
                    <CheckCircle2 /> Mark reviewed
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!note.deletable || remove.isPending}
                  title={note.deleteBlocked ?? undefined}
                  onClick={() => window.confirm(`Delete note "${draft.title}"?`) && remove.mutate()}
                >
                  <Trash2 /> Delete note
                </Button>
              </span>
            </div>
          )}
          {(review.error || remove.error) && (
            <Alert>{errorMessage(review.error ?? remove.error)}</Alert>
          )}
        </section>
        {showPrior && d.rolledFrom && note.carriedFrom && (
          <PriorPanel taskId={taskId} d={d} note={note} />
        )}
      </div>
      {picker && (
        <FigurePicker
          catalog={d.catalog}
          indian={indian}
          title={
            picker.replace
              ? `Replace "${picker.replace}" with a live figure`
              : 'Insert a live figure'
          }
          onPick={onPick}
          onClose={() => setPicker(null)}
        />
      )}
    </CatalogContext.Provider>
  );
}

function IconBtn({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 [&>svg]:size-4"
    >
      {children}
    </button>
  );
}
