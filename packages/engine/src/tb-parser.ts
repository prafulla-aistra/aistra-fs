import { parseAmountCell } from './amounts';
import { type IsoDate, toIsoDate } from './dates';
import { Decimal } from './money';

/**
 * Trial balance files (Zoho / Xero exports, or any sheet with an "Account Code" column).
 * Pure functions over rows of cells; the API reads the spreadsheet into rows first.
 * Sign convention of the result: debit = positive, credit = negative (CLAUDE.md).
 */
export type Cell = string | number | boolean | null | undefined;

export type SignConvention =
  'DEBIT_POSITIVE' | 'CREDIT_POSITIVE' | 'DRCR_SUFFIX' | 'SEPARATE_COLUMNS';

export interface TbColumnSettings {
  /** 0-based index of the header row. */
  headerRow: number;
  codeColumn: number;
  nameColumn: number;
  /** Single signed balance column (all conventions except SEPARATE_COLUMNS). */
  balanceColumn: number | null;
  debitColumn: number | null;
  creditColumn: number | null;
  /** Account type column (optional; older saved settings have none). */
  typeColumn?: number | null;
  signConvention: SignConvention;
}

export interface TbLayout {
  headerRow: number | null;
  headers: string[];
  /** Detected settings; null if no "Account Code" header was found. */
  settings: TbColumnSettings | null;
  period: { from: IsoDate; to: IsoDate } | { asOf: IsoDate } | null;
  organisation: string | null;
}

export interface TbIssue {
  code: string;
  message: string;
  /** Spreadsheet row numbers (1-based) or account codes involved. */
  rows?: number[];
  accounts?: string[];
}

export interface ParsedTbLine {
  accountCode: string;
  accountName: string;
  /** From the account type column, when there is one. */
  accountType: string | null;
  /** Exact decimal, debit positive / credit negative. */
  amount: string;
  /** 1-based spreadsheet rows (several if a duplicate code was combined). */
  sourceRows: number[];
  zero: boolean;
}

export interface TbParseResult {
  lines: ParsedTbLine[];
  errors: TbIssue[];
  warnings: TbIssue[];
  info: TbIssue[];
  totals: { debits: string; credits: string; difference: string };
  /** Debits equal credits within 0.01. */
  balanced: boolean;
}

/** Tolerance for "debits = credits" (CLAUDE.md: ties to the cent). */
export const TB_BALANCE_TOLERANCE = '0.01';
export const HEADER_SCAN_ROWS = 40;

export function cellText(c: Cell): string {
  if (c === null || c === undefined) return '';
  return String(c)
    .replace(/\u00A0/g, ' ')
    .trim();
}

const norm = (c: Cell) =>
  cellText(c)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const IS_CODE = /^account (code|no|number)$/;
const IS_NAME = /^(account|account name|account description|description|name)$/;
const IS_BALANCE = /^(closing balance|net balance|balance|closing|amount)$/;
const IS_DEBIT = /^(net )?(debit|dr)$/;
const IS_CREDIT = /^(net )?(credit|cr)$/;
const IS_TYPE = /^(account type|type)$/;

function dmyToIso(d: string, m: string, y: string): IsoDate | null {
  try {
    return toIsoDate(Number(y), Number(m), Number(d));
  } catch {
    return null;
  }
}

