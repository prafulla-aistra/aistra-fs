import { CircleCheck, CircleX, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type {
  EntityNotesDto,
  FiguresBlockDto,
  FiguresViewDto,
  GeneratedViewDto,
  TableBlockDto,
  TableViewDto,
} from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Label, Select } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/overlay';
import { statementAmount } from '@/lib/format';
import { cn } from '@/lib/utils';

const newId = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function Tick({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) return null;
  return ok ? (
    <CircleCheck className="ml-1 inline size-4 text-success" aria-label={`${label}: agrees`} />
  ) : (
    <CircleX
      className="ml-1 inline size-4 text-destructive"
      aria-label={`${label}: does not agree`}
    />
  );
}

/** Line note figures: accounts grouped into sub-captions (with subtotals), total ticked to the face. */
export function FiguresBlockEditor({
  block,
  view,
  d,
  editable,
  onChange,
}: {
  block: FiguresBlockDto;
  view: FiguresViewDto | undefined;
  d: EntityNotesDto;
  editable: boolean;
  onChange: (b: FiguresBlockDto) => void;
}) {
  const [newLabel, setNewLabel] = useState('');
  const indian = d.selection.unit === 'LAKHS' || d.selection.unit === 'CRORES';
  const amt = (v: string | null) => statementAmount(v, indian);
  if (!view) return <p className="text-sm text-muted-foreground">No figures for this line.</p>;
  const breakdown = view.breakdown ? <LineBreakdown view={view} amt={amt} /> : null;
  const owner = (code: string) =>
    block.subCaptions.find((s) => s.accounts.includes(code))?.id ?? '';
  const move = (code: string, to: string) =>
    onChange({
      ...block,
      subCaptions: block.subCaptions.map((s) => ({
        ...s,
        accounts:
          s.id === to
            ? [...s.accounts.filter((a) => a !== code), code]
            : s.accounts.filter((a) => a !== code),
      })),
    });
  return (
    <div className="space-y-2">
      {breakdown}
      <Table aria-label="Note figures">
        <thead>
          <tr>
            <Th>Account</Th>
            <Th className="text-right">{d.periodLabel}</Th>
            {d.hasComparative && <Th className="text-right">{d.comparativeLabel}</Th>}
            {editable && <Th>Sub-caption</Th>}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {view.groups.map((g) => (
            <GroupRows
              key={g.id}
              g={g}
              d={d}
              editable={editable}
              amt={amt}
              block={block}
              owner={owner}
              move={move}
            />
          ))}
          {view.computed.map((c) => (
            <tr key={c.fsliCode} className="italic">
              <Td>{c.label} (computed)</Td>
              <Td className="text-right">{amt(c.current)}</Td>
              {d.hasComparative && <Td className="text-right">{amt(c.comparative)}</Td>}
              {editable && <Td />}
            </tr>
          ))}
          <tr className="font-semibold">
            <Td>Total</Td>
            <Td className="text-right whitespace-nowrap">
              {amt(view.total.current)}
              <Tick ok={view.ties.current} label="Total agrees to the statement" />
            </Td>
            {d.hasComparative && (
              <Td className="text-right whitespace-nowrap">
                {amt(view.total.comparative)}
                <Tick
                  ok={view.ties.comparative}
                  label="Comparative total agrees to the statement"
                />
              </Td>
            )}
            {editable && <Td />}
          </tr>
        </tbody>
      </Table>
      {view.errors.map((e) => (
        <p key={e} className="text-xs text-destructive">
          {e}
        </p>
      ))}
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="New sub-caption"
            placeholder='New sub-caption, e.g. "Unsecured, considered good"'
            className="h-8 max-w-sm text-sm"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!newLabel.trim()}
            onClick={() => {
              onChange({
                ...block,
                subCaptions: [
                  ...block.subCaptions,
                  { id: newId(), label: newLabel.trim(), accounts: [] },
                ],
              });
              setNewLabel('');
            }}
          >
            <Plus /> Add sub-caption
          </Button>
          {block.subCaptions.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 rounded border bg-card px-1.5 py-0.5 text-xs"
            >
              <input
                aria-label={`Rename ${s.label}`}
                className="w-40 bg-transparent outline-none"
                value={s.label}
                onChange={(e) =>
                  onChange({
                    ...block,
                    subCaptions: block.subCaptions.map((x) =>
                      x.id === s.id ? { ...x, label: e.target.value } : x,
                    ),
                  })
                }
              />
              <button
                type="button"
                aria-label={`Remove sub-caption ${s.label}`}
                onClick={() =>
                  onChange({
                    ...block,
                    subCaptions: block.subCaptions.filter((x) => x.id !== s.id),
                  })
                }
              >
                <Trash2 className="size-3.5 text-muted-foreground" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupRows({
  g,
  d,
  editable,
  amt,
  block,
  owner,
  move,
}: {
  g: FiguresViewDto['groups'][number];
  d: EntityNotesDto;
  editable: boolean;
  amt: (v: string | null) => string;
  block: FiguresBlockDto;
  owner: (code: string) => string;
  move: (code: string, to: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <>
      {g.label && (
        <tr
          className={cn('bg-muted/30', over && 'ring-2 ring-primary')}
          onDragOver={(e) => {
            if (!editable) return;
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            setOver(false);
            move(e.dataTransfer.getData('text/plain'), g.id === 'other' ? '' : g.id);
          }}
        >
          <Td colSpan={d.hasComparative ? 4 : 3} className="py-1.5 text-xs font-semibold italic">
            {g.label}
          </Td>
        </tr>
      )}
      {g.accounts.map((a) => (
        <tr
          key={a.code}
          draggable={editable}
          onDragStart={(e) => e.dataTransfer.setData('text/plain', a.code)}
          className={editable ? 'cursor-grab' : undefined}
        >
          <Td className={g.label ? 'pl-6' : undefined}>
            <span className="font-mono text-xs text-muted-foreground">{a.code}</span> {a.name}
            {a.counterpartyCode && (
              <span className="text-muted-foreground"> ({a.counterpartyCode})</span>
            )}
          </Td>
          <Td className="text-right">{amt(a.current)}</Td>
          {d.hasComparative && <Td className="text-right">{amt(a.comparative)}</Td>}
          {editable && (
            <Td className="py-1">
              <Select
                aria-label={`Sub-caption for ${a.code}`}
                className="h-7 text-xs"
                value={owner(a.code)}
                onChange={(e) => move(a.code, e.target.value)}
              >
                <option value="">Other</option>
                {block.subCaptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Td>
          )}
        </tr>
      ))}
      {g.label && (
        <tr className="font-medium">
          <Td className="pl-6 text-xs">Total {g.label.toLowerCase()}</Td>
          <Td className="border-t border-foreground/40 text-right">{amt(g.subtotal.current)}</Td>
          {d.hasComparative && (
            <Td className="border-t border-foreground/40 text-right">
              {amt(g.subtotal.comparative)}
            </Td>
          )}
          {editable && <Td />}
        </tr>
      )}
    </>
  );
}

/** A user-defined table: columns (text or number; current / comparative period), rows, tie. */
export function TableBlockEditor({
  block,
  view,
  d,
  editable,
  onChange,
}: {
  block: TableBlockDto;
  view: TableViewDto | undefined;
  d: EntityNotesDto;
  editable: boolean;
  onChange: (b: TableBlockDto) => void;
}) {
  const heading = (c: TableBlockDto['columns'][number]) =>
    c.period === 'CURRENT'
      ? d.periodLabel
      : c.period === 'COMPARATIVE'
        ? d.comparativeLabel
        : c.label;
  const setCell = (rowId: string, colId: string, v: string) =>
    onChange({
      ...block,
      rows: block.rows.map((r) =>
        r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: v } } : r,
      ),
    });
  return (
    <div className="space-y-2">
      <Table aria-label={block.label || 'Custom table'}>
        <thead>
          <tr>
            {block.columns.map((c) => (
              <Th key={c.id} className={c.numeric ? 'text-right' : undefined}>
                {editable && c.period === null ? (
                  <input
                    aria-label="Column name"
                    className="w-full bg-transparent font-medium outline-none"
                    value={c.label}
                    onChange={(e) =>
                      onChange({
                        ...block,
                        columns: block.columns.map((x) =>
                          x.id === c.id ? { ...x, label: e.target.value } : x,
                        ),
                      })
                    }
                  />
                ) : (
                  heading(c)
                )}
              </Th>
            ))}
            {editable && <Th />}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((r) => (
            <tr key={r.id}>
              {block.columns.map((c) => (
                <Td key={c.id} className="py-1">
                  <Input
                    aria-label={`${heading(c)} of row`}
                    className={cn('h-8 text-sm', c.numeric && 'text-right tabular-nums')}
                    disabled={!editable}
                    inputMode={c.numeric ? 'decimal' : undefined}
                    value={r.cells[c.id] ?? ''}
                    onChange={(e) => setCell(r.id, c.id, e.target.value)}
                  />
                </Td>
              ))}
              {editable && (
                <Td className="py-1">
                  <button
                    type="button"
                    aria-label="Remove row"
                    onClick={() =>
                      onChange({ ...block, rows: block.rows.filter((x) => x.id !== r.id) })
                    }
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </button>
                </Td>
              )}
            </tr>
          ))}
          {view?.total !== null && view?.total !== undefined && (
            <tr className="font-semibold">
              {block.columns.map((c, i) => (
                <Td key={c.id} className={c.numeric ? 'text-right tabular-nums' : undefined}>
                  {i === 0
                    ? 'Total'
                    : c.period === 'CURRENT'
                      ? statementAmount(view.total, false)
                      : ''}
                  {c.period === 'CURRENT' && (
                    <Tick ok={view.ties} label={`Agrees to ${view.agreeLabel ?? 'the line'}`} />
                  )}
                </Td>
              ))}
              {editable && <Td />}
            </tr>
          )}
        </tbody>
      </Table>
      {view?.errors.map((e) => (
        <p key={e} className="text-xs text-destructive">
          {e}
        </p>
      ))}
      {editable && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onChange({ ...block, rows: [...block.rows, { id: newId(), cells: {} }] })
            }
          >
            <Plus /> Row
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onChange({
                ...block,
                columns: [
                  ...block.columns,
                  { id: newId(), label: 'New column', numeric: false, period: null },
                ],
              })
            }
          >
            <Plus /> Column
          </Button>
          <span className="flex items-center gap-2">
            <Checkbox
              id={`agree-${block.id}`}
              checked={block.mode === 'AGREE'}
              onChange={(e) =>
                onChange({
                  ...block,
                  mode: e.target.checked ? 'AGREE' : 'MEMO',
                  agreeLine: e.target.checked ? (block.agreeLine ?? d.lines[0]?.key ?? null) : null,
                })
              }
            />
            <Label htmlFor={`agree-${block.id}`}>Must agree to line</Label>
          </span>
          {block.mode === 'AGREE' && (
            <Select
              aria-label="Line the table must agree to"
              className="h-8 w-72 text-xs"
              value={block.agreeLine ?? ''}
              onChange={(e) => onChange({ ...block, agreeLine: e.target.value })}
            >
              {d.lines.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </Select>
          )}
          {block.mode === 'MEMO' && (
            <span className="text-xs text-muted-foreground">
              Memo table (not tied to the statements)
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Consolidation line notes: the line by member entity, eliminations and consolidated. */
function LineBreakdown({ view, amt }: { view: FiguresViewDto; amt: (v: string | null) => string }) {
  const b = view.breakdown!;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="border-b bg-muted/40 text-muted-foreground">
            {b.columns.map((c) => (
              <th key={c.code} className="px-2 py-1 text-right font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {b.columns.map((c) => (
              <td
                key={c.code}
                className={cn('px-2 py-1 text-right', c.code === 'CONSOLIDATED' && 'font-semibold')}
              >
                {amt(b.current[c.code] ?? null)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** A table the system fills from the consolidation (read-only). */
export function GeneratedBlockView({ view }: { view: GeneratedViewDto | undefined }) {
  if (!view) return <p className="text-sm text-muted-foreground">Filled from the consolidation.</p>;
  return (
    <div className="space-y-1">
      {view.columns.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                {view.columns.map((c, i) => (
                  <th
                    key={i}
                    className={cn('px-2 py-1 font-medium', c.numeric ? 'text-right' : 'text-left')}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r, i) => (
                <tr key={i} className={cn('border-b last:border-0', r.total && 'font-semibold')}>
                  {r.cells.map((c, j) => (
                    <td
                      key={j}
                      className={cn(
                        'px-2 py-1',
                        view.columns[j]?.numeric ? 'text-right' : 'text-left',
                      )}
                    >
                      {c ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.footnote && <p className="text-xs text-muted-foreground">{view.footnote}</p>}
      <p className="text-xs text-muted-foreground">
        Read-only: filled from the consolidation each time.
      </p>
    </div>
  );
}
