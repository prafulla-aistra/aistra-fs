import { describe, expect, it } from 'vitest';
import { type CfsCheckData, runCfsChecks } from './cfs-checks';
import { type EntityCheckData, runSfsChecks } from './checks';
import {
  type ConsolMember,
  consolidatedAmounts,
  eliminationChecks,
  equityAttribution,
  generateEliminations,
  type GenerateEliminationsInput,
  profitAttribution,
} from './consolidation';
import type { FormatFsli } from './formats';
import { Decimal } from './money';
import { parseAcquisitionTemplate } from './acquisitions-template';
import { periodTiesToMonths, YTD_PRIOR_PROFIT_CODE, ytdToPeriod } from './tb-basis';

/** Decisions round 1: NCI at fair value, IC_DIFF_PL, YTD trial balances, period ties, checks. */
const F = (code: string, cls: FormatFsli['class'], statement: 'BS' | 'PL'): FormatFsli => ({
  code,
  name: code,
  class: cls,
  statement,
});
const FSLIS: FormatFsli[] = [
  F('INV_SUB', 'A', 'BS'),
  F('CASH', 'A', 'BS'),
  F('IC_REC', 'A', 'BS'),
  F('GOODWILL', 'A', 'BS'),
  F('IC_PAY', 'L', 'BS'),
  F('IC_DIFF', 'L', 'BS'),
  F('SHARE_CAP', 'E', 'BS'),
  F('SEC_PREM', 'E', 'BS'),
  F('RETAINED', 'E', 'BS'),
  F('OTH_RES', 'E', 'BS'),
  F('PROFIT', 'E', 'BS'),
  F('FCTR', 'E', 'BS'),
  F('NCI', 'E', 'BS'),
  F('PL_NCI', 'E', 'BS'),
  F('REV_OPS', 'I', 'PL'),
  F('IC_REV', 'I', 'PL'),
  F('IC_EXP', 'X', 'PL'),
  F('OTH_EXP', 'X', 'PL'),
  F('IC_DIFF_PL', 'X', 'PL'),
];
type Tb = [string, string, string?][];
const mk = (code: string, parentCode: string | null, pct: string | null, tb: Tb): ConsolMember => ({
  code,
  parentCode,
  heldByParentPct: pct,
  functionalCurrency: 'USD',
  accounts: tb.map(([fsliCode, amount, cp]) => ({
    fsliCode,
    amount,
    counterpartyCode: cp ?? null,
  })),
  fctr: null,
});
const P = mk('P', null, null, [
  ['INV_SUB', '450.00', 'S'],
  ['CASH', '1550.00'],
  ['SHARE_CAP', '-1500.00'],
  ['RETAINED', '-300.00'],
  ['REV_OPS', '-1000.00'],
  ['OTH_EXP', '800.00'],
]);
const S = mk('S', 'P', '60', [
  ['CASH', '1000.00'],
  ['SHARE_CAP', '-500.00'],
  ['RETAINED', '-300.00'],
  ['REV_OPS', '-400.00'],
  ['OTH_EXP', '200.00'],
]);
const base = (
  nci: 'PROPORTIONATE' | 'FAIR_VALUE',
  fv: string | null,
): GenerateEliminationsInput => ({
  level: 1,
  levelCurrency: 'USD',
  levelParentCode: 'P',
  members: [P, S],
  levels: [{ level: 1, parentCode: 'P', members: ['P', 'S'] }],
  icPairs: [],
  acquisitions: [
    {
      subsidiaryCode: 'S',
      parentCode: 'P',
      nciMeasurement: nci,
      nciFairValue: fv,
      steps: [
        {
          acquiredOn: '2024-04-01',
          pct: '60',
          cost: '450',
          shareCapital: '500',
          premium: '0',
          preAcquisitionReserves: '200',
          rateToParent: '1',
          rateToLevel: '1',
        },
      ],
    },
  ],
  closingToLevel: { USD: '1' },
  averageToLevel: { USD: '1' },
  manual: [],
  fslis: FSLIS,
});