/** Finds the header row (first 40 rows), the columns, and any period / organisation above it. */
export function detectTbLayout(rows: readonly (readonly Cell[])[]): TbLayout {
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
  let headerRow: number | null = null;
  for (let i = 0; i < limit; i++) {
    if ((rows[i] ?? []).some((c) => IS_CODE.test(norm(c)))) {
      headerRow = i;
      break;
    }
  }

  const above = rows.slice(0, headerRow ?? limit);
  let period: TbLayout['period'] = null;
  let organisation: string | null = null;
  for (const row of above) {
    for (const c of row) {
      const t = cellText(c);
      if (!t) continue;
      const range =
        /from\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+to\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(t);
      const asOf = /as\s+(?:of|at|on)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(t);
      if (!period && range) {
        const from = dmyToIso(range[1]!, range[2]!, range[3]!);
        const to = dmyToIso(range[4]!, range[5]!, range[6]!);
        if (from && to) period = { from, to };
      } else if (!period && asOf) {
        const d = dmyToIso(asOf[1]!, asOf[2]!, asOf[3]!);
        if (d) period = { asOf: d };
      } else if (
        !organisation &&
        !range &&
        !asOf &&
        !/trial balance|basis|currency|report|^page/i.test(t)
      ) {
        organisation = t;
      }
    }
  }

  if (headerRow === null)
    return { headerRow: null, headers: [], settings: null, period, organisation };

  const headers = (rows[headerRow] ?? []).map(cellText);
  const find = (re: RegExp) => headers.findIndex((h) => re.test(norm(h)));
  const codeColumn = find(IS_CODE);
  const nameColumn = find(IS_NAME);
  const balanceColumn = find(IS_BALANCE);
  const debitColumn = find(IS_DEBIT);
  const creditColumn = find(IS_CREDIT);
  const typeColumn = find(IS_TYPE);
  const separate = balanceColumn < 0 && debitColumn >= 0 && creditColumn >= 0;

  return {
    headerRow,
    headers,
    period,
    organisation,
    settings: {
      headerRow,
      codeColumn,
      nameColumn: nameColumn >= 0 ? nameColumn : codeColumn,
      balanceColumn: separate ? null : balanceColumn >= 0 ? balanceColumn : null,
      debitColumn: debitColumn >= 0 ? debitColumn : null,
      creditColumn: creditColumn >= 0 ? creditColumn : null,
      typeColumn: typeColumn >= 0 ? typeColumn : null,
      signConvention: separate ? 'SEPARATE_COLUMNS' : 'DEBIT_POSITIVE',
    },
  };
}

/**
 * Parses the lines under the header with confirmed settings. Blank rows and the totals row
 * are skipped; duplicate account codes are combined (warning); zero lines are kept (info).
 * Rows with an amount but no account code, and non-numeric amounts, are errors.
 */
export function parseTrialBalance(
  rows: readonly (readonly Cell[])[],
  s: TbColumnSettings,
): TbParseResult {
  const errors: TbIssue[] = [];
  const warnings: TbIssue[] = [];
  const info: TbIssue[] = [];
  const byCode = new Map<
    string,
    { name: string; type: string | null; amount: Decimal; rows: number[] }
  >();
  const noCode: number[] = [];
  const skippedTotals: number[] = [];

  const columnError = (label: string) =>
    errors.push({ code: 'COLUMN_MISSING', message: `Choose the ${label} column.` });
  if (s.codeColumn < 0) columnError('account code');
  if (s.signConvention === 'SEPARATE_COLUMNS') {
    if (s.debitColumn === null || s.debitColumn < 0) columnError('debit');
    if (s.creditColumn === null || s.creditColumn < 0) columnError('credit');
  } else if (s.balanceColumn === null || s.balanceColumn < 0) {
    columnError('balance');
  }
  if (errors.length > 0) return result([], errors, warnings, info);

  for (let i = s.headerRow + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const excelRow = i + 1;
    if (row.every((c) => cellText(c) === '')) continue;

    const code = cellText(row[s.codeColumn]);
    const name = cellText(row[s.nameColumn]);
    const amount = readAmount(row, s);

    if (!code) {
      if (/^(grand\s+)?total/i.test(name) || /^(grand\s+)?total/i.test(cellText(row[0]))) {
        skippedTotals.push(excelRow);
        continue;
      }
      if (amount.ok && amount.value.isZero()) continue; // section heading such as "Assets"
      noCode.push(excelRow);
      continue;
    }
    if (!amount.ok) {
      errors.push({
        code: 'NOT_A_NUMBER',
        message: `Row ${excelRow} (${code}): ${amount.reason}.`,
        rows: [excelRow],
      });
      continue;
    }
    if (amount.value.decimalPlaces() > 4) {
      errors.push({
        code: 'TOO_MANY_DECIMALS',
        message: `Row ${excelRow} (${code}): more than 4 decimal places.`,
        rows: [excelRow],
      });
      continue;
    }
    if (amount.value.abs().greaterThanOrEqualTo('1e16')) {
      // NUMERIC(20,4) holds at most 16 digits before the decimal point.
      errors.push({
        code: 'AMOUNT_TOO_LARGE',
        message: `Row ${excelRow} (${code}): the amount is too large.`,
        rows: [excelRow],
      });
      continue;
    }
    const existing = byCode.get(code);
    if (existing) {
      existing.amount = existing.amount.plus(amount.value);
      existing.rows.push(excelRow);
    } else {
      byCode.set(code, {
        name,
        type: s.typeColumn != null ? cellText(row[s.typeColumn]) || null : null,
        amount: amount.value,
        rows: [excelRow],
      });
    }
  }

  if (noCode.length > 0) {
    errors.push({
      code: 'AMOUNT_WITHOUT_ACCOUNT',
      message: `${noCode.length} row(s) have an amount but no account code: row ${noCode.join(', ')}.`,
      rows: noCode,
    });
  }
  if (skippedTotals.length > 0) {
    info.push({
      code: 'TOTALS_SKIPPED',
      message: `Totals row skipped (row ${skippedTotals.join(', ')}).`,
      rows: skippedTotals,
    });
  }
  const dups = [...byCode.entries()].filter(([, v]) => v.rows.length > 1);
  if (dups.length > 0) {
    warnings.push({
      code: 'DUPLICATE_CODES',
      message: `Duplicate account codes were combined: ${dups.map(([c, v]) => `${c} (rows ${v.rows.join(', ')})`).join('; ')}.`,
      accounts: dups.map(([c]) => c),
    });
  }

  const lines: ParsedTbLine[] = [...byCode.entries()].map(([accountCode, v]) => ({
    accountCode,
    accountName: v.name,
    accountType: v.type,
    amount: v.amount.toFixed(),
    sourceRows: v.rows,
    zero: v.amount.isZero(),
  }));
  const zeros = lines.filter((l) => l.zero).map((l) => l.accountCode);
  if (zeros.length > 0) {
    info.push({
      code: 'ZERO_BALANCES',
      message: `${zeros.length} account(s) with a zero balance kept: ${zeros.join(', ')}.`,
      accounts: zeros,
    });
  }
  if (lines.length === 0 && errors.length === 0) {
    errors.push({
      code: 'NO_LINES',
      message: 'No trial balance lines were found under the header row.',
    });
  }
  return result(lines, errors, warnings, info);
}

