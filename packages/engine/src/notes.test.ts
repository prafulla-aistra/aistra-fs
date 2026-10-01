import { describe, expect, it } from 'vitest';
import {
  checkTable,
  figureValue,
  groupAccounts,
  type NoteBlock,
  numberNotes,
  type PeriodFigureSet,
  plainText,
  type RichNode,
  rollForwardBlocks,
  staleNumbers,
  type TableBlock,
  typedNumbers,
  wordDiff,
} from './notes';

const para = (...content: RichNode[]): RichNode => ({ type: 'paragraph', content });
const text = (t: string): RichNode => ({ type: 'text', text: t });
const figure = (key: string, measure = 'current'): RichNode => ({
  type: 'figure',
  attrs: { source: 'ACCOUNT', key, measure },
});
const doc = (...content: RichNode[]): RichNode => ({ type: 'doc', content });

const TABLE: TableBlock = {
  id: 't1',
  type: 'TABLE',
  label: 'Capital commitments',
  columns: [
    { id: 'nature', label: 'Nature', numeric: false, period: null },
    { id: 'cur', label: 'Current', numeric: true, period: 'CURRENT' },
    { id: 'comp', label: 'Comparative', numeric: true, period: 'COMPARATIVE' },
  ],
  rows: [
    { id: 'r1', cells: { nature: 'Office fit-out', cur: '2,500,000', comp: '2,000,000' } },
    { id: 'r2', cells: { nature: 'Laptops', cur: '300,000', comp: '' } },
  ],
  mode: 'MEMO',
  agreeLine: null,
};

describe('rollForwardBlocks', () => {
  it('copies texts and sub-captions; custom-table current values move to comparative', () => {
    const blocks: NoteBlock[] = [
      {
        id: 'f',
        type: 'FIGURES',
        subCaptions: [{ id: 's1', label: 'Balances with banks', accounts: ['1010'] }],
      },
      { id: 'x', type: 'TEXT', label: 'Terms', doc: doc(para(text('Repayable on demand.'))) },
      TABLE,
    ];
    const next = rollForwardBlocks(blocks);
    expect(next[0]).toEqual(blocks[0]);
    expect(next[0]).not.toBe(blocks[0]);
    expect(next[1]).toEqual(blocks[1]);
    const t = next[2] as TableBlock;
    expect(t.rows.map((r) => r.cells)).toEqual([
      { nature: 'Office fit-out', cur: '', comp: '2,500,000' },
      { nature: 'Laptops', cur: '', comp: '300,000' },
    ]);
    expect(TABLE.rows[0]!.cells.cur).toBe('2,500,000'); // the original is untouched
  });
});

describe('live figures', () => {
  const jul: PeriodFigureSet = {
    lines: {},
    fslis: {},
    accounts: { '1200': '30000.00' },
    subCaptions: {},
  };
  const aug: PeriodFigureSet = {
    lines: {},
    fslis: {},
    accounts: { '1200': '40000.00' },
    subCaptions: {},
  };
  it('a token shows the Jul figure in Jul and the Aug figure in Aug', () => {
    const ref = { source: 'ACCOUNT' as const, key: '1200', measure: 'current' as const };
    expect(figureValue(ref, jul, null)).toBe('30000.00');
    expect(figureValue(ref, aug, jul)).toBe('40000.00');
    expect(figureValue({ ...ref, measure: 'comparative' }, aug, jul)).toBe('30000.00');
    expect(figureValue({ ...ref, measure: 'variance' }, aug, jul)).toBe('10000.00');
    expect(figureValue({ ...ref, measure: 'variancePct' }, aug, jul)).toBe('33.3');
    expect(figureValue({ ...ref, measure: 'variancePct' }, aug, null)).toBeNull();
  });
});