describe('NCI at fair value (full goodwill)', () => {
  /*
   * Hand calculation (page 10 fixture, NCI fair value at acquisition 320):
   *   Net assets at acquisition = share capital 500 + premium 0 + pre-acquisition reserves 200 = 700.
   *   Total goodwill = (cost 450 + NCI fair value 320) − 100% × 700 = 70.
   *   Parent share = cost 450 − 60% × 700 = 450 − 420 = 30.
   *   NCI share = 70 − 30 = 40 (= NCI fair value 320 − 40% × 700 = 320 − 280).
   *   Investment entry: Cr INV_SUB 450; Dr SHARE_CAP 300; Dr RETAINED 120; Dr GOODWILL 30;
   *     Dr GOODWILL 40 / Cr NCI 40 (NCI share of goodwill). Nets to 0.
   *   NCI entry (unchanged): Dr SHARE_CAP 200, RETAINED 120, PL_NCI 80; Cr NCI 400.
   *   Consolidated: cash 2,550 + goodwill 70 = 2,620; NCI 400 + 40 = 440; equity attributable to
   *     owners 2,180 (unchanged); total equity 2,620; profit 400 → owners 320, NCI 80.
   */
  const r = generateEliminations(base('FAIR_VALUE', '320'));
  const c = consolidatedAmounts([P, S], r.entries, FSLIS);

  it('goodwill 70 (parent 30, NCI 40); the NCI share is added to NCI', () => {
    expect(r.issues).toEqual([]);
    const inv = r.entries.find((e) => e.type === 'INVESTMENT')!;
    expect(inv.lines.map((l) => [l.fsliCode, l.amount])).toEqual([
      ['INV_SUB', '-450.00'],
      ['SHARE_CAP', '300.00'],
      ['RETAINED', '120.00'],
      ['GOODWILL', '30.00'],
      ['GOODWILL', '40.00'],
      ['NCI', '-40.00'],
    ]);
    expect(inv.goodwill).toBe('70.00');
    expect(inv.nciGoodwill).toBe('40.00');
    expect(inv.balanced).toBe(true);
    expect(inv.calculation.join(' ')).toContain(
      'Total goodwill (USD) = (cost 450.00 + NCI fair value 320.00) − 100% × net assets 700.00 = 70.00: parent 30.00, NCI 40.00.',
    );
  });

  it('consolidated: goodwill 70, NCI 440, total equity 2,620; owners + NCI = profit', () => {
    expect(c).toMatchObject({
      CASH: '2550.00',
      GOODWILL: '70.00',
      NCI: '-440.00',
      PROFIT: '-400.00',
    });
    expect(equityAttribution(c, FSLIS)).toEqual({
      owners: '2180.00',
      nci: '440.00',
      total: '2620.00',
    });
    expect(profitAttribution(c, r.entries)).toEqual({
      total: '400.00',
      owners: '320.00',
      nci: '80.00',
    });
    expect(eliminationChecks([P, S], r.entries, FSLIS).every((x) => x.passed)).toBe(true);
  });

  it('proportionate share keeps goodwill 30; fair value without a value is reported, not guessed', () => {
    const prop = generateEliminations(base('PROPORTIONATE', null)).entries.find(
      (e) => e.type === 'INVESTMENT',
    )!;
    expect(prop.goodwill).toBe('30.00');
    const missing = generateEliminations(base('FAIR_VALUE', null));
    expect(missing.issues[0]).toMatch(/NCI fair value at the acquisition date/);
  });
});

describe('P&L intercompany differences go to IC_DIFF_PL', () => {
  it('group profit does not move by the mismatch; flagged', () => {
    const A = mk('A', null, null, [
      ['IC_EXP', '1000.00', 'B'],
      ['CASH', '-1000.00'],
    ]);
    const B = mk('B', 'A', '100', [
      ['IC_REV', '-900.00', 'A'],
      ['CASH', '900.00'],
    ]);
    const r = generateEliminations({
      ...base('PROPORTIONATE', null),
      members: [A, B],
      levelParentCode: 'A',
      levels: [{ level: 1, parentCode: 'A', members: ['A', 'B'] }],
      icPairs: [{ a: 'A', b: 'B', tolerance: '1.00' }],
      acquisitions: [],
    });
    const e = r.entries.find((x) => x.type === 'IC_PNL')!;
    expect(e.lines.map((l) => [l.fsliCode, l.amount])).toEqual([
      ['IC_EXP', '-1000.00'],
      ['IC_REV', '900.00'],
      ['IC_DIFF_PL', '100.00'],
    ]);
    expect(e.flagged).toBe(true);
    // Profit before eliminations: A (1,000) loss, B 900 profit → (100). After: still (100).
    const before = consolidatedAmounts([A, B], [], FSLIS).PROFIT;
    const after = consolidatedAmounts([A, B], [e], FSLIS).PROFIT;
    expect(after).toBe(before);
  });
});

