import { type IsoDate, parseIsoDate } from './dates';
import type { PeriodKind } from './periods';
import { QUARTER_MONTHS } from './periods';

export interface NumberedPeriod {
  type: PeriodKind;
  /** 1–12 for months (1 = April), 1–4 for quarters, 1 for the year. */
  sequence: number;
  startDate: IsoDate;
  /** Calendar year the financial year starts in (2026 = FY 2026-27). */
  fyStartYear: number;
}

/** "FY27" for FY 2026-27 (the year it ends in). */
function fyShort(fyStartYear: number): string {
  return `FY${String((fyStartYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * Task number prefix:
 *   monthly   SFS-2026-08      (calendar year and month of the period)
 *   quarterly SFS-FY27-Q1
 *   annual    SFS-FY27
 */
export function taskNumberPrefix(type: 'SFS' | 'CFS', period: NumberedPeriod): string {
  if (period.type === 'MONTHLY') {
    const { year, month } = parseIsoDate(period.startDate);
    return `${type}-${year}-${String(month).padStart(2, '0')}`;
  }
  if (period.type === 'QUARTERLY')
    return `${type}-${fyShort(period.fyStartYear)}-Q${period.sequence}`;
  return `${type}-${fyShort(period.fyStartYear)}`;
}

/**
 * Next task number for a prefix, given the numbers already used: highest sequence + 1,
 * three digits (…-001). Numbers are never reused, even if a task is removed.
 */
export function nextTaskNumber(prefix: string, existing: readonly string[]): string {
  const head = `${prefix}-`;
  const highest = existing.reduce((max, n) => {
    const rest = n.startsWith(head) ? n.slice(head.length) : '';
    return /^\d{3,}$/.test(rest) ? Math.max(max, Number(rest)) : max;
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(3, '0')}`;
}

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Label for choosing a period in the new-task wizard:
 *   "Aug-2026", "Q1 (Apr–Jun 2026)", "Q4 (Jan–Mar 2027)", "FY 2026-27 (Apr-2026 to Mar-2027)".
 */
export function periodChoiceLabel(period: NumberedPeriod & { endDate: IsoDate }): string {
  const start = parseIsoDate(period.startDate);
  const end = parseIsoDate(period.endDate);
  if (period.type === 'MONTHLY') return `${MONTH_ABBR[start.month - 1]}-${start.year}`;
  if (period.type === 'QUARTERLY') {
    return `Q${period.sequence} (${QUARTER_MONTHS[period.sequence - 1]} ${end.year})`;
  }
  const fy = `FY ${period.fyStartYear}-${String((period.fyStartYear + 1) % 100).padStart(2, '0')}`;
  return `${fy} (${MONTH_ABBR[start.month - 1]}-${start.year} to ${MONTH_ABBR[end.month - 1]}-${end.year})`;
}

/** A period can be prepared only after its end date: today must be later than the end. */
export function hasPeriodEnded(endDate: IsoDate, today: IsoDate): boolean {
  parseIsoDate(endDate);
  parseIsoDate(today);
  return today > endDate;
}
