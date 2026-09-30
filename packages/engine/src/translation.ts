import { Decimal } from './money';
import { type IsoDate } from './dates';
import { monthLabel, monthsBetween, type MonthlyRate, periodUsdRate, type RateKind } from './rates';

/**
 * Currency translation of a mapped trial balance (Ind AS 21 / IAS 21, CLAUDE.md), page 6.
 *
 *   assets and liabilities → closing; income and expenses → average;
 *   share capital and premium → historical (opening, with a warning, if there is none);
 *   other reserves → opening; retained earnings → rolled forward from the finalised prior
 *   translation when the roll-forward check passed, else opening (with a warning);
 *   PROFIT = sum of translated P&L; FCTR = −(translated balance sheet + PROFIT), so the
 *   translated TB nets to exactly 0.00.
 *
 * Rates are used at full precision (decimal.js, 40 significant digits) and never rounded
 * before multiplying; each translated line is rounded to 2 dp, half away from zero.
 */
export type RateBasisCode =
  'CLOSING' | 'AVERAGE' | 'HISTORICAL' | 'OPENING' | 'ROLL_FORWARD' | 'COMPUTED';

export interface TranslationLineInput {
  code: string;
  name: string;
  fsliCode: string | null;
  fsliClass: 'A' | 'L' | 'E' | 'I' | 'X' | null;
  statement: 'BS' | 'PL' | null;
  /** The FSLI's default rate basis. */
  fsliRateBasis: RateBasisCode | null;
  /** The account's override, if any. */
  rateBasisOverride: RateBasisCode | null;
  counterpartyCode: string | null;
  /** Functional currency, debit + / credit −. */
  amount: string;
}

export interface PriorTranslation {
  periodLabel: string;
  /** Translated retained earnings and profit (signed, credit −) of the finalised prior period. */
  retained: string;
  profit: string;
}

export interface TranslateTbInput {
  functionalCurrency: string;
  targetCurrency: string;
  period: { startDate: IsoDate; endDate: IsoDate; label: string };
  /** Units of currency per 1 USD, per month. */
  rates: readonly MonthlyRate[];
  /** 1 unit of functional currency = this many target units (entity master); null if none. */
  historicalRate: string | null;
  lines: readonly TranslationLineInput[];
  /** The finalised prior-period translation in the same target currency, if any. */
  prior: PriorTranslation | null;
  /** Label of the prior period, for messages ("Jul-2026"). */
  priorPeriodLabel: string;
  /** The retained-earnings roll-forward check (page 5) passed. */
  rollForwardPassed: boolean;
}

export interface RateUsed {
  /** Full precision (for audit); display uses `value`. */
  full: string | null;
  /** 10 decimals. */
  value: string | null;
  formula: string | null;
  /** Months the rate comes from ("Jul-2026"; three months for a quarter's average). */
  sourceMonths: string[];
  missing: string[];
}

export interface TranslatedLine {
  code: string;
  name: string;
  fsliCode: string | null;
  basis: RateBasisCode;
  basisLabel: string;
  overridden: boolean;
  /** 10 decimals; null for rolled-forward lines. */
  rate: string | null;
  functional: string;
  translated: string;
}

export interface TranslationSummary {
  /** Presentation signs: assets positive; liabilities and equity positive when credit. */
  totalAssets: string;
  totalLiabilities: string;
  shareCapitalAndPremium: string;
  retainedEarnings: string;
  otherReserves: string;
  profit: string;
  fctr: string;
  totalEquity: string;
  /** Assets = liabilities + equity. */
  balanced: boolean;
}

export interface TranslateTbResult {
  status: 'OK' | 'FAIL';
  failures: string[];
  rates: { opening: RateUsed; closing: RateUsed; average: RateUsed; historical: RateUsed };
  lines: TranslatedLine[];
  /** Translated amount per FSLI (signed). */
  fsliTotals: { fsliCode: string; functional: string; translated: string }[];
  /** Signed: a credit (negative) is a profit. */
  profit: string | null;
  /** Signed balancing figure (debit +). */
  fctr: string | null;
  totals: { functional: string; translated: string | null };
  summary: TranslationSummary | null;
  reMethod: { kind: 'ROLL_FORWARD' | 'OPENING_RATE' | 'SAME_CURRENCY' | 'NONE'; text: string };
  warnings: string[];
}

const BASIS_LABEL: Record<RateBasisCode, string> = {
  CLOSING: 'closing',
  AVERAGE: 'average',
  HISTORICAL: 'historical',
  OPENING: 'opening',
  ROLL_FORWARD: 'roll-forward',
  COMPUTED: 'computed',
};

