import { addDays, type IsoDate, parseIsoDate } from './dates';
import { isWorkingDay } from './due-dates';

/**
 * Close tasks: status of one entity (SFS) or consolidation level (CFS) within a task, and the
 * task status derived from them. Task status is never stored by hand.
 */
export type ItemStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'IN_REVIEW' | 'FINALISED';
export type TaskStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';

export const ITEM_STATUSES: readonly ItemStatus[] = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'IN_REVIEW',
  'FINALISED',
];

/**
 * - Done: every entity/level is Finalised (the task is then locked)
 * - In review: not Done and at least one is In review
 * - In progress: at least one is In progress or Finalised
 * - Not started: otherwise (including a task with no items)
 */
export function deriveTaskStatus(items: readonly ItemStatus[]): TaskStatus {
  if (items.length > 0 && items.every((s) => s === 'FINALISED')) return 'DONE';
  if (items.includes('IN_REVIEW')) return 'IN_REVIEW';
  if (items.some((s) => s === 'IN_PROGRESS' || s === 'FINALISED')) return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

/** Overdue = not Done and today is after the due date. */
export function isOverdue(status: TaskStatus, dueDate: IsoDate, today: IsoDate): boolean {
  parseIsoDate(dueDate);
  parseIsoDate(today);
  return status !== 'DONE' && today > dueDate;
}

/** Count of items per status (every status present, zero if none). */
export function countItemStatuses(items: readonly ItemStatus[]): Record<ItemStatus, number> {
  const counts: Record<ItemStatus, number> = {
    NOT_STARTED: 0,
    IN_PROGRESS: 0,
    IN_REVIEW: 0,
    FINALISED: 0,
  };
  for (const s of items) counts[s] += 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Period in close
// ---------------------------------------------------------------------------

export interface MonthRef {
  id: string;
  startDate: IsoDate;
  endDate: IsoDate;
}

/**
 * Default period in close: the latest month whose end date has passed (today is after it).
 * 29-Sep-2026 → Aug-2026. Null if no month has ended yet.
 */
export function defaultPeriodInClose<T extends MonthRef>(
  months: readonly T[],
  today: IsoDate,
): T | null {
  parseIsoDate(today);
  const ended = months.filter((m) => m.endDate < today);
  return ended.reduce<T | null>(
    (latest, m) => (!latest || m.endDate > latest.endDate ? m : latest),
    null,
  );
}

/** The month immediately before `selected` (by date, across financial years); null if none. */
export function previousMonth<T extends MonthRef>(
  months: readonly T[],
  selected: MonthRef,
): T | null {
  const wantedEnd = addDays(selected.startDate, -1);
  return months.find((m) => m.endDate === wantedEnd) ?? null;
}

// ---------------------------------------------------------------------------
// Deadline shown on the "period in close" card
// ---------------------------------------------------------------------------

/** Working days after `today` up to and including `dueDate` (0 if due today or earlier). */
export function workingDaysLeft(
  today: IsoDate,
  dueDate: IsoDate,
  holidays: Iterable<IsoDate> = [],
): number {
  parseIsoDate(today);
  parseIsoDate(dueDate);
  const set = new Set(holidays);
  let count = 0;
  for (let d = addDays(today, 1); d <= dueDate; d = addDays(d, 1)) {
    if (isWorkingDay(d, set)) count++;
  }
  return count;
}

/** Calendar days from `a` to `b` (positive when b is later). */
export function calendarDaysBetween(a: IsoDate, b: IsoDate): number {
  const ms = (s: IsoDate) => {
    const { year, month, day } = parseIsoDate(s);
    return Date.UTC(year, month - 1, day);
  };
  return Math.floor((ms(b) - ms(a)) / 86_400_000);
}

export type CloseDeadline =
  | { kind: 'SFS' | 'CFS'; dueDate: IsoDate; status: 'ON_TRACK'; workingDaysLeft: number }
  | { kind: 'SFS' | 'CFS'; dueDate: IsoDate; status: 'OVERDUE'; overdueDays: number }
  | { kind: 'COMPLETE' };

/**
 * The deadline that matters now: SFS until every standalone statement is finalised, then CFS;
 * COMPLETE once both are done. Overdue counts calendar days past the due date.
 */
export function closeDeadline(input: {
  today: IsoDate;
  sfsDue: IsoDate;
  cfsDue: IsoDate;
  sfsDone: boolean;
  cfsDone: boolean;
  holidays?: Iterable<IsoDate>;
}): CloseDeadline {
  const pick = (kind: 'SFS' | 'CFS', dueDate: IsoDate): CloseDeadline =>
    input.today > dueDate
      ? { kind, dueDate, status: 'OVERDUE', overdueDays: calendarDaysBetween(dueDate, input.today) }
      : {
          kind,
          dueDate,
          status: 'ON_TRACK',
          workingDaysLeft: workingDaysLeft(input.today, dueDate, input.holidays),
        };
  if (!input.sfsDone) return pick('SFS', input.sfsDue);
  if (!input.cfsDone) return pick('CFS', input.cfsDue);
  return { kind: 'COMPLETE' };
}
