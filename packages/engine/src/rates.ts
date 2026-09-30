import { addDays, type IsoDate, parseIsoDate, toIsoDate } from './dates';
import { Decimal, toDecimal } from './money';

/**
 * Exchange rates are stored per month as units of currency per 1 USD: opening, closing and
 * average (CLAUDE.md). A month is identified by its first day, e.g. "2026-08-01".
 */
export interface MonthlyRate {
  month: IsoDate;
  currency: string;
  opening: string | null;
  closing: string | null;
  average: string | null;
}

export interface RateWarning {
  month: IsoDate;
  currency: string;
  code: 'OPENING_NOT_PRIOR_CLOSING' | 'LARGE_MOVE';
  message: string;
}

/** A move of more than this (10%) from the prior month is flagged as a possible typo. */
export const RATE_MOVE_THRESHOLD = '0.10';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Aug-26", "Aug-2026", "August 2026", "2026-08", "08/2026" → "2026-08-01"; null if unreadable. */
export function parseRateMonth(input: string): IsoDate | null {
  const s = input.trim().toLowerCase();
  let m = /^([a-z]{3})[a-z]*[-\s/]?(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[1]!) + 1;
    if (month === 0) return null;
    const year = m[2]!.length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return toIsoDate(year, month, 1);
  }
  m = /^(\d{4})-(\d{1,2})(?:-01)?$/.exec(s) ?? null;
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return toIsoDate(Number(m[1]), Number(m[2]), 1);
  m = /^(\d{1,2})\/(\d{4})$/.exec(s);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return toIsoDate(Number(m[2]), Number(m[1]), 1);
  return null;
}

/** First day of the month before. */
export function priorMonth(month: IsoDate): IsoDate {
  const { year, month: m } = parseIsoDate(addDays(month, -1));
  return toIsoDate(year, m, 1);
}

/** First day of the month after. */
export function nextMonth(month: IsoDate): IsoDate {
  const { year, month: m } = parseIsoDate(month);
  return m === 12 ? toIsoDate(year + 1, 1, 1) : toIsoDate(year, m + 1, 1);
}

/** Start year of the Indian financial year (April–March) the month falls in. */
export function fyStartYearOf(month: IsoDate): number {
  const { year, month: m } = parseIsoDate(month);
  return m >= 4 ? year : year - 1;
}

export interface RateMonthReview {
  status: 'COMPLETE' | 'MISSING' | 'LOCKED';
  missing: number;
  checks: {
    currency: string;
    code: 'OPENING_NOT_PRIOR_CLOSING' | 'LARGE_MOVE' | 'MISSING';
    message: string;
  }[];
}

/**
 * One month of the rate master: missing values of the required currencies, opening ≠ prior
 * closing and moves over 10% (checkRates). Locked wins over missing / complete.
 */
export function reviewRateMonth(
  rates: readonly MonthlyRate[],
  month: IsoDate,
  required: readonly string[],
  locked: boolean,
): RateMonthReview {
  const checks: RateMonthReview['checks'] = [];
  let missing = 0;
  for (const c of required) {
    const r = rates.find((x) => x.month === month && x.currency === c);
    const absent = (['opening', 'closing', 'average'] as const).filter((f) => !r?.[f]);
    missing += absent.length;
    if (absent.length > 0)
      checks.push({
        currency: c,
        code: 'MISSING',
        message: `${c} ${monthLabel(month)}: ${absent.join(', ')} missing.`,
      });
  }
  for (const w of checkRates(
    rates.filter((r) => r.month === month || r.month === priorMonth(month)),
  ))
    if (w.month === month) checks.push({ currency: w.currency, code: w.code, message: w.message });
  return { status: locked ? 'LOCKED' : missing > 0 ? 'MISSING' : 'COMPLETE', missing, checks };
}

/** "Aug-2026" for "2026-08-01". */
export function monthLabel(month: IsoDate): string {
  const { year, month: m } = parseIsoDate(month);
  const name = MONTHS[m - 1]!;
  return `${name[0]!.toUpperCase()}${name.slice(1)}-${year}`;
}

/**
 * Checks each month against the month before (same currency):
 *  - opening should equal the prior month's closing;
 *  - closing or average moving more than 10% from the prior month may be a typo.
 */
