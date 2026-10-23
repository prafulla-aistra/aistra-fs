import { Decimal, roundAmount } from './money';
import { type Cell, cellText } from './tb-parser';

/**
 * Veracity Group (Xero, not connected): the month's trial balance is built from two files, as in
 * "Veracity Group – Monthly Financial Statements Process":
 *
 *  - Veracity Category (Sheet1: A Name, B Category, one column per month) → the P&L for the
 *    month, each account under its category (the client grouping).
 *  - VSCON (tab "Notes": A Code, C Description, F Group USD, notes 7–12 and the Investment group;
 *    tab "BS": the balance sheet summary, B line, C note, D amount; tab "PL": Profit after Tax,
 *    Group 12 months in column H) → the balance sheet, at the note lines.
 *
 * Current Year Profit is replaced by this month's P&L plus one line for the profit of earlier
 * months (YTD-PRIOR), so the TB is a period TB like the Zoho ones. A difference left in the VSCON
 * balance sheet (and rounding) is shown on its own line, VG-DIFF, never hidden. Every line keeps
 * its source (file › tab › cell) and every check of the process is returned.
 */

export interface VeracityLine {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  /** Signed, debit +, 2 dp. */
  amount: string;
  /** The client grouping (category / balance-sheet line) used for mapping. */
  grouping: string;
  source: string;
}

export interface VeracityCheck {
  code: string;
  label: string;
  value: string;
  expected: string;
  passed: boolean;
  source: string;
}

export interface VeracityResult {
  lines: VeracityLine[];
  checks: VeracityCheck[];
  /** Blocking: a file could not be read. */
  problems: string[];
  monthProfit: string;
  priorProfit: string;
  /** VSCON balance-sheet difference + rounding, on line VG-DIFF (0.00 when none). */
  difference: string;
  monthColumn: string | null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const colLetter = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const dec = (v: Cell): Decimal => {
  if (v === null || v === undefined || v === '') return new Decimal(0);
  if (typeof v === 'number') return new Decimal(v.toPrecision(15));
  const t = String(v).replace(/,/g, '').trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? new Decimal(t) : new Decimal(0);
};
const two = (d: Decimal) => roundAmount(d);

/** The month column of the Category file, e.g. "Aug'26" for a period ending in August 2026. */
export function categoryMonthLabel(periodEnd: string): string {
  const [y, m] = periodEnd.split('-');
  const mon = MONTHS[Number(m) - 1]!;
  return `${mon[0]!.toUpperCase()}${mon.slice(1)}'${y!.slice(2)}`;
}

function findMonthColumn(header: readonly Cell[], periodEnd: string): number {
  const [y, m] = periodEnd.split('-');
  const mon = MONTHS[Number(m) - 1]!;
  const yy = y!.slice(2);
  return header.findIndex((h) => {
    const t = norm(cellText(h)).replace(/\s/g, '');
    return t.startsWith(mon) && (t.endsWith(`'${yy}`) || t.endsWith(yy) || t.endsWith(y!));
  });
}

const slug = (s: string) =>
  s
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);

type Section =
  'PPE' | 'INVESTMENT' | 'RECEIVABLES' | 'BANKS' | 'PAYABLES' | 'EQUITY' | 'LONG_TERM' | null;
const SECTION_OF: [RegExp, Section][] = [
  [/property plant|^note 7$/, 'PPE'],
  [/^investment/, 'INVESTMENT'],
  [/receivable|^note 8$/, 'RECEIVABLES'],
  [/^bank|^note 9$/, 'BANKS'],
  [/payable|^note 10$/, 'PAYABLES'],
  [/^equity|^note 11$/, 'EQUITY'],
  [/long term|^note 12$/, 'LONG_TERM'],
];
const sectionType = (s: Section): VeracityLine['type'] =>
  s === 'PAYABLES' || s === 'LONG_TERM' ? 'liability' : s === 'EQUITY' ? 'equity' : 'asset';

