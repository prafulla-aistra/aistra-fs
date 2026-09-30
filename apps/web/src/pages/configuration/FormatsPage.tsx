import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Copy,
  GripVertical,
  IndentDecrease,
  IndentIncrease,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  FormatDetailDto,
  FormatDto,
  FormatIssueDto,
  FormatLineDto,
  FormatPreviewDto,
  FormatPreviewSourceDto,
  FormatRoleCode,
  FormatSaveResultDto,
  FormatStatementCode,
  FsliDto,
} from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Field, Input, Select } from '@/components/ui/form';
import { Dialog, Table, Td, Th } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { amountText, formatDateTime } from '@/lib/format';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { ConfigPage, EditButton } from './ConfigPage';
import { useCanEditConfig } from './hooks';

const STATEMENT_LABEL: Record<FormatStatementCode, string> = {
  PL: 'Profit and loss',
  BS: 'Balance sheet',
};
const TYPE_LABEL = { HEADING: 'Heading', LINE: 'Line', TOTAL: 'Subtotal / total' } as const;
const ROLES: Record<FormatStatementCode, { role: FormatRoleCode; label: string }[]> = {
  PL: [{ role: 'PROFIT', label: 'Profit for the period' }],
  BS: [
    { role: 'TOTAL_ASSETS', label: 'Total assets' },
    { role: 'TOTAL_EQUITY_LIABILITIES', label: 'Total equity and liabilities' },
  ],
};

let seq = 0;
const newKey = (type: string) =>
  `${type.toLowerCase()}_${Date.now().toString(36)}${(seq++).toString(36)}`;

