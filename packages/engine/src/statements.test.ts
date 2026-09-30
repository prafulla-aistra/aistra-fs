import { describe, expect, it } from 'vitest';
import type { FormatFsli, FormatLine } from './formats';
import {
  buildStatement,
  fsliAmounts,
  intercompanyNote,
  lineNote,
  noteNumbers,
  scaleAmount,
  type StatementAccount,
  statementTitle,
} from './statements';

const FSLIS: FormatFsli[] = [
  { code: 'CASH', name: 'Cash', statement: 'BS', class: 'A' },
  { code: 'IC_REC', name: 'IC receivables', statement: 'BS', class: 'A' },
  { code: 'TRADE_PAY', name: 'Trade payables', statement: 'BS', class: 'L' },
  { code: 'IC_PAY', name: 'IC payables', statement: 'BS', class: 'L' },
  { code: 'SHARE_CAP', name: 'Share capital', statement: 'BS', class: 'E' },
  { code: 'PROFIT', name: 'Profit', statement: 'BS', class: 'E' },
  { code: 'FCTR', name: 'FCTR', statement: 'BS', class: 'E' },
  { code: 'REV_OPS', name: 'Revenue', statement: 'PL', class: 'I' },
  { code: 'IC_REV', name: 'IC revenue', statement: 'PL', class: 'I' },
  { code: 'EMP', name: 'Employee', statement: 'PL', class: 'X' },
];
const line = (statement: 'BS' | 'PL', key: string, fslis: string[], indent = 0): FormatLine => ({
  key,
  statement,
  type: 'LINE',
  label: key,
  indent,
  fslis,
  formula: [],
  role: null,
});
const total = (
  statement: 'BS' | 'PL',
  key: string,
  parts: [string, '+' | '-'][],
  role: FormatLine['role'] = null,
): FormatLine => ({
  key,
  statement,
  type: 'TOTAL',
  label: key,
  indent: 0,
  fslis: [],
  formula: parts.map(([k, op]) => ({ key: k, op })),
  role,
});
const FORMAT: FormatLine[] = [
  line('PL', 'revenue', ['REV_OPS', 'IC_REV']),
  line('PL', 'people', ['EMP']),
  total(
    'PL',
    'profit',
    [
      ['revenue', '+'],
      ['people', '-'],
    ],
    'PROFIT',
  ),
  { ...line('BS', 'assets_h', []), type: 'HEADING' },
  line('BS', 'cash', ['CASH', 'IC_REC'], 1),
  total('BS', 'ta', [['cash', '+']], 'TOTAL_ASSETS'),
  line('BS', 'equity', ['SHARE_CAP', 'PROFIT', 'FCTR']),
  line('BS', 'payables', ['TRADE_PAY', 'IC_PAY']),
  total(
    'BS',
    'tel',
    [
      ['equity', '+'],
      ['payables', '+'],
    ],
    'TOTAL_EQUITY_LIABILITIES',
  ),
];
const acct = (
  code: string,
  fsliCode: string | null,
  amount: string,
  cp: string | null = null,
): StatementAccount => ({
  code,
  name: `Account ${code}`,
  fsliCode,
  counterpartyCode: cp,
  amount,
});
// Balanced TB: 1,000 revenue (IC 200 from UK), 600 people, cash 700 + IC 100, SC 300, TP 60, IC pay 40.
const ACCOUNTS = [
  acct('4000', 'REV_OPS', '-800.00'),
  acct('4100', 'IC_REV', '-200.00', 'UK'),
  acct('6000', 'EMP', '600.00'),
  acct('1000', 'CASH', '700.00'),
  acct('1100', 'IC_REC', '100.00', 'UK'),
  acct('3000', 'SHARE_CAP', '-300.00'),
  acct('2000', 'TRADE_PAY', '-60.00'),
  acct('2100', 'IC_PAY', '-40.00', 'AE'),
];