export function checkRates(rates: readonly MonthlyRate[]): RateWarning[] {
  const byKey = new Map(rates.map((r) => [`${r.currency}:${r.month}`, r]));
  const warnings: RateWarning[] = [];
  const pct = (a: Decimal, b: Decimal) => a.minus(b).abs().dividedBy(b);
  for (const r of rates) {
    const prev = byKey.get(`${r.currency}:${priorMonth(r.month)}`);
    if (!prev) continue;
    const label = `${r.currency} ${monthLabel(r.month)}`;
    if (r.opening && prev.closing && !toDecimal(r.opening).equals(toDecimal(prev.closing))) {
      warnings.push({
        month: r.month,
        currency: r.currency,
        code: 'OPENING_NOT_PRIOR_CLOSING',
        message: `${label}: opening ${r.opening} differs from ${monthLabel(prev.month)} closing ${prev.closing}.`,
      });
    }
    for (const field of ['closing', 'average'] as const) {
      const now = r[field];
      const before = prev[field];
      if (!now || !before || toDecimal(before).isZero()) continue;
      const move = pct(toDecimal(now), toDecimal(before));
      if (move.greaterThan(RATE_MOVE_THRESHOLD)) {
        warnings.push({
          month: r.month,
          currency: r.currency,
          code: 'LARGE_MOVE',
          message: `${label}: ${field} ${now} moved ${move.times(100).toDecimalPlaces(1).toFixed(1)}% from ${before} — possible typo.`,
        });
      }
    }
  }
  return warnings;
}

/** Validates one rate value: a positive decimal with at most 10 decimal places (NUMERIC(20,10)). */
export function validRate(value: string): boolean {
  return /^\d{1,10}(\.\d{1,10})?$/.test(value.trim()) && !toDecimal(value.trim()).isZero();
}

/** First day of every month from `start` to `end` (inclusive), e.g. a quarter → 3 months. */
export function monthsBetween(start: IsoDate, end: IsoDate): IsoDate[] {
  const { year, month } = parseIsoDate(start);
  const out: IsoDate[] = [];
  for (let d = toIsoDate(year, month, 1); d <= end;) {
    out.push(d);
    const p = parseIsoDate(d);
    d = p.month === 12 ? toIsoDate(p.year + 1, 1, 1) : toIsoDate(p.year, p.month + 1, 1);
  }
  return out;
}

export interface RateSheetRow extends MonthlyRate {
  /** 1-based spreadsheet row. */
  row: number;
}

export interface RateSheetResult {
  rates: RateSheetRow[];
  errors: { row: number; message: string }[];
}

type RateCell = string | number | boolean | null | undefined;

const text = (c: RateCell) => (c === null || c === undefined ? '' : String(c).trim());

/** Excel stores a typed "Aug-26" as a date serial number (days since 30 Dec 1899). */
function monthFromCell(c: RateCell): IsoDate | null {
  if (typeof c === 'number' && Number.isInteger(c) && c > 20000 && c < 80000) {
    const iso = addDays('1899-12-30', c);
    const { year, month } = parseIsoDate(iso);
    return toIsoDate(year, month, 1);
  }
  return parseRateMonth(text(c));
}

/** A rate cell → exact decimal text (at most 10 dp), '' when blank, null when not a rate. */
function rateFromCell(c: RateCell): string | null {
  if (c === null || c === undefined || text(c) === '') return '';
  const s =
    typeof c === 'number'
      ? new Decimal(String(c)).toDecimalPlaces(10, Decimal.ROUND_HALF_UP).toFixed()
      : text(c).replace(/,/g, '');
  return validRate(s) ? new Decimal(s).toFixed() : null;
}

/**
 * Reads a rate file with columns Month, Currency, Opening, Closing, Average (header in the
 * first 40 rows; months like "Aug-26" or "2026-08"). A blank rate is "missing", not an error.
 */
