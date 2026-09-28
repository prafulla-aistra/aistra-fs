import { addDays, dayOfWeek, type IsoDate, parseIsoDate } from './dates';

/** Working days are Monday–Friday, excluding holidays. */
export function isWorkingDay(date: IsoDate, holidays: ReadonlySet<IsoDate>): boolean {
  const dow = dayOfWeek(date);
  return dow !== 0 && dow !== 6 && !holidays.has(date);
}

/**
 * Due date = the `workingDays`-th working day after the period end.
 * The period-end day itself never counts. 0 working days returns the period end.
 *
 * Example: period end Mon 31 Aug 2026, 7 working days, no holidays → Wed 9 Sep 2026.
 */
export function calculateDueDate(
  periodEnd: IsoDate,
  workingDays: number,
  holidays: Iterable<IsoDate> = [],
): IsoDate {
  parseIsoDate(periodEnd);
  if (!Number.isInteger(workingDays) || workingDays < 0 || workingDays > 366) {
    throw new RangeError(`workingDays must be an integer from 0 to 366 (got ${workingDays})`);
  }
  const holidaySet = new Set<IsoDate>();
  for (const h of holidays) {
    parseIsoDate(h);
    holidaySet.add(h);
  }

  let date = periodEnd;
  let counted = 0;
  while (counted < workingDays) {
    date = addDays(date, 1);
    if (isWorkingDay(date, holidaySet)) counted++;
  }
  return date;
}
