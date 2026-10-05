import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import type { EntityNotesDto, NoteDto, PriorNoteDto } from '@finance-close/shared';
import { Alert } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { statementAmount } from '@/lib/format';
import { indianGrouping } from './figures';
import { RichTextView } from './RichTextView';
import { useApiBase } from '../api-base';

/**
 * "Last finalised (Jul-2026)": the note exactly as finalised (read-only), and the words added /
 * removed in this period's text.
 */
export function PriorPanel({
  taskId,
  d,
  note,
}: {
  taskId: string;
  d: EntityNotesDto;
  note: NoteDto;
}) {
  const base = useApiBase(taskId, d.entity.code);
  const qs = new URLSearchParams({
    currency: d.selection.currency,
    unit: d.selection.unit,
  }).toString();
  const q = useQuery({
    queryKey: ['note-prior', taskId, d.entity.code, note.id, qs, note.version],
    queryFn: () => api.get<PriorNoteDto>(`${base}/notes/${note.id}/prior?${qs}`),
  });
  const indian = indianGrouping(d);
  if (q.error) return <Alert>{errorMessage(q.error)}</Alert>;
  if (!q.data) return <Skeleton className="h-48 w-full" />;
  const p = q.data;
  const changed = Object.entries(p.diff).filter(([, parts]) => parts.some((x) => x.op !== 'same'));
  return (
    <aside
      className="space-y-3 rounded-lg border bg-muted/30 p-4"
      aria-label={`Last finalised (${p.periodLabel})`}
    >
      <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <History className="size-4" /> Last finalised ({p.periodLabel}) · {p.taskNumber}
      </h4>
      {!p.note ? (
        <p className="text-sm text-muted-foreground">This note is new this period.</p>
      ) : (
        <>
          <p className="text-sm font-medium">{p.note.title}</p>
          {p.note.blocks.map((b) => {
            if (b.type === 'TEXT')
              return (
                <div key={b.id} className="space-y-1">
                  {b.label && <p className="text-xs font-medium italic">{b.label}</p>}
                  <RichTextView doc={b.doc} catalog={p.catalog} indian={indian} />
                </div>
              );
            if (b.type === 'GENERATED') return null;
            if (b.type === 'FIGURES') {
              const f = p.note!.figures[b.id];
              if (!f) return null;
              return (
                <Table key={b.id}>
                  <tbody className="tabular-nums text-xs">
                    {f.groups.flatMap((g) => [
                      ...(g.label
                        ? [
                            <tr key={`${g.id}h`}>
                              <Td colSpan={2} className="py-1 font-semibold italic">
                                {g.label}
                              </Td>
                            </tr>,
                          ]
                        : []),
                      ...g.accounts.map((a) => (
                        <tr key={`${g.id}${a.code}`}>
                          <Td className="py-1">{a.name}</Td>
                          <Td className="py-1 text-right">{statementAmount(a.current, indian)}</Td>
                        </tr>
                      )),
                    ])}
                    <tr className="font-semibold">
                      <Td className="py-1">Total</Td>
                      <Td className="py-1 text-right">
                        {statementAmount(f.total.current, indian)}
                      </Td>
                    </tr>
                  </tbody>
                </Table>
              );
            }
            return (
              <Table key={b.id}>
                <thead>
                  <tr>
                    {b.columns.map((c) => (
                      <Th key={c.id}>
                        {c.period === 'CURRENT'
                          ? p.periodLabel
                          : c.period === 'COMPARATIVE'
                            ? 'Comparative'
                            : c.label}
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-xs">
                  {b.rows.map((r) => (
                    <tr key={r.id}>
                      {b.columns.map((c) => (
                        <Td key={c.id} className="py-1">
                          {r.cells[c.id] ?? ''}
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
            );
          })}
        </>
      )}
      {changed.length > 0 && (
        <div className="space-y-1 border-t pt-2">
          <p className="text-xs font-semibold">What changed in the text</p>
          {changed.map(([id, parts]) => (
            <p key={id} className="text-xs leading-5">
              {parts.map((x, i) =>
                x.op === 'same' ? (
                  <span key={i}>{x.text}</span>
                ) : x.op === 'added' ? (
                  <ins key={i} className="bg-mint text-success no-underline">
                    {x.text === '{figure}' ? '[live figure]' : x.text}
                  </ins>
                ) : (
                  <del key={i} className="bg-red-50 text-destructive">
                    {x.text}
                  </del>
                ),
              )}
            </p>
          ))}
        </div>
      )}
    </aside>
  );
}
