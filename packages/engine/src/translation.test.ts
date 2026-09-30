import { describe, expect, it } from 'vitest';
import type { MonthlyRate } from './rates';
import { type TranslateTbInput, type TranslationLineInput, translateTB } from './translation';

const rate = (
  month: string,
  currency: string,
  opening: string,
  closing: string,
  average: string,
): MonthlyRate => ({
  month,
  currency,
  opening,
  closing,
  average,
});
const RATES = [
  rate('2026-07-01', 'INR', '85.80', '86.40', '86.10'),
  rate('2026-08-01', 'INR', '86.40', '86.90', '86.60'),
  rate('2026-09-01', 'INR', '86.90', '87.20', '87.00'),
  rate('2026-08-01', 'GBP', '0.80', '0.80', '0.80'),
];
const line = (
  code: string,
  amount: string,
  fsliCode: string,
  fsliClass: TranslationLineInput['fsliClass'],
  statement: 'BS' | 'PL',
  fsliRateBasis: TranslationLineInput['fsliRateBasis'],
  rateBasisOverride: TranslationLineInput['rateBasisOverride'] = null,
): TranslationLineInput => ({
  code,
  name: code,
  amount,
  fsliCode,
  fsliClass,
  statement,
  fsliRateBasis,
  rateBasisOverride,
  counterpartyCode: null,
});

const TB = [
  line('1010', '1000', 'CASH', 'A', 'BS', 'CLOSING'),
  line('2001', '-200', 'TRADE_PAY', 'L', 'BS', 'CLOSING'),
  line('3001', '-500', 'SHARE_CAP', 'E', 'BS', 'HISTORICAL'),
  line('3200', '-165', 'RETAINED', 'E', 'BS', 'ROLL_FORWARD'),
  line('4000', '-300', 'REV_OPS', 'I', 'PL', 'AVERAGE'),
  line('6001', '165', 'EMP', 'X', 'PL', 'AVERAGE'),
];
const input = (over: Partial<TranslateTbInput> = {}): TranslateTbInput => ({
  functionalCurrency: 'INR',
  targetCurrency: 'USD',
  period: { startDate: '2026-08-01', endDate: '2026-08-31', label: 'Aug-2026' },
  rates: RATES,
  historicalRate: '0.0133333333',
  lines: TB,
  prior: null,
  priorPeriodLabel: 'Jul-2026',
  rollForwardPassed: true,
  ...over,
});
const amounts = (r: ReturnType<typeof translateTB>) =>
  Object.fromEntries(r.lines.map((l) => [l.code, l.translated]));

