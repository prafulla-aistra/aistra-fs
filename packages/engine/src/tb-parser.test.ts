import { describe, expect, it } from 'vitest';
import { parseAmountText, spreadsheetNumberToDecimal } from './amounts';
import { inferMapping } from './fsli-inference';
import { checkRates, parseRateMonth } from './rates';
import {
  type Cell,
  detectTbLayout,
  parseTrialBalance,
  sameOrganisation,
  tbPeriodMatches,
} from './tb-parser';

const zohoTb = (lines: Cell[][], extra: Cell[][] = []): Cell[][] => [
  ['Aistra GenAI India Pvt Ltd'],
  ['Trial Balance'],
  ['From 01/08/2026 To 31/08/2026'],
  [],
  ['Account Code', 'Account Name', 'Account Type', 'Closing Balance'],
  ...lines,
  ...extra,
];

describe('amount parsing', () => {
  it.each([
    ['1,234.56', '1234.56', null],
    ['-1234.56', '-1234.56', null],
    ['(1,234.00)', '-1234', null],
    ['12,40,500.00', '1240500', null],
    ['1,234.00 Dr', '1234', 'DR'],
    ['1,234.00 Cr', '1234', 'CR'],
    ['₹ 5,000', '5000', null],
    ['', '0', null],
  ])('%j → %s', (text, value, suffix) => {
    const r = parseAmountText(text);
    expect(r.ok && r.value.toString()).toBe(value);
    expect(r.ok && r.suffix).toBe(suffix);
  });

  it('rejects non-numbers', () => {
    expect(parseAmountText('abc').ok).toBe(false);
    expect(parseAmountText('12.3.4').ok).toBe(false);
  });

  it('turns spreadsheet numbers into exact 2-decimal amounts through text, not float arithmetic', () => {
    expect(spreadsheetNumberToDecimal(1234.565).toFixed(2)).toBe('1234.57'); // float toFixed gives 1234.56
    expect(spreadsheetNumberToDecimal(0.1 + 0.2).toFixed(2)).toBe('0.30');
    expect(spreadsheetNumberToDecimal(-1.005).toFixed(2)).toBe('-1.01');
    expect(spreadsheetNumberToDecimal(1e-7).toFixed(2)).toBe('0.00');
  });
});

describe('detectTbLayout', () => {
  it('finds the header row, columns, period and organisation of a Zoho export', () => {
    const layout = detectTbLayout(zohoTb([]));
    expect(layout).toMatchObject({
      headerRow: 4,
      period: { from: '2026-08-01', to: '2026-08-31' },
      organisation: 'Aistra GenAI India Pvt Ltd',
      settings: {
        codeColumn: 0,
        nameColumn: 1,
        balanceColumn: 3,
        signConvention: 'DEBIT_POSITIVE',
      },
    });
  });

  it('detects separate debit and credit columns, and "as of" dates', () => {
    const layout = detectTbLayout([
      ['As of 31/08/2026'],
      ['Account Code', 'Account', 'Net Debit', 'Net Credit'],
    ]);
    expect(layout.period).toEqual({ asOf: '2026-08-31' });
    expect(layout.settings).toMatchObject({
      debitColumn: 2,
      creditColumn: 3,
      balanceColumn: null,
      signConvention: 'SEPARATE_COLUMNS',
    });
  });

  it('reports no header when there is no "Account Code" in the first 40 rows', () => {
    expect(detectTbLayout([['Name', 'Amount']]).settings).toBeNull();
  });
});