function groupingFor(section: Section, code: string, desc: string): string {
  const d = norm(desc);
  switch (section) {
    case 'PPE':
      return 'Property, Plant and Equipments (Net)';
    case 'INVESTMENT':
      return /fixed deposit/.test(d) ? 'Cash and Cash Equivalents' : 'Investment';
    case 'RECEIVABLES':
      return /^accounts receivable/.test(d) ? 'Accounts Receivable' : 'Other Current Assets';
    case 'BANKS':
      return 'Cash and Cash Equivalents';
    case 'PAYABLES':
      return /^accounts payable/.test(d) ? 'Accounts Payable' : 'Other Current Liabilities';
    case 'EQUITY':
      return /retained/.test(d) ? 'Retained Earnings' : 'Common Shares';
    case 'LONG_TERM':
      return /gratuity/.test(d)
        ? 'Provisions – non-current'
        : /deferred tax/.test(d)
          ? 'Deferred tax liabilities (net)'
          : 'Deferred Revenue';
    default:
      return code;
  }
}

interface NoteLine {
  code: string;
  desc: string;
  section: Section;
  amount: Decimal;
  row: number;
}

/** VSCON › Notes: the balance-sheet note lines (A Code, C Description, F Group USD). */
export function readVsconNotes(rows: readonly (readonly Cell[])[]): {
  lines: NoteLine[];
  currentYearProfit: { amount: Decimal; row: number } | null;
} {
  const start = rows.findIndex((r) => /note to the balance sheet/i.test(cellText(r[0])));
  const lines: NoteLine[] = [];
  let section: Section = null;
  let cyp: { amount: Decimal; row: number } | null = null;
  for (let i = Math.max(start, 0); i < rows.length; i++) {
    const r = rows[i] ?? [];
    const a = cellText(r[0]).trim();
    const b = norm(cellText(r[1]));
    const c = cellText(r[2]).trim();
    if (/^note 13$/.test(b)) break; // income tax: not a balance-sheet note
    if (!a) {
      const head = b || norm(c);
      const hit = SECTION_OF.find(([re]) => re.test(head) || re.test(norm(c)));
      if (hit && (b.startsWith('note') || /^investment/.test(norm(c)))) section = hit[1];
      if (/^current year profit$/.test(norm(c))) cyp = { amount: dec(r[5]), row: i + 1 };
      continue;
    }
    if (section) lines.push({ code: a, desc: c, section, amount: dec(r[5]), row: i + 1 });
  }
  return { lines, currentYearProfit: cyp };
}

/** VSCON › BS: the balance sheet summary (B line, C note, D amount). */
export function readVsconSummary(rows: readonly (readonly Cell[])[]) {
  const out: { label: string; amount: Decimal; row: number }[] = [];
  rows.forEach((r, i) => {
    const label = cellText(r?.[1]).trim();
    if (label && typeof r?.[3] === 'number') out.push({ label, amount: dec(r[3]), row: i + 1 });
  });
  return out;
}

/** VSCON › PL: "Profit after Tax", Group 12 months (column H). */
export function readVsconProfitAfterTax(rows: readonly (readonly Cell[])[]) {
  const i = rows.findIndex((r) => norm(cellText(r?.[1])) === 'profit after tax');
  return i < 0 ? null : { amount: dec(rows[i]![7]), row: i + 1 };
}

