import ExcelJS from 'exceljs';
import type { FormatLine } from '@finance-close/engine';
import {
  type EntityStatementsDto,
  ITEM_STATUS_LABELS,
  type ItemStatus,
} from '@finance-close/shared';
import type { EntityFigures } from './statement-figures';

/**
 * Statements workbook: Cover, then per currency BS, P&L and Notes, then TB (functional, with
 * FSLI mapping), Translation <ccy> and Checks. Figures are real numbers with number formats;
 * subtotals, totals and note totals are SUM formulas over the lines above, so a reviewer can
 * re-perform them. Amounts are exact 2 dp values from the engine; they become Excel numbers
 * only here, at output.
 */
const NUM = '#,##0.00;(#,##0.00);"–"';
const RATE = '0.0000000000';
const num = (v: string | null) => (v === null ? null : Number(v));
const thin: Partial<ExcelJS.Border> = { style: 'thin' };
const double: Partial<ExcelJS.Border> = { style: 'double' };

export interface ExportInput {
  views: EntityStatementsDto[];
  lines: FormatLine[];
  figures: EntityFigures;
  task: { number: string; periodLabel: string };
  itemStatus: ItemStatus;
  exportedBy: string;
  exportedAt: Date;
  fsliNames: Map<string, string>;
}

function header(ws: ExcelJS.Worksheet, rows: string[], widths: number[]) {
  rows.forEach((t, i) => {
    const c = ws.getCell(i + 1, 1);
    c.value = t;
    c.font = { bold: i < 2, size: i === 0 ? 13 : 11 };
  });
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
}

