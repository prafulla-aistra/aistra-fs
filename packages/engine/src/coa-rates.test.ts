import { describe, expect, it } from 'vitest';
import { parseChartOfAccounts, planCoaMerge } from './coa-parser';
import { fyStartYearOf, monthsBetween, nextMonth, parseRateSheet, reviewRateMonth } from './rates';
import { checkTrialBalance } from './tb-checks';
import { detectTbLayout } from './tb-parser';

describe('parseChartOfAccounts', () => {
  it('reads a Zoho chart of accounts, skipping blanks and reporting rows without a code', () => {
    const r = parseChartOfAccounts([
      ['Chart of Accounts'],
      ['Account Name', 'Account Code', 'Account Type', 'Parent Account'],
      ['HDFC Bank', '1001', 'Bank', ''],
      [],
      ['Office Supplies', '6150', 'Expense', 'Other Expenses'],
      ['Nameless', '', 'Expense', ''],
    ]);
    expect(r.accounts).toEqual([
      { code: '1001', name: 'HDFC Bank', type: 'Bank', parent: null, row: 3 },
      { code: '6150', name: 'Office Supplies', type: 'Expense', parent: 'Other Expenses', row: 5 },
    ]);
    expect(r.warnings[0]).toMatchObject({ code: 'NO_ACCOUNT_CODE', rows: [6] });
  });

  it('fails without the header', () => {
    expect(parseChartOfAccounts([['Name', 'Type']]).errors[0]!.code).toBe('COLUMN_MISSING');
  });
});

describe('planCoaMerge', () => {
  it('adds new codes, updates changed names/types, and leaves the rest', () => {
    const plan = planCoaMerge(
      [
        { code: '1001', name: 'HDFC Bank', type: 'Bank', parent: null },
        { code: '6001', name: 'Salaries', type: 'Expense', parent: null },
      ],
      [
        { code: '1001', name: 'HDFC Bank', type: 'Bank', parent: null, row: 2 },
        { code: '6001', name: 'Salaries and Wages', type: 'Expense', parent: null, row: 3 },
        { code: '6150', name: 'Office Supplies', type: 'Expense', parent: null, row: 4 },
      ],
    );
    expect(plan.added.map((a) => a.code)).toEqual(['6150']);
    expect(plan.updated.map((u) => [u.account.code, u.before.name])).toEqual([
      ['6001', 'Salaries'],
    ]);
    expect(plan.unchanged.map((a) => a.code)).toEqual(['1001']);
  });
});

describe('parseRateSheet', () => {
  it('reads months as text or Excel dates, exact rates, blanks as missing, and skips USD', () => {
    const r = parseRateSheet([
      ['Month', 'Currency', 'Opening', 'Closing', 'Average'],
      ['Aug-26', 'INR', 83.9, 84.12, '84.01'],
      ['2026-08', 'gbp', '0.7815', '', 0.7829],
      [46235, 'SGD', 1.3555, 1.349, 1.3521], // 2026-08-01 as an Excel date serial
      ['Aug-26', 'USD', 1, 1, 1],
    ]);
    expect(r.errors).toEqual([]);
    expect(r.rates.map((x) => [x.month, x.currency, x.opening, x.closing, x.average])).toEqual([
      ['2026-08-01', 'INR', '83.9', '84.12', '84.01'],
      ['2026-08-01', 'GBP', '0.7815', null, '0.7829'],
      ['2026-08-01', 'SGD', '1.3555', '1.349', '1.3521'],
    ]);
  });

  it('reports unreadable months, bad rates and duplicates with row numbers', () => {
    const r = parseRateSheet([
      ['Month', 'Currency', 'Opening', 'Closing', 'Average'],
      ['Smarch', 'INR', 1, 1, 1],
      ['Aug-26', 'INR', -5, 1, 1],
      ['Aug-26', 'AED', 3.6725, 3.6725, 3.6725],
      ['2026-08', 'AED', 3.6725, 3.6725, 3.6725],
    ]);
    expect(r.errors.map((e) => e.row)).toEqual([2, 3, 5]);
    expect(r.errors[1]!.message).toMatch(/opening must be a positive number/);
  });

  it('lists the months of a period', () => {
    expect(monthsBetween('2026-07-01', '2026-09-30')).toEqual([
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
    ]);
    expect(monthsBetween('2026-04-01', '2027-03-31')).toHaveLength(12);
  });
});