const ten = (d: Decimal) => d.toDecimalPlaces(10, Decimal.ROUND_HALF_UP).toFixed(10);
const two = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
/** "1,923,076.92 Cr" */
const drCr = (d: Decimal) => {
  const [int = '0', dec = '00'] = d.abs().toFixed(2).split('.');
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec} ${d.isNegative() ? 'Cr' : 'Dr'}`;
};
const rateText = (d: Decimal) => {
  if (d.equals(1)) return '1';
  const t = d.toDecimalPlaces(10).toFixed();
  return (t.split('.')[1]?.length ?? 0) >= 2 ? t : d.toFixed(2);
};

function periodRate(
  input: TranslateTbInput,
  kind: RateKind,
): { rate: Decimal | null; used: RateUsed } {
  const months = monthsBetween(input.period.startDate, input.period.endDate);
  const sourceMonths = (
    kind === 'opening' ? [months[0]!] : kind === 'closing' ? [months.at(-1)!] : months
  ).map(monthLabel);
  if (input.functionalCurrency === input.targetCurrency) {
    return {
      rate: new Decimal(1),
      used: {
        full: '1',
        value: ten(new Decimal(1)),
        formula: 'Same currency',
        sourceMonths,
        missing: [],
      },
    };
  }
  const a = periodUsdRate(input.rates, input.period, input.functionalCurrency, kind);
  const b = periodUsdRate(input.rates, input.period, input.targetCurrency, kind);
  const missing = [...a.missing, ...b.missing];
  if (!a.value || !b.value)
    return { rate: null, used: { full: null, value: null, formula: null, sourceMonths, missing } };
  const rate = b.value.dividedBy(a.value);
  return {
    rate,
    used: {
      full: rate.toString(),
      value: ten(rate),
      formula: `${rateText(b.value)} ÷ ${rateText(a.value)}`,
      sourceMonths,
      missing: [],
    },
  };
}

export function translateTB(input: TranslateTbInput): TranslateTbResult {
  const same = input.functionalCurrency === input.targetCurrency;
  const opening = periodRate(input, 'opening');
  const closing = periodRate(input, 'closing');
  const average = periodRate(input, 'average');
  const hist = same
    ? new Decimal(1)
    : input.historicalRate !== null && input.historicalRate.trim() !== ''
      ? new Decimal(input.historicalRate)
      : null;
  const rates = {
    opening: opening.used,
    closing: closing.used,
    average: average.used,
    historical: {
      full: hist?.toString() ?? null,
      value: hist ? ten(hist) : null,
      formula: same ? 'Same currency' : hist ? 'Entity master' : null,
      sourceMonths: [],
      missing: hist
        ? []
        : [`${input.functionalCurrency} → ${input.targetCurrency} historical rate (entity master)`],
    },
  };
  const functionalTotal = input.lines.reduce((s, l) => s.plus(l.amount), new Decimal(0)).toFixed(2);

  const failures: string[] = [];
  for (const [label, r] of [
    ['opening', opening],
    ['closing', closing],
    ['average', average],
  ] as const) {
    if (!r.rate) failures.push(`The ${label} rate is missing (${r.used.missing.join(', ')}).`);
  }
  const unmapped = input.lines.filter(
    (l) => !l.fsliCode || !l.statement || !(l.rateBasisOverride ?? l.fsliRateBasis),
  );
  if (unmapped.length > 0)
    failures.push(
      `${unmapped.length} account(s) are not mapped to an FSLI (step 2): ${unmapped.map((l) => l.code).join(', ')}.`,
    );
  if (failures.length > 0) {
    return {
      status: 'FAIL',
      failures,
      rates,
      lines: [],
      fsliTotals: [],
      profit: null,
      fctr: null,
      totals: { functional: functionalTotal, translated: null },
      summary: null,
      reMethod: { kind: 'NONE', text: 'Not translated: see the errors.' },
      warnings: [],
    };
  }

  const warnings: string[] = [];
  const byBasis: Record<Exclude<RateBasisCode, 'ROLL_FORWARD' | 'COMPUTED'>, Decimal> = {
    CLOSING: closing.rate!,
    AVERAGE: average.rate!,
    OPENING: opening.rate!,
    HISTORICAL: hist ?? opening.rate!,
  };
  if (!hist && input.lines.some((l) => (l.rateBasisOverride ?? l.fsliRateBasis) === 'HISTORICAL')) {
    warnings.push(
      `No historical rate ${input.functionalCurrency} → ${input.targetCurrency} in the entity master: share capital and premium are translated at the opening rate.`,
    );
  }

  // Retained earnings: rolled forward, or the opening rate.
  const reLines = input.lines.filter(
    (l) => (l.rateBasisOverride ?? l.fsliRateBasis) === 'ROLL_FORWARD',
  );
  let reMethod: TranslateTbResult['reMethod'];
  const rolled = new Map<string, Decimal>();
  if (same) {
    reMethod = { kind: 'SAME_CURRENCY', text: 'Same currency: every rate is 1.' };
  } else if (input.rollForwardPassed && input.prior) {
    const total = new Decimal(input.prior.retained).plus(input.prior.profit);
    const base = reLines.reduce((s, l) => s.plus(l.amount), new Decimal(0));
    let allocated = new Decimal(0);
    reLines.forEach((l, i) => {
      const share =
        i === reLines.length - 1
          ? total.minus(allocated)
          : base.isZero()
            ? new Decimal(0)
            : two(total.times(l.amount).dividedBy(base));
      allocated = allocated.plus(share);
      rolled.set(l.code, share);
    });
    reMethod = {
      kind: 'ROLL_FORWARD',
      text: `Rolled forward from finalised ${input.prior.periodLabel}: retained earnings ${drCr(new Decimal(input.prior.retained))} + profit ${drCr(new Decimal(input.prior.profit))} = ${drCr(total)}.`,
    };
  } else {
    const reason = !input.prior
      ? `there is no finalised ${input.priorPeriodLabel} translation in ${input.targetCurrency}`
      : 'the retained-earnings roll-forward check did not pass';
    reMethod = { kind: 'OPENING_RATE', text: `Opening rate: ${reason}.` };
    if (reLines.length > 0)
      warnings.push(`Retained earnings are translated at the opening rate because ${reason}.`);
  }

  const lines: TranslatedLine[] = input.lines.map((l) => {
    const configured = (l.rateBasisOverride ?? l.fsliRateBasis)!;
    const overridden = l.rateBasisOverride !== null && l.rateBasisOverride !== l.fsliRateBasis;
    const amount = new Decimal(l.amount);
    if (configured === 'ROLL_FORWARD' && rolled.has(l.code)) {
      return {
        code: l.code,
        name: l.name,
        fsliCode: l.fsliCode,
        basis: 'ROLL_FORWARD',
        basisLabel: 'roll-forward',
        overridden,
        rate: null,
        functional: amount.toFixed(2),
        translated: rolled.get(l.code)!.toFixed(2),
      };
    }
    let basis: RateBasisCode =
      configured === 'COMPUTED' ? (l.statement === 'PL' ? 'AVERAGE' : 'CLOSING') : configured;
    let label = BASIS_LABEL[basis];
    if (basis === 'ROLL_FORWARD') {
      basis = 'OPENING';
      label = same ? 'opening' : 'opening (roll-forward not available)';
    } else if (basis === 'HISTORICAL' && !hist) {
      basis = 'OPENING';
      label = 'opening (no historical rate)';
    }
    const rate = byBasis[basis as keyof typeof byBasis];
    return {
      code: l.code,
      name: l.name,
      fsliCode: l.fsliCode,
      basis,
      basisLabel: label,
      overridden,
      rate: ten(rate),
      functional: amount.toFixed(2),
      translated: two(amount.times(rate)).toFixed(2),
    };
  });

  const cls = new Map(input.lines.map((l) => [l.code, l]));
  const sum = (f: (l: TranslatedLine) => boolean) =>
    lines.filter(f).reduce((s, l) => s.plus(l.translated), new Decimal(0));
  const profit = sum((l) => cls.get(l.code)!.statement === 'PL');
  const bs = sum((l) => cls.get(l.code)!.statement === 'BS');
  const fctr = bs.plus(profit).negated();

  const fsliMap = new Map<string, { functional: Decimal; translated: Decimal }>();
  for (const l of lines) {
    const t = fsliMap.get(l.fsliCode!) ?? {
      functional: new Decimal(0),
      translated: new Decimal(0),
    };
    t.functional = t.functional.plus(l.functional);
    t.translated = t.translated.plus(l.translated);
    fsliMap.set(l.fsliCode!, t);
  }
  const byClass = (c: string) => sum((l) => cls.get(l.code)!.fsliClass === c);
  const byFsli = (codes: string[]) => sum((l) => codes.includes(l.fsliCode ?? ''));
  const totalAssets = byClass('A');
  const totalLiabilities = byClass('L').negated();
  const scp = byFsli(['SHARE_CAP', 'SEC_PREM']).negated();
  const re = byFsli(['RETAINED']).negated();
  const otherReserves = byClass('E').negated().minus(scp).minus(re);
  const totalEquity = scp.plus(re).plus(otherReserves).plus(profit.negated()).plus(fctr.negated());

  return {
    status: 'OK',
    failures: [],
    rates,
    lines,
    fsliTotals: [...fsliMap.entries()].map(([fsliCode, t]) => ({
      fsliCode,
      functional: t.functional.toFixed(2),
      translated: t.translated.toFixed(2),
    })),
    profit: profit.toFixed(2),
    fctr: fctr.toFixed(2),
    totals: { functional: functionalTotal, translated: bs.plus(profit).plus(fctr).toFixed(2) },
    summary: {
      totalAssets: totalAssets.toFixed(2),
      totalLiabilities: totalLiabilities.toFixed(2),
      shareCapitalAndPremium: scp.toFixed(2),
      retainedEarnings: re.toFixed(2),
      otherReserves: otherReserves.toFixed(2),
      profit: profit.negated().toFixed(2),
      fctr: fctr.negated().toFixed(2),
      totalEquity: totalEquity.toFixed(2),
      balanced: totalAssets.equals(totalLiabilities.plus(totalEquity)),
    },
    reMethod,
    warnings,
  };
}
