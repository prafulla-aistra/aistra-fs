import ExcelJS from 'exceljs';
import {
  buildStatement,
  type CheckResult,
  Decimal,
  equityAttribution,
  type FormatLine,
  plainText,
  profitAttribution,
  type RichNode,
} from '@finance-close/engine';
import type { EntityNotesDto } from '@finance-close/shared';
import type { LevelData } from './consolidation.service';
import { levelColumns } from './cfs-statements';

/**
 * Group reporting pack of a level (page 10), laid out like the manual workbooks: Exchange Rates;
 * Entity Wise PL; Entity Wise BS; Eliminations; Consol PL; Consol BS; NCI; Goodwill; Checks;
 * Notes. Figures are real numbers; subtotals are SUM formulas over the lines above and the
 * consolidated column is the SUM of the entity and elimination columns, so a reviewer can
 * re-perform them. Amounts are exact 2 dp engine values; they become Excel numbers only here.
 */
const NUM = '#,##0.00;(#,##0.00);"–"';
const RATE = '0.0000000000';
const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
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

export async function groupPackWorkbook(x: {
  d: LevelData;
  lines: FormatLine[];
  checks: CheckResult[];
  rates: {
    currency: string;
    opening: string | null;
    closing: string | null;
    average: string | null;
    formula: string | null;
  }[];
  notes: EntityNotesDto;
}): Promise<Buffer> {
  const { d, lines } = x;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Finance Close';
  const title = (ws: ExcelJS.Worksheet, t: string) => {
    ws.getCell(1, 1).value =
      `${d.task.number} · Level ${d.level.level} ${d.level.name} · ${d.task.period.label} · ${d.level.currency}`;
    ws.getCell(1, 1).font = { bold: true, size: 12 };
    ws.getCell(2, 1).value = t;
    ws.getColumn(1).width = 48;
  };

  // Exchange Rates
  {
    const ws = wb.addWorksheet('Exchange Rates');
    title(
      ws,
      `Rates into ${d.level.currency} (units of ${d.level.currency} per 1 unit of each currency; cross rates via USD)`,
    );
    ws.getRow(4).values = ['Currency', 'Opening', 'Closing', 'Average', 'Closing formula'];
    ws.getRow(4).font = { bold: true };
    x.rates.forEach((r, i) => {
      const row = ws.getRow(5 + i);
      row.values = [r.currency, num(r.opening), num(r.closing), num(r.average), r.formula ?? ''];
      for (const c of [2, 3, 4]) row.getCell(c).numFmt = RATE;
    });
    for (let i = 2; i <= 5; i++) ws.getColumn(i).width = 18;
  }

  // Entity Wise PL / BS
  const cols = levelColumns(d, true).filter((c) => c.kind !== 'COMPARATIVE');
  const comparative = d.comparative.consolidated;
  const entityWise = (name: string, st: 'BS' | 'PL') => {
    const ws = wb.addWorksheet(name);
    title(
      ws,
      `${st === 'BS' ? 'Balance sheet' : 'Profit and loss'} — entity-wise, eliminations and consolidated (displayed signs)`,
    );
    const parts = cols.filter((c) => c.kind !== 'CONSOLIDATED');
    const header = ws.getRow(4);
    header.getCell(1).value = 'Particulars';
    parts.forEach((c, i) => (header.getCell(2 + i).value = c.label));
    const consCol = 2 + parts.length;
    header.getCell(consCol).value = 'Consolidated';
    header.getCell(consCol + 1).value = comparative
      ? `Comparative ${d.comparative.periodLabel}`
      : 'Comparative';
    header.font = { bold: true };
    for (let i = 2; i <= consCol + 1; i++) ws.getColumn(i).width = 18;
    const built = parts.map((c) => buildStatement(lines, st, c.amounts ?? {}, d.fslis));
    const cons = buildStatement(lines, st, d.consolidated, d.fslis);
    const comp = comparative ? buildStatement(lines, st, comparative, d.fslis) : null;
    const first = 5;
    const rowOf = new Map(cons.rows.map((r, i) => [r.key, first + i]));
    const byKey = new Map(lines.map((l) => [l.key, l]));
    cons.rows.forEach((r, i) => {
      const row = ws.getRow(first + i);
      row.getCell(1).value = r.label;
      row.getCell(1).alignment = { indent: r.indent * 2 };
      if (r.type === 'HEADING') {
        row.font = { bold: true };
        return;
      }
      const line = byKey.get(r.key);
      const cell = (c: number, value: string | null) => {
        const letter = col(c);
        const target = row.getCell(c);
        if (r.type === 'TOTAL' && line) {
          const refs = line.formula
            .filter((p) => rowOf.has(p.key))
            .map((p) => `${p.op === '-' ? '-' : ''}${letter}${rowOf.get(p.key)}`);
          target.value = {
            formula: refs.length ? `SUM(${refs.join(',')})` : '0',
            result: num(value) ?? 0,
          };
        } else target.value = num(value) ?? 0;
        target.numFmt = NUM;
      };
      built.forEach((b, j) => cell(2 + j, b.rows[i]!.value));
      const c = row.getCell(consCol);
      c.value = {
        formula: `SUM(${col(2)}${first + i}:${col(consCol - 1)}${first + i})`,
        result: num(r.value) ?? 0,
      };
      c.numFmt = NUM;
      if (comp) cell(consCol + 1, comp.rows[i]!.value);
      if (r.type === 'TOTAL') row.font = { bold: true };
    });
  };
  entityWise('Entity Wise PL', 'PL');
  entityWise('Entity Wise BS', 'BS');

  // Eliminations
  {
    const ws = wb.addWorksheet('Eliminations');
    title(
      ws,
      'All entries for this level, including those brought forward from lower levels and manual adjustments',
    );
    ws.getRow(4).values = [
      'Entry',
      'Type',
      'Origin level',
      'Entity',
      'FSLI',
      'Counterparty',
      'Dr',
      'Cr',
      'Note',
    ];
    ws.getRow(4).font = { bold: true };
    let r = 5;
    for (const e of d.entries)
      for (const l of e.lines) {
        const a = new Decimal(l.amount);
        const row = ws.getRow(r++);
        row.values = [
          e.title,
          e.type,
          e.originLevel,
          l.entityCode ?? 'Group',
          l.fsliCode,
          l.counterpartyCode ?? '',
          a.isPositive() ? Number(l.amount) : null,
          a.isNegative() ? Number(a.negated().toFixed(2)) : null,
          l.note,
        ];
        row.getCell(7).numFmt = NUM;
        row.getCell(8).numFmt = NUM;
      }
    const t = ws.getRow(r);
    t.getCell(1).value = 'Total';
    t.getCell(7).value = { formula: r > 5 ? `SUM(G5:G${r - 1})` : '0', result: 0 };
    t.getCell(8).value = { formula: r > 5 ? `SUM(H5:H${r - 1})` : '0', result: 0 };
    t.getCell(7).numFmt = NUM;
    t.getCell(8).numFmt = NUM;
    t.font = { bold: true };
    for (const [i, w] of [
      [2, 14],
      [3, 12],
      [4, 10],
      [5, 14],
      [6, 12],
      [7, 16],
      [8, 16],
      [9, 50],
    ] as const)
      ws.getColumn(i).width = w;
  }

  // Consol PL / BS
  const consol = (name: string, st: 'BS' | 'PL') => {
    const ws = wb.addWorksheet(name);
    title(ws, `Consolidated ${st === 'BS' ? 'balance sheet' : 'profit and loss'}`);
    ws.getRow(4).values = [
      'Particulars',
      d.task.period.label,
      comparative ? d.comparative.periodLabel : 'Comparative',
    ];
    ws.getRow(4).font = { bold: true };
    ws.getColumn(2).width = 18;
    ws.getColumn(3).width = 18;
    const cur = buildStatement(lines, st, d.consolidated, d.fslis);
    const comp = comparative ? buildStatement(lines, st, comparative, d.fslis) : null;
    const byKey = new Map(lines.map((l) => [l.key, l]));
    const rowOf = new Map(cur.rows.map((r, i) => [r.key, 5 + i]));
    cur.rows.forEach((r, i) => {
      const row = ws.getRow(5 + i);
      row.getCell(1).value = r.label;
      row.getCell(1).alignment = { indent: r.indent * 2 };
      if (r.type === 'HEADING') return void (row.font = { bold: true });
      const line = byKey.get(r.key);
      for (const [c, v] of [
        [2, r.value],
        [3, comp?.rows[i]!.value ?? null],
      ] as const) {
        const target = row.getCell(c);
        if (r.type === 'TOTAL' && line) {
          const refs = line.formula
            .filter((p) => rowOf.has(p.key))
            .map((p) => `${p.op === '-' ? '-' : ''}${col(c)}${rowOf.get(p.key)}`);
          target.value = {
            formula: refs.length ? `SUM(${refs.join(',')})` : '0',
            result: num(v) ?? 0,
          };
        } else target.value = num(v);
        target.numFmt = NUM;
      }
      if (r.type === 'TOTAL') row.font = { bold: true };
    });
    let r = 6 + cur.rows.length;
    const put = (label: string, a: string | null, b: string | null, bold = false) => {
      const row = ws.getRow(r++);
      row.values = [label, num(a), num(b)];
      row.getCell(2).numFmt = NUM;
      row.getCell(3).numFmt = NUM;
      if (bold) row.font = { bold: true };
    };
    if (st === 'PL') {
      const a = profitAttribution(d.consolidated, d.entries);
      const b = comparative ? profitAttribution(comparative, d.comparative.entries) : null;
      put('Profit attributable to:', null, null, true);
      put('  Owners of the parent', a.owners, b?.owners ?? null);
      put('  Non-controlling interests', a.nci, b?.nci ?? null);
    } else {
      const a = equityAttribution(d.consolidated, d.fslis);
      const b = comparative ? equityAttribution(comparative, d.fslis) : null;
      put('Equity attributable to owners of the parent', a.owners, b?.owners ?? null);
      put('Non-controlling interests', a.nci, b?.nci ?? null);
      put('Total equity', a.total, b?.total ?? null, true);
    }
  };
  consol('Consol PL', 'PL');
  consol('Consol BS', 'BS');

  // NCI
  {
    const ws = wb.addWorksheet('NCI');
    title(
      ws,
      'Non-controlling interests: NCI % × the sub-group’s equity components (Dr) and share of profit',
    );
    ws.getRow(4).values = ['Entry', 'Component', 'Amount'];
    ws.getRow(4).font = { bold: true };
    let r = 5;
    for (const e of d.entries.filter((x) => x.type === 'NCI')) {
      for (const l of e.lines) {
        const row = ws.getRow(r++);
        row.values = [e.title, l.note, Number(l.amount)];
        row.getCell(3).numFmt = NUM;
      }
      const row = ws.getRow(r++);
      row.values = [e.title, 'NCI share of profit for the period', Number(e.nciProfit ?? '0')];
      row.getCell(3).numFmt = NUM;
      row.font = { italic: true };
    }
    ws.getColumn(2).width = 40;
    ws.getColumn(3).width = 18;
  }

  // Goodwill
  {
    const ws = wb.addWorksheet('Goodwill');
    title(ws, 'Goodwill (or capital reserve) by acquisition');
    ws.getRow(4).values = [
      'Acquisition',
      'Goodwill (parent currency)',
      'Parent currency',
      'Closing rate',
      `Amount (${d.level.currency})`,
    ];
    ws.getRow(4).font = { bold: true };
    let r = 5;
    for (const e of d.entries.filter((x) => x.type === 'INVESTMENT')) {
      const row = ws.getRow(r++);
      row.values = [
        e.title,
        num(e.goodwillParent),
        e.parentCurrency ?? '',
        num(e.goodwillRate),
        num(e.goodwill),
      ];
      row.getCell(2).numFmt = NUM;
      row.getCell(4).numFmt = RATE;
      row.getCell(5).numFmt = NUM;
      for (const c of e.calculation) ws.getRow(r++).getCell(1).value = `   ${c}`;
    }
    for (let i = 2; i <= 5; i++) ws.getColumn(i).width = 18;
  }

  // Checks
  {
    const ws = wb.addWorksheet('Checks');
    title(ws, 'Control checks (register severities and thresholds)');
    ws.getRow(4).values = ['Check', 'Severity', 'Result', 'Details'];
    ws.getRow(4).font = { bold: true };
    x.checks.forEach(
      (c, i) => (ws.getRow(5 + i).values = [c.name, c.severity, c.result, c.details]),
    );
    ws.getColumn(4).width = 90;
  }

  // Notes
  {
    const ws = wb.addWorksheet('Notes');
    title(ws, 'Notes to the consolidated financial statements');
    let r = 4;
    for (const n of x.notes.notes.filter((v) => v.number !== null)) {
      ws.getRow(r).getCell(1).value = `${n.number}. ${n.title}`;
      ws.getRow(r++).font = { bold: true };
      for (const b of n.blocks) {
        if (b.type === 'TEXT') {
          const t = plainText(b.doc as unknown as RichNode).trim();
          if (t) ws.getRow(r++).getCell(1).value = t;
        }
        if (b.type === 'GENERATED') {
          const g = n.generated?.[b.id];
          if (!g) continue;
          ws.getRow(r++).values = g.columns.map((c) => c.label);
          for (const row of g.rows) ws.getRow(r++).values = row.cells.map((c) => c ?? '');
        }
      }
      r++;
    }
    ws.getColumn(1).width = 100;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
