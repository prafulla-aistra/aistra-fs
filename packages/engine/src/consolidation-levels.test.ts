import { describe, expect, it } from 'vitest';
import { type CfsCheckData, runCfsChecks } from './cfs-checks';
import {
  type ConsolMember,
  consolidatedAmounts,
  eliminationChecks,
  equityAttribution,
  fctrMovement,
  fctrSplit,
  generateEliminations,
  profitAttribution,
} from './consolidation';
import type { FormatFsli } from './formats';
import { Decimal } from './money';
import type { MonthlyRate } from './rates';
import { type RateBasisCode, type TranslationLineInput, translateTB } from './translation';

/** Page 10: NCI attribution, levels in another currency, CFS checks. */
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
  PROFIT: ['E', 'BS', 'COMPUTED'],
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
const line = (e: { lines: { fsliCode: string; amount: string }[] }, f: string) =>
  e.lines.filter((l) => l.fsliCode === f).map((l) => l.amount);

describe('page 10 NCI fixture: P (USD) owns 60% of S (USD), level currency USD', () => {
  /*
   * Hand check (page 10 prompt F).
   *   Goodwill = cost 450 − 60% × (500 + 0 + 200) = 450 − 420 = 30.
   *   Investment: Cr INV_SUB 450; Dr SHARE_CAP 60% × 500 = 300; Dr RETAINED 60% × 200 = 120;
   *     Dr GOODWILL 30.
   *   NCI 40% of S: share capital 500 → Dr 200; retained earnings 300 → Dr 120;
   *     profit 200 → Dr PL_NCI 80; Cr NCI 400.
   *   Consolidated: cash 1,550 + 1,000 = 2,550; goodwill 30 → assets 2,580; profit 400 →
   *     owners 320, NCI 80; RE 300 + 300 − 120 − 120 = 360; NCI 400; share capital 1,500;
   *     equity attributable to owners 1,500 + 360 + 400 − 80 = 2,180; total equity 2,580.
   */
  const mk = (
    code: string,
    parentCode: string | null,
    pct: string | null,
    tb: Tb,
  ): ConsolMember => ({
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
  const r = generateEliminations({
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
  const c = consolidatedAmounts([P, S], r.entries, FSLIS);

  it('goodwill 30.00; investment Cr INV_SUB 450, Dr SHARE_CAP 300, Dr RETAINED 120, Dr GOODWILL 30', () => {
    expect(r.issues).toEqual([]);
    const inv = r.entries.find((e) => e.type === 'INVESTMENT')!;
    expect(inv.goodwill).toBe('30.00');
    expect(inv.lines.map((l) => [l.fsliCode, l.amount])).toEqual([
      ['INV_SUB', '-450.00'],
      ['SHARE_CAP', '300.00'],
      ['RETAINED', '120.00'],
      ['GOODWILL', '30.00'],
    ]);
  });

  it('NCI: Dr SHARE_CAP 200, Dr RETAINED 120, Dr PL_NCI 80, Cr NCI 400', () => {
    const nci = r.entries.find((e) => e.type === 'NCI')!;
    expect(nci.lines.map((l) => [l.fsliCode, l.amount])).toEqual([
      ['SHARE_CAP', '200.00'],
      ['RETAINED', '120.00'],
      ['PL_NCI', '80.00'],
      ['NCI', '-400.00'],
    ]);
    expect(nci.nciProfit).toBe('80.00');
  });

  it('consolidated: assets 2,580; profit 400 → owners 320, NCI 80; RE 360; NCI 400; share capital 1,500; total equity 2,580; nets to 0.00', () => {
    expect(new Decimal(c.CASH!).plus(c.GOODWILL!).toFixed(2)).toBe('2580.00');
    expect(c).toMatchObject({
      CASH: '2550.00',
      GOODWILL: '30.00',
      RETAINED: '-360.00',
      NCI: '-400.00',
      SHARE_CAP: '-1500.00',
      PROFIT: '-400.00',
      PL_NCI: '80.00',
      INV_SUB: '0.00',
    });
    const a = profitAttribution(c, r.entries);
    expect(a).toEqual({ total: '400.00', owners: '320.00', nci: '80.00' });
    expect(new Decimal(a.owners).plus(a.nci).toFixed(2)).toBe(a.total);
    expect(equityAttribution(c, FSLIS)).toEqual({
      owners: '2180.00',
      nci: '400.00',
      total: '2580.00',
    });
    expect(eliminationChecks([P, S], r.entries, FSLIS).every((x) => x.passed)).toBe(true);
  });

  it('FCTR split and movement (none in one currency)', () => {
    const s = fctrSplit(c, r.entries);
    expect(s).toEqual({ total: '0.00', owners: '0.00', nci: '0.00' });
    expect(fctrMovement(s, s)).toEqual({ total: '0.00', owners: '0.00', nci: '0.00' });
    // A movement from Dr 100 (owners 60 / NCI 40) to Dr 150 (90 / 60) is a loss of 50.
    expect(
      fctrMovement(
        { total: '150.00', owners: '90.00', nci: '60.00' },
        { total: '100.00', owners: '60.00', nci: '40.00' },
      ),
    ).toEqual({
      total: '-50.00',
      owners: '-30.00',
      nci: '-20.00',
    });
  });
});

describe('page 9 fixture carried to a level in USD (brought forward, recomputed in USD)', () => {
  /*
   * SGD → USD: closing 1 ÷ 1.25 = 0.8, average 1 ÷ 1.28 = 0.78125; historical SGD → USD 0.75.
   * LKR → USD: closing 1 ÷ 310, average 1 ÷ 305; historical / acquisition LKR → USD 0.0035.
   *   P in USD: INV_SUB 40,000 × 0.8 = 32,000.00; IC_PAY (10,000.00); IC_EXP 7,812.50.
   *   S in USD: IC_REC 3,100,000 ÷ 310 = 10,000.00; IC_REV 2,382,812.50 ÷ 305 = (7,812.50);
   *     SHARE_CAP 9,000,000 × 0.0035 = (31,500.00).
   *   IC balances: Dr IC_PAY 10,000.00 / Cr IC_REC 10,000.00; IC P&L: Dr IC_REV 7,812.50 /
   *     Cr IC_EXP 7,812.50 — both brought forward from level 1.
   *   Investment: goodwill 400.00 SGD × 0.8 = 320.00 USD; Cr INV_SUB 32,000.00, Dr SHARE_CAP
   *     31,500.00, Dr GOODWILL 320.00 → balancing Dr FCTR 180.00.
   */
  const toUsd = (
    code: string,
    fn: string,
    tb: Tb,
    hist: string,
    parentCode: string | null,
    pct: string | null,
  ): ConsolMember => {
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
    const t = translateTB({
      functionalCurrency: fn,
      targetCurrency: 'USD',
      period: PERIOD,
      rates: RATES,
      historicalRate: hist,
      lines,
      prior: null,
      priorPeriodLabel: 'Jul-2026',
      rollForwardPassed: false,
    });
    expect(t.status).toBe('OK');
    return {
      code,
      parentCode,
      heldByParentPct: pct,
      functionalCurrency: fn,
      accounts: t.lines.map((l) => ({
        fsliCode: l.fsliCode!,
        counterpartyCode: lines.find((x) => x.code === l.code)!.counterpartyCode,
        amount: l.translated,
      })),
      fctr: t.fctr,
    };
  };
  const P_TB: Tb = [
    ['INV_SUB', '40000', 'S'],
    ['CASH', '100000'],
    ['IC_PAY', '-12500', 'S'],
    ['IC_EXP', '10000', 'S'],
    ['REV_OPS', '-50000'],
    ['SHARE_CAP', '-60000'],
    ['RETAINED', '-27500'],
  ];
  const S_TB: Tb = [
    ['CASH', '12000000'],
    ['IC_REC', '3100000', 'P'],
    ['OTH_EXP', '1000000'],
    ['SHARE_CAP', '-9000000'],
    ['RETAINED', '-2000000'],
    ['IC_REV', '-2382812.50', 'P'],
    ['TRADE_PAY', '-2717187.50'],
  ];
  const P2 = toUsd('P', 'SGD', P_TB, '0.75', null, null);
  const S2 = toUsd('S', 'LKR', S_TB, '0.0035', 'P', '100');
  const r = generateEliminations({
    level: 2,
    levelCurrency: 'USD',
    levelParentCode: 'P',
    members: [P2, S2],
    levels: [
      { level: 1, parentCode: 'P', members: ['P', 'S'] },
      { level: 2, parentCode: 'P', members: ['P', 'S'] },
    ],
    icPairs: [{ a: 'P', b: 'S', tolerance: '1.00' }],
    acquisitions: [
      {
        subsidiaryCode: 'S',
        parentCode: 'P',
        steps: [
          {
            acquiredOn: '2024-04-01',
            pct: '100',
            cost: '40000',
            shareCapital: '9000000',
            premium: '0',
            preAcquisitionReserves: '0',
            rateToParent: '0.0044',
            rateToLevel: '0.0035',
          },
        ],
      },
    ],
    closingToLevel: {
      USD: '1',
      SGD: new Decimal(1).dividedBy('1.25').toString(),
      LKR: new Decimal(1).dividedBy('310').toString(),
    },
    averageToLevel: {
      USD: '1',
      SGD: new Decimal(1).dividedBy('1.28').toString(),
      LKR: new Decimal(1).dividedBy('305').toString(),
    },
    manual: [],
    fslis: FSLIS,
  });

  it('recomputes every entry in USD, each brought forward from level 1 and balanced', () => {
    expect(r.issues).toEqual([]);
    expect(r.entries.map((e) => [e.type, e.originLevel, e.balanced])).toEqual([
      ['IC_BALANCE', 1, true],
      ['IC_PNL', 1, true],
      ['INVESTMENT', 1, true],
    ]);
    expect(line(r.entries[0]!, 'IC_PAY')).toEqual(['10000.00']);
    expect(line(r.entries[1]!, 'IC_REV')).toEqual(['7812.50']);
    const inv = r.entries[2]!;
    expect(inv.goodwill).toBe('320.00');
    expect(inv.lines.map((l) => [l.fsliCode, l.amount])).toEqual([
      ['INV_SUB', '-32000.00'],
      ['SHARE_CAP', '31500.00'],
      ['GOODWILL', '320.00'],
      ['FCTR', '180.00'],
    ]);
    expect(eliminationChecks([P2, S2], r.entries, FSLIS).every((x) => x.passed)).toBe(true);
  });
});

describe('runCfsChecks', () => {
  const reg = (code: string, severity: 'BLOCKING' | 'WARNING' | 'INFO' = 'BLOCKING') => ({
    code,
    name: code,
    severity,
    threshold: '0',
    thresholdUnit: null,
    isActive: true,
  });
  const base: CfsCheckData = {
    membersNotFinalised: [],
    generated: true,
    stale: false,
    membersChanged: [],
    issues: [],
    eliminationChecks: [],
    bs: { totalAssets: '100.00', totalEquityLiabilities: '100.00' },
    profit: { profit: '10.00', carried: '10.00' },
    attribution: { total: '10.00', owners: '8.00', nci: '2.00' },
    icDifferences: [],
    notes: { visible: 2, notReviewed: [], staleFlags: 0 },
    acquisitionsToBeConfirmed: [],
    comparativePresent: true,
  };

  it('member data changed blocks; an unexplained IC difference is a warning; owners + NCI = profit', () => {
    const r = runCfsChecks(
      {
        ...base,
        membersChanged: ['VM'],
        icDifferences: [{ title: 'IC VS ↔ VM', amount: '-100.00', explained: false }],
      },
      [
        reg('CFS_ELIMINATIONS_CURRENT'),
        reg('CFS_IC_DIFFERENCES_EXPLAINED', 'WARNING'),
        reg('CFS_ATTRIBUTION_TIES'),
      ],
    );
    expect(r.map((x) => [x.code, x.result])).toEqual([
      ['CFS_ELIMINATIONS_CURRENT', 'FAIL'],
      ['CFS_IC_DIFFERENCES_EXPLAINED', 'FAIL'],
      ['CFS_ATTRIBUTION_TIES', 'PASS'],
    ]);
    expect(r[0]!.details).toMatch(/Member data changed/);
    const bad = runCfsChecks(
      { ...base, attribution: { total: '10.00', owners: '8.00', nci: '1.00' } },
      [reg('CFS_ATTRIBUTION_TIES')],
    );
    expect(bad[0]!.result).toBe('FAIL');
  });
});
