import { describe, expect, it } from 'vitest';
import {
  type AcquisitionInput,
  type ConsolMember,
  consolidatedAmounts,
  eliminationChecks,
  eliminationSummary,
  type GenerateEliminationsInput,
  generateEliminations,
  validateManualAdjustment,
} from './consolidation';
import type { FormatFsli } from './formats';
import { Decimal } from './money';
import type { MonthlyRate } from './rates';
import { type RateBasisCode, type TranslationLineInput, translateTB } from './translation';

/**
 * Page 9 fixture (CLAUDE.md prompt E). The expected answers were computed independently and
 * must match to the cent: rates per 1 USD SGD 1.30 / 1.25 / 1.28, LKR 300 / 310 / 305.
 */
const RATES: MonthlyRate[] = [
  { month: '2026-08-01', currency: 'SGD', opening: '1.30', closing: '1.25', average: '1.28' },
  { month: '2026-08-01', currency: 'LKR', opening: '300', closing: '310', average: '305' },
];
const PERIOD = { startDate: '2026-08-01', endDate: '2026-08-31', label: 'Aug-2026' };

const META: Record<string, [FormatFsli['class'], 'BS' | 'PL', RateBasisCode]> = {
  INV_SUB: ['A', 'BS', 'CLOSING'],
  CASH: ['A', 'BS', 'CLOSING'],
  IC_REC: ['A', 'BS', 'CLOSING'],
  GOODWILL: ['A', 'BS', 'CLOSING'],
  IC_PAY: ['L', 'BS', 'CLOSING'],
  TRADE_PAY: ['L', 'BS', 'CLOSING'],
  IC_DIFF: ['L', 'BS', 'CLOSING'],
  SHARE_CAP: ['E', 'BS', 'HISTORICAL'],
  SEC_PREM: ['E', 'BS', 'HISTORICAL'],
  RETAINED: ['E', 'BS', 'ROLL_FORWARD'],
  OTH_RES: ['E', 'BS', 'OPENING'],
  FCTR: ['E', 'BS', 'COMPUTED'],
  NCI: ['E', 'BS', 'COMPUTED'],
  PL_NCI: ['E', 'BS', 'COMPUTED'],
  REV_OPS: ['I', 'PL', 'AVERAGE'],
  IC_REV: ['I', 'PL', 'AVERAGE'],
  IC_EXP: ['X', 'PL', 'AVERAGE'],
  OTH_EXP: ['X', 'PL', 'AVERAGE'],
};
const FSLIS: FormatFsli[] = Object.entries(META).map(([code, [cls, statement]]) => ({
  code,
  name: code,
  class: cls,
  statement,
}));

type Tb = [fsli: string, amount: string, counterparty?: string][];

function translateS(tb: Tb): ConsolMember {
  const lines: TranslationLineInput[] = tb.map(([fsli, amount, cp], i) => ({
    code: `${fsli}-${i}`,
    name: fsli,
    fsliCode: fsli,
    fsliClass: META[fsli]![0],
    statement: META[fsli]![1],
    fsliRateBasis: META[fsli]![2],
    rateBasisOverride: null,
    counterpartyCode: cp ?? null,
    amount,
  }));
  const r = translateTB({
    functionalCurrency: 'LKR',
    targetCurrency: 'SGD',
    period: PERIOD,
    rates: RATES,
    historicalRate: '0.0044',
    lines,
    prior: null,
    priorPeriodLabel: 'Jul-2026',
    rollForwardPassed: false,
  });
  expect(r.status).toBe('OK');
  return {
    code: 'S',
    parentCode: 'P',
    heldByParentPct: '100',
    functionalCurrency: 'LKR',
    accounts: r.lines.map((l) => ({
      fsliCode: l.fsliCode!,
      counterpartyCode: lines.find((x) => x.code === l.code)!.counterpartyCode,
      amount: l.translated,
    })),
    fctr: r.fctr,
  };
}

const P: ConsolMember = {
  code: 'P',
  parentCode: null,
  heldByParentPct: null,
  functionalCurrency: 'SGD',
  accounts: (
    [
      ['INV_SUB', '40000.00', 'S'],
      ['CASH', '100000.00'],
      ['IC_PAY', '-12500.00', 'S'],
      ['IC_EXP', '10000.00', 'S'],
      ['REV_OPS', '-50000.00'],
      ['SHARE_CAP', '-60000.00'],
      ['RETAINED', '-27500.00'],
    ] as Tb
  ).map(([fsliCode, amount, cp]) => ({ fsliCode, amount, counterpartyCode: cp ?? null })),
  fctr: null,
};

