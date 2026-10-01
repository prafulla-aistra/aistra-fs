import { CircleCheck, CircleX } from 'lucide-react';
import type { EntityStatementsDto, StatementRowDto, StatementViewDto } from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { statementAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import { indianUnits } from './units';
import { QueryMarker } from '../review/ReviewStep';

export function TitleBlock({ d, title }: { d: EntityStatementsDto; title: string }) {
  return (
    <div className="mb-4 text-center">
      <p className="text-base font-semibold text-ink">{d.header.legalName}</p>
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      <p className="text-xs text-muted-foreground">
        {d.header.formatName} · {d.header.currencyUnits}
        {d.header.translatedFrom && <> · {d.header.translatedFrom}</>}
      </p>
    </div>
  );
}

function Tie({ row, d }: { row: StatementRowDto; d: EntityStatementsDto }) {
  if (!row.tie) return null;
  const t = row.tie.current;
  return t.ok ? (
    <span title={row.tie.text}>
      <CircleCheck className="ml-1 inline size-4 text-success" aria-label={row.tie.text} />
    </span>
  ) : (
    <span
      className="ml-1 inline-flex items-center gap-0.5 text-xs text-destructive"
      title={row.tie.text}
    >
      <CircleX className="size-4" aria-label={`${row.tie.text}: does not agree`} />
      difference {statementAmount(t.difference, indianUnits(d))}
    </span>
  );
}

/** One statement: Particulars | Note | current | comparative, styled from the format. */
export function StatementView({
  d,
  view,
  onNote,
  queries,
}: {
  d: EntityStatementsDto;
  view: StatementViewDto;
  onNote: (n: number) => void;
  /** Open review queries per line key. */
  queries?: (lineKey: string) => number;
}) {
  const prefix = view === d.balanceSheet ? 'BS' : 'PL';
  const indian = indianUnits(d);
  const hasComparative = d.header.noComparative === null;
  return (
    <section className="statement-page rounded-lg border bg-card p-6" aria-label={view.title}>
      <TitleBlock d={d} title={view.title} />
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="py-2 text-left font-medium">Particulars</th>
            <th className="w-14 py-2 text-center font-medium">Note</th>
            <th className="w-44 py-2 text-right font-medium">{d.header.periodLabel}</th>
            <th className="w-44 py-2 text-right font-medium">
              <span className="inline-flex flex-col items-end gap-0.5">
                {d.header.comparativeLabel}
                <Badge variant={hasComparative ? 'outline' : 'neutral'} className="no-print">
                  {hasComparative
                    ? `${d.header.comparativeSource.label}${d.header.comparativeSource.taskNumber ? ` · ${d.header.comparativeSource.taskNumber}` : ''}`
                    : 'No comparative'}
                </Badge>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r) => {
            const total = r.type === 'TOTAL';
            const major = total && r.role !== null;
            const cell = (v: string | null) => (
              <span
                className={cn(
                  'inline-block min-w-32 py-0.5 text-right',
                  total && 'border-t border-foreground/60',
                  major && 'border-b-[3px] border-double border-b-foreground/70',
                )}
              >
                {statementAmount(v, indian)}
              </span>
            );
            return (
              <tr
                key={r.key}
                data-row={r.key}
                className={cn(
                  r.type === 'HEADING' && 'font-semibold text-ink',
                  total && 'font-semibold',
                )}
              >
                <td className="py-1" style={{ paddingLeft: `${r.indent * 1.25}rem` }}>
                  {r.note !== null ? (
                    <button
                      type="button"
                      className="text-left hover:text-primary hover:underline"
                      onClick={() => onNote(r.note!)}
                      title={`Go to note ${r.note}`}
                    >
                      {r.label}
                    </button>
                  ) : (
                    r.label
                  )}
                  {(queries?.(`${prefix}:${r.key}`) ?? 0) > 0 && (
                    <QueryMarker count={queries!(`${prefix}:${r.key}`)} />
                  )}
                </td>
                <td className="py-1 text-center">
                  {r.note !== null && (
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => onNote(r.note!)}
                    >
                      {r.note}
                    </button>
                  )}
                </td>
                <td className="py-1 text-right whitespace-nowrap">
                  {r.type !== 'HEADING' && cell(r.current)}
                  <Tie row={r} d={d} />
                </td>
                <td className="py-1 text-right whitespace-nowrap">
                  {r.type !== 'HEADING' && hasComparative && cell(r.comparative)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!hasComparative && (
        <p className="mt-2 text-right text-xs text-muted-foreground">No comparative</p>
      )}
      {d.roundingNote && <p className="mt-3 text-xs text-muted-foreground">{d.roundingNote}</p>}
    </section>
  );
}