describe('translateTB', () => {
  it('uses closing / average / historical / opening, rounds each line, and FCTR balances to 0.00', () => {
    const r = translateTB(input());
    expect(r.status).toBe('OK');
    expect(amounts(r)).toEqual({
      '1010': '11.51', // 1000 ÷ 86.90
      '2001': '-2.30',
      '3001': '-6.67', // × 0.0133333333
      '3200': '-1.91', // opening 1 ÷ 86.40 (no finalised prior translation)
      '4000': '-3.46', // ÷ 86.60
      '6001': '1.91',
    });
    expect(r.profit).toBe('-1.55');
    expect(r.fctr).toBe('0.92');
    expect(r.totals).toEqual({ functional: '0.00', translated: '0.00' });
    expect(r.rates.closing).toMatchObject({
      value: '0.0115074799',
      formula: '1 ÷ 86.90',
      sourceMonths: ['Aug-2026'],
    });
    expect(r.reMethod).toEqual({
      kind: 'OPENING_RATE',
      text: 'Opening rate: there is no finalised Jul-2026 translation in USD.',
    });
    expect(r.lines.find((l) => l.code === '3200')!.basisLabel).toBe(
      'opening (roll-forward not available)',
    );
    expect(r.summary).toMatchObject({
      totalAssets: '11.51',
      totalLiabilities: '2.30',
      profit: '1.55',
      fctr: '-0.92',
      balanced: true,
    });
  });

  it('never rounds the rate before multiplying', () => {
    // 1 ÷ 86.90 rounded to 10 dp would give 11,507,479.90; full precision gives 11,507,479.86.
    const r = translateTB(
      input({
        lines: [
          line('1010', '1000000000', 'CASH', 'A', 'BS', 'CLOSING'),
          line('3001', '-1000000000', 'SHARE_CAP', 'E', 'BS', 'HISTORICAL'),
        ],
      }),
    );
    expect(r.lines[0]!.translated).toBe('11507479.86');
  });

  it('rounds half away from zero', () => {
    const lines = [
      line('1010', '0.02', 'CASH', 'A', 'BS', 'CLOSING'),
      line('2001', '-0.02', 'TRADE_PAY', 'L', 'BS', 'CLOSING'),
    ];
    const r = translateTB(input({ functionalCurrency: 'GBP', lines, historicalRate: '1.27' }));
    expect(amounts(r)).toEqual({ '1010': '0.03', '2001': '-0.03' }); // 0.025 → 0.03, −0.025 → −0.03
  });

  it('rolls retained earnings forward from the finalised prior translation', () => {
    const r = translateTB(
      input({ prior: { periodLabel: 'Jul-2026', retained: '-1.00', profit: '-0.50' } }),
    );
    expect(amounts(r)['3200']).toBe('-1.50');
    expect(r.fctr).toBe('0.51');
    expect(r.totals.translated).toBe('0.00');
    expect(r.reMethod.kind).toBe('ROLL_FORWARD');
    expect(r.reMethod.text).toBe(
      'Rolled forward from finalised Jul-2026: retained earnings 1.00 Cr + profit 0.50 Cr = 1.50 Cr.',
    );
  });

  it('allocates rolled-forward RE across several RE accounts in proportion', () => {
    const lines = [
      ...TB.filter((l) => l.code !== '3200'),
      line('3200', '-100', 'RETAINED', 'E', 'BS', 'ROLL_FORWARD'),
      line('3210', '-65', 'RETAINED', 'E', 'BS', 'ROLL_FORWARD'),
    ];
    const r = translateTB(
      input({ lines, prior: { periodLabel: 'Jul-2026', retained: '-1.00', profit: '-0.50' } }),
    );
    expect([amounts(r)['3200'], amounts(r)['3210']]).toEqual(['-0.91', '-0.59']);
  });

  it('uses the opening rate with a warning when the roll-forward check failed', () => {
    const r = translateTB(
      input({
        rollForwardPassed: false,
        prior: { periodLabel: 'Jul-2026', retained: '-1.00', profit: '-0.50' },
      }),
    );
    expect(amounts(r)['3200']).toBe('-1.91');
    expect(r.warnings).toEqual([
      'Retained earnings are translated at the opening rate because the retained-earnings roll-forward check did not pass.',
    ]);
  });

  it('missing historical rate → opening rate and a warning', () => {
    const r = translateTB(input({ historicalRate: null }));
    const sc = r.lines.find((l) => l.code === '3001')!;
    expect([sc.translated, sc.basisLabel]).toEqual(['-5.79', 'opening (no historical rate)']);
    expect(r.warnings[0]).toMatch(/No historical rate INR → USD/);
    expect(r.totals.translated).toBe('0.00');
  });

  it('missing closing rate → fail, no figures', () => {
    const r = translateTB(
      input({
        rates: RATES.map((x) =>
          x.month === '2026-08-01' && x.currency === 'INR' ? { ...x, closing: null } : x,
        ),
      }),
    );
    expect(r.status).toBe('FAIL');
    expect(r.failures[0]).toMatch(/closing rate is missing \(INR Aug-2026 closing\)/);
    expect(r.lines).toEqual([]);
    expect(r.fctr).toBeNull();
  });

  it('unmapped lines → fail', () => {
    const r = translateTB(
      input({
        lines: [
          ...TB,
          {
            ...line('9999', '0', 'X', 'A', 'BS', 'CLOSING'),
            fsliCode: null,
            statement: null,
            fsliRateBasis: null,
          },
        ],
      }),
    );
    expect(r.failures[0]).toMatch(/not mapped/);
  });

  it('target = functional currency: every rate 1, FCTR 0', () => {
    const r = translateTB(input({ targetCurrency: 'INR' }));
    expect(amounts(r)).toEqual({
      '1010': '1000.00',
      '2001': '-200.00',
      '3001': '-500.00',
      '3200': '-165.00',
      '4000': '-300.00',
      '6001': '165.00',
    });
    expect(r.fctr).toBe('0.00');
    expect(r.reMethod.kind).toBe('SAME_CURRENCY');
  });

  it('honours a rate-basis override on an account', () => {
    const lines = TB.map((l) =>
      l.code === '1010' ? { ...l, rateBasisOverride: 'AVERAGE' as const } : l,
    );
    const r = translateTB(input({ lines }));
    const bank = r.lines.find((l) => l.code === '1010')!;
    expect([bank.translated, bank.basis, bank.overridden]).toEqual(['11.55', 'AVERAGE', true]);
    expect(r.totals.translated).toBe('0.00');
  });

  it('quarter: average of the monthly averages, sources listed', () => {
    const r = translateTB(
      input({ period: { startDate: '2026-07-01', endDate: '2026-09-30', label: 'Q2' } }),
    );
    expect(r.rates.average.sourceMonths).toEqual(['Jul-2026', 'Aug-2026', 'Sep-2026']);
    expect(r.rates.opening.sourceMonths).toEqual(['Jul-2026']);
    expect(r.rates.closing.sourceMonths).toEqual(['Sep-2026']);
    expect(r.rates.average.value).toBe('0.0115517905'); // 1 ÷ mean(86.10, 86.60, 87.00)
  });
});