const S_TB: Tb = [
  ['CASH', '12000000'],
  ['IC_REC', '3100000', 'P'],
  ['OTH_EXP', '1000000'],
  ['SHARE_CAP', '-9000000'],
  ['RETAINED', '-2000000'],
  ['IC_REV', '-2382812.50', 'P'],
  ['TRADE_PAY', '-2717187.50'],
];

const ACQ = (pre = '0'): AcquisitionInput => ({
  subsidiaryCode: 'S',
  parentCode: 'P',
  steps: [
    {
      acquiredOn: '2024-04-01',
      pct: '100',
      cost: '40000',
      shareCapital: '9000000',
      premium: '0',
      preAcquisitionReserves: pre,
      rateToParent: '0.0044',
      rateToLevel: '0.0044',
    },
  ],
});

const input = (s: ConsolMember, acq = ACQ()): GenerateEliminationsInput => ({
  level: 1,
  levelCurrency: 'SGD',
  levelParentCode: 'P',
  members: [P, s],
  levels: [{ level: 1, parentCode: 'P', members: ['P', 'S'] }],
  icPairs: [{ a: 'P', b: 'S', tolerance: '1.00' }],
  acquisitions: [acq],
  closingToLevel: { SGD: '1', LKR: new Decimal('1.25').dividedBy('310').toString() },
  averageToLevel: { SGD: '1', LKR: new Decimal('1.28').dividedBy('305').toString() },
  manual: [],
  fslis: FSLIS,
});

const amounts = (m: ConsolMember) =>
  Object.fromEntries(m.accounts.map((a) => [a.fsliCode, a.amount]));
const line = (e: { lines: { fsliCode: string; amount: string }[] }, f: string) =>
  e.lines.filter((l) => l.fsliCode === f).map((l) => l.amount);

