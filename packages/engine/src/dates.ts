/**
 * Calendar dates as ISO strings ("2026-08-31"), with no time zone involved.
 *
 * Accounting dates are calendar days, not instants. Arithmetic goes through UTC so the
 * machine's local time zone (IST, BST, …) can never shift a date by one day.
 */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in a month; `month` is 1–12. */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12)
    throw new RangeError(`Invalid month ${month}`);
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function toIsoDate(year: number, month: number, day: number): IsoDate {
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Invalid date ${year}-${month}-${day}`);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Parses and validates "YYYY-MM-DD" (rejects impossible dates such as 2026-02-29). */
export function parseIsoDate(value: IsoDate): { year: number; month: number; day: number } {
  const m = ISO_DATE.exec(value);
  if (!m) throw new RangeError(`Not a date in YYYY-MM-DD format: "${value}"`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  toIsoDate(year, month, day); // validates
  return { year, month, day };
}

export function isIsoDate(value: string): boolean {
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

function toUtcMs(value: IsoDate): number {
  const { year, month, day } = parseIsoDate(value);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMs(ms: number): IsoDate {
  const d = new Date(ms);
  return toIsoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(value: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) throw new RangeError('days must be an integer');
  return fromUtcMs(toUtcMs(value) + days * 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(value: IsoDate): number {
  return new Date(toUtcMs(value)).getUTCDay();
}

/** Last day of the month containing `value`. */
export function endOfMonth(year: number, month: number): IsoDate {
  return toIsoDate(year, month, daysInMonth(year, month));
}
