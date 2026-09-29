import DecimalJs from 'decimal.js';
import { Decimal } from './money';

/**
 * Amounts read from uploaded files. Exact decimals only — a spreadsheet's numbers are turned
 * into text first and rounded as decimals, never through floating-point arithmetic.
 */
export type ParsedAmount =
  { ok: true; value: Decimal; suffix: 'DR' | 'CR' | null } | { ok: false; reason: string };

const CURRENCY_PREFIX = /^(?:[₹$£€]|INR|USD|GBP|AED|SGD|LKR|EUR)\s*/i;

/**
 * Parses an amount written as text: "1,234.56", "-1234.56", "(1,234.00)" (negative),
 * "1,234.00 Dr" / "1,234.00 Cr", "₹ 1,234.00". Empty text is zero.
 * Indian grouping ("12,40,500.00") works too: separators are simply removed.
 */
export function parseAmountText(input: string): ParsedAmount {
  let s = input.replace(/\u00A0/g, ' ').trim();
  if (s === '' || s === '-' || s === '–') return { ok: true, value: new Decimal(0), suffix: null };

  let suffix: 'DR' | 'CR' | null = null;
  const sfx = /\s*(dr|cr)\.?$/i.exec(s);
  if (sfx) {
    suffix = sfx[1]!.toUpperCase() as 'DR' | 'CR';
    s = s.slice(0, sfx.index).trim();
  }
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(CURRENCY_PREFIX, '').replace(/[,\s]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s))
    return { ok: false, reason: `"${input.trim()}" is not a number` };
  const value = new Decimal(s);
  return { ok: true, value: negative ? value.negated() : value, suffix };
}

/**
 * A numeric spreadsheet cell (already a JS number, as Excel stores it) → exact Decimal,
 * rounded to `dp` places half away from zero. The number's shortest text form is used, so
 * 1234.565 stays 1234.565 and rounds to 1234.57 (floating-point rounding would give 1234.56).
 */
export function spreadsheetNumberToDecimal(n: number, dp = 2): Decimal {
  if (!Number.isFinite(n)) throw new RangeError(`Not a finite number: ${n}`);
  return new Decimal(new DecimalJs(String(n)).toFixed()).toDecimalPlaces(
    dp,
    DecimalJs.ROUND_HALF_UP,
  );
}

/** Any cell value → exact Decimal amount (text parsed, numbers via their text form). */
export function parseAmountCell(cell: unknown): ParsedAmount {
  if (cell === null || cell === undefined || cell === '')
    return { ok: true, value: new Decimal(0), suffix: null };
  if (typeof cell === 'number')
    return { ok: true, value: spreadsheetNumberToDecimal(cell), suffix: null };
  if (typeof cell === 'string') return parseAmountText(cell);
  return { ok: false, reason: `unexpected value ${JSON.stringify(cell)}` };
}