describe('page 9 fixture: P (SGD) 100% owns S (LKR), level currency SGD', () => {
  const S = translateS(S_TB);

  it('translates S to SGD as expected', () => {
    expect(amounts(S)).toEqual({
      CASH: '48387.10',
      IC_REC: '12500.00',
      OTH_EXP: '4196.72',
      SHARE_CAP: '-39600.00',
      RETAINED: '-8666.67',
      IC_REV: '-10000.00',
      TRADE_PAY: '-10956.40',
    });
    // Profit 5,803.28 (credit); FCTR 4,139.25 Dr.
    const profit = S.accounts
      .filter((a) => META[a.fsliCode]![1] === 'PL')
      .reduce((s, a) => s.plus(a.amount), new Decimal(0));
    expect(profit.toFixed(2)).toBe('-5803.28');
    expect(S.fctr).toBe('4139.25');
  });

  const { entries, issues } = generateEliminations(input(S));
  const byType = (t: string) => entries.filter((e) => e.type === t);

  it('IC balances: Dr IC_PAY 12,500.00 / Cr IC_REC 12,500.00, difference 0.00', () => {
    expect(issues).toEqual([]);
    const [e] = byType('IC_BALANCE');
    expect(line(e!, 'IC_PAY')).toEqual(['12500.00']);
    expect(line(e!, 'IC_REC')).toEqual(['-12500.00']);
    expect(e!.difference).toBe('0.00');
    expect(e!.lines).toHaveLength(2);
    expect(e!.balanced).toBe(true);
  });

  it('IC revenue / charges: Dr IC_REV 10,000.00 / Cr IC_EXP 10,000.00, difference 0.00', () => {
    const [e] = byType('IC_PNL');
    expect(line(e!, 'IC_REV')).toEqual(['10000.00']);
    expect(line(e!, 'IC_EXP')).toEqual(['-10000.00']);
    expect(e!.difference).toBe('0.00');
    expect(e!.balanced).toBe(true);
  });

  it('investment: goodwill 400.00; Cr INV_SUB 40,000.00, Dr SHARE_CAP 39,600.00, Dr GOODWILL 400.00, no FCTR line', () => {
    const [e] = byType('INVESTMENT');
    expect(e!.goodwill).toBe('400.00');
    expect(e!.lines.map((l) => [l.fsliCode, l.amount])).toEqual([
      ['INV_SUB', '-40000.00'],
      ['SHARE_CAP', '39600.00'],
      ['GOODWILL', '400.00'],
    ]);
    expect(e!.balanced).toBe(true);
    expect(e!.calculation.join(' ')).toContain(
      'Goodwill (SGD) = cost 40,000.00 − net assets acquired 39,600.00 = 400.00',
    );
  });

  it('consolidated: assets 148,787.10; profit 45,803.28; RE (36,166.67); FCTR 4,139.25 Dr; payables (10,956.40); share capital (60,000.00); nets to 0.00', () => {
    const c = consolidatedAmounts([P, S], entries, FSLIS);
    expect(c.CASH).toBe('148387.10');
    expect(c.GOODWILL).toBe('400.00');
    expect(new Decimal(c.CASH!).plus(c.GOODWILL!).toFixed(2)).toBe('148787.10');
    expect(c.PROFIT).toBe('-45803.28');
    expect(c.RETAINED).toBe('-36166.67');
    expect(c.FCTR).toBe('4139.25');
    expect(c.TRADE_PAY).toBe('-10956.40');
    expect(c.SHARE_CAP).toBe('-60000.00');
    for (const f of ['INV_SUB', 'IC_REC', 'IC_PAY', 'IC_REV', 'IC_EXP']) expect(c[f]).toBe('0.00');
    const checks = eliminationChecks([P, S], entries, FSLIS);
    expect(checks.every((x) => x.passed)).toBe(true);
    const summary = eliminationSummary(entries);
    expect(summary).toMatchObject({
      entries: 3,
      balanced: true,
      icDifferencesFlagged: 0,
      goodwill: '400.00',
      capitalReserve: '0.00',
    });
  });

  it('variant 1: S IC_REC 3,075,200 → 12,400.00 SGD; difference 100.00 to IC_DIFF, flagged (tolerance 1.00)', () => {
    const v = translateS(
      S_TB.map(([f, a, cp]) =>
        f === 'IC_REC'
          ? [f, '3075200', cp]
          : f === 'TRADE_PAY'
            ? [f, '-2692387.50', cp]
            : [f, a, cp],
      ) as Tb,
    );
    expect(amounts(v).IC_REC).toBe('12400.00');
    const r = generateEliminations(input(v));
    const e = r.entries.find((x) => x.type === 'IC_BALANCE')!;
    expect(e.difference).toBe('-100.00');
    expect(line(e, 'IC_DIFF')).toEqual(['-100.00']);
    expect(e.flagged).toBe(true);
    expect(e.balanced).toBe(true);
    expect(eliminationSummary(r.entries).icDifferencesFlagged).toBe(1);
    // The consolidated balance sheet still balances; IC residuals are zero (the 100.00 is parked).
    expect(eliminationChecks([P, v], r.entries, FSLIS).every((x) => x.passed)).toBe(true);
  });

  it('variant 1b: a difference below the tolerance is rounding to FCTR, not flagged', () => {
    const v = translateS(
      S_TB.map(([f, a, cp]) =>
        f === 'IC_REC'
          ? [f, '3099900', cp]
          : f === 'TRADE_PAY'
            ? [f, '-2717087.50', cp]
            : [f, a, cp],
      ) as Tb,
    );
    const e = generateEliminations(input(v)).entries.find((x) => x.type === 'IC_BALANCE')!;
    // 3,099,900 × 1.25 / 310 = 12,499.60 → difference 0.40 < 1.00.
    expect(line(e, 'FCTR')).toEqual(['-0.40']);
    expect(e.lines.find((l) => l.fsliCode === 'FCTR')!.note).toBe('Rounding');
    expect(e.flagged).toBe(false);
  });

  it('variant 2: pre-acquisition reserves 500,000 LKR → negative goodwill 1,800.00 to capital reserve; Dr RETAINED 2,200.00', () => {
    const r = generateEliminations(input(S, ACQ('500000')));
    const e = r.entries.find((x) => x.type === 'INVESTMENT')!;
    expect(e.calculation.join(' ')).toContain('net assets acquired 41,800.00 = −1,800.00');
    expect(e.goodwill).toBe('-1800.00');
    expect(e.lines.map((l) => [l.fsliCode, l.amount, l.note])).toEqual([
      ['INV_SUB', '-40000.00', 'Investment in S'],
      ['SHARE_CAP', '39600.00', "100% of S's share capital"],
      ['RETAINED', '2200.00', 'Pre-acquisition reserves'],
      ['OTH_RES', '-1800.00', 'Capital reserve on consolidation'],
    ]);
    expect(e.balanced).toBe(true);
    expect(eliminationSummary(r.entries).capitalReserve).toBe('1800.00');
  });

  it('reports a subsidiary with no acquisitions register row instead of guessing', () => {
    const r = generateEliminations({ ...input(S), acquisitions: [] });
    expect(r.entries.some((e) => e.type === 'INVESTMENT')).toBe(false);
    expect(r.issues).toEqual([
      'Investment in S (held by P) not eliminated: no acquisitions register row.',
    ]);
  });

  it('a level-1 manual adjustment in LKR is carried into SGD: BS at closing, P&L at average, difference to FCTR', () => {
    const r = generateEliminations({
      ...input(S),
      level: 2,
      levels: [
        { level: 1, parentCode: 'S', members: ['S'] },
        { level: 2, parentCode: 'P', members: ['P', 'S'] },
      ],
      manual: [
        {
          id: 'm1',
          level: 1,
          currency: 'LKR',
          narration: 'Accrual',
          reason: 'Late invoice',
          lines: [
            { entityCode: 'S', fsliCode: 'OTH_EXP', amount: '30500' },
            { entityCode: 'S', fsliCode: 'CASH', amount: '-30500' },
          ],
        },
      ],
    });
    const m = r.entries.find((e) => e.type === 'MANUAL')!;
    // 30,500 × 1.28 / 305 = 128.00; 30,500 × 1.25 / 310 = 122.98; difference 5.02 to FCTR.
    expect(m.lines.map((l) => [l.fsliCode, l.amount])).toEqual([
      ['OTH_EXP', '128.00'],
      ['CASH', '-122.98'],
      ['FCTR', '-5.02'],
    ]);
    expect(m.originLevel).toBe(1);
    expect(m.balanced).toBe(true);
  });
});