describe('buildStatement', () => {
  const { amounts } = fsliAmounts(ACCOUNTS, FSLIS);
  it('PROFIT = the P&L total; income, equity and liabilities shown positive', () => {
    expect(amounts.PROFIT).toBe('-400.00');
    const pl = buildStatement(FORMAT, 'PL', amounts, FSLIS);
    expect(pl.rows.map((r) => [r.key, r.value])).toEqual([
      ['revenue', '1000.00'],
      ['people', '600.00'],
      ['profit', '400.00'],
    ]);
    expect(pl).toMatchObject({
      profit: '400.00',
      profitCarried: '400.00',
      profitDifference: '0.00',
    });
  });
  it('balance sheet ties: total equity and liabilities = total assets; headings have no value', () => {
    const bs = buildStatement(FORMAT, 'BS', amounts, FSLIS);
    expect(bs.rows.find((r) => r.key === 'assets_h')!.value).toBeNull();
    expect(bs).toMatchObject({
      totalAssets: '800.00',
      totalEquityLiabilities: '800.00',
      balanceDifference: '0.00',
    });
  });
  it('FCTR is carried as an equity item; a missing FSLI shows a difference', () => {
    const t = fsliAmounts([...ACCOUNTS, acct('1001', 'CASH', '5.00')], FSLIS, '-5.00').amounts;
    const bs = buildStatement(FORMAT, 'BS', t, FSLIS);
    expect(bs.rows.find((r) => r.key === 'equity')!.value).toBe('705.00');
    expect(bs.balanceDifference).toBe('0.00');
    const broken = buildStatement(FORMAT, 'BS', { ...amounts, CASH: '690.00' }, FSLIS);
    expect(broken.balanceDifference).toBe('10.00');
  });
});

describe('noteNumbers', () => {
  it('3 onwards, balance sheet first, lines with a current or comparative value only', () => {
    const n = noteNumbers([
      { key: 'revenue', statement: 'PL', type: 'LINE', current: '10.00', comparative: null },
      { key: 'nil', statement: 'PL', type: 'LINE', current: '0.00', comparative: '0.00' },
      { key: 'cash', statement: 'BS', type: 'LINE', current: '0.00', comparative: '5.00' },
      { key: 'ta', statement: 'BS', type: 'TOTAL', current: '5.00', comparative: '5.00' },
      { key: 'equity', statement: 'BS', type: 'LINE', current: '1.00', comparative: null },
    ]);
    expect(n).toEqual({ 'BS:cash': 3, 'BS:equity': 4, 'PL:revenue': 5 });
  });
});

describe('notes', () => {
  const cur = fsliAmounts(ACCOUNTS, FSLIS).amounts;
  it('line note: accounts with display sign, computed items separately, total ties to the face', () => {
    const n = lineNote({
      fslis: ['SHARE_CAP', 'PROFIT', 'FCTR'],
      classes: FSLIS,
      current: { accounts: ACCOUNTS, amounts: cur },
      comparative: null,
      face: { current: '700.00', comparative: null },
    });
    expect(n.accounts).toEqual([
      expect.objectContaining({ code: '3000', current: '300.00', comparative: null }),
    ]);
    expect(n.computed).toEqual([
      expect.objectContaining({ fsliCode: 'PROFIT', current: '400.00' }),
    ]);
    expect(n.total.current).toBe('700.00');
    expect(n.ties).toEqual({ current: true, comparative: null });
  });
  it('intercompany note by counterparty, shown positive', () => {
    expect(intercompanyNote(ACCOUNTS, null)).toEqual([
      {
        counterpartyCode: 'AE',
        current: { receivable: '0.00', payable: '40.00', revenue: '0.00', charges: '0.00' },
        comparative: null,
      },
      {
        counterpartyCode: 'UK',
        current: { receivable: '100.00', payable: '0.00', revenue: '200.00', charges: '0.00' },
        comparative: null,
      },
    ]);
  });
});

describe('presentation', () => {
  it('units round each figure independently, half away from zero', () => {
    expect(scaleAmount('745317348.66', 'LAKHS')).toBe('7453.17');
    expect(scaleAmount('745317348.66', 'CRORES')).toBe('74.53');
    expect(scaleAmount('-1500.00', 'THOUSANDS')).toBe('-1.50');
    expect(scaleAmount('-1005.00', 'THOUSANDS')).toBe('-1.01');
    expect(scaleAmount('2500000.00', 'MILLIONS')).toBe('2.50');
  });
  it('titles', () => {
    expect(statementTitle('BS', 'MONTHLY', '2026-08-31')).toBe(
      'Balance sheet as at 31 August 2026',
    );
    expect(statementTitle('PL', 'MONTHLY', '2026-08-31')).toBe(
      'Statement of profit and loss for the month ended 31 August 2026',
    );
    expect(statementTitle('PL', 'QUARTERLY', '2026-06-30')).toBe(
      'Statement of profit and loss for the quarter ended 30 June 2026',
    );
    expect(statementTitle('PL', 'ANNUAL', '2027-03-31')).toContain('year ended 31 March 2027');
  });
});
