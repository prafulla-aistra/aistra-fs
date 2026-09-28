import { endOfMonth, type IsoDate, toIsoDate } from './dates';

/**
 * Indian financial year: April to March, labelled "FY 2026-27" (CLAUDE.md).
 * A financial year is identified by the calendar year it starts in (2026 → FY 2026-27).
 */
export type PeriodKind = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

export interface GeneratedPeriod {
  type: PeriodKind;
  /** 1–12 for months (1 = April), 1–4 for quarters, 1 for the year. */
  sequence: number;
  label: string;
  startDate: IsoDate;
  endDate: IsoDate;
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

/** Quarters of the Indian FY: Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar. */
export const QUARTER_MONTHS = ['Apr–Jun', 'Jul–Sep', 'Oct–Dec', 'Jan–Mar'] as const;

function assertStartYear(startYear: number): void {
  if (!Number.isInteger(startYear) || startYear < 2000 || startYear > 2100) {
    throw new RangeError(`Invalid financial-year start year: ${startYear}`);
  }
}

/** "FY 2026-27" for startYear 2026. */
export function fyLabel(startYear: number): string {
  assertStartYear(startYear);
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** Calendar year and month (1–12) of the n-th month (1 = April) of the FY. */
function fyMonth(startYear: number, n: number): { year: number; month: number } {
  const zeroBased = 3 + (n - 1); // April = index 3
  return { year: startYear + Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

/**
 * All periods of a financial year: 12 months, 4 quarters and 1 annual period, each with
 * start date, end date (inclusive), label and type.
 */
export function generatePeriods(startYear: number): GeneratedPeriod[] {
  assertStartYear(startYear);
  const fy = fyLabel(startYear);
  const periods: GeneratedPeriod[] = [];

  for (let n = 1; n <= 12; n++) {
    const { year, month } = fyMonth(startYear, n);
    periods.push({
      type: 'MONTHLY',
      sequence: n,
      label: `${MONTH_ABBR[month - 1]}-${year}`,
      startDate: toIsoDate(year, month, 1),
      endDate: endOfMonth(year, month),
    });
  }

  for (let q = 1; q <= 4; q++) {
    const first = fyMonth(startYear, (q - 1) * 3 + 1);
    const last = fyMonth(startYear, q * 3);
    periods.push({
      type: 'QUARTERLY',
      sequence: q,
      label: `Q${q} ${fy}`,
      startDate: toIsoDate(first.year, first.month, 1),
      endDate: endOfMonth(last.year, last.month),
    });
  }

  periods.push({
    type: 'ANNUAL',
    sequence: 1,
    label: fy,
    startDate: toIsoDate(startYear, 4, 1),
    endDate: endOfMonth(startYear + 1, 3),
  });

  return periods;
}