export function parseRateSheet(rows: readonly (readonly RateCell[])[]): RateSheetResult {
  const errors: RateSheetResult['errors'] = [];
  const norm = (c: RateCell) => text(c).toLowerCase();
  let header = -1;
  let cols: Record<'month' | 'currency' | 'opening' | 'closing' | 'average', number> = {
    month: -1,
    currency: -1,
    opening: -1,
    closing: -1,
    average: -1,
  };
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const h = (rows[r] ?? []).map(norm);
    const find = (re: RegExp) => h.findIndex((x) => re.test(x));
    const c = {
      month: find(/^month$/),
      currency: find(/^(currency|ccy)$/),
      opening: find(/^opening/),
      closing: find(/^closing/),
      average: find(/^average/),
    };
    if (c.month >= 0 && c.currency >= 0) {
      header = r;
      cols = c;
      break;
    }
  }
  if (header < 0 || cols.opening < 0 || cols.closing < 0 || cols.average < 0) {
    return {
      rates: [],
      errors: [{ row: 0, message: 'Columns needed: Month, Currency, Opening, Closing, Average.' }],
    };
  }
  const seen = new Set<string>();
  const rates: RateSheetRow[] = [];
  for (let r = header + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => text(c) === '')) continue;
    const n = r + 1;
    const month = monthFromCell(row[cols.month]);
    const currency = text(row[cols.currency]).toUpperCase();
    if (!month) {
      errors.push({
        row: n,
        message: `Row ${n}: month "${text(row[cols.month])}" is not readable (use Aug-26 or 2026-08).`,
      });
      continue;
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      errors.push({ row: n, message: `Row ${n}: currency "${currency}" is not a 3-letter code.` });
      continue;
    }
    if (currency === 'USD') continue; // USD is 1 by definition
    const values = {
      opening: rateFromCell(row[cols.opening]),
      closing: rateFromCell(row[cols.closing]),
      average: rateFromCell(row[cols.average]),
    };
    const bad = Object.entries(values)
      .filter(([, v]) => v === null)
      .map(([k]) => k);
    if (bad.length > 0) {
      errors.push({
        row: n,
        message: `Row ${n}: ${bad.join(', ')} must be a positive number (at most 10 decimals).`,
      });
      continue;
    }
    const key = `${currency}:${month}`;
    if (seen.has(key)) {
      errors.push({
        row: n,
        message: `Row ${n}: ${currency} ${monthLabel(month)} appears more than once.`,
      });
      continue;
    }
    seen.add(key);
    rates.push({
      row: n,
      month,
      currency,
      opening: values.opening || null,
      closing: values.closing || null,
      average: values.average || null,
    });
  }
  if (rates.length === 0 && errors.length === 0)
    errors.push({ row: 0, message: 'The file has no rates.' });
  return { rates, errors };
}

export type RateKind = 'opening' | 'closing' | 'average';

/**
 * A currency's rate per 1 USD for a period (CLAUDE.md): opening = first month's opening,
 * closing = last month's closing, average = simple mean of the monthly averages. USD is 1.
 * `missing` lists the monthly figures that are not entered ("INR Aug-2026 closing").
 */
export function periodUsdRate(
  rates: readonly MonthlyRate[],
  period: { startDate: IsoDate; endDate: IsoDate },
  currency: string,
  kind: RateKind,
): { value: Decimal | null; missing: string[] } {
  if (currency === 'USD') return { value: new Decimal(1), missing: [] };
  const months = monthsBetween(period.startDate, period.endDate);
  const get = (m: IsoDate) =>
    rates.find((r) => r.currency === currency && r.month === m)?.[kind] ?? null;
  const pick = kind === 'opening' ? [months[0]!] : kind === 'closing' ? [months.at(-1)!] : months;
  const values = pick.map((m) => ({ m, v: get(m) }));
  const missing = values
    .filter((x) => x.v === null)
    .map((x) => `${currency} ${monthLabel(x.m)} ${kind}`);
  if (missing.length > 0) return { value: null, missing };
  const sum = values.reduce((s, x) => s.plus(x.v!), new Decimal(0));
  return { value: sum.dividedBy(values.length), missing: [] };
}

/** Rate text for formulas: at least 2 decimals, no trailing zeros beyond that ("86.90", "1"). */
function rateText(d: Decimal): string {
  if (d.equals(1)) return '1';
  const t = d.toDecimalPlaces(10).toFixed();
  const dp = t.includes('.') ? t.split('.')[1]!.length : 0;
  return dp >= 2 ? t : d.toFixed(2);
}

export interface CrossRate {
  /** Units of `to` per 1 unit of `from`, 10 decimals; null if a rate is missing. */
  value: string | null;
  /** How it was derived, e.g. "1 ÷ 86.90" (units of `to` per USD ÷ units of `from` per USD). */
  formula: string | null;
  missing: string[];
}

/** Cross rate from the USD rate master: A→B = (units of B per USD) ÷ (units of A per USD). */
export function crossRate(
  rates: readonly MonthlyRate[],
  period: { startDate: IsoDate; endDate: IsoDate },
  from: string,
  to: string,
  kind: RateKind,
): CrossRate {
  const a = periodUsdRate(rates, period, from, kind);
  const b = periodUsdRate(rates, period, to, kind);
  const missing = [...a.missing, ...b.missing];
  if (!a.value || !b.value) return { value: null, formula: null, missing };
  return {
    value: b.value.dividedBy(a.value).toDecimalPlaces(10, Decimal.ROUND_HALF_UP).toFixed(10),
    formula: `${rateText(b.value)} ÷ ${rateText(a.value)}`,
    missing,
  };
}
