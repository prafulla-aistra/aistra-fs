import { Decimal } from './money';

/**
 * Comparatives (page 5): which period to compare with, the retained-earnings roll-forward
 * check, and the comparison table with variance flags. Amounts are exact decimal strings,
 * debit positive / credit negative.
 */
export type ComparativeBasis = 'PREVIOUS_PERIOD' | 'SAME_PERIOD_LAST_YEAR';

export interface PeriodRef {
  type: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
  /** 1–12 for months (1 = April), 1–4 for quarters, 1 for the year. */
  sequence: number;
  /** Calendar year the financial year starts in (2026 = FY 2026-27). */
  fyStartYear: number;
}

/**
 * The comparative period. Previous period: month → previous month (April → March of the
 * previous FY), quarter → previous quarter (Q1 → Q4 of the previous FY), year → previous FY.
 * Same period last year: the same month / quarter / year one FY earlier.
 */
export function comparativePeriod(p: PeriodRef, basis: ComparativeBasis): PeriodRef {
  if (basis === 'SAME_PERIOD_LAST_YEAR' || p.type === 'ANNUAL')
    return { ...p, fyStartYear: p.fyStartYear - 1 };
  const last = p.type === 'MONTHLY' ? 12 : 4;
  return p.sequence > 1
    ? { ...p, sequence: p.sequence - 1 }
    : { ...p, sequence: last, fyStartYear: p.fyStartYear - 1 };
}

export interface ClassifiedLine {
  code: string;
  name: string;
  amount: string;
  fsliCode: string | null;
  /** 'BS' | 'PL' of the FSLI (null when unmapped). */
  statement: 'BS' | 'PL' | null;
}

export const RETAINED_FSLI = 'RETAINED';
export const ROLL_FORWARD_TOLERANCE = '1.00';

export type RollForwardStatus = 'PASS' | 'FAIL' | 'NOT_APPLICABLE' | 'NO_COMPARATIVE';

export interface RollForwardResult {
  status: RollForwardStatus;
  /** Current opening retained earnings (sum of RETAINED lines). */
  openingRe: string | null;
  /** Comparative retained earnings and profit (P&L sum: a credit is a profit). */
  priorRe: string | null;
  priorPl: string | null;
  /** priorRe + priorPl, what the opening RE should be. */
  expected: string | null;
  /** openingRe − expected. */
  difference: string | null;
}

const sumWhere = (lines: readonly ClassifiedLine[], f: (l: ClassifiedLine) => boolean) =>
  lines.filter(f).reduce((s, l) => s.plus(l.amount), new Decimal(0));

/**
 * Opening retained earnings must equal the comparative's retained earnings plus its profit
 * for the period, within 1.00. Only meaningful against the immediately preceding period.
 */
export function rollForwardCheck(input: {
  basis: ComparativeBasis;
  current: readonly ClassifiedLine[];
  comparative: readonly ClassifiedLine[] | null;
  tolerance?: string;
}): RollForwardResult {
  const none = { openingRe: null, priorRe: null, priorPl: null, expected: null, difference: null };
  if (input.basis !== 'PREVIOUS_PERIOD') return { status: 'NOT_APPLICABLE', ...none };
  if (!input.comparative) return { status: 'NO_COMPARATIVE', ...none };
  const opening = sumWhere(input.current, (l) => l.fsliCode === RETAINED_FSLI);
  const priorRe = sumWhere(input.comparative, (l) => l.fsliCode === RETAINED_FSLI);
  const priorPl = sumWhere(input.comparative, (l) => l.statement === 'PL');
  const expected = priorRe.plus(priorPl);
  const difference = opening.minus(expected);
  return {
    status: difference.abs().lessThanOrEqualTo(input.tolerance ?? ROLL_FORWARD_TOLERANCE)
      ? 'PASS'
      : 'FAIL',
    openingRe: opening.toFixed(2),
    priorRe: priorRe.toFixed(2),
    priorPl: priorPl.toFixed(2),
    expected: expected.toFixed(2),
    difference: difference.toFixed(2),
  };
}

export type ComparisonTag = 'NEW' | 'NIL_THIS_PERIOD' | null;

export interface ComparisonRow {
  key: string;
  code: string;
  name: string;
  fsliCode: string | null;
  current: string;
  /** null when there is no comparative at all. */
  comparative: string | null;
  variance: string | null;
  /** Variance as % of |comparative|, 1 decimal; null for a nil comparative. */
  variancePct: string | null;
  tag: ComparisonTag;
  flagged: boolean;
}

export interface VarianceRule {
  /** e.g. '0.20' for 20%. */
  pctThreshold: string;
  /** Entity materiality in functional currency. */
  materiality: string;
}