describe('stale-number check', () => {
  const block = (d: RichNode) => [{ blockId: 'b1', doc: d }];
  it('flags "30,000" when last period was 30,000 and this period is 40,000', () => {
    const flags = staleNumbers(
      block(doc(para(text('A security deposit of 30,000 is held.')))),
      ['30000.00'],
      ['40000.00'],
    );
    expect(flags).toEqual([
      {
        blockId: 'b1',
        number: '30,000',
        message:
          "This looks like last period's figure (30,000). Update it or replace it with a live figure.",
      },
    ]);
  });
  it('does not flag a live figure token, an updated number, an unchanged figure, or a year', () => {
    expect(
      staleNumbers(
        block(doc(para(text('A deposit of '), figure('1200')))),
        ['30000.00'],
        ['40000.00'],
      ),
    ).toEqual([]);
    expect(
      staleNumbers(block(doc(para(text('A deposit of 40,000.')))), ['30000.00'], ['40000.00']),
    ).toEqual([]);
    expect(
      staleNumbers(
        block(doc(para(text('Share capital 100,000,000.')))),
        ['100000000.00'],
        ['100000000.00'],
      ),
    ).toEqual([]);
    expect(
      staleNumbers(block(doc(para(text('In 2026 the lease was renewed.')))), ['2026.00'], []),
    ).toEqual([]);
  });
  it('reads Indian and international grouping', () => {
    expect(typedNumbers('Rs 1,23,456.50 and 45,000 and 999').map((n) => n.value)).toEqual([
      '123456.50',
      '45000.00',
    ]);
  });
});

describe('sub-captions', () => {
  const accounts = [
    { code: '1100', current: '800.00', comparative: '700.00' },
    { code: '1450', current: '150.00', comparative: '100.00' },
    { code: '1451', current: '50.00', comparative: null },
  ];
  it('group with subtotals; the rest under "Other"; groups add up to the note total', () => {
    const r = groupAccounts(
      accounts,
      [{ id: 'g', label: 'Unsecured, considered good', accounts: ['1100', '1450'] }],
      true,
    );
    expect(r.groups.map((g) => [g.label, g.subtotal.current, g.subtotal.comparative])).toEqual([
      ['Unsecured, considered good', '950.00', '800.00'],
      ['Other', '50.00', '0.00'],
    ]);
    expect(r.total).toEqual({ current: '1000.00', comparative: '800.00' });
    expect(r.errors).toEqual([]);
  });
  it('an account in two sub-captions is an error', () => {
    const r = groupAccounts(
      accounts,
      [
        { id: 'a', label: 'A', accounts: ['1100'] },
        { id: 'b', label: 'B', accounts: ['1100'] },
      ],
      true,
    );
    expect(r.errors).toEqual(['Account 1100 is in more than one sub-caption.']);
  });
});

describe('custom tables, text, diff, numbering', () => {
  it('validates numbers; AGREE compares the current column with the line', () => {
    expect(
      checkTable(
        { ...TABLE, rows: [{ id: 'r', cells: { nature: 'X', cur: 'abc', comp: '' } }] },
        null,
      ).errors,
    ).toEqual(['"X" · Current: "abc" is not a number.']);
    expect(checkTable({ ...TABLE, mode: 'AGREE', agreeLine: 'x' }, '2800000.00')).toEqual({
      errors: [],
      total: '2800000.00',
      ties: true,
    });
    expect(checkTable({ ...TABLE, mode: 'AGREE', agreeLine: 'x' }, '1.00').ties).toBe(false);
  });
  it('plain text marks tokens; word diff shows added and removed words', () => {
    expect(plainText(doc(para(text('Deposit of '), figure('1200'), text('.'))))).toBe(
      'Deposit of {figure}.',
    );
    expect(wordDiff('deposit of 30,000 held', 'deposit of 40,000 held')).toEqual([
      { op: 'same', text: 'deposit of ' },
      { op: 'removed', text: '30,000' },
      { op: 'added', text: '40,000' },
      { op: 'same', text: ' held' },
    ]);
  });
  it('numbers visible notes 1..n', () => {
    const n = numberNotes([
      { id: 'a', hidden: false },
      { id: 'b', hidden: true },
      { id: 'c', hidden: false },
    ]);
    expect([...n]).toEqual([
      ['a', 1],
      ['c', 2],
    ]);
  });
});
