import { describe, expect, it } from 'vitest';
import { buildVeracityTb, categoryMonthLabel } from './veracity';

const CATEGORY = [
  ['Name', 'Cateogry', "Jul'26", "Aug'26"],
  ['Operational Income', 'Revenue from Acquisions', 300, 1000],
  ['Cost of Sales', 'Cost of revenue  from Acquisitions', 100, 400],
  ['Bank Fees', 'Other Expenses', 10, 100],
];
// Notes tab: A code, B note, C description, F group USD.
const NOTES = [
  ['NOTE TO THE BALANCE SHEET'],
  [null, 'Note 7', 'Property Plant and Equipment'],
  ['FA01', null, 'Computer Equipment', null, null, 900],
  [null, 'Note 9', 'Banks'],
  ['B01', null, 'HNB LKR', null, null, 600],
  [null, 'Note 10', 'Account Payables'],
  ['AP01', null, 'Accounts Payable', null, null, 300],
  [null, 'Note 11', 'Equity'],
  ['SH01', null, 'Stated Capital', null, null, 100],
  ['SH02', null, 'Retained Earnings', null, null, 300],
  [null, null, 'Current Year Profit', null, null, 800],
];
const BS = [
  [null, 'Property Plant and Equipments', 'Note 7', 900],
  [null, 'Bank ', 'Note 9', 600],
  [null, 'Payables', 'Note 10', 300],
  [null, 'Equity', 'Note 11', 1200],
];
const PL = [[null, 'Profit after Tax', null, null, null, null, null, 800]];

describe('buildVeracityTb', () => {
  const r = buildVeracityTb({
    periodEnd: '2026-08-31',
    category: { rows: CATEGORY, fileName: 'Veracity Category.ods', sheet: 'Sheet1' },
    vscon: { notes: NOTES, summary: BS, pl: PL, fileName: 'VSCON.xlsx' },
  });

  it('P&L from the month column, balance sheet from the notes, earlier profit as YTD-PRIOR', () => {
    expect(r.problems).toEqual([]);
    expect(r.monthColumn).toBe("Aug'26");
    expect(r.monthProfit).toBe('500.00');
    expect(r.lines.map((l) => [l.code, l.amount, l.grouping])).toEqual([
      ['VC-OPERATIONAL-INCOME', '-1000.00', 'Revenue from Acquisions'],
      ['VC-COST-OF-SALES', '400.00', 'Cost of revenue  from Acquisitions'],
      ['VC-BANK-FEES', '100.00', 'Other Expenses'],
      ['FA01', '900.00', 'Property, Plant and Equipments (Net)'],
      ['B01', '600.00', 'Cash and Cash Equivalents'],
      ['AP01', '-300.00', 'Accounts Payable'],
      ['SH01', '-100.00', 'Common Shares'],
      ['SH02', '-300.00', 'Retained Earnings'],
      ['YTD-PRIOR', '-300.00', 'Retained Earnings'],
    ]);
    expect(r.lines.reduce((s, l) => s + Number(l.amount), 0)).toBe(0);
  });

  it('every line keeps its source; checks: notes = summary, assets = equity + liabilities, profit after tax', () => {
    expect(r.lines[0]!.source).toBe("Veracity Category.ods › Sheet1 › row 2, column D (Aug'26)");
    expect(r.lines[3]!.source).toBe('VSCON.xlsx › Notes › F3');
    expect(r.checks.every((c) => c.passed || c.expected === '—')).toBe(true);
    expect(r.checks.find((c) => c.code === 'ASSETS_EQUAL_EQUITY_LIABILITIES')!.passed).toBe(true);
    expect(r.checks.find((c) => c.code === 'CURRENT_YEAR_PROFIT')!.passed).toBe(true);
  });

  it('a VSCON imbalance goes to VG-DIFF and fails the check', () => {
    const bad = NOTES.map((row) =>
      row[0] === 'B01' ? ['B01', null, 'HNB LKR', null, null, 600.29] : row,
    );
    const x = buildVeracityTb({
      periodEnd: '2026-08-31',
      category: { rows: CATEGORY, fileName: 'c.ods', sheet: 'Sheet1' },
      vscon: { notes: bad, summary: BS, pl: PL, fileName: 'v.xlsx' },
    });
    expect(x.difference).toBe('-0.29');
    expect(x.checks.find((c) => c.code === 'ASSETS_EQUAL_EQUITY_LIABILITIES')!.passed).toBe(false);
  });

  it('a missing month column is a problem', () => {
    expect(categoryMonthLabel('2026-09-30')).toBe("Sep'26");
    const x = buildVeracityTb({
      periodEnd: '2026-09-30',
      category: { rows: CATEGORY, fileName: 'c.ods', sheet: 'Sheet1' },
      vscon: { notes: NOTES, summary: BS, pl: PL, fileName: 'v.xlsx' },
    });
    expect(x.problems[0]).toMatch(/no column for Sep'26/);
  });
});