export function FormatsPage() {
  const formats = useQuery({
    queryKey: ['config', 'formats'],
    queryFn: () => api.get<FormatDto[]>('/config/formats'),
  });
  const [code, setCode] = useState<string | null>(null);
  const active = code ?? formats.data?.[0]?.code ?? null;
  const [duplicating, setDuplicating] = useState(false);
  return (
    <ConfigPage
      title="Report formats"
      purpose="The layout of the balance sheet and P&L each task produces, built from FSLIs. Every FSLI must sit on exactly one line."
      count={formats.data ? `${formats.data.length} formats` : null}
      action={
        <EditButton variant="outline" disabled={!active} onClick={() => setDuplicating(true)}>
          <Copy /> Duplicate format
        </EditButton>
      }
    >
      {formats.error && <Alert>{errorMessage(formats.error)}</Alert>}
      {!formats.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <div role="tablist" aria-label="Formats" className="flex flex-wrap gap-1 border-b">
            {formats.data.map((f) => (
              <button
                key={f.code}
                role="tab"
                type="button"
                aria-selected={f.code === active}
                onClick={() => setCode(f.code)}
                className={cn(
                  '-mb-px border-b-2 px-3 py-2 text-sm',
                  f.code === active
                    ? 'border-primary font-medium text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {f.name}
                <span className="ml-1.5 text-xs text-muted-foreground">v{f.currentVersion}</span>
              </button>
            ))}
          </div>
          {active && <FormatEditor key={active} code={active} />}
        </>
      )}
      {duplicating && active && (
        <DuplicateDialog
          code={active}
          onClose={() => setDuplicating(false)}
          onDone={(c) => {
            setDuplicating(false);
            setCode(c);
          }}
        />
      )}
    </ConfigPage>
  );
}

// ---------------------------------------------------------------------------------------

function FormatEditor({ code }: { code: string }) {
  const qc = useQueryClient();
  const canEdit = useCanEditConfig();
  const detail = useQuery({
    queryKey: ['config', 'format', code],
    queryFn: () => api.get<FormatDetailDto>(`/config/formats/${code}`),
  });
  const fslis = useQuery({
    queryKey: ['config', 'fslis'],
    queryFn: () => api.get<FsliDto[]>('/config/fslis'),
  });
  const [draft, setDraft] = useState<{
    name: string;
    description: string;
    lines: FormatLineDto[];
  } | null>(null);
  const [statement, setStatement] = useState<FormatStatementCode>('PL');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (detail.data && !draft)
      setDraft({
        name: detail.data.name,
        description: detail.data.description,
        lines: detail.data.lines,
      });
  }, [detail.data, draft]);

  const dirty =
    !!draft &&
    !!detail.data &&
    JSON.stringify([draft.name, draft.description, draft.lines]) !==
      JSON.stringify([detail.data.name, detail.data.description, detail.data.lines]);

  // Coverage check runs in the engine on the server, on every change (debounced).
  const [issues, setIssues] = useState<FormatIssueDto[] | null>(null);
  useEffect(() => {
    if (!draft) return;
    const t = setTimeout(() => {
      api
        .post<{ issues: FormatIssueDto[] }>('/config/formats/check', { lines: draft.lines })
        .then((r) => setIssues(r.issues))
        .catch(() => setIssues(null));
    }, 250);
    return () => clearTimeout(t);
  }, [draft]);

  const save = useMutation({
    mutationFn: () =>
      api.put<FormatSaveResultDto>(`/config/formats/${code}`, {
        ...draft,
        note: note.trim() || null,
      }),
    onSuccess: async (r) => {
      toast(
        r.newVersion
          ? `Saved as version ${r.format.currentVersion}. The old version stays with its finalised reports.`
          : 'Format saved.',
      );
      setDraft({ name: r.format.name, description: r.format.description, lines: r.format.lines });
      setNote('');
      qc.setQueryData(['config', 'format', code], r.format);
      await qc.invalidateQueries({ queryKey: ['config', 'formats'] });
    },
  });

  if (detail.error) return <Alert>{errorMessage(detail.error)}</Alert>;
  if (!detail.data || !draft || !fslis.data) return <Skeleton className="h-96 w-full" />;
  const d = detail.data;
  const own = draft.lines.filter((l) => l.statement === statement);
  const setOwn = (next: FormatLineDto[]) =>
    setDraft({
      ...draft,
      lines:
        statement === 'PL'
          ? [...next, ...draft.lines.filter((l) => l.statement === 'BS')]
          : [...draft.lines.filter((l) => l.statement === 'PL'), ...next],
    });
  const update = (key: string, patch: Partial<FormatLineDto>) =>
    setOwn(own.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= own.length || from === to) return;
    const next = [...own];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setOwn(next);
  };
  const add = (type: FormatLineDto['type']) =>
    setOwn([
      ...own,
      {
        key: newKey(type),
        statement,
        type,
        label: type === 'HEADING' ? 'New heading' : type === 'LINE' ? 'New line' : 'New subtotal',
        indent: 0,
        fslis: [],
        formula: [],
        role: null,
      },
    ]);
  const issuesHere = (issues ?? []).filter((i) => i.statement === statement);
  const lineIssues = (key: string) => issuesHere.filter((i) => i.lineKey === key);
  const stFslis = fslis.data.filter((f) => f.statement === statement);
  const nameOf = (c: string) => fslis.data.find((f) => f.code === c)?.name ?? c;

  return (
    <div className="space-y-4">
      {d.savesAsNewVersion && (
        <Alert variant="info">
          Version {d.currentVersion} is used by finalised reports (
          {d.versions.find((v) => v.version === d.currentVersion)?.finalisedTasks.join(', ')}).
          Saving creates version {d.currentVersion + 1}; the finalised reports keep version{' '}
          {d.currentVersion}.
        </Alert>
      )}
      <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
        <Field label="Format name" htmlFor="format-name">
          <Input
            id="format-name"
            value={draft.name}
            disabled={!canEdit}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </Field>
        <Field label="Description" htmlFor="format-description">
          <Input
            id="format-description"
            value={draft.description}
            disabled={!canEdit}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Statement">
          {(['PL', 'BS'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={statement === s}
              onClick={() => setStatement(s)}
              className={cn(
                'rounded px-3 py-1 text-sm',
                statement === s
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {STATEMENT_LABEL[s]}
            </button>
          ))}
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => add('HEADING')}>
              <Plus /> Heading
            </Button>
            <Button variant="outline" size="sm" onClick={() => add('LINE')}>
              <Plus /> Line
            </Button>
            <Button variant="outline" size="sm" onClick={() => add('TOTAL')}>
              <Plus /> Subtotal
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{STATEMENT_LABEL[statement]} layout</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 p-2">
            {own.map((l, i) => (
              <LineRow
                key={l.key}
                line={l}
                index={i}
                count={own.length}
                above={own.slice(0, i).filter((x) => x.type !== 'HEADING')}
                canEdit={canEdit}
                issues={lineIssues(l.key)}
                fsliName={nameOf}
                onChange={(p) => update(l.key, p)}
                onMove={move}
                onDelete={() => setOwn(own.filter((x) => x.key !== l.key))}
              />
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <CoveragePanel issues={issues} statement={statement} />
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">FSLI placement</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table aria-label="FSLI placement">
                <thead>
                  <tr>
                    <Th>FSLI</Th>
                    <Th>Placed on</Th>
                  </tr>
                </thead>
                <tbody>
                  {stFslis.map((f) => {
                    const on = own.filter((l) => l.type === 'LINE' && l.fslis.includes(f.code));
                    return (
                      <tr key={f.code} className={on.length !== 1 ? 'bg-red-50' : undefined}>
                        <Td className="text-xs">
                          {f.name} <span className="font-mono text-muted-foreground">{f.code}</span>
                        </Td>
                        <Td className="py-1">
                          <Select
                            aria-label={`Line for ${f.name}`}
                            className="h-8 text-xs"
                            disabled={!canEdit}
                            value={on.length === 1 ? on[0]!.key : ''}
                            onChange={(e) => {
                              const target = e.target.value;
                              setOwn(
                                own.map((l) =>
                                  l.type !== 'LINE'
                                    ? l
                                    : l.key === target
                                      ? {
                                          ...l,
                                          fslis: [...l.fslis.filter((c) => c !== f.code), f.code],
                                        }
                                      : { ...l, fslis: l.fslis.filter((c) => c !== f.code) },
                                ),
                              );
                            }}
                          >
                            <option value="">
                              {on.length > 1 ? `On ${on.length} lines – choose one` : 'Not placed'}
                            </option>
                            {own
                              .filter((l) => l.type === 'LINE')
                              .map((l) => (
                                <option key={l.key} value={l.key}>
                                  {l.label}
                                </option>
                              ))}
                          </Select>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>

      {canEdit && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 shadow-sm">
          <Input
            aria-label="Change note"
            placeholder="Change note (optional)"
            className="max-w-sm"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            disabled={!dirty || save.isPending || issues === null || issues.length > 0}
            onClick={() => save.mutate()}
            title={issues && issues.length > 0 ? 'Fix the coverage problems first' : undefined}
          >
            {d.savesAsNewVersion ? `Save as version ${d.currentVersion + 1}` : 'Save format'}
          </Button>
          <Button
            variant="outline"
            disabled={!dirty}
            onClick={() => setDraft({ name: d.name, description: d.description, lines: d.lines })}
          >
            Discard changes
          </Button>
          {issues && issues.length > 0 && (
            <span className="text-sm text-destructive" role="status">
              Saving is blocked: {issues.length} coverage problem{issues.length === 1 ? '' : 's'}.
            </span>
          )}
          {save.error && <Alert className="w-full">{errorMessage(save.error)}</Alert>}
        </div>
      )}

      <PreviewCard lines={draft.lines} />
      <VersionsCard d={d} />
    </div>
  );
}

function LineRow({
  line: l,
  index,
  count,
  above,
  canEdit,
  issues,
  fsliName,
  onChange,
  onMove,
  onDelete,
}: {
  line: FormatLineDto;
  index: number;
  count: number;
  above: FormatLineDto[];
  canEdit: boolean;
  issues: FormatIssueDto[];
  fsliName: (code: string) => string;
  onChange: (p: Partial<FormatLineDto>) => void;
  onMove: (from: number, to: number) => void;
  onDelete: () => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      data-testid={`format-line-${l.key}`}
      draggable={canEdit}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', String(index))}
      onDragOver={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onMove(Number(e.dataTransfer.getData('text/plain')), index);
      }}
      className={cn(
        'rounded-md border px-2 py-1.5',
        l.type === 'HEADING' && 'bg-muted/40',
        l.type === 'TOTAL' && 'border-ink/20 bg-[#F3F6F8]',
        issues.length > 0 && 'border-destructive/50',
        over && 'ring-2 ring-primary',
      )}
      style={{ marginLeft: `${l.indent * 1.25}rem` }}
    >
      <div className="flex items-center gap-1.5">
        {canEdit && (
          <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden />
        )}
        <Badge variant={l.type === 'TOTAL' ? 'review' : 'outline'} className="shrink-0">
          {TYPE_LABEL[l.type]}
        </Badge>
        <Input
          aria-label={`Name of ${l.label || 'line'}`}
          className={cn('h-8 flex-1 text-sm', l.type !== 'LINE' && 'font-semibold')}
          value={l.label}
          disabled={!canEdit}
          onChange={(e) => onChange({ label: e.target.value })}
        />
        {canEdit && (
          <div className="flex shrink-0">
            <IconBtn
              label="Move up"
              disabled={index === 0}
              onClick={() => onMove(index, index - 1)}
            >
              <ArrowUp />
            </IconBtn>
            <IconBtn
              label="Move down"
              disabled={index === count - 1}
              onClick={() => onMove(index, index + 1)}
            >
              <ArrowDown />
            </IconBtn>
            <IconBtn
              label="Indent less"
              disabled={l.indent === 0}
              onClick={() => onChange({ indent: l.indent - 1 })}
            >
              <IndentDecrease />
            </IconBtn>
            <IconBtn
              label="Indent more"
              disabled={l.indent >= 4}
              onClick={() => onChange({ indent: l.indent + 1 })}
            >
              <IndentIncrease />
            </IconBtn>
            <IconBtn label={`Delete ${l.label}`} onClick={onDelete}>
              <Trash2 />
            </IconBtn>
          </div>
        )}
      </div>
      {l.type === 'LINE' && (
        <div className="mt-1 flex flex-wrap gap-1 pl-6 text-[11px] text-muted-foreground">
          {l.fslis.length === 0 ? (
            <span className="text-destructive">No FSLIs – choose them in the placement table</span>
          ) : (
            l.fslis.map((c) => (
              <span key={c} className="rounded bg-mint px-1.5 py-0.5 text-ink">
                {fsliName(c)}
              </span>
            ))
          )}
        </div>
      )}
      {l.type === 'TOTAL' && (
        <div className="mt-1 flex flex-wrap items-center gap-1 pl-6 text-xs">
          <span className="text-muted-foreground">=</span>
          {l.formula.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-0.5">
              <Select
                aria-label="Add or subtract"
                className="h-7 w-12 px-1 text-xs"
                disabled={!canEdit}
                value={p.op}
                onChange={(e) =>
                  onChange({
                    formula: l.formula.map((x, j) =>
                      j === i ? { ...x, op: e.target.value as '+' | '-' } : x,
                    ),
                  })
                }
              >
                <option value="+">+</option>
                <option value="-">−</option>
              </Select>
              <Select
                aria-label="Line in total"
                className="h-7 max-w-44 px-1 text-xs"
                disabled={!canEdit}
                value={p.key}
                onChange={(e) =>
                  onChange({
                    formula: l.formula.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)),
                  })
                }
              >
                {!above.some((a) => a.key === p.key) && (
                  <option value={p.key}>(line not above)</option>
                )}
                {above.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </Select>
              {canEdit && (
                <IconBtn
                  label="Remove part"
                  onClick={() => onChange({ formula: l.formula.filter((_, j) => j !== i) })}
                >
                  <XCircle />
                </IconBtn>
              )}
            </span>
          ))}
          {canEdit && above.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() =>
                onChange({ formula: [...l.formula, { key: above.at(-1)!.key, op: '+' }] })
              }
            >
              <Plus /> part
            </Button>
          )}
          <Select
            aria-label="Marked as"
            className="ml-auto h-7 w-52 px-1 text-xs"
            disabled={!canEdit}
            value={l.role ?? ''}
            onChange={(e) => onChange({ role: (e.target.value || null) as FormatRoleCode | null })}
          >
            <option value="">Not marked</option>
            {ROLES[l.statement].map((r) => (
              <option key={r.role} value={r.role}>
                Marked: {r.label}
              </option>
            ))}
          </Select>
        </div>
      )}
      {issues.map((i, n) => (
        <p key={n} className="mt-1 pl-6 text-xs text-destructive">
          {i.message}
        </p>
      ))}
    </div>
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
      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 [&>svg]:size-3.5"
    >
      {children}
    </button>
  );
}

