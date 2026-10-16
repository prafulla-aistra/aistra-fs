import { describe, expect, it } from 'vitest';
import {
  checkFormatCoverage,
  type FormatFsli,
  type FormatLine,
  placeNewFsli,
  renderFormat,
} from './formats';

const FSLIS: FormatFsli[] = [
  { code: 'CASH', name: 'Cash', statement: 'BS', class: 'A' },
  { code: 'TRADE_PAY', name: 'Trade payables', statement: 'BS', class: 'L' },
  { code: 'SHARE_CAP', name: 'Share capital', statement: 'BS', class: 'E' },
  { code: 'PROFIT', name: 'Profit for the period', statement: 'BS', class: 'E' },
  { code: 'REV_OPS', name: 'Revenue', statement: 'PL', class: 'I' },
  { code: 'COST_SERV', name: 'Cost of services', statement: 'PL', class: 'X' },
  { code: 'OTH_EXP', name: 'Other expenses', statement: 'PL', class: 'X' },
];
const L = (statement: 'BS' | 'PL', key: string, label: string, fslis: string[]): FormatLine => ({
  key,
  statement,
  type: 'LINE',
  label,
  indent: 0,
  fslis,
  formula: [],
  role: null,
});
const T = (
  statement: 'BS' | 'PL',
  key: string,
  label: string,
  formula: string,
  role: FormatLine['role'] = null,
): FormatLine => ({
  key,
  statement,
  type: 'TOTAL',
  label,
  indent: 0,
  fslis: [],
  formula: formula
    .split(' ')
    .reduce<FormatLine['formula']>(
      (acc, tok, i, all) =>
        i % 2 === 0 ? [...acc, { key: tok, op: i === 0 ? '+' : (all[i - 1] as '+' | '-') }] : acc,
      [],
    ),
  role,
});
const FORMAT: FormatLine[] = [
  L('PL', 'rev', 'Revenue', ['REV_OPS']),
  L('PL', 'cos', 'Direct costs', ['COST_SERV']),
  T('PL', 'gm', 'Gross margin', 'rev - cos'),
  L('PL', 'oth', 'Other expenses', ['OTH_EXP']),
  T('PL', 'np', 'Net profit', 'gm - oth', 'PROFIT'),
  { ...L('BS', 'h', 'Assets', []), type: 'HEADING' },
  L('BS', 'cash', 'Cash', ['CASH']),
  T('BS', 'ta', 'Total assets', 'cash', 'TOTAL_ASSETS'),
  L('BS', 'sc', 'Share capital', ['SHARE_CAP']),
  L('BS', 'res', 'Reserves', ['PROFIT']),
  L('BS', 'tp', 'Trade payables', ['TRADE_PAY']),
  T('BS', 'tel', 'Total equity and liabilities', 'sc + res + tp', 'TOTAL_EQUITY_LIABILITIES'),
];

describe('checkFormatCoverage', () => {
  it('passes a complete format', () => {
    expect(checkFormatCoverage(FORMAT, FSLIS)).toEqual([]);
  });
  it('flags an unplaced FSLI (Other expenses left off)', () => {
    const issues = checkFormatCoverage(
      FORMAT.map((l) => (l.key === 'oth' ? { ...l, fslis: [] } : l)),
      FSLIS,
    );
    expect(issues.map((i) => i.code)).toEqual(['EMPTY_LINE', 'UNPLACED']);
    expect(issues[1]!.message).toBe('Other expenses (OTH_EXP) is not placed on any P&L line.');
  });
  it('flags an FSLI on two lines, and on the wrong statement', () => {
    const twice = FORMAT.map((l) =>
      l.key === 'cos' ? { ...l, fslis: ['COST_SERV', 'REV_OPS'] } : l,
    );
    expect(checkFormatCoverage(twice, FSLIS)[0]).toMatchObject({
      code: 'PLACED_TWICE',
      fsliCode: 'REV_OPS',
    });
    const wrong = FORMAT.map((l) => (l.key === 'cash' ? { ...l, fslis: ['CASH', 'OTH_EXP'] } : l));
    expect(checkFormatCoverage(wrong, FSLIS).map((i) => i.code)).toContain('WRONG_STATEMENT');
  });
  it('totals may use only lines above them on the same statement; markers are required', () => {
    const forward = FORMAT.map((l) =>
      l.key === 'gm' ? { ...l, formula: [{ key: 'np', op: '+' as const }] } : l,
    );
    expect(checkFormatCoverage(forward, FSLIS).map((i) => i.code)).toContain('FORWARD_REFERENCE');
    const other = FORMAT.map((l) =>
      l.key === 'ta' ? { ...l, formula: [{ key: 'rev', op: '+' as const }] } : l,
    );
    expect(checkFormatCoverage(other, FSLIS).map((i) => i.code)).toContain('BAD_REFERENCE');
    const unmarked = FORMAT.map((l) => (l.key === 'np' ? { ...l, role: null } : l));
    expect(checkFormatCoverage(unmarked, FSLIS)).toEqual([
      expect.objectContaining({ code: 'MISSING_MARKER', statement: 'PL' }),
    ]);
  });
});

describe('renderFormat', () => {
  it('shows income, liabilities and equity positive; totals from displayed values; profit on the BS', () => {
    const amounts = {
      CASH: '500.00',
      TRADE_PAY: '-100.00',
      SHARE_CAP: '-300.00',
      REV_OPS: '-1000.00',
      COST_SERV: '600.00',
      OTH_EXP: '300.00',
    };
    const { rows, balanced } = renderFormat(FORMAT, amounts, FSLIS);
    const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(v).toMatchObject({
      rev: '1000.00',
      cos: '600.00',
      gm: '400.00',
      np: '100.00',
      cash: '500.00',
      res: '100.00',
      tp: '100.00',
      tel: '500.00',
      h: null,
    });
    expect(balanced).toBe(true);
  });
});

describe('placeNewFsli', () => {
  const line = (key: string, fslis: string[]): FormatLine => ({
    key,
    statement: 'PL',
    type: 'LINE',
    label: key,
    indent: 1,
    fslis,
    formula: [],
    role: null,
  });
  const LINES: FormatLine[] = [
    line('rev', ['REV']),
    line('opex', ['OPEX', 'OTHER']),
    {
      key: 'profit',
      statement: 'PL',
      type: 'TOTAL',
      label: 'Profit',
      indent: 0,
      fslis: [],
      formula: [
        { key: 'rev', op: '+' },
        { key: 'opex', op: '-' },
      ],
      role: 'PROFIT',
    },
  ];
  const NEW = { code: 'MKT', name: 'Marketing', statement: 'PL' as const };

  it('joins the anchor line, right after the anchor', () => {
    const r = placeNewFsli(LINES, NEW, 'OPEX', false)!;
    expect(r.find((l) => l.key === 'opex')!.fslis).toEqual(['OPEX', 'MKT', 'OTHER']);
    expect(r).toHaveLength(3);
  });

  it('own line after the anchor line, in every total of that line with its sign', () => {
    const r = placeNewFsli(LINES, NEW, 'OPEX', true)!;
    expect(r.map((l) => l.key)).toEqual(['rev', 'opex', 'mkt', 'profit']);
    expect(r[2]).toMatchObject({ label: 'Marketing', fslis: ['MKT'], indent: 1 });
    expect(r[3]!.formula).toContainEqual({ key: 'mkt', op: '-' });
  });

  it('null when the anchor is on no line of the statement', () => {
    expect(placeNewFsli(LINES, NEW, 'NOPE', true)).toBeNull();
  });
});