function readAmount(row: readonly Cell[], s: TbColumnSettings) {
  if (s.signConvention === 'SEPARATE_COLUMNS') {
    const dr = parseAmountCell(row[s.debitColumn!]);
    const cr = parseAmountCell(row[s.creditColumn!]);
    if (!dr.ok) return dr;
    if (!cr.ok) return cr;
    return { ok: true as const, value: dr.value.abs().minus(cr.value.abs()), suffix: null };
  }
  const a = parseAmountCell(row[s.balanceColumn!]);
  if (!a.ok) return a;
  const magnitude = a.value.abs();
  if (a.suffix) return { ...a, value: a.suffix === 'DR' ? magnitude : magnitude.negated() };
  if (s.signConvention === 'DRCR_SUFFIX' && !a.value.isZero()) {
    return {
      ok: false as const,
      reason: `"${cellText(row[s.balanceColumn!])}" has no Dr or Cr suffix`,
    };
  }
  return s.signConvention === 'CREDIT_POSITIVE' ? { ...a, value: a.value.negated() } : a;
}

function result(
  lines: ParsedTbLine[],
  errors: TbIssue[],
  warnings: TbIssue[],
  info: TbIssue[],
): TbParseResult {
  let debits = new Decimal(0);
  let credits = new Decimal(0);
  for (const l of lines) {
    const a = new Decimal(l.amount);
    if (a.isPositive()) debits = debits.plus(a);
    else credits = credits.plus(a.abs());
  }
  const difference = debits.minus(credits);
  return {
    lines,
    errors,
    warnings,
    info,
    totals: {
      debits: debits.toFixed(2),
      credits: credits.toFixed(2),
      difference: difference.toFixed(2),
    },
    balanced: difference.abs().lessThanOrEqualTo(TB_BALANCE_TOLERANCE),
  };
}

/** Does a detected period match the task period? (A single "as of" date must be the period end.) */
export function tbPeriodMatches(
  detected: TbLayout['period'],
  period: { startDate: IsoDate; endDate: IsoDate },
): boolean {
  if (!detected) return true;
  if ('asOf' in detected) return detected.asOf === period.endDate;
  return detected.from === period.startDate && detected.to === period.endDate;
}

/** Loose comparison of an organisation name in the file with the entity's legal name. */
export function sameOrganisation(fileName: string, legalName: string): boolean {
  const n = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(private|pvt|limited|ltd|llc|inc|pte|the)\b/g, '')
      .replace(/[^a-z0-9]/g, '');
  const a = n(fileName);
  const b = n(legalName);
  return a === b || (a.length > 3 && (a.includes(b) || b.includes(a)));
}
