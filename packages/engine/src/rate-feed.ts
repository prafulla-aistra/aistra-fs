import { Decimal } from './money';
import type { IsoDate } from './dates';

/**
 * Monthly rates from a daily rate feed (free API). Rates are units of currency per 1 USD.
 *
 *  - Only working days (Monday–Friday) with a published rate count.
 *  - closing = the rate of the last working day of the month with a rate;
 *  - average = the simple mean of every working-day rate in the month;
 *  - opening = the previous month's closing (its last working-day rate).
 *
 * Each figure is kept at full precision and rounded once, to 10 decimals (NUMERIC(20,10)),
 * half away from zero.
 */
export interface DailyRate {
  date: IsoDate;
  /** Units of the currency per 1 USD, as a decimal string. */
  perUsd: string;
}

export interface MonthFromDaily {
  opening: string | null;
  closing: string | null;
  average: string | null;
  openingDate: IsoDate | null;
  closingDate: IsoDate | null;
  /** Working days in the month with a rate (the average's divisor). */
  days: number;
  problems: string[];
}

export const RATE_DP = 10;

const isWeekday = (d: IsoDate) => {
  const w = new Date(`${d}T00:00:00Z`).getUTCDay();
  return w >= 1 && w <= 5;
};

const lastDayOf = (month: IsoDate) => {
  const d = new Date(`${month}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
};

const previousMonth = (month: IsoDate) => {
  const d = new Date(`${month}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
};

/** Cross rate from a feed quoted against another base: (C per base) / (USD per base). */
export function perUsdFromBase(currencyPerBase: string, usdPerBase: string): string {
  const usd = new Decimal(usdPerBase);
  if (!usd.greaterThan(0)) throw new RangeError('USD rate must be more than 0');
  return new Decimal(currencyPerBase).dividedBy(usd).toString();
}

/**
 * @param month first day of the month (YYYY-MM-01)
 * @param daily daily rates covering at least the last working days of the previous month and
 *   the whole month (other dates are ignored)
 */
export function monthFromDaily(month: IsoDate, daily: readonly DailyRate[]): MonthFromDaily {
  const end = lastDayOf(month);
  const prev = previousMonth(month);
  const usable = daily
    .filter((d) => isWeekday(d.date) && new Decimal(d.perUsd).greaterThan(0))
    .sort((a, b) => a.date.localeCompare(b.date));
  const inMonth = usable.filter((d) => d.date >= month && d.date <= end);
  const inPrev = usable.filter((d) => d.date >= prev && d.date < month);
  const problems: string[] = [];
  const round = (v: Decimal) => v.toDecimalPlaces(RATE_DP, Decimal.ROUND_HALF_UP).toFixed(RATE_DP);

  const last = inMonth.at(-1) ?? null;
  const prevLast = inPrev.at(-1) ?? null;
  const daysBefore = (a: IsoDate, b: IsoDate) =>
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000;
  if (!last) problems.push('No working-day rates were published in this month.');
  else if (daysBefore(last.date, end) > 7)
    problems.push(
      `The last rate of the month is on ${last.date}, more than a week before month end.`,
    );
  if (!prevLast) problems.push("No rate for the previous month's last working day (opening).");

  const average =
    inMonth.length > 0
      ? round(
          inMonth.reduce((s, d) => s.plus(d.perUsd), new Decimal('0')).dividedBy(inMonth.length),
        )
      : null;
  return {
    opening: prevLast ? round(new Decimal(prevLast.perUsd)) : null,
    closing: last ? round(new Decimal(last.perUsd)) : null,
    average,
    openingDate: prevLast?.date ?? null,
    closingDate: last?.date ?? null,
    days: inMonth.length,
    problems,
  };
}