describe('parseTrialBalance', () => {
  const settings = detectTbLayout(zohoTb([])).settings!;

  it('reads signed balances (debit positive), skips blanks and the totals row', () => {
    const rows = zohoTb([
      ['1001', 'Bank', 'Bank', 5000],
      [],
      ['2001', 'Trade Payables', 'Accounts Payable', '(3,000.00)'],
      ['3001', 'Share Capital', 'Equity', -2000],
      [null, 'Total', null, 0],
    ]);
    const r = parseTrialBalance(rows, settings);
    expect(r.lines.map((l) => [l.accountCode, l.amount, l.sourceRows])).toEqual([
      ['1001', '5000', [6]],
      ['2001', '-3000', [8]],
      ['3001', '-2000', [9]],
    ]);
    expect(r.totals).toEqual({ debits: '5000.00', credits: '5000.00', difference: '0.00' });
    expect(r.balanced).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.info.map((i) => i.code)).toContain('TOTALS_SKIPPED');
  });

  it('honours Dr / Cr suffixes, and requires them in the Dr-Cr convention', () => {
    const rows = zohoTb([
      ['1001', 'Bank', '', '1,500.00 Dr'],
      ['2001', 'Payables', '', '1,500.00 Cr'],
    ]);
    expect(
      parseTrialBalance(rows, { ...settings, signConvention: 'DRCR_SUFFIX' }).lines.map(
        (l) => l.amount,
      ),
    ).toEqual(['1500', '-1500']);
    const missing = parseTrialBalance(zohoTb([['1001', 'Bank', '', '1500']]), {
      ...settings,
      signConvention: 'DRCR_SUFFIX',
    });
    expect(missing.errors[0]!.message).toMatch(/Row 6 \(1001\).*no Dr or Cr suffix/);
  });

  it('flips signs in the credit-positive convention', () => {
    const r = parseTrialBalance(
      zohoTb([
        ['1001', 'Bank', '', -100],
        ['2001', 'Payables', '', 100],
      ]),
      {
        ...settings,
        signConvention: 'CREDIT_POSITIVE',
      },
    );
    expect(r.lines.map((l) => l.amount)).toEqual(['100', '-100']);
  });

  it('reads separate debit and credit columns', () => {
    const rows: Cell[][] = [
      ['Account Code', 'Account Name', 'Debit', 'Credit'],
      ['1001', 'Bank', '2,500.00', ''],
      ['4001', 'Revenue', '', '2,500.00'],
    ];
    const r = parseTrialBalance(rows, detectTbLayout(rows).settings!);
    expect(r.lines.map((l) => l.amount)).toEqual(['2500', '-2500']);
    expect(r.balanced).toBe(true);
  });

  it('combines duplicate account codes with a warning, and keeps zero lines as info', () => {
    const r = parseTrialBalance(
      zohoTb([
        ['1001', 'Bank', '', 100],
        ['1001', 'Bank', '', 50],
        ['1002', 'Petty cash', '', 0],
        ['2001', 'Payables', '', -150],
      ]),
      settings,
    );
    expect(r.lines.find((l) => l.accountCode === '1001')).toMatchObject({
      amount: '150',
      sourceRows: [6, 7],
    });
    expect(r.warnings[0]).toMatchObject({ code: 'DUPLICATE_CODES', accounts: ['1001'] });
    expect(r.info.find((i) => i.code === 'ZERO_BALANCES')?.accounts).toEqual(['1002']);
  });

  it('errors on an amount without an account code and on non-numeric amounts (with row numbers)', () => {
    const r = parseTrialBalance(
      zohoTb([
        ['1001', 'Bank', '', 100],
        [null, 'Mystery', '', 25],
        ['2001', 'Payables', '', 'n/a'],
      ]),
      settings,
    );
    expect(r.errors.map((e) => e.code)).toEqual(['NOT_A_NUMBER', 'AMOUNT_WITHOUT_ACCOUNT']);
    expect(r.errors[0]!.rows).toEqual([8]);
    expect(r.errors[1]!.rows).toEqual([7]);
  });

  it('rejects an unbalanced trial balance and shows the difference', () => {
    const r = parseTrialBalance(
      zohoTb([
        ['1001', 'Bank', '', 1000.5],
        ['2001', 'Payables', '', -1000],
      ]),
      settings,
    );
    expect(r.balanced).toBe(false);
    expect(r.totals).toEqual({ debits: '1000.50', credits: '1000.00', difference: '0.50' });
    // A difference of exactly 0.01 is tolerated.
    expect(
      parseTrialBalance(
        zohoTb([
          ['1001', 'Bank', '', 1000.01],
          ['2001', 'P', '', -1000],
        ]),
        settings,
      ).balanced,
    ).toBe(true);
  });
});