describe('checkTrialBalance', () => {
  const rows = [
    ['Aistra GenAI India Pvt Ltd'],
    ['Trial Balance'],
    ['From 01/08/2026 To 31/08/2026'],
    [],
    ['Account Code', 'Account Name', 'Account Type', 'Closing Balance'],
    ['1001', 'Bank', 'Bank', 1000],
    ['6120', 'Staff Welfare Expenses', 'Expense', 250],
    ['2001', 'Payables', 'Accounts Payable', -1250],
  ];
  const base = {
    rows,
    settings: detectTbLayout(rows).settings!,
    layout: detectTbLayout(rows),
    period: { startDate: '2026-08-01', endDate: '2026-08-31', label: 'Aug-2026' },
    legalName: 'Aistra GenAI India Pvt Ltd',
    knownAccounts: new Set(['1001', '2001']),
    sameFileElsewhere: [],
  };

  it('validates a balanced TB and lists accounts not in the chart of accounts', () => {
    const r = checkTrialBalance(base);
    expect(r.status).toBe('VALIDATED');
    expect(r.newAccounts).toEqual([{ code: '6120', name: 'Staff Welfare Expenses' }]);
    expect(r.info.find((i) => i.code === 'NEW_ACCOUNTS')!.message).toMatch(
      /^1 account is not in the chart/,
    );
  });

  it('flags a period or organisation mismatch for acknowledgement', () => {
    const r = checkTrialBalance({
      ...base,
      period: { startDate: '2026-07-01', endDate: '2026-07-31', label: 'Jul-2026' },
      legalName: 'Aistra Labs UK Ltd',
    });
    expect(r.needsAcknowledgement.map((w) => w.code)).toEqual([
      'PERIOD_MISMATCH',
      'ORGANISATION_MISMATCH',
    ]);
    expect(r.status).toBe('VALIDATED_WITH_WARNINGS');
  });

  it('is an error when unbalanced, and warns about the same file elsewhere', () => {
    const unbalanced = rows.map((r) => (r[0] === '2001' ? ['2001', 'Payables', '', -1200] : r));
    const r = checkTrialBalance({
      ...base,
      rows: unbalanced,
      sameFileElsewhere: ['UK · Aug-2026'],
    });
    expect(r.status).toBe('ERROR');
    expect(r.errors.at(-1)!.message).toMatch(/differ by 50.00/);
    expect(r.warnings.map((w) => w.code)).toContain('DUPLICATE_FILE');
  });
});

describe('rate master months', () => {
  const r = (
    month: string,
    currency: string,
    opening: string | null,
    closing: string | null,
    average: string | null,
  ) => ({ month, currency, opening, closing, average });
  it('next month and FY of a month', () => {
    expect(nextMonth('2026-12-01')).toBe('2027-01-01');
    expect(fyStartYearOf('2027-03-01')).toBe(2026);
    expect(fyStartYearOf('2026-04-01')).toBe(2026);
  });
  it('complete, missing, and locked; opening ≠ prior closing; large move', () => {
    const rates = [
      r('2026-07-01', 'INR', '85.80', '86.40', '86.10'),
      r('2026-08-01', 'INR', '86.50', '96.90', '86.60'),
      r('2026-08-01', 'GBP', '0.742', null, '0.745'),
    ];
    const aug = reviewRateMonth(rates, '2026-08-01', ['INR', 'GBP'], false);
    expect(aug.status).toBe('MISSING');
    expect(aug.missing).toBe(1);
    expect(aug.checks.map((c) => `${c.currency}:${c.code}`)).toEqual([
      'GBP:MISSING',
      'INR:OPENING_NOT_PRIOR_CLOSING',
      'INR:LARGE_MOVE',
    ]);
    expect(aug.checks[0]!.message).toBe('GBP Aug-2026: closing missing.');
    expect(reviewRateMonth(rates, '2026-07-01', ['INR'], false).status).toBe('COMPLETE');
    expect(reviewRateMonth(rates, '2026-08-01', ['INR', 'GBP'], true).status).toBe('LOCKED');
  });
});
