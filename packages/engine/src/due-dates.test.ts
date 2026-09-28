import { describe, expect, it } from 'vitest';
import { calculateDueDate, isWorkingDay } from './due-dates';

describe('calculateDueDate', () => {
  it('counts working days after the period end (Aug-2026 monthly SFS, 7 days)', () => {
    // Mon 31 Aug 2026 → Tue 1, Wed 2, Thu 3, Fri 4, Mon 7, Tue 8, Wed 9 Sep.
    expect(calculateDueDate('2026-08-31', 7)).toBe('2026-09-09');
  });

  it('skips weekends', () => {
    // Fri 30 Oct 2026 + 1 working day = Mon 2 Nov.
    expect(calculateDueDate('2026-10-30', 1)).toBe('2026-11-02');
    // Period ending on a Saturday: the first working day is the Monday.
    expect(calculateDueDate('2026-10-31', 1)).toBe('2026-11-02');
  });

  it('skips holidays', () => {
    expect(calculateDueDate('2026-08-31', 7, ['2026-09-02'])).toBe('2026-09-10');
    // A holiday on a weekend changes nothing.
    expect(calculateDueDate('2026-08-31', 7, ['2026-09-05'])).toBe('2026-09-09');
    // Consecutive holidays.
    expect(calculateDueDate('2026-12-31', 1, ['2027-01-01', '2027-01-04'])).toBe('2027-01-05');
  });

  it('does not count the period-end day itself, even if it is a working day', () => {
    expect(calculateDueDate('2026-09-30', 1)).toBe('2026-10-01');
  });

  it('crosses month, year and leap-day boundaries', () => {
    // Q4 FY 2026-27 ends Wed 31 Mar 2027; 10 working days → Wed 14 Apr 2027.
    expect(calculateDueDate('2027-03-31', 10)).toBe('2027-04-14');
    // Annual FY 2027-28 ends Fri 31 Mar 2028; 30 working days → Fri 12 May 2028.
    expect(calculateDueDate('2028-03-31', 30)).toBe('2028-05-12');
    // Feb-2028 (leap) ends Tue 29 Feb; 1 working day → Wed 1 Mar.
    expect(calculateDueDate('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('returns the period end for 0 days, and rejects bad input', () => {
    expect(calculateDueDate('2026-08-31', 0)).toBe('2026-08-31');
    expect(() => calculateDueDate('2026-08-31', -1)).toThrow(RangeError);
    expect(() => calculateDueDate('2026-08-31', 1.5)).toThrow(RangeError);
    expect(() => calculateDueDate('2026-02-30', 1)).toThrow(RangeError);
    expect(() => calculateDueDate('2026-08-31', 1, ['not-a-date'])).toThrow(RangeError);
  });
});

describe('isWorkingDay', () => {
  it('is Monday to Friday, excluding holidays', () => {
    const none = new Set<string>();
    expect(isWorkingDay('2026-09-05', none)).toBe(false); // Saturday
    expect(isWorkingDay('2026-09-06', none)).toBe(false); // Sunday
    expect(isWorkingDay('2026-09-07', none)).toBe(true); // Monday
    expect(isWorkingDay('2026-09-07', new Set(['2026-09-07']))).toBe(false);
  });
});