describe('period and entity checks', () => {
  const aug = { startDate: '2026-08-01', endDate: '2026-08-31' };
  it('matches the task period, and detects a mismatch', () => {
    expect(tbPeriodMatches({ from: '2026-08-01', to: '2026-08-31' }, aug)).toBe(true);
    expect(tbPeriodMatches({ from: '2026-07-01', to: '2026-07-31' }, aug)).toBe(false);
    expect(tbPeriodMatches({ asOf: '2026-08-31' }, aug)).toBe(true);
    expect(tbPeriodMatches({ asOf: '2026-07-31' }, aug)).toBe(false);
    expect(tbPeriodMatches(null, aug)).toBe(true);
  });
  it('compares organisation names loosely', () => {
    expect(
      sameOrganisation('Aistra GenAI India Private Limited', 'Aistra GenAI India Pvt Ltd'),
    ).toBe(true);
    expect(sameOrganisation('Aistra Labs UK Ltd', 'Aistra GenAI India Pvt Ltd')).toBe(false);
  });
});

describe('inferMapping', () => {
  const entities = [
    { code: 'US', shortName: 'US', legalName: 'Aistra Labs Inc (US)' },
    { code: 'IN', shortName: 'India', legalName: 'Aistra GenAI India Pvt Ltd' },
    { code: 'UK', shortName: 'UK', legalName: 'Aistra Labs UK Ltd' },
    { code: 'UC', shortName: 'Unconstrained', legalName: 'Unconstrained INC' },
  ];
  it.each([
    ['Due from Aistra Labs UK Ltd', 'Other Current Asset', 'IC_REC', 'UK'],
    ['Due to Aistra Labs Inc (US)', 'Other Current Liability', 'IC_PAY', 'US'],
    ['IC Revenue - US', 'Income', 'IC_REV', 'US'],
    ['IC Service Charges - Unconstrained', 'Expense', 'IC_EXP', 'UC'],
    ['Investment - Unconstrained INC', 'Other Asset', 'INV_SUB', 'UC'],
  ])('%s → %s with counterparty', (name, type, fsli, cp) => {
    expect(inferMapping({ name, type }, entities, 'IN')).toMatchObject({
      fsliCode: fsli,
      counterpartyCode: cp,
    });
  });
  it.each([
    ['HDFC Bank Current Account', 'Bank', 'CASH'],
    ['Salaries and Wages', 'Expense', 'EMP'],
    ['Equity Share Capital', 'Equity', 'SHARE_CAP'],
    ['Securities Premium', 'Equity', 'SEC_PREM'],
    ['Accumulated Depreciation - Computers', 'Fixed Asset', 'PPE'],
    ['Deferred Tax Asset', 'Other Asset', 'DTA'],
    ['Income Tax Payable', 'Other Current Liability', 'CUR_TAX_LIAB'],
    ['Consulting Revenue', 'Income', 'REV_OPS'],
    ['Staff Welfare Expenses', 'Expense', 'EMP'],
    ['Advance to Suppliers', 'Other Current Asset', 'CUR_OTH'], // account-type default
  ])('%s (%s) → %s', (name, type, fsli) => {
    expect(inferMapping({ name, type }, entities, 'IN').fsliCode).toBe(fsli);
  });
});

describe('rates', () => {
  it('reads month formats', () => {
    expect(parseRateMonth('Aug-26')).toBe('2026-08-01');
    expect(parseRateMonth('August 2026')).toBe('2026-08-01');
    expect(parseRateMonth('2026-08')).toBe('2026-08-01');
    expect(parseRateMonth('08/2026')).toBe('2026-08-01');
    expect(parseRateMonth('Smarch-26')).toBeNull();
  });
  it('warns when opening differs from the prior closing, and on moves over 10%', () => {
    const w = checkRates([
      { month: '2026-07-01', currency: 'INR', opening: '83.1', closing: '83.5', average: '83.3' },
      { month: '2026-08-01', currency: 'INR', opening: '83.6', closing: '93.9', average: '83.7' },
    ]);
    expect(w.map((x) => x.code)).toEqual(['OPENING_NOT_PRIOR_CLOSING', 'LARGE_MOVE']);
    expect(w[1]!.message).toMatch(/closing 93.9 moved 12.5%/);
  });
});
