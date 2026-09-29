import { describe, expect, it } from 'vitest';
import { generatePeriods } from './periods';
import {
  hasPeriodEnded,
  nextTaskNumber,
  periodChoiceLabel,
  taskNumberPrefix,
} from './task-numbers';

const fy26 = generatePeriods(2026).map((p) => ({ ...p, fyStartYear: 2026 }));
const find = (label: string) => fy26.find((p) => p.label === label)!;

describe('task numbers', () => {
  it('uses SFS-YYYY-MM for months, SFS-FY27-Qn for quarters and SFS-FY27 for the year', () => {
    expect(taskNumberPrefix('SFS', find('Aug-2026'))).toBe('SFS-2026-08');
    expect(taskNumberPrefix('SFS', find('Jan-2027'))).toBe('SFS-2027-01');
    expect(taskNumberPrefix('CFS', find('Q1 FY 2026-27'))).toBe('CFS-FY27-Q1');
    expect(taskNumberPrefix('SFS', find('Q4 FY 2026-27'))).toBe('SFS-FY27-Q4');
    expect(taskNumberPrefix('SFS', find('FY 2026-27'))).toBe('SFS-FY27');
    expect(taskNumberPrefix('SFS', { ...find('FY 2026-27'), fyStartYear: 2099 })).toBe('SFS-FY00');
  });

  it('numbers from 001 and continues after the highest existing number', () => {
    expect(nextTaskNumber('SFS-2026-06', [])).toBe('SFS-2026-06-001');
    expect(nextTaskNumber('SFS-2026-08', ['SFS-2026-08-001'])).toBe('SFS-2026-08-002');
    expect(
      nextTaskNumber('SFS-2026-08', [
        'SFS-2026-08-001',
        'SFS-2026-08-004',
        'CFS-2026-08-009',
        'SFS-2026-07-007',
      ]),
    ).toBe('SFS-2026-08-005');
    // Quarter prefixes must not match monthly numbers of other prefixes.
    expect(nextTaskNumber('SFS-FY27', ['SFS-FY27-Q1-001'])).toBe('SFS-FY27-001');
  });
});

describe('periodChoiceLabel', () => {
  it('labels months, quarters and the year for the wizard', () => {
    expect(periodChoiceLabel(find('Apr-2026'))).toBe('Apr-2026');
    expect(fy26.filter((p) => p.type === 'QUARTERLY').map(periodChoiceLabel)).toEqual([
      'Q1 (Apr–Jun 2026)',
      'Q2 (Jul–Sep 2026)',
      'Q3 (Oct–Dec 2026)',
      'Q4 (Jan–Mar 2027)',
    ]);
    expect(periodChoiceLabel(find('FY 2026-27'))).toBe('FY 2026-27 (Apr-2026 to Mar-2027)');
  });
});

describe('hasPeriodEnded', () => {
  it('is true only after the end date (29-Sep-2026: Aug ended, Sep and Q2 not)', () => {
    const today = '2026-09-29';
    expect(hasPeriodEnded(find('Aug-2026').endDate, today)).toBe(true);
    expect(hasPeriodEnded(find('Sep-2026').endDate, today)).toBe(false);
    expect(hasPeriodEnded(find('Q2 FY 2026-27').endDate, today)).toBe(false);
    expect(hasPeriodEnded(find('Q1 FY 2026-27').endDate, today)).toBe(true);
    expect(hasPeriodEnded('2026-09-29', '2026-09-29')).toBe(false); // ends today
  });
});