describe('NCI: P owns 60% of A, A owns 100% of B (one currency, so every rate is 1)', () => {
  /*
   * Hand calculation.
   *   P: INV_SUB(A) 6,000; CASH 4,000; SHARE_CAP (10,000).
   *   A: INV_SUB(B) 2,000; CASH 10,000; OTH_EXP 1,000; SHARE_CAP (10,000); RETAINED (1,000);
   *      REV_OPS (2,000) → profit 1,000.
   *   B: CASH 3,500; OTH_EXP 500; SHARE_CAP (2,000); RETAINED (1,000); REV_OPS (1,000) → profit 500.
   *   Investment in A: 60% × 10,000 = 6,000 = cost → goodwill 0: Cr INV_SUB 6,000, Dr SHARE_CAP 6,000.
   *   Investment in B: 100% × 2,000 = 2,000 = cost → goodwill 0: Cr INV_SUB 2,000, Dr SHARE_CAP 2,000
   *     (within the A sub-group, so it counts for A's NCI).
   *   NCI in A = 40% of the A + B sub-group after the B elimination:
   *     share capital (10,000) + (2,000) + 2,000 = (10,000) → Dr 4,000
   *     retained earnings (1,000) + (1,000) = (2,000)        → Dr 800
   *     profit 1,000 + 500 = 1,500                           → Dr PL_NCI 600 (NCI share of profit)
   *     Cr NCI 5,400 = 40% × sub-group net assets (cash 10,000 + 3,500 = 13,500).
   *   Consolidated: cash 17,500; share capital (10,000); RE (2,000) + 800 = (1,200); PL_NCI 600;
   *     NCI (5,400); profit 1,500 → nets to 0.
   */
  const m = (
    code: string,
    parentCode: string | null,
    pct: string | null,
    tb: Tb,
  ): ConsolMember => ({
    code,
    parentCode,
    heldByParentPct: pct,
    functionalCurrency: 'SGD',
    accounts: tb.map(([fsliCode, amount, cp]) => ({
      fsliCode,
      amount,
      counterpartyCode: cp ?? null,
    })),
    fctr: null,
  });
  const P3 = m('P', null, null, [
    ['INV_SUB', '6000.00', 'A'],
    ['CASH', '4000.00'],
    ['SHARE_CAP', '-10000.00'],
  ]);
  const A = m('A', 'P', '60', [
    ['INV_SUB', '2000.00', 'B'],
    ['CASH', '10000.00'],
    ['OTH_EXP', '1000.00'],
    ['SHARE_CAP', '-10000.00'],
    ['RETAINED', '-1000.00'],
    ['REV_OPS', '-2000.00'],
  ]);
  const B = m('B', 'A', '100', [
    ['CASH', '3500.00'],
    ['OTH_EXP', '500.00'],
    ['SHARE_CAP', '-2000.00'],
    ['RETAINED', '-1000.00'],
    ['REV_OPS', '-1000.00'],
  ]);
  const step = (cost: string, sc: string, pct: string) => ({
    acquiredOn: '2024-04-01',
    pct,
    cost,
    shareCapital: sc,
    premium: '0',
    preAcquisitionReserves: '0',
    rateToParent: '1',
    rateToLevel: '1',
  });
  const levels = [
    { level: 1, parentCode: 'A', members: ['A', 'B'] },
    { level: 2, parentCode: 'P', members: ['P', 'A', 'B'] },
  ];
  const base: GenerateEliminationsInput = {
    level: 2,
    levelCurrency: 'SGD',
    levelParentCode: 'P',
    members: [P3, A, B],
    levels,
    icPairs: [],
    acquisitions: [
      { subsidiaryCode: 'A', parentCode: 'P', steps: [step('6000', '10000', '60')] },
      { subsidiaryCode: 'B', parentCode: 'A', steps: [step('2000', '2000', '100')] },
    ],
    closingToLevel: { SGD: '1' },
    averageToLevel: { SGD: '1' },
    manual: [],
    fslis: FSLIS,
  };

  it('level 2: NCI 40% of the A sub-group (Dr SHARE_CAP 4,000, RETAINED 800, PL_NCI 600; Cr NCI 5,400)', () => {
    const r = generateEliminations(base);
    expect(r.issues).toEqual([]);
    const nci = r.entries.find((e) => e.type === 'NCI')!;
    expect(nci.lines.map((l) => [l.fsliCode, l.amount])).toEqual([
      ['SHARE_CAP', '4000.00'],
      ['RETAINED', '800.00'],
      ['PL_NCI', '600.00'],
      ['NCI', '-5400.00'],
    ]);
    expect(nci.nciProfit).toBe('600.00');
    expect(nci.balanced).toBe(true);
    // The B investment is brought forward from level 1; A's arises at level 2.
    const inv = r.entries
      .filter((e) => e.type === 'INVESTMENT')
      .map((e) => [e.id, e.originLevel, e.goodwill]);
    expect(inv).toEqual([
      ['INVESTMENT:P:A', 2, '0.00'],
      ['INVESTMENT:A:B', 1, '0.00'],
    ]);
    const c = consolidatedAmounts([P3, A, B], r.entries, FSLIS);
    expect(c).toMatchObject({
      CASH: '17500.00',
      SHARE_CAP: '-10000.00',
      RETAINED: '-1200.00',
      PL_NCI: '600.00',
      NCI: '-5400.00',
      PROFIT: '-1500.00',
      INV_SUB: '0.00',
    });
    expect(eliminationChecks([P3, A, B], r.entries, FSLIS).every((x) => x.passed)).toBe(true);
  });

  it('level 1 (A is the level parent): no NCI, only the B investment', () => {
    const r = generateEliminations({ ...base, level: 1, levelParentCode: 'A', members: [A, B] });
    expect(r.entries.map((e) => e.type)).toEqual(['INVESTMENT']);
  });
});

describe('manual adjustments', () => {
  it('must balance and have two lines', () => {
    expect(
      validateManualAdjustment([{ entityCode: null, fsliCode: 'CASH', amount: '10.00' }]),
    ).toEqual([
      'Enter at least two lines.',
      'The adjustment does not balance: debits − credits = 10.00.',
    ]);
    expect(
      validateManualAdjustment([
        { entityCode: 'P', fsliCode: 'CASH', amount: '10.00' },
        { entityCode: null, fsliCode: 'OTH_EXP', amount: '-10.00' },
      ]),
    ).toEqual([]);
  });
});
