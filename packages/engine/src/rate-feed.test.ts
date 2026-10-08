import { describe, expect, it } from 'vitest';
import { monthFromDaily, perUsdFromBase } from './rate-feed';

/** Hand-calculated: Sep-2026 (1 Sep is a Tuesday; 31 Aug a Monday). */
const DAILY = [
  { date: '2026-08-28', perUsd: '94.00' },
  { date: '2026-08-31', perUsd: '94.50' },
  { date: '2026-09-01', perUsd: '95' },
  { date: '2026-09-05', perUsd: '99' }, // Saturday: ignored
  { date: '2026-09-15', perUsd: '96' },
  { date: '2026-09-30', perUsd: '97.123456789012' },
  { date: '2026-10-01', perUsd: '90' }, // next month: ignored
];

describe('monthFromDaily', () => {
  it('opening = previous month last working day; closing = last working day; average = mean', () => {
    expect(monthFromDaily('2026-09-01', DAILY)).toEqual({
      opening: '94.5000000000',
      closing: '97.1234567890',
      // (95 + 96 + 97.123456789012) / 3 = 96.041152263004
      average: '96.0411522630',
      openingDate: '2026-08-31',
      closingDate: '2026-09-30',
      days: 3,
      problems: [],
    });
  });

  it('rounds once, half away from zero, to 10 decimals', () => {
    const r = monthFromDaily('2026-09-01', [
      { date: '2026-08-31', perUsd: '1.00000000005' },
      { date: '2026-09-29', perUsd: '1.00000000005' },
      { date: '2026-09-30', perUsd: '1.00000000004' },
    ]);
    expect([r.opening, r.closing, r.average]).toEqual([
      '1.0000000001',
      '1.0000000000',
      '1.0000000000',
    ]);
  });

  it('reports a month without rates, a stale month end and a missing opening', () => {
    expect(monthFromDaily('2026-09-01', []).problems).toEqual([
      'No working-day rates were published in this month.',
      "No rate for the previous month's last working day (opening).",
    ]);
    expect(
      monthFromDaily('2026-09-01', [
        { date: '2026-08-31', perUsd: '1' },
        { date: '2026-09-10', perUsd: '1' },
      ]).problems,
    ).toEqual(['The last rate of the month is on 2026-09-10, more than a week before month end.']);
  });
});

describe('perUsdFromBase', () => {
  it('divides at full precision (ECB rates are per EUR)', () => {
    // 110.8335 / 1.1667 at 40 significant digits.
    expect(perUsdFromBase('110.8335', '1.1667')).toBe('94.9974286448958601182823347904345590126');
    expect(perUsdFromBase('2', '4')).toBe('0.5');
    expect(() => perUsdFromBase('1', '0')).toThrow();
  });
});
