import ExcelJS from 'exceljs';
import type { FormatLine } from '@finance-close/engine';
import type { AggregationDto, AggregationRowDto } from '@finance-close/shared';

/**
 * Entity-wise balance sheet and P&L of a consolidation level (step 2), in the level currency.
 * One column per member and an Aggregate column = SUM of the member columns; subtotals and
 * totals are formulas over the lines above (as in the format), so a reviewer can re-perform
 * them. Amounts are exact 2 dp values from the engine; they become Excel numbers only here.
 */
const NUM = '#,##0.00;(#,##0.00);"–"';
const num = (v: string | null) => (v === null ? null : Number(v));
const col = (i: number) => {
  let n = i;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

export async function aggregationWorkbook(
  a: AggregationDto,
  lines: readonly FormatLine[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Finance Close';
  const byKey = new Map(lines.map((l) => [l.key, l]));
  const sheet = (title: string, rows: AggregationRowDto[]) => {
    const ws = wb.addWorksheet(title);
    ws.getCell(1, 1).value =
      `${a.level.taskNumber} · Level ${a.level.level} ${a.level.name} · ${a.level.periodLabel}`;
    ws.getCell(1, 1).font = { bold: true, size: 12 };
    ws.getCell(2, 1).value = `${title} — entity-wise, in ${a.currency} (${a.formatName})`;
    const header = ws.getRow(4);
    header.getCell(1).value = 'Particulars';
    a.entities.forEach((e, i) => (header.getCell(2 + i).value = `${e.code} ${e.shortName}`));
    const aggCol = 2 + a.entities.length;
    header.getCell(aggCol).value = 'Aggregate';
    header.font = { bold: true };
    ws.getColumn(1).width = 48;
    for (let i = 2; i <= aggCol; i++) ws.getColumn(i).width = 18;
    const first = 5;
    const rowOf = new Map(rows.map((r, i) => [r.key, first + i]));
    rows.forEach((r, i) => {
      const x = ws.getRow(first + i);
      x.getCell(1).value = r.label;
      x.getCell(1).alignment = { indent: r.indent * 2 };
      if (r.type === 'HEADING') {
        x.font = { bold: true };
        return;
      }
      const line = byKey.get(r.key);
      a.entities.forEach((e, j) => {
        const c = x.getCell(2 + j);
        const letter = col(2 + j);
        if (r.type === 'TOTAL' && line) {
          const parts = line.formula
            .filter((p) => rowOf.has(p.key))
            .map((p) => `${p.op === '-' ? '-' : ''}${letter}${rowOf.get(p.key)}`);
          c.value = {
            formula: parts.length ? `SUM(${parts.join(',')})` : '0',
            result: num(r.values[e.code] ?? null) ?? 0,
          };
        } else c.value = num(r.values[e.code] ?? null);
        c.numFmt = NUM;
      });
      const agg = x.getCell(aggCol);
      agg.value = {
        formula: a.entities.length
          ? `SUM(${col(2)}${first + i}:${col(aggCol - 1)}${first + i})`
          : '0',
        result: num(r.aggregate) ?? 0,
      };
      agg.numFmt = NUM;
      if (r.type === 'TOTAL') x.font = { bold: true };
    });
  };
  sheet('Balance sheet', a.balanceSheet);
  sheet('Profit and loss', a.profitAndLoss);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
