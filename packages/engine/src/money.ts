import DecimalJs from 'decimal.js';

/**
 * Engine-wide Decimal constructor.
 *
 * A private clone so the engine's settings never leak into (or get changed by) other
 * code that imports decimal.js. 40 significant digits comfortably covers
 * NUMERIC(20,4) amounts multiplied by NUMERIC(20,10) rates without intermediate loss.
 *
 * Rounding: ROUND_HALF_UP (0.005 → 0.01, -0.005 → -0.01, i.e. half away from zero),
 * matching Excel ROUND. Decided group policy — no banker's rounding (README "Decisions").
 */
export const Decimal = DecimalJs.clone({
  precision: 40,
  rounding: DecimalJs.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});
export type Decimal = InstanceType<typeof Decimal>;

/** Decimal places for presented / translated line amounts (CLAUDE.md). */
export const AMOUNT_DP = 2;

/** Anything the engine accepts as a money or rate value. JS `number` is deliberately excluded. */
export type DecimalInput = string | Decimal;

const DECIMAL_STRING = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/**
 * Converts a string or Decimal to an engine Decimal.
 *
 * Throws for JS numbers (even though the type already forbids them) so floats cannot
 * sneak in through `any` or untyped JSON. It also throws for empty, non-numeric,
 * exponent-notation, NaN and Infinity strings.
 */
export function toDecimal(value: DecimalInput): Decimal {
  if (DecimalJs.isDecimal(value)) {
    const d = new Decimal(value);
    if (!d.isFinite()) throw new RangeError('Amount must be a finite number');
    return d;
  }
  if (typeof value !== 'string') {
    throw new TypeError(
      `Amounts must be passed as strings or Decimals, never as ${typeof value} (floating-point is not allowed for money)`,
    );
  }
  const trimmed = value.trim().replace(/,/g, '');
  if (!DECIMAL_STRING.test(trimmed)) {
    throw new RangeError(`Not a valid decimal amount: "${value}"`);
  }
  return new Decimal(trimmed);
}

/** Rounds to `dp` decimal places using the engine's rounding mode (default 2 dp). */
export function roundAmount(value: DecimalInput, dp: number = AMOUNT_DP): Decimal {
  if (!Number.isInteger(dp) || dp < 0) throw new RangeError('dp must be a non-negative integer');
  return toDecimal(value).toDecimalPlaces(dp);
}

/** Exact sum of amounts. An empty list sums to zero. */
export function sumAmounts(values: Iterable<DecimalInput>): Decimal {
  let total = new Decimal(0);
  for (const v of values) total = total.plus(toDecimal(v));
  return total;
}

/**
 * Sign convention: debit = positive, credit = negative.
 * A trial balance is balanced when its lines net to exactly zero.
 */
export function isBalanced(values: Iterable<DecimalInput>): boolean {
  return sumAmounts(values).isZero();
}
