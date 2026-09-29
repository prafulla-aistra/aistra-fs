import { describe, expect, it } from 'vitest';
import { generatePeriods } from './periods';
import {
  calendarDaysBetween,
  closeDeadline,
  countItemStatuses,
  defaultPeriodInClose,
  deriveTaskStatus,
  isOverdue,
  type ItemStatus,
  previousMonth,
  workingDaysLeft,
} from './tasks';

describe('deriveTaskStatus', () => {
  const F: ItemStatus = 'FINALISED';
  it.each<[ItemStatus[], string]>([
    [[F, F, F, F, F, F, F], 'DONE'],
    [[F, F, F, 'IN_REVIEW', 'IN_PROGRESS', 'NOT_STARTED', 'NOT_STARTED'], 'IN_REVIEW'], // Aug-2026 demo
    [['IN_REVIEW'], 'IN_REVIEW'],
    [['IN_PROGRESS', 'NOT_STARTED'], 'IN_PROGRESS'],
    [[F, 'NOT_STARTED'], 'IN_PROGRESS'], // a finalised item means work has started
    [['NOT_STARTED', 'NOT_STARTED'], 'NOT_STARTED'],
    [[], 'NOT_STARTED'],
  ])('%j → %s', (items, expected) => {
    expect(deriveTaskStatus(items)).toBe(expected);
  });
});

describe('isOverdue', () => {
  it('is overdue only when not Done and today is after the due date', () => {
    expect(isOverdue('IN_REVIEW', '2026-09-09', '2026-09-29')).toBe(true);
    expect(isOverdue('IN_REVIEW', '2026-09-09', '2026-09-09')).toBe(false); // due today
    expect(isOverdue('NOT_STARTED', '2026-09-09', '2026-09-08')).toBe(false);
    expect(isOverdue('DONE', '2026-08-11', '2026-09-29')).toBe(false);
  });
});

describe('countItemStatuses', () => {
  it('counts every status, including zeros', () => {
    expect(countItemStatuses(['FINALISED', 'FINALISED', 'IN_REVIEW'])).toEqual({
      NOT_STARTED: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 1,
      FINALISED: 2,
    });
  });
});

describe('period in close', () => {
  const months = [...generatePeriods(2025), ...generatePeriods(2026)]
    .filter((p) => p.type === 'MONTHLY')
    .map((p) => ({ id: p.label, startDate: p.startDate, endDate: p.endDate }));

  it('defaults to the latest month whose end date has passed', () => {
    expect(defaultPeriodInClose(months, '2026-09-29')?.id).toBe('Aug-2026');
    expect(defaultPeriodInClose(months, '2026-09-30')?.id).toBe('Aug-2026'); // Sep ends today, not passed
    expect(defaultPeriodInClose(months, '2026-10-01')?.id).toBe('Sep-2026');
    expect(defaultPeriodInClose(months, '2026-04-02')?.id).toBe('Mar-2026'); // across financial years
    expect(defaultPeriodInClose(months, '2025-04-15')).toBeNull();
  });

  it('finds the month before, across financial years', () => {
    const find = (id: string) => months.find((m) => m.id === id)!;
    expect(previousMonth(months, find('Aug-2026'))?.id).toBe('Jul-2026');
    expect(previousMonth(months, find('Apr-2026'))?.id).toBe('Mar-2026');
    expect(previousMonth(months, find('Mar-2026'))?.id).toBe('Feb-2026');
    expect(previousMonth(months, find('Apr-2025'))).toBeNull();
  });
});

describe('deadlines', () => {
  it('counts working days left, excluding weekends and holidays', () => {
    expect(workingDaysLeft('2026-09-01', '2026-09-09')).toBe(6); // Wed 2 … Wed 9, minus Sat/Sun
    expect(workingDaysLeft('2026-09-01', '2026-09-09', ['2026-09-02'])).toBe(5);
    expect(workingDaysLeft('2026-09-09', '2026-09-09')).toBe(0);
    expect(workingDaysLeft('2026-09-29', '2026-09-09')).toBe(0);
  });

  it('counts calendar days between dates', () => {
    expect(calendarDaysBetween('2026-09-09', '2026-09-29')).toBe(20);
    expect(calendarDaysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('shows the SFS deadline until SFS is done, then CFS, then complete', () => {
    const base = { sfsDue: '2026-09-09', cfsDue: '2026-09-16' };
    expect(closeDeadline({ ...base, today: '2026-09-29', sfsDone: false, cfsDone: false })).toEqual(
      {
        kind: 'SFS',
        dueDate: '2026-09-09',
        status: 'OVERDUE',
        overdueDays: 20,
      },
    );
    expect(closeDeadline({ ...base, today: '2026-09-02', sfsDone: false, cfsDone: false })).toEqual(
      {
        kind: 'SFS',
        dueDate: '2026-09-09',
        status: 'ON_TRACK',
        workingDaysLeft: 5,
      },
    );
    expect(
      closeDeadline({ ...base, today: '2026-09-10', sfsDone: true, cfsDone: false }),
    ).toMatchObject({
      kind: 'CFS',
      status: 'ON_TRACK',
      workingDaysLeft: 4,
    });
    expect(closeDeadline({ ...base, today: '2026-09-29', sfsDone: true, cfsDone: true })).toEqual({
      kind: 'COMPLETE',
    });
  });
});