function CoveragePanel({
  issues,
  statement,
}: {
  issues: FormatIssueDto[] | null;
  statement: FormatStatementCode;
}) {
  if (issues === null) return <Skeleton className="h-16 w-full" />;
  const other = issues.filter((i) => i.statement !== statement).length;
  return (
    <Card
      aria-label="Coverage check"
      className={issues.length > 0 ? 'border-destructive/40' : 'border-success/40'}
    >
      <CardContent className="space-y-1.5 py-3">
        {issues.length === 0 ? (
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 className="size-4" /> Coverage check passed: every FSLI is placed exactly
            once.
          </p>
        ) : (
          <>
            <p className="flex items-center gap-2 text-sm font-medium text-destructive">
              <XCircle className="size-4" /> Coverage check failed – {issues.length} problem
              {issues.length === 1 ? '' : 's'}
            </p>
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-destructive">
              {issues
                .filter((i) => i.statement === statement)
                .map((i, n) => (
                  <li key={n}>{i.message}</li>
                ))}
            </ul>
            {other > 0 && (
              <p className="text-xs text-muted-foreground">{other} more on the other statement.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PreviewCard({ lines }: { lines: FormatLineDto[] }) {
  const sources = useQuery({
    queryKey: ['config', 'format-sources'],
    queryFn: () => api.get<FormatPreviewSourceDto[]>('/config/formats/preview-sources'),
  });
  const [pick, setPick] = useState('');
  const chosen = useMemo(
    () =>
      sources.data?.find((s) => `${s.taskId}:${s.entityCode}` === pick) ??
      sources.data?.[0] ??
      null,
    [pick, sources.data],
  );
  const preview = useMutation({
    mutationFn: () =>
      api.post<FormatPreviewDto>('/config/formats/preview', {
        lines,
        taskId: chosen!.taskId,
        entityCode: chosen!.entityCode,
      }),
  });
  const p = preview.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Preview with real figures</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-96">
            <Field label="Task and entity" htmlFor="preview-source">
              <Select
                id="preview-source"
                value={chosen ? `${chosen.taskId}:${chosen.entityCode}` : ''}
                onChange={(e) => setPick(e.target.value)}
              >
                {(sources.data ?? []).map((s) => (
                  <option key={`${s.taskId}:${s.entityCode}`} value={`${s.taskId}:${s.entityCode}`}>
                    {s.periodLabel} · {s.entityCode} {s.entityName} · {s.taskNumber}{' '}
                    {s.finalised ? '(finalised)' : '(current)'}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button
            variant="outline"
            disabled={!chosen || preview.isPending}
            onClick={() => preview.mutate()}
          >
            Show preview
          </Button>
        </div>
        {preview.error && <Alert>{errorMessage(preview.error)}</Alert>}
        {p && (
          <>
            <p className="text-sm">
              {p.source.entityCode} {p.source.periodLabel}, in {p.source.currency}.{' '}
              {p.balanced === true ? (
                <span className="font-medium text-success">Balance sheet balances.</span>
              ) : p.balanced === false ? (
                <span className="font-medium text-destructive">
                  Balance sheet does not balance.
                </span>
              ) : null}
              {p.unmapped !== '0.00' && (
                <span className="ml-1 text-warning-foreground">
                  Unmapped TB lines ({amountText(p.unmapped)}) are not shown.
                </span>
              )}
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              {(['PL', 'BS'] as const).map((st) => (
                <Table key={st} aria-label={`Preview ${STATEMENT_LABEL[st]}`}>
                  <thead>
                    <tr>
                      <Th>{STATEMENT_LABEL[st]}</Th>
                      <Th className="text-right">{p.source.currency}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.rows
                      .filter((r) => r.statement === st)
                      .map((r) => (
                        <tr
                          key={r.key}
                          className={
                            r.type === 'TOTAL'
                              ? 'font-semibold'
                              : r.type === 'HEADING'
                                ? 'bg-muted/30'
                                : undefined
                          }
                        >
                          <Td
                            className="py-1.5 text-xs"
                            style={{ paddingLeft: `${0.75 + r.indent * 1.25}rem` }}
                          >
                            {r.label}
                          </Td>
                          <Td className="py-1.5 text-right font-mono text-xs tabular-nums">
                            {r.value === null ? '' : amountText(r.value)}
                          </Td>
                        </tr>
                      ))}
                  </tbody>
                </Table>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function VersionsCard({ d }: { d: FormatDetailDto }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Versions</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table aria-label="Format versions">
          <thead>
            <tr>
              <Th>Version</Th>
              <Th>Note</Th>
              <Th>Created</Th>
              <Th>Used by</Th>
            </tr>
          </thead>
          <tbody>
            {d.versions.map((v) => (
              <tr key={v.version}>
                <Td>
                  v{v.version}{' '}
                  {v.version === d.currentVersion && <Badge variant="success">Current</Badge>}
                </Td>
                <Td className="text-xs">{v.note ?? '—'}</Td>
                <Td className="text-xs">
                  {v.createdBy ?? 'Seed'}, {formatDateTime(v.createdAt)}
                </Td>
                <Td className="text-xs">
                  {v.tasks.length === 0
                    ? '—'
                    : v.tasks
                        .map((t) => (v.finalisedTasks.includes(t) ? `${t} (finalised)` : t))
                        .join(', ')}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </CardContent>
    </Card>
  );
}

function DuplicateDialog({
  code,
  onClose,
  onDone,
}: {
  code: string;
  onClose: () => void;
  onDone: (code: string) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ code: `${code}_COPY`.slice(0, 40), name: '' });
  const dup = useMutation({
    mutationFn: () => api.post<FormatDetailDto>(`/config/formats/${code}/duplicate`, form),
    onSuccess: async (f) => {
      toast(`${f.name} created.`);
      await qc.invalidateQueries({ queryKey: ['config', 'formats'] });
      onDone(f.code);
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Duplicate format"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={dup.isPending || !form.name.trim()} onClick={() => dup.mutate()}>
            Duplicate
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {dup.error && <Alert>{errorMessage(dup.error)}</Alert>}
        <Field label="Code" htmlFor="dup-code" hint="Capitals, digits and _ only.">
          <Input
            id="dup-code"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label="Name" htmlFor="dup-name">
          <Input
            id="dup-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
      </div>
    </Dialog>
  );
}