export function buildVeracityTb(input: {
  periodEnd: string;
  category: { rows: readonly (readonly Cell[])[]; fileName: string; sheet: string };
  vscon: {
    notes: readonly (readonly Cell[])[];
    summary: readonly (readonly Cell[])[] | null;
    pl: readonly (readonly Cell[])[] | null;
    fileName: string;
  };
}): VeracityResult {
  const problems: string[] = [];
  const lines: VeracityLine[] = [];
  const checks: VeracityCheck[] = [];
  const empty = (p: string): VeracityResult => ({
    lines: [],
    checks: [],
    problems: [p],
    monthProfit: '0.00',
    priorProfit: '0.00',
    difference: '0.00',
    monthColumn: null,
  });

  // ---- P&L: Veracity Category
  const cat = input.category;
  const header = cat.rows[0] ?? [];
  const nameCol = header.findIndex((h) => norm(cellText(h)) === 'name');
  const catCol = header.findIndex((h) => /^cat[e]?[o]?g[o]?r/.test(norm(cellText(h))));
  const mCol = findMonthColumn(header, input.periodEnd);
  if (nameCol < 0 || catCol < 0)
    return empty(`${cat.fileName}: no "Name" and "Category" columns in the first row.`);
  if (mCol < 0)
    return empty(
      `${cat.fileName}: no column for ${categoryMonthLabel(input.periodEnd)} in the first row (columns: ${header
        .map((h) => cellText(h))
        .filter(Boolean)
        .join(', ')}).`,
    );
  const usedCodes = new Set<string>();
  let income = new Decimal(0);
  let expense = new Decimal(0);
  cat.rows.slice(1).forEach((r, i) => {
    const name = cellText(r?.[nameCol]).trim();
    const category = cellText(r?.[catCol]).trim();
    if (!name) return;
    const v = dec(r?.[mCol]);
    if (v.isZero()) return;
    const isIncome = /^(revenue|other income)/i.test(category);
    let code = `VC-${slug(name)}`;
    for (let n = 2; usedCodes.has(code); n++) code = `VC-${slug(name).slice(0, 33)}-${n}`;
    usedCodes.add(code);
    if (isIncome) income = income.plus(v);
    else expense = expense.plus(v);
    lines.push({
      code,
      name,
      type: isIncome ? 'income' : 'expense',
      amount: two(isIncome ? v.negated() : v).toFixed(2),
      grouping: category,
      source: `${cat.fileName} › ${cat.sheet} › row ${i + 2}, column ${colLetter(mCol)} (${cellText(header[mCol])})`,
    });
  });
  const monthProfit = income.minus(expense);

  // ---- Balance sheet: VSCON Notes
  const notes = readVsconNotes(input.vscon.notes);
  if (notes.lines.length === 0)
    return empty(`${input.vscon.fileName}: no balance-sheet notes found in the "Notes" tab.`);
  for (const n of notes.lines) {
    if (n.amount.isZero()) continue;
    const t = sectionType(n.section);
    const amt = t === 'asset' ? n.amount : n.amount.negated();
    lines.push({
      code: n.code,
      name: n.desc,
      type: t,
      amount: two(amt).toFixed(2),
      grouping: groupingFor(n.section, n.code, n.desc),
      source: `${input.vscon.fileName} › Notes › F${n.row}`,
    });
  }
  const cyp = notes.currentYearProfit;
  if (!cyp) problems.push(`${input.vscon.fileName}: no "Current Year Profit" line in Note 11.`);
  const cypAmt = cyp?.amount ?? new Decimal(0);
  const prior = cypAmt.minus(monthProfit);
  if (!two(prior).isZero())
    lines.push({
      code: 'YTD-PRIOR',
      name: 'Profit of earlier months this year (VSCON current year profit less this month)',
      type: 'equity',
      amount: two(prior.negated()).toFixed(2),
      grouping: 'Retained Earnings',
      source: `${input.vscon.fileName} › Notes › F${cyp?.row ?? '?'} (Current Year Profit) less this month's P&L`,
    });

  // VSCON balance-sheet difference and rounding: its own line, never spread over others.
  const net = lines.reduce((s, l) => s.plus(l.amount), new Decimal(0));
  if (!net.isZero())
    lines.push({
      code: 'VG-DIFF',
      name: 'Difference in the VSCON balance sheet and rounding',
      type: 'equity',
      amount: net.negated().toFixed(2),
      grouping: 'Retained Earnings',
      source: `${input.vscon.fileName} › BS (assets − equity − liabilities) and rounding to 2 dp`,
    });

  // ---- Checks of the process
  const sumOf = (pred: (n: NoteLine) => boolean) =>
    notes.lines.filter(pred).reduce((s, n) => s.plus(n.amount), new Decimal(0));
  const summary = input.vscon.summary ? readVsconSummary(input.vscon.summary) : [];
  const SUMMARY_CHECKS: [string, RegExp, (n: NoteLine) => boolean][] = [
    ['Note 7 PPE', /property plant/i, (n) => n.section === 'PPE'],
    ['Note 8 Receivables', /^receivables/i, (n) => n.section === 'RECEIVABLES'],
    ['Note 9 Bank', /^bank/i, (n) => n.section === 'BANKS'],
    ['Fixed Deposits (Investment group)', /^fixed deposits/i, (n) => n.section === 'INVESTMENT'],
    ['Note 10 Payables', /^payables/i, (n) => n.section === 'PAYABLES'],
    ['Note 11 Equity', /^equity$/i, (n) => n.section === 'EQUITY'],
    ['Gratuity', /^gratuity/i, (n) => n.section === 'LONG_TERM' && /gratuity/i.test(n.desc)],
    [
      'Deferred Liability',
      /^deferred liability/i,
      (n) => n.section === 'LONG_TERM' && /deferred tax/i.test(n.desc),
    ],
  ];
  for (const [label, re, pred] of SUMMARY_CHECKS) {
    const s = summary.find((x) => re.test(x.label));
    let mine = sumOf(pred);
    if (label === 'Note 11 Equity') mine = mine.plus(cypAmt);
    checks.push({
      code: 'NOTE_EQUALS_SUMMARY',
      label: `${label} = balance sheet summary`,
      value: two(mine).toFixed(2),
      expected: s ? two(s.amount).toFixed(2) : '—',
      passed: !!s && two(mine).minus(two(s.amount)).abs().lessThan('0.01'),
      source: s
        ? `${input.vscon.fileName} › BS › D${s.row}`
        : `${input.vscon.fileName} › BS: line not found`,
    });
  }
  const assets = sumOf((n) => sectionType(n.section) === 'asset');
  const liabEq = sumOf((n) => sectionType(n.section) !== 'asset').plus(cypAmt);
  checks.push({
    code: 'ASSETS_EQUAL_EQUITY_LIABILITIES',
    label: 'Total assets = equity + liabilities',
    value: two(assets).toFixed(2),
    expected: two(liabEq).toFixed(2),
    passed: two(assets).minus(two(liabEq)).abs().lessThan('0.01'),
    source: `${input.vscon.fileName} › Notes (column F)`,
  });
  const pat = input.vscon.pl ? readVsconProfitAfterTax(input.vscon.pl) : null;
  checks.push({
    code: 'CURRENT_YEAR_PROFIT',
    label: 'Current Year Profit (Note 11) = profit after tax (Group, 12 months)',
    value: two(cypAmt).toFixed(2),
    expected: pat ? two(pat.amount).toFixed(2) : '—',
    passed: !!pat && two(cypAmt).minus(two(pat.amount)).abs().lessThan('0.01'),
    source: pat
      ? `${input.vscon.fileName} › PL › H${pat.row}`
      : `${input.vscon.fileName} › PL: "Profit after Tax" not found`,
  });
  const diff = lines.find((l) => l.code === 'VG-DIFF')?.amount ?? '0.00';
  return {
    lines,
    checks,
    problems,
    monthProfit: two(monthProfit).toFixed(2),
    priorProfit: two(prior).toFixed(2),
    difference: diff,
    monthColumn: cellText(header[mCol]),
  };
}

/** The TB as a CSV the upload step reads (Code, Name, Type, Amount) plus a Source column. */
export function veracityTbCsv(input: {
  entityName: string;
  periodStart: string;
  periodEnd: string;
  files: string;
  lines: readonly VeracityLine[];
}): string {
  const cell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  const rows = [
    [input.entityName],
    ['Trial Balance'],
    [`From ${dmy(input.periodStart)} To ${dmy(input.periodEnd)}`],
    [`Source: ${input.files}`],
    [],
    ['Account Code', 'Account Name', 'Account Type', 'Amount (Dr-Cr)', 'Source'],
    ...input.lines.map((l) => [l.code, l.name, l.type, l.amount, l.source]),
  ];
  return `${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