describe('year-to-date trial balances', () => {
  const line = (code: string, amount: string, isPL: boolean) => ({
    code,
    name: code,
    type: isPL ? 'Income' : 'Bank',
    amount,
    isPL,
  });

  it('April (first period of the year): YTD is the period as is', () => {
    const r = ytdToPeriod({
      current: [line('4000', '-500.00', true), line('1000', '500.00', false)],
      previous: null,
      firstPeriodOfYear: true,
      previousLabel: 'Mar-2026',
    });
    expect(r.problems).toEqual([]);
    expect(r.lines.map((l) => [l.code, l.amount])).toEqual([
      ['4000', '-500.00'],
      ['1000', '500.00'],
    ]);
  });

  it('May: period P&L = May YTD − April YTD; earlier months’ profit added so the TB still nets to 0', () => {
    // April YTD revenue (500); May YTD revenue (1,200) and expense 300 → May revenue (700), expense 300.
    const r = ytdToPeriod({
      current: [
        line('4000', '-1200.00', true),
        line('5000', '300.00', true),
        line('1000', '900.00', false),
      ],
      previous: [
        { code: '4000', name: '4000', ytdAmount: '-500.00' },
        { code: '6000', name: '6000', ytdAmount: '50.00' },
      ],
      firstPeriodOfYear: false,
      previousLabel: 'Apr-2026',
    });
    expect(r.lines.map((l) => [l.code, l.amount])).toEqual([
      ['4000', '-700.00'],
      ['5000', '300.00'],
      ['1000', '900.00'],
      ['6000', '-50.00'],
      [YTD_PRIOR_PROFIT_CODE, '-450.00'],
    ]);
    expect(r.lines.reduce((s, l) => s.plus(l.amount), new Decimal(0)).toFixed(2)).toBe('0.00');
    expect(r.lines.find((l) => l.code === '4000')!.ytdAmount).toBe('-1200.00');
  });

  it('a YTD TB without the previous month’s TB is blocked with a clear message', () => {
    const r = ytdToPeriod({
      current: [line('4000', '-1200.00', true)],
      previous: null,
      firstPeriodOfYear: false,
      previousLabel: 'Apr-2026',
    });
    expect(r.problems).toEqual([
      expect.stringMatching(/upload the Apr-2026 YTD trial balance first/),
    ]);
  });
});

describe('quarters and years against their months', () => {
  it('monthly P&L adds up and the balance sheet equals the last month’s (within 0.50)', () => {
    const ok = periodTiesToMonths({
      monthsPl: [{ REV_OPS: '-100.00' }, { REV_OPS: '-120.00' }, { REV_OPS: '-130.00' }],
      periodPl: { REV_OPS: '-350.30' },
      lastMonthBs: { CASH: '1000.00', RETAINED: '-870.00', PROFIT: '-130.00' },
      periodBs: { CASH: '1000.00', RETAINED: '-650.00', PROFIT: '-350.00' },
      tolerance: '0.50',
    });
    expect(ok).toEqual({ plDiffs: [], bsDiffs: [] });
    const bad = periodTiesToMonths({
      monthsPl: [{ REV_OPS: '-100.00' }],
      periodPl: { REV_OPS: '-101.00' },
      lastMonthBs: { CASH: '10.00' },
      periodBs: { CASH: '11.00' },
      tolerance: '0.50',
    });
    expect(bad.plDiffs).toEqual([
      { fsli: 'REV_OPS', months: '-100.00', period: '-101.00', difference: '-1.00' },
    ]);
    expect(bad.bsDiffs.map((x) => x.fsli)).toContain('CASH');
  });
});

