import { Decimal } from './money';

/**
 * Trial-balance P&L basis (decision round 1, Q10). Monthly TBs carry the period's P&L only
 * ("Period movement", the default). A "Year-to-date" TB carries the P&L from the start of the
 * financial year: the period P&L is this TB's YTD P&L minus the previous TB's YTD P&L (the month
 * before the period starts). Balance-sheet lines are always closing balances. The profit of the
 * earlier months of the year is added as one equity line so the converted TB still nets to zero
 * (as a period-movement TB carries it in opening retained earnings).
 */
export interface BasisLine {
  code: string;
  name: string;
  type: string | null;
  /** Signed, debit +. */
  amount: string;
  /** Income or expense account. */
  isPL: boolean;
}

export interface ConvertedLine {
  code: string;
  name: string;
  type: string | null;
  /** Period-movement amount (what the TB stores). */
  amount: string;
  /** The YTD amount as uploaded (P&L lines); null for lines not in the uploaded TB. */
  ytdAmount: string | null;
}

export const YTD_PRIOR_PROFIT_CODE = 'YTD-PRIOR';
export const YTD_PRIOR_PROFIT_NAME = 'Profit of earlier months this year (YTD conversion)';

export function ytdToPeriod(input: {
  current: readonly BasisLine[];
  /** YTD P&L of the previous TB by account (null when there is none). */
  previous: readonly { code: string; name: string; ytdAmount: string }[] | null;
  /** The period starts at the beginning of the financial year (April): YTD = period. */
  firstPeriodOfYear: boolean;
  previousLabel: string;
}): { lines: ConvertedLine[]; priorProfit: string; problems: string[] } {
  const asIs = input.current.map((l) => ({
    code: l.code,
    name: l.name,
    type: l.type,
    amount: new Decimal(l.amount).toFixed(2),
    ytdAmount: l.isPL ? new Decimal(l.amount).toFixed(2) : null,
  }));
  if (input.firstPeriodOfYear) return { lines: asIs, priorProfit: '0.00', problems: [] };
  if (!input.previous)
    return {
      lines: asIs,
      priorProfit: '0.00',
      problems: [
        `This trial balance is year-to-date: upload the ${input.previousLabel} YTD trial balance first (the period P&L is this TB's YTD P&L less ${input.previousLabel}'s).`,
      ],
    };
  const prev = new Map(input.previous.map((p) => [p.code, p]));
  const seen = new Set<string>();
  const lines: ConvertedLine[] = input.current.map((l) => {
    if (!l.isPL)
      return {
        code: l.code,
        name: l.name,
        type: l.type,
        amount: new Decimal(l.amount).toFixed(2),
        ytdAmount: null,
      };
    seen.add(l.code);
    const before = new Decimal(prev.get(l.code)?.ytdAmount ?? '0');
    return {
      code: l.code,
      name: l.name,
      type: l.type,
      amount: new Decimal(l.amount).minus(before).toFixed(2),
      ytdAmount: new Decimal(l.amount).toFixed(2),
    };
  });
  // P&L accounts that had a YTD balance last month but none now: their movement reverses it.
  for (const p of input.previous)
    if (!seen.has(p.code) && !new Decimal(p.ytdAmount).isZero())
      lines.push({
        code: p.code,
        name: p.name,
        type: null,
        amount: new Decimal(p.ytdAmount).negated().toFixed(2),
        ytdAmount: '0.00',
      });
  const priorProfit = input.previous.reduce((s, p) => s.plus(p.ytdAmount), new Decimal(0));
  if (!priorProfit.isZero())
    lines.push({
      code: YTD_PRIOR_PROFIT_CODE,
      name: YTD_PRIOR_PROFIT_NAME,
      type: 'Equity',
      amount: priorProfit.toFixed(2),
      ytdAmount: null,
    });
  return { lines, priorProfit: priorProfit.toFixed(2), problems: [] };
}

/**
 * A quarter or year against its months (decision round 1, Q10b): the sum of the monthly P&L by
 * FSLI equals the period P&L, and the period-end balance sheet equals the last month's.
 */
export function periodTiesToMonths(input: {
  monthsPl: readonly Readonly<Record<string, string>>[];
  periodPl: Readonly<Record<string, string>>;
  lastMonthBs: Readonly<Record<string, string>>;
  periodBs: Readonly<Record<string, string>>;
  tolerance: string;
}): {
  plDiffs: { fsli: string; months: string; period: string; difference: string }[];
  bsDiffs: { fsli: string; lastMonth: string; period: string; difference: string }[];
} {
  const keys = (rs: readonly Readonly<Record<string, string>>[]) =>
    [...new Set(rs.flatMap((r) => Object.keys(r)))].sort();
  const plDiffs = keys([...input.monthsPl, input.periodPl])
    .map((f) => {
      const months = input.monthsPl.reduce((s, m) => s.plus(m[f] ?? '0'), new Decimal(0));
      const period = new Decimal(input.periodPl[f] ?? '0');
      return {
        fsli: f,
        months: months.toFixed(2),
        period: period.toFixed(2),
        difference: period.minus(months).toFixed(2),
      };
    })
    .filter((x) => new Decimal(x.difference).abs().greaterThan(input.tolerance));
  // Retained earnings and the period's profit are compared together: a quarter's TB opens retained
  // earnings at the quarter start, its last month's at the month start (earlier months included).
  const bs = (r: Readonly<Record<string, string>>) => {
    const out: Record<string, string> = { ...r };
    out.RETAINED = new Decimal(r.RETAINED ?? '0').plus(r.PROFIT ?? '0').toFixed(2);
    delete out.PROFIT;
    return out;
  };
  const lastMonthBs = bs(input.lastMonthBs);
  const periodBs = bs(input.periodBs);
  const bsDiffs = keys([lastMonthBs, periodBs])
    .map((f) => {
      const last = new Decimal(lastMonthBs[f] ?? '0');
      const period = new Decimal(periodBs[f] ?? '0');
      return {
        fsli: f,
        lastMonth: last.toFixed(2),
        period: period.toFixed(2),
        difference: period.minus(last).toFixed(2),
      };
    })
    .filter((x) => new Decimal(x.difference).abs().greaterThan(input.tolerance));
  return { plDiffs, bsDiffs };
}