/** A statement sheet; returns the row of each line key (for checks and notes). */
function statementSheet(
  wb: ExcelJS.Workbook,
  name: string,
  v: EntityStatementsDto,
  st: 'BS' | 'PL',
  lines: FormatLine[],
): Map<string, number> {
  const view = st === 'BS' ? v.balanceSheet : v.profitAndLoss;
  const ws = wb.addWorksheet(name);
  header(
    ws,
    [
      v.header.legalName,
      view.title,
      `${v.header.formatName} · ${v.selection.currency} (actual amounts)${v.header.translatedFrom ? ` · ${v.header.translatedFrom}` : ''}`,
    ],
    [64, 8, 20, 20],
  );
  const head = ws.getRow(5);
  head.values = [
    'Particulars',
    'Note',
    v.header.periodLabel,
    v.header.comparativeLabel || 'Comparative',
  ];
  head.font = { bold: true };
  head.eachCell((c) => (c.border = { bottom: thin }));
  ws.views = [{ state: 'frozen', ySplit: 5, xSplit: 1 }];
  const rowOf = new Map<string, number>();
  const byKey = new Map(lines.filter((l) => l.statement === st).map((l) => [l.key, l]));
  let r = 6;
  for (const row of view.rows) {
    const x = ws.getRow(r);
    x.getCell(1).value = row.label;
    x.getCell(1).alignment = { indent: row.indent * 2 };
    if (row.note !== null) x.getCell(2).value = row.note;
    const line = byKey.get(row.key);
    for (const [col, value] of [
      [3, row.current],
      [4, row.comparative],
    ] as const) {
      if (row.type === 'HEADING') continue;
      const cell = x.getCell(col);
      if (row.type === 'TOTAL' && line) {
        const letter = col === 3 ? 'C' : 'D';
        const parts = line.formula
          .filter((p) => rowOf.has(p.key))
          .map((p) => `${p.op === '-' ? '-' : ''}${letter}${rowOf.get(p.key)}`);
        cell.value = {
          formula: parts.length ? `SUM(${parts.join(',')})` : '0',
          result: num(value) ?? 0,
        };
      } else if (value !== null) cell.value = num(value);
      cell.numFmt = NUM;
    }
    if (row.type === 'HEADING') x.font = { bold: true };
    if (row.type === 'TOTAL') {
      const major = row.role !== null;
      x.font = { bold: true };
      for (const col of [3, 4])
        x.getCell(col).border = major ? { top: thin, bottom: double } : { top: thin };
    }
    rowOf.set(row.key, r);
    r++;
  }
  ws.getRow(r + 1).getCell(1).value = v.footer;
  ws.getRow(r + 1).getCell(1).font = { italic: true, size: 9 };
  ws.pageSetup = {
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
  ws.headerFooter = { oddFooter: '&L&A&RPage &P of &N' };
  return rowOf;
}

function notesSheet(
  wb: ExcelJS.Workbook,
  name: string,
  v: EntityStatementsDto,
  faces: { BS: Map<string, number>; PL: Map<string, number> },
  sheetOf: { BS: string; PL: string },
) {
  const ws = wb.addWorksheet(name);
  header(
    ws,
    [
      v.header.legalName,
      `Notes to accounts – ${v.header.periodLabel}`,
      `${v.selection.currency} (actual amounts)`,
    ],
    [14, 56, 20, 20, 20, 16],
  );
  ws.views = [{ state: 'frozen', ySplit: 3 }];
  let r = 5;
  const title = (t: string) => {
    ws.getCell(r, 1).value = t;
    ws.getCell(r, 1).font = { bold: true };
    r++;
  };
  const text = (t: string) => {
    for (const para of t.split(/\n+/)) {
      ws.getCell(r, 1).value = para;
      ws.mergeCells(r, 1, r, 6);
      ws.getCell(r, 1).alignment = { wrapText: true, vertical: 'top' };
      ws.getRow(r).height = Math.max(15, Math.ceil(para.length / 110) * 15);
      r++;
    }
    r++;
  };
  title('Note 1 Corporate information and basis of preparation');
  text(v.notes.note1.text + (v.notes.note1.translation ? `\n${v.notes.note1.translation}` : ''));
  title('Note 2 Significant accounting policies (draft – to be reviewed)');
  text(v.notes.note2.text);
  for (const n of v.notes.lines) {
    title(`Note ${n.number} ${n.label}`);
    const h = ws.getRow(r);
    h.values = [
      'Account',
      'Name',
      v.header.periodLabel,
      v.header.comparativeLabel || 'Comparative',
      'Face',
      'Difference',
    ];
    h.font = { bold: true };
    r++;
    const first = r;
    for (const a of n.accounts) {
      ws.getRow(r).values = [
        a.code,
        a.counterpartyCode
          ? `${a.name} (${a.counterpartyCode} – ${a.counterpartyName ?? ''})`
          : a.name,
        num(a.current),
        num(a.comparative),
      ];
      r++;
    }
    for (const c of n.computed) {
      ws.getRow(r).values = ['', `${c.label} (computed)`, num(c.current), num(c.comparative)];
      ws.getCell(r, 2).font = { italic: true };
      r++;
    }
    const last = r - 1;
    const t = ws.getRow(r);
    t.getCell(2).value = 'Total';
    t.getCell(3).value = {
      formula: last >= first ? `SUM(C${first}:C${last})` : '0',
      result: num(n.total.current) ?? 0,
    };
    t.getCell(4).value = {
      formula: last >= first ? `SUM(D${first}:D${last})` : '0',
      result: num(n.total.comparative) ?? 0,
    };
    const faceRow = faces[n.statement].get(n.key);
    if (faceRow) {
      t.getCell(5).value = {
        formula: `'${sheetOf[n.statement]}'!C${faceRow}`,
        result: num(n.face.current) ?? 0,
      };
      t.getCell(6).value = { formula: `C${r}-E${r}`, result: 0 };
    }
    t.font = { bold: true };
    for (const col of [3, 4]) t.getCell(col).border = { top: thin, bottom: double };
    r += 2;
    for (let i = first; i <= r; i++)
      for (const col of [3, 4, 5, 6]) ws.getCell(i, col).numFmt = NUM;
  }
  if (v.notes.intercompany) {
    title(`Note ${v.notes.intercompany.number} ${v.notes.intercompany.label}`);
    ws.getRow(r).values = ['Counterparty', 'Name', 'Receivable', 'Payable', 'Revenue', 'Charges'];
    ws.getRow(r).font = { bold: true };
    r++;
    for (const row of v.notes.intercompany.rows) {
      ws.getRow(r).values = [
        row.counterpartyCode,
        row.counterpartyName,
        ...Object.values(row.current).map(num),
      ];
      for (const col of [3, 4, 5, 6]) ws.getCell(r, col).numFmt = NUM;
      r++;
    }
    r++;
  }
  if (v.notes.rates) {
    title(`Note ${v.notes.rates.number} Exchange rates used (${v.notes.rates.currencyPair})`);
    ws.getRow(r).values = [
      'Rate',
      '',
      v.header.periodLabel,
      v.header.comparativeLabel || 'Comparative',
    ];
    ws.getRow(r).font = { bold: true };
    r++;
    for (const k of ['opening', 'closing', 'average', 'historical'] as const) {
      ws.getRow(r).values = [
        k[0]!.toUpperCase() + k.slice(1),
        '',
        num(v.notes.rates.current[k]),
        num(v.notes.rates.comparative?.[k] ?? null),
      ];
      for (const col of [3, 4]) ws.getCell(r, col).numFmt = RATE;
      r++;
    }
  }
}

export async function statementsWorkbook(input: ExportInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Finance Close';
  wb.created = input.exportedAt;
  const v0 = input.views[0]!;

  const cover = wb.addWorksheet('Cover');
  cover.getColumn(1).width = 22;
  cover.getColumn(2).width = 70;
  const coverRows: [string, string][] = [
    ['Entity', `${v0.entity.legalName} (${v0.entity.code})`],
    ['Task', input.task.number],
    ['Period', input.task.periodLabel],
    [
      'Comparative',
      `${v0.header.comparativeLabel} · ${v0.header.comparativeSource.label}${v0.header.comparativeSource.taskNumber ? ` (${v0.header.comparativeSource.taskNumber})` : ''}`,
    ],
    [
      'Format',
      `${v0.selection.formatName} (version ${v0.selection.formatVersion})${v0.selection.isTaskFormat ? '' : ' – preview, not the task format'}`,
    ],
    ['Currency', input.views.map((v) => v.selection.currency).join(', ')],
    ['Units', 'Actual amounts'],
    ['Status', ITEM_STATUS_LABELS[input.itemStatus]],
    [
      'Figures',
      v0.fromSnapshot ? 'Stored snapshot (finalised)' : 'Calculated from the trial balance',
    ],
    ['Exported by', input.exportedBy],
    ['Exported at', input.exportedAt.toISOString()],
  ];
  cover.getCell(1, 1).value = 'Statements and notes';
  cover.getCell(1, 1).font = { bold: true, size: 14 };
  coverRows.forEach(([k, val], i) => {
    cover.getCell(i + 3, 1).value = k;
    cover.getCell(i + 3, 1).font = { bold: true };
    cover.getCell(i + 3, 2).value = val;
  });
  cover.getCell(coverRows.length + 4, 1).value = v0.footer;

  const checks: { label: string; formula: string; result: number }[] = [];
  const multi = input.views.length > 1;
  for (const v of input.views) {
    const ccy = v.selection.currency;
    const names = { BS: multi ? `BS ${ccy}` : 'BS', PL: multi ? `P&L ${ccy}` : 'P&L' };
    const faces = {
      BS: statementSheet(wb, names.BS, v, 'BS', input.lines),
      PL: statementSheet(wb, names.PL, v, 'PL', input.lines),
    };
    notesSheet(wb, multi ? `Notes ${ccy}` : 'Notes', v, faces, names);
    const ta = v.balanceSheet.rows.find((r) => r.role === 'TOTAL_ASSETS');
    const tel = v.balanceSheet.rows.find((r) => r.role === 'TOTAL_EQUITY_LIABILITIES');
    if (ta && tel)
      checks.push({
        label: `${ccy}: total equity and liabilities − total assets`,
        formula: `'${names.BS}'!C${faces.BS.get(tel.key)}-'${names.BS}'!C${faces.BS.get(ta.key)}`,
        result: 0,
      });
    const profit = v.profitAndLoss.rows.find((r) => r.role === 'PROFIT');
    if (profit?.tie)
      checks.push({
        label: `${ccy}: profit line − profit carried to the balance sheet`,
        formula: `${Number(profit.tie.current.difference)}`,
        result: Number(profit.tie.current.difference),
      });
  }

  // TB (functional) with the FSLI mapping.
  const fx = input.figures.currencies[0]!;
  const tb = wb.addWorksheet('TB');
  header(
    tb,
    [
      v0.entity.legalName,
      `Trial balance ${input.task.periodLabel} (${fx.currency}, debit +, credit −)`,
    ],
    [14, 44, 16, 40, 14, 20],
  );
  tb.getRow(4).values = ['Account', 'Name', 'FSLI', 'FSLI name', 'Counterparty', 'Amount'];
  tb.getRow(4).font = { bold: true };
  tb.views = [{ state: 'frozen', ySplit: 4 }];
  fx.current.accounts.forEach((a, i) => {
    tb.getRow(5 + i).values = [
      a.code,
      a.name,
      a.fsliCode ?? '(unmapped)',
      a.fsliCode ? (input.fsliNames.get(a.fsliCode) ?? '') : '',
      a.counterpartyCode ?? '',
      num(a.amount),
    ];
    tb.getCell(5 + i, 6).numFmt = NUM;
  });
  const tbTotal = 5 + fx.current.accounts.length;
  tb.getCell(tbTotal, 2).value = 'Total (must be nil)';
  tb.getCell(tbTotal, 6).value = { formula: `SUM(F5:F${tbTotal - 1})`, result: 0 };
  tb.getCell(tbTotal, 6).numFmt = NUM;
  tb.getRow(tbTotal).font = { bold: true };
  checks.push({ label: 'Trial balance nets to zero', formula: `TB!F${tbTotal}`, result: 0 });

  for (const c of input.figures.currencies.filter(
    (x) => x.translatedFrom && x.current.translation,
  )) {
    const ws = wb.addWorksheet(`Translation ${c.currency}`);
    header(
      ws,
      [
        v0.entity.legalName,
        `Translation ${c.translatedFrom} → ${c.currency}, ${input.task.periodLabel}`,
      ],
      [14, 44, 16, 26, 16, 20, 20],
    );
    ws.getRow(4).values = [
      'Account',
      'Name',
      'FSLI',
      'Rate basis',
      'Rate',
      c.translatedFrom!,
      c.currency,
    ];
    ws.getRow(4).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 4 }];
    const names = new Map(c.current.accounts.map((a) => [a.code, a]));
    const t = c.current.translation!;
    t.forEach((l, i) => {
      const a = names.get(l.code);
      ws.getRow(5 + i).values = [
        l.code,
        a?.name ?? '',
        a?.fsliCode ?? '',
        l.basisLabel,
        num(l.rate),
        num(l.functional),
        num(l.translated),
      ];
      ws.getCell(5 + i, 5).numFmt = RATE;
      for (const col of [6, 7]) ws.getCell(5 + i, col).numFmt = NUM;
    });
    const fr = 5 + t.length;
    ws.getRow(fr).values = [
      'FCTR',
      'Foreign currency translation reserve (balancing figure)',
      'FCTR',
      'computed',
      null,
      0,
      num(c.current.fctr),
    ];
    for (const col of [6, 7]) ws.getCell(fr, col).numFmt = NUM;
    const total = fr + 1;
    ws.getCell(total, 2).value = 'Total (must be nil)';
    ws.getCell(total, 6).value = { formula: `SUM(F5:F${fr})`, result: 0 };
    ws.getCell(total, 7).value = { formula: `SUM(G5:G${fr})`, result: 0 };
    for (const col of [6, 7]) ws.getCell(total, col).numFmt = NUM;
    ws.getRow(total).font = { bold: true };
    checks.push({
      label: `Translated TB ${c.currency} nets to zero`,
      formula: `'Translation ${c.currency}'!G${total}`,
      result: 0,
    });
  }

  const ck = wb.addWorksheet('Checks');
  header(ck, [v0.entity.legalName, 'Checks (each must be 0.00)'], [60, 18, 10]);
  ck.getRow(4).values = ['Check', 'Difference', 'OK'];
  ck.getRow(4).font = { bold: true };
  checks.forEach((c, i) => {
    const r = 5 + i;
    ck.getCell(r, 1).value = c.label;
    ck.getCell(r, 2).value = { formula: c.formula, result: c.result };
    ck.getCell(r, 2).numFmt = NUM;
    ck.getCell(r, 3).value = {
      formula: `IF(ROUND(B${r},2)=0,"✓","✗")`,
      result: c.result === 0 ? '✓' : '✗',
    };
  });
  const noteTies = input.views.flatMap((v) =>
    v.notes.lines.map((n) => ({ ccy: v.selection.currency, n })),
  );
  ck.getCell(6 + checks.length, 1).value =
    `Note totals agreeing to the face: ${noteTies.filter((x) => x.n.ties.current).length} of ${noteTies.length}`;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