/**
 * A variance is flagged when |variance| ≥ threshold × |comparative| AND |variance| ≥ the
 * materiality amount. A nil comparative is tagged New (not flagged by %). Retained earnings
 * are never flagged: the roll-forward check covers them.
 */
export function varianceFlag(
  current: string,
  comparative: string,
  rule: VarianceRule,
  fsliCode: string | null,
): boolean {
  if (fsliCode === RETAINED_FSLI) return false;
  const comp = new Decimal(comparative);
  if (comp.isZero()) return false;
  const variance = new Decimal(current).minus(comp).abs();
  return (
    variance.greaterThanOrEqualTo(comp.abs().times(rule.pctThreshold)) &&
    variance.greaterThanOrEqualTo(rule.materiality)
  );
}

type Keyed = { key: string; code: string; name: string; fsliCode: string | null; amount: string };

function compare(
  current: readonly Keyed[],
  comparative: readonly Keyed[] | null,
  rule: VarianceRule,
): ComparisonRow[] {
  const cur = new Map(current.map((l) => [l.key, l]));
  const comp = new Map((comparative ?? []).map((l) => [l.key, l]));
  const keys = [...new Set([...cur.keys(), ...comp.keys()])];
  return keys.map((key) => {
    const c = cur.get(key);
    const p = comp.get(key);
    const base = c ?? p!;
    const currentAmount = new Decimal(c?.amount ?? '0');
    if (!comparative) {
      return {
        key,
        code: base.code,
        name: base.name,
        fsliCode: base.fsliCode,
        current: currentAmount.toFixed(2),
        comparative: null,
        variance: null,
        variancePct: null,
        tag: null,
        flagged: false,
      };
    }
    const compAmount = new Decimal(p?.amount ?? '0');
    const variance = currentAmount.minus(compAmount);
    const tag: ComparisonTag =
      (!p || compAmount.isZero()) && !currentAmount.isZero()
        ? 'NEW'
        : (!c || currentAmount.isZero()) && !compAmount.isZero()
          ? 'NIL_THIS_PERIOD'
          : null;
    return {
      key,
      code: base.code,
      name: base.name,
      fsliCode: c?.fsliCode ?? p?.fsliCode ?? null,
      current: currentAmount.toFixed(2),
      comparative: compAmount.toFixed(2),
      variance: variance.toFixed(2),
      variancePct: compAmount.isZero()
        ? null
        : variance.dividedBy(compAmount.abs()).times(100).toDecimalPlaces(1).toFixed(1),
      tag,
      flagged: varianceFlag(currentAmount.toFixed(), compAmount.toFixed(), rule, base.fsliCode),
    };
  });
}

/** Account view: one row per account code (current order, then accounts only in the comparative). */
export function compareAccounts(
  current: readonly ClassifiedLine[],
  comparative: readonly ClassifiedLine[] | null,
  rule: VarianceRule,
): ComparisonRow[] {
  const keyed = (ls: readonly ClassifiedLine[]) => ls.map((l) => ({ ...l, key: l.code }));
  return compare(keyed(current), comparative ? keyed(comparative) : null, rule).sort((a, b) =>
    a.code.localeCompare(b.code),
  );
}

/** FSLI view: lines summed per FSLI (unmapped lines under "—"), in FSLI order. */
export function compareFslis(
  current: readonly ClassifiedLine[],
  comparative: readonly ClassifiedLine[] | null,
  fslis: readonly { code: string; name: string; sortOrder: number }[],
  rule: VarianceRule,
): ComparisonRow[] {
  const order = new Map(fslis.map((f) => [f.code, f]));
  const group = (ls: readonly ClassifiedLine[]) => {
    const by = new Map<string, Decimal>();
    for (const l of ls) {
      const k = l.fsliCode ?? '—';
      by.set(k, (by.get(k) ?? new Decimal(0)).plus(l.amount));
    }
    return [...by.entries()].map(([k, v]) => ({
      key: k,
      code: k,
      name: order.get(k)?.name ?? 'Unmapped',
      fsliCode: k === '—' ? null : k,
      amount: v.toFixed(2),
    }));
  };
  const rank = (code: string) => order.get(code)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  return compare(group(current), comparative ? group(comparative) : null, rule).sort(
    (a, b) => rank(a.code) - rank(b.code),
  );
}

/** Sum of a column: nets to nil for a balanced TB. */
export function columnTotal(amounts: readonly (string | null)[]): string {
  return amounts.reduce((s, a) => (a === null ? s : s.plus(a)), new Decimal(0)).toFixed(2);
}
