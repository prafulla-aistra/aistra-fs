import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  NOTE_KIND_LABELS,
  type NoteKindCode,
  type NoteTemplateDto,
  type NoteTemplatesDto,
} from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Checkbox, Field, Input, Label, Select } from '@/components/ui/form';
import { Dialog, Table, Td, Th } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { toast } from '@/lib/toast';
import { EditButton } from './ConfigPage';

const textOf = (t: NoteTemplateDto) =>
  t.defaultBlocks
    .filter((b) => b.type === 'TEXT')
    .map((b) =>
      b.type === 'TEXT'
        ? (b.doc.content ?? [])
            .map((p) => (p.content ?? []).map((x) => x.text ?? '').join(''))
            .join('\n')
        : '',
    )
    .join('\n');

/** Configuration → Report formats → Notes: the note templates a new note set starts from. */
export function NoteTemplatesPanel({ code }: { code: string }) {
  const qc = useQueryClient();
  const key = ['config', 'note-templates', code];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.get<NoteTemplatesDto>(`/config/formats/${code}/note-templates`),
  });
  const [editing, setEditing] = useState<NoteTemplateDto | 'new' | null>(null);
  const set = (d: NoteTemplatesDto) => qc.setQueryData(key, d);
  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      api.put<NoteTemplatesDto>(`/config/formats/${code}/note-templates`, { ids }),
    onSuccess: set,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/config/formats/${code}/note-templates/${id}`),
    onSuccess: async () => {
      toast('Note template removed.');
      await qc.invalidateQueries({ queryKey: key });
    },
  });
  if (q.error) return <Alert>{errorMessage(q.error)}</Alert>;
  if (!q.data) return <Skeleton className="h-64 w-full" />;
  const d = q.data;
  const ids = d.templates.map((t) => t.id);
  const move = (i: number, j: number) => {
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j]!, next[i]!];
    reorder.mutate(next);
  };
  const lineLabel = new Map(d.lines.map((l) => [l.key, l.label]));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {d.templates.length} notes. New note sets start from this list (or roll forward from the
          last finalised period).
        </p>
        <EditButton onClick={() => setEditing('new')}>
          <Plus /> Add note template
        </EditButton>
      </div>
      {d.removeBlocked && <Alert variant="info">{d.removeBlocked}</Alert>}
      {(reorder.error || remove.error) && (
        <Alert>{errorMessage(reorder.error ?? remove.error)}</Alert>
      )}
      <Table aria-label="Note templates">
        <thead>
          <tr>
            <Th>#</Th>
            <Th>Title</Th>
            <Th>Type</Th>
            <Th>Linked line</Th>
            <Th>Mandatory</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {d.templates.map((t, i) => (
            <tr key={t.id}>
              <Td className="tabular-nums text-xs">{i + 1}</Td>
              <Td>{t.title}</Td>
              <Td>
                <Badge variant="outline">{NOTE_KIND_LABELS[t.kind]}</Badge>
              </Td>
              <Td className="text-xs">{t.lineKeys.map((k) => lineLabel.get(k) ?? k).join(', ')}</Td>
              <Td>{t.mandatory ? 'Yes' : ''}</Td>
              <Td className="text-right whitespace-nowrap">
                <EditButton
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${t.title} up`}
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  <ArrowUp />
                </EditButton>
                <EditButton
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${t.title} down`}
                  disabled={i === ids.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <ArrowDown />
                </EditButton>
                <EditButton
                  variant="ghost"
                  size="sm"
                  aria-label={`Edit ${t.title}`}
                  onClick={() => setEditing(t)}
                >
                  <Pencil />
                </EditButton>
                <EditButton
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${t.title}`}
                  disabled={!!d.removeBlocked}
                  title={d.removeBlocked ?? undefined}
                  onClick={() => window.confirm(`Remove "${t.title}"?`) && remove.mutate(t.id)}
                >
                  <Trash2 />
                </EditButton>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {editing && (
        <TemplateDialog
          code={code}
          d={d}
          t={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={set}
        />
      )}
    </div>
  );
}

function TemplateDialog({
  code,
  d,
  t,
  onClose,
  onSaved,
}: {
  code: string;
  d: NoteTemplatesDto;
  t: NoteTemplateDto | null;
  onClose: () => void;
  onSaved: (d: NoteTemplatesDto) => void;
}) {
  const [form, setForm] = useState({
    title: t?.title ?? '',
    kind: (t?.kind ?? 'NARRATIVE') as NoteKindCode,
    lineKeys: t?.lineKeys ?? [],
    mandatory: t?.mandatory ?? false,
    defaultText: t ? textOf(t) : '',
  });
  const save = useMutation({
    mutationFn: () =>
      t
        ? api.put<NoteTemplatesDto>(`/config/formats/${code}/note-templates/${t.id}`, form)
        : api.post<NoteTemplatesDto>(`/config/formats/${code}/note-templates`, form),
    onSuccess: (r) => {
      toast('Note template saved.');
      onSaved(r);
      onClose();
    },
  });
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={t ? `Edit ${t.title}` : 'Add note template'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !form.title.trim()} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <Field label="Title" htmlFor="tpl-title">
          <Input
            id="tpl-title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label="Type" htmlFor="tpl-kind">
          <Select
            id="tpl-kind"
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as NoteKindCode })}
          >
            {Object.entries(NOTE_KIND_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        {form.kind === 'LINE' && (
          <Field label="Linked statement line" htmlFor="tpl-line">
            <Select
              id="tpl-line"
              value={form.lineKeys[0] ?? ''}
              onChange={(e) =>
                setForm({ ...form, lineKeys: e.target.value ? [e.target.value] : [] })
              }
            >
              <option value="">Choose a line</option>
              {d.lines.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field
          label="Default text"
          htmlFor="tpl-text"
          hint="One paragraph per line. Placeholders: {legalName}, {country}, {functionalCurrency}, {gaap}, {erp}, {periodLabel}, {periodEnd}, {periodSpan}."
        >
          <textarea
            id="tpl-text"
            className="min-h-32 w-full rounded-md border bg-background p-2 text-sm"
            value={form.defaultText}
            onChange={(e) => setForm({ ...form, defaultText: e.target.value })}
          />
        </Field>
        <span className="flex items-center gap-2">
          <Checkbox
            id="tpl-mandatory"
            checked={form.mandatory}
            onChange={(e) => setForm({ ...form, mandatory: e.target.checked })}
          />
          <Label htmlFor="tpl-mandatory">Mandatory (always shown, cannot be deleted)</Label>
        </span>
      </div>
    </Dialog>
  );
}
