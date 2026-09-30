import { describe, expect, it } from 'vitest';
import {
  type ClassifiedLine,
  compareAccounts,
  compareFslis,
  columnTotal,
  comparativePeriod,
  rollForwardCheck,
  varianceFlag,
} from './comparatives';

describe('comparativePeriod', () => {
  it.each([
    [
      { type: 'MONTHLY', sequence: 5, fyStartYear: 2026 },
      'PREVIOUS_PERIOD',
      { sequence: 4, fyStartYear: 2026 },
    ], // Aug → Jul
    [
      { type: 'MONTHLY', sequence: 1, fyStartYear: 2026 },
      'PREVIOUS_PERIOD',
      { sequence: 12, fyStartYear: 2025 },
    ], // Apr-26 → Mar-26
    [
      { type: 'QUARTERLY', sequence: 1, fyStartYear: 2026 },
      'PREVIOUS_PERIOD',
      { sequence: 4, fyStartYear: 2025 },
    ], // Q1 → previous Q4
    [
      { type: 'QUARTERLY', sequence: 3, fyStartYear: 2026 },
      'PREVIOUS_PERIOD',
      { sequence: 2, fyStartYear: 2026 },
    ],
    [
      { type: 'ANNUAL', sequence: 1, fyStartYear: 2026 },
      'PREVIOUS_PERIOD',
      { sequence: 1, fyStartYear: 2025 },
    ],
    [
      { type: 'MONTHLY', sequence: 5, fyStartYear: 2026 },
      'SAME_PERIOD_LAST_YEAR',
      { sequence: 5, fyStartYear: 2025 },
    ], // Aug-26 → Aug-25
    [
      { type: 'QUARTERLY', sequence: 1, fyStartYear: 2026 },
      'SAME_PERIOD_LAST_YEAR',
      { sequence: 1, fyStartYear: 2025 },
    ],
  ] as const)('%j %s → %j', (p, basis, expected) => {
    expect(comparativePeriod(p, basis)).toEqual({ type: p.type, ...expected });
  });
});

const line = (
  code: string,
  amount: string,
  fsliCode: string | null,
  statement: 'BS' | 'PL' | null = 'BS',
): ClassifiedLine => ({
  code,
  name: code,
  amount,
  fsliCode,
  statement,
});

describe('rollForwardCheck', () => {
  const jul = [
    line('3200', '-165000000.00', 'RETAINED'),
    line('4001', '-20000000.00', 'REV_OPS', 'PL'),
    line('6001', '3643415.84', 'EMP', 'PL'),
  ];
  it('passes when opening RE = prior RE + prior profit (India Aug-26)', () => {
    const r = rollForwardCheck({
      basis: 'PREVIOUS_PERIOD',
      current: [line('3200', '-181356584.16', 'RETAINED')],
      comparative: jul,
    });
    expect(r).toEqual({
      status: 'PASS',
      openingRe: '-181356584.16',
      priorRe: '-165000000.00',
      priorPl: '-16356584.16',
      expected: '-181356584.16',
      difference: '0.00',
    });
  });
  it('tolerates 1.00 and fails beyond it', () => {
    const cur = (a: string) => [line('3200', a, 'RETAINED')];
    expect(
      rollForwardCheck({
        basis: 'PREVIOUS_PERIOD',
        current: cur('-181356585.16'),
        comparative: jul,
      }).status,
    ).toBe('PASS');
    const fail = rollForwardCheck({
      basis: 'PREVIOUS_PERIOD',
      current: cur('-181356585.17'),
      comparative: jul,
    });
    expect(fail).toMatchObject({ status: 'FAIL', difference: '-1.01' });
  });
  it('is not applicable against the same period last year, and needs a comparative', () => {
    expect(
      rollForwardCheck({ basis: 'SAME_PERIOD_LAST_YEAR', current: [], comparative: jul }).status,
    ).toBe('NOT_APPLICABLE');
    expect(
      rollForwardCheck({ basis: 'PREVIOUS_PERIOD', current: [], comparative: null }).status,
    ).toBe('NO_COMPARATIVE');
  });
});

describe('varianceFlag', () => {
  const rule = { pctThreshold: '0.20', materiality: '100000' };
  it('needs both 20% of the comparative and the materiality amount', () => {
    expect(varianceFlag('800000', '1200000', rule, 'CUR_OTH')).toBe(true); // −33.3%, 400,000
    expect(varianceFlag('350000', '700000', rule, 'OTH_EXP')).toBe(true); // −50%, 350,000
    expect(varianceFlag('85000', '82000', rule, 'CASH')).toBe(false); // under materiality
    expect(varianceFlag('30849500', '29800000', rule, 'IC_REC')).toBe(false); // 3.5%
    expect(varianceFlag('50000', '10000', rule, 'OTH_EXP')).toBe(false); // 400% but 40,000
    expect(varianceFlag('880000', '1100000', rule, 'OTH_EXP')).toBe(true); // exactly 20% and 220,000
  });
  it('never flags retained earnings or a nil comparative', () => {
    expect(varianceFlag('-181356584.16', '-165000000', rule, 'RETAINED')).toBe(false);
    expect(varianceFlag('400000', '0', rule, 'CUR_OTH')).toBe(false);
  });
});

describe('compareAccounts / compareFslis', () => {
  const rule = { pctThreshold: '0.20', materiality: '100000' };
  const current = [
    line('1300', '800000.00', 'CUR_OTH'),
    line('1455', '400000.00', 'CUR_OTH'),
    line('2001', '-1200000.00', 'TRADE_PAY'),
  ];
  const comparative = [
    line('1300', '1200000.00', 'CUR_OTH'),
    line('1600', '500000.00', 'DTA'),
    line('2001', '-1700000.00', 'TRADE_PAY'),
  ];
  it('computes variance, %, tags New / Nil this period, and flags', () => {
    const rows = compareAccounts(current, comparative, rule);
    expect(
      rows.map((r) => [
        r.code,
        r.current,
        r.comparative,
        r.variance,
        r.variancePct,
        r.tag,
        r.flagged,
      ]),
    ).toEqual([
      ['1300', '800000.00', '1200000.00', '-400000.00', '-33.3', null, true],
      ['1455', '400000.00', '0.00', '400000.00', null, 'NEW', false],
      ['1600', '0.00', '500000.00', '-500000.00', '-100.0', 'NIL_THIS_PERIOD', true],
      ['2001', '-1200000.00', '-1700000.00', '500000.00', '29.4', null, true],
    ]);
  });
  it('without a comparative, the comparative columns stay blank', () => {
    const rows = compareAccounts(current, null, rule);
    expect(
      rows.every(
        (r) => r.comparative === null && r.variance === null && !r.flagged && r.tag === null,
      ),
    ).toBe(true);
  });
  it('FSLI view sums lines per FSLI in FSLI order', () => {
    const fslis = [
      { code: 'DTA', name: 'Deferred tax assets', sortOrder: 1 },
      { code: 'CUR_OTH', name: 'Other current assets', sortOrder: 2 },
      { code: 'TRADE_PAY', name: 'Trade payables', sortOrder: 3 },
    ];
    const rows = compareFslis(current, comparative, fslis, rule);
    expect(rows.map((r) => [r.code, r.current, r.comparative, r.flagged])).toEqual([
      ['DTA', '0.00', '500000.00', true],
      ['CUR_OTH', '1200000.00', '1200000.00', false],
      ['TRADE_PAY', '-1200000.00', '-1700000.00', true],
    ]);
  });
  it('column totals', () => {
    expect(columnTotal(['100.00', '-100.00', null])).toBe('0.00');
  });
});