describe('checks that change severity once explained', () => {
  const reg = (code: string, severity: 'BLOCKING' | 'WARNING' | 'INFO', threshold = '0') => ({
    code,
    name: code,
    severity,
    threshold,
    thresholdUnit: 'AMOUNT' as const,
    isActive: true,
  });
  it('an IC difference above the tolerance blocks until explained, then warns', () => {
    const data = {
      icDifferences: [{ title: 'IC A ↔ B', amount: '-100.00', explained: false }],
    } as unknown as CfsCheckData;
    expect(runCfsChecks(data, [reg('CFS_IC_DIFFERENCES_EXPLAINED', 'BLOCKING')])[0]).toMatchObject({
      result: 'FAIL',
      severity: 'BLOCKING',
    });
    const explained = {
      icDifferences: [{ title: 'IC A ↔ B', amount: '-100.00', explained: true }],
    } as unknown as CfsCheckData;
    expect(
      runCfsChecks(explained, [reg('CFS_IC_DIFFERENCES_EXPLAINED', 'BLOCKING')])[0],
    ).toMatchObject({ result: 'FAIL', severity: 'WARNING' });
  });

  it('a quarter that does not tie to its months blocks until explained; unfinalised months only warn', () => {
    const base = {
      notes: { visible: 0, notReviewed: [], staleFlags: 0 },
    } as unknown as EntityCheckData;
    const period = (explanation: string | null, notFinalised: string[] = []) => ({
      ...base,
      period: {
        type: 'QUARTERLY' as const,
        monthsNotFinalised: notFinalised,
        ties: notFinalised.length
          ? null
          : {
              plDiffs: [{ fsli: 'REV_OPS', months: '-1.00', period: '-2.00', difference: '-1.00' }],
              bsDiffs: [],
            },
        explanation,
      },
    });
    const regs = [
      reg('PERIOD_MONTHS_FINALISED', 'WARNING'),
      reg('PERIOD_TIES_TO_MONTHS', 'BLOCKING', '0.50'),
    ];
    expect(runSfsChecks(period(null), regs).map((x) => [x.code, x.result, x.severity])).toEqual([
      ['PERIOD_MONTHS_FINALISED', 'PASS', 'WARNING'],
      ['PERIOD_TIES_TO_MONTHS', 'FAIL', 'BLOCKING'],
    ]);
    expect(runSfsChecks(period('Rounding of the June accrual reversal.'), regs)[1]).toMatchObject({
      result: 'FAIL',
      severity: 'WARNING',
    });
    expect(runSfsChecks(period(null, ['Jun-2026']), regs).map((x) => [x.code, x.result])).toEqual([
      ['PERIOD_MONTHS_FINALISED', 'FAIL'],
      ['PERIOD_TIES_TO_MONTHS', 'NA'],
    ]);
  });
});

describe('acquisitions template (Q3)', () => {
  const head = [
    'Subsidiary',
    'Parent',
    'Acquired on',
    '% acquired',
    'Cost',
    'Share capital',
    'Securities premium',
    'Pre-acquisition reserves',
    'NCI measurement',
    'NCI fair value',
    'To be confirmed',
    'Rates to be confirmed',
    'Note',
    'Rate USD',
    'Rate INR',
  ];
  it('reads valid rows, Excel dates and percentage cells', () => {
    const r = parseAcquisitionTemplate([
      ['Acquisitions register'],
      head,
      [
        'in',
        'US',
        45383,
        0.5849,
        1000000,
        '500,000',
        '0',
        '(200)',
        'Fair value',
        320,
        'N',
        'Y',
        'Step 1',
        0.012,
        '',
      ],
    ]);
    expect(r.problems).toEqual([]);
    expect(r.rows[0]).toMatchObject({
      row: 3,
      subsidiaryCode: 'IN',
      parentCode: 'US',
      acquiredOn: '2024-04-01',
      pctAcquired: '58.49',
      cost: '1000000',
      shareCapital: '500000',
      preAcquisitionReserves: '-200',
      nciMeasurement: 'FAIR_VALUE',
      nciFairValue: '320',
      toBeConfirmed: false,
      ratesToBeConfirmed: true,
      rates: [{ currency: 'USD', rate: '0.012' }],
      problems: [],
    });
  });
  it('reports row problems and duplicates', () => {
    const r = parseAcquisitionTemplate([
      head,
      ['UK', 'UK', '31/02/2024', 'abc', '', 10, '', '', 'Fair value', '', 'maybe', '', '', -1, ''],
      ['AE', 'IN', '2024-04-01', '100', 5, 5, '', '', '', '', '', '', '', '', ''],
      ['AE', 'IN', '2024-04-01', '100', 5, 5, '', '', '', '', '', '', '', '', ''],
    ]);
    expect(r.rows[0]!.problems).toEqual([
      'The subsidiary and the parent must differ.',
      'Acquired on: a date (YYYY-MM-DD).',
      '% acquired: a number.',
      'Cost: required.',
      'NCI fair value: required when NCI is measured at fair value.',
      'To be confirmed: Y or N.',
      'Rate USD: a number more than 0.',
    ]);
    expect(r.rows[1]!.problems).toEqual([]);
    expect(r.rows[2]!.problems).toEqual(['Same subsidiary, parent and date as row 3.']);
  });
  it('needs the header', () => {
    expect(parseAcquisitionTemplate([['x']]).problems[0]).toMatch(/No header row/);
    expect(parseAcquisitionTemplate([['Subsidiary', 'Parent']]).problems[0]).toMatch(
      /Columns missing: Acquired on/,
    );
  });
});
