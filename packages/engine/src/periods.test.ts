import { describe, expect, it } from 'vitest';
import { addDays, dayOfWeek, daysInMonth, isLeapYear, parseIsoDate } from './dates';
import { fyLabel, generatePeriods } from './periods';

describe('fyLabel', () => {
  it('formats Indian financial years', () => {
    expect(fyLabel(2026)).toBe('FY 2026-27');
    expect(fyLabel(2099)).toBe('FY 2099-00');
    expect(() => fyLabel(26)).toThrow(RangeError);
  });
});

describe('generatePeriods', () => {
  const periods = generatePeriods(2026);
  const months = periods.filter((p) => p.type === 'MONTHLY');
  const quarters = periods.filter((p) => p.type === 'QUARTERLY');
  const annual = periods.filter((p) => p.type === 'ANNUAL');

  it('creates 12 months, 4 quarters and 1 annual period', () => {
    expect([months.length, quarters.length, annual.length]).toEqual([12, 4, 1]);
    expect(periods).toHaveLength(17);
  });

  it('runs the months April to March with correct start and end dates', () => {
    expect(months.map((m) => m.label)).toEqual([
      'Apr-2026',
      'May-2026',
      'Jun-2026',
      'Jul-2026',
      'Aug-2026',
      'Sep-2026',
      'Oct-2026',
      'Nov-2026',
      'Dec-2026',
      'Jan-2027',
      'Feb-2027',
      'Mar-2027',
    ]);
    expect(months.map((m) => m.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(months[0]).toMatchObject({ startDate: '2026-04-01', endDate: '2026-04-30' });
    expect(months[4]).toMatchObject({
      label: 'Aug-2026',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    });
    expect(months[8]).toMatchObject({ startDate: '2026-12-01', endDate: '2026-12-31' });
    expect(months[9]).toMatchObject({ startDate: '2027-01-01', endDate: '2027-01-31' });
    expect(months[11]).toMatchObject({ startDate: '2027-03-01', endDate: '2027-03-31' });
  });

  it('months are contiguous: each starts the day after the previous ends', () => {
    for (let i = 1; i < months.length; i++) {
      expect(months[i]!.startDate).toBe(addDays(months[i - 1]!.endDate, 1));
    }
  });

  it('gives February 28 days in a normal year and 29 in a leap year', () => {
    expect(generatePeriods(2026).find((p) => p.label === 'Feb-2027')!.endDate).toBe('2027-02-28');
    expect(generatePeriods(2027).find((p) => p.label === 'Feb-2028')!.endDate).toBe('2028-02-29');
    expect(generatePeriods(2023).find((p) => p.label === 'Feb-2024')!.endDate).toBe('2024-02-29');
    // Century rule: 2100 is not a leap year.
    expect(generatePeriods(2099).find((p) => p.label === 'Feb-2100')!.endDate).toBe('2100-02-28');
  });

  it('builds the quarters Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar', () => {
    expect(quarters.map((q) => [q.label, q.startDate, q.endDate])).toEqual([
      ['Q1 FY 2026-27', '2026-04-01', '2026-06-30'],
      ['Q2 FY 2026-27', '2026-07-01', '2026-09-30'],
      ['Q3 FY 2026-27', '2026-10-01', '2026-12-31'],
      ['Q4 FY 2026-27', '2027-01-01', '2027-03-31'],
    ]);
  });

  it('builds the annual period April to March', () => {
    expect(annual[0]).toEqual({
      type: 'ANNUAL',
      sequence: 1,
      label: 'FY 2026-27',
      startDate: '2026-04-01',
      endDate: '2027-03-31',
    });
  });
});

describe('date helpers', () => {
  it('know leap years and month lengths', () => {
    expect([2024, 2026, 2028, 2100, 2000].map(isLeapYear)).toEqual([
      true,
      false,
      true,
      false,
      true,
    ]);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('reject impossible dates', () => {
    expect(() => parseIsoDate('2027-02-29')).toThrow(RangeError);
    expect(() => parseIsoDate('2026-13-01')).toThrow(RangeError);
    expect(() => parseIsoDate('31/08/2026')).toThrow(RangeError);
    expect(parseIsoDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
  });

  it('add days across month and year ends, and know the weekday', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(dayOfWeek('2026-08-31')).toBe(1); // Monday
  });
});
