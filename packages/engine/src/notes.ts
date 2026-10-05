import { Decimal } from './money';

/**
 * Notes to accounts (SFS "Notes" step). A note is an ordered list of blocks:
 *   FIGURES  the accounts behind a statement line, grouped into sub-captions (with subtotals)
 *   TEXT     a label and rich text (bold, italic, bullets, numbered lists, live figure tokens)
 *   TABLE    a user-defined table (numeric columns validated; memo or "must agree to line X")
 * Pure functions: roll forward, live figures, the stale-number check, sub-caption totals and
 * word differences.
 */

export type NoteKind = 'LINE' | 'NARRATIVE' | 'CUSTOM';
export type NoteStatus = 'DRAFT' | 'CARRIED_FORWARD' | 'EDITED' | 'REVIEWED';

/** Rich text: a small ProseMirror-like document. */
export interface RichNode {
  type: string;
  text?: string;
  marks?: { type: string }[];
  attrs?: Record<string, unknown>;
  content?: RichNode[];
}

export type FigureMeasure = 'current' | 'comparative' | 'variance' | 'variancePct';
export interface FigureRef {
  source: 'LINE' | 'FSLI' | 'ACCOUNT' | 'SUBCAPTION';
  /** Line key, FSLI code, account code, or "<noteId>:<subCaptionId>". */
  key: string;
  measure: FigureMeasure;
}

export interface SubCaption {
  id: string;
  label: string;
  accounts: string[];
}

export interface FiguresBlock {
  id: string;
  type: 'FIGURES';
  subCaptions: SubCaption[];
}
export interface TextBlock {
  id: string;
  type: 'TEXT';
  label: string;
  doc: RichNode;
}
export interface TableColumn {
  id: string;
  label: string;
  numeric: boolean;
  /** CURRENT / COMPARATIVE columns are headed with the period and shift on roll forward. */
  period: 'CURRENT' | 'COMPARATIVE' | null;
}
export interface TableBlock {
  id: string;
  type: 'TABLE';
  label: string;
  columns: TableColumn[];
  rows: { id: string; cells: Record<string, string> }[];
  mode: 'MEMO' | 'AGREE';
  /** AGREE: the statement line the CURRENT column must total to. */
  agreeLine: string | null;
}
/**
 * A table the system fills from consolidation data each time it is shown (list of subsidiaries,
 * goodwill, NCI, intercompany summary, FCTR). Read-only; only its label is editable.
 */
export interface GeneratedBlock {
  id: string;
  type: 'GENERATED';
  source: 'SUBSIDIARIES' | 'GOODWILL' | 'NCI' | 'IC_SUMMARY' | 'FCTR';
  label: string;
}

export type NoteBlock = FiguresBlock | TextBlock | TableBlock | GeneratedBlock;

// ---------------------------------------------------------------------------------------
// Roll forward
// ---------------------------------------------------------------------------------------

/**
 * A note's blocks for the next period: everything is copied (texts, sub-captions with their
 * accounts, tables); in tables, last period's CURRENT column values move to the COMPARATIVE
 * column and the CURRENT column is left blank to fill in.
 */
export function rollForwardBlocks(blocks: readonly NoteBlock[]): NoteBlock[] {
  return blocks.map((b): NoteBlock => {
    if (b.type !== 'TABLE') return structuredClone(b);
    const cur = b.columns.find((c) => c.period === 'CURRENT');
    const comp = b.columns.find((c) => c.period === 'COMPARATIVE');
    return {
      ...structuredClone(b),
      rows: b.rows.map((r) => {
        const cells = { ...r.cells };
        if (cur && comp) cells[comp.id] = r.cells[cur.id] ?? '';
        if (cur) cells[cur.id] = '';
        return { id: r.id, cells };
      }),
    };
  });
}

// ---------------------------------------------------------------------------------------
// Figures: statement lines, FSLIs, accounts, sub-captions
// ---------------------------------------------------------------------------------------

/** Displayed figures of one period (liabilities, equity and income shown positive). */
export interface PeriodFigureSet {
  lines: Record<string, string>;
  fslis: Record<string, string>;
  accounts: Record<string, string>;
  subCaptions: Record<string, string>;
}

/** The value of a live figure (null when the item has no value in the period). */
export function figureValue(
  ref: FigureRef,
  current: PeriodFigureSet,
  comparative: PeriodFigureSet | null,
): string | null {
  const pick = (set: PeriodFigureSet | null) => {
    if (!set) return null;
    const table =
      ref.source === 'LINE'
        ? set.lines
        : ref.source === 'FSLI'
          ? set.fslis
          : ref.source === 'ACCOUNT'
            ? set.accounts
            : set.subCaptions;
    return table[ref.key] ?? null;
  };
  const c = pick(current);
  const p = pick(comparative);
  if (ref.measure === 'current') return c;
  if (ref.measure === 'comparative') return p;
  const variance = new Decimal(c ?? '0').minus(p ?? '0');
  if (ref.measure === 'variance') return c === null && p === null ? null : variance.toFixed(2);
  if (p === null || new Decimal(p).isZero()) return null;
  return variance
    .dividedBy(new Decimal(p).abs())
    .times(100)
    .toDecimalPlaces(1, Decimal.ROUND_HALF_UP)
    .toFixed(1);
}

export interface GroupedAccount {
  code: string;
  current: string | null;
  comparative: string | null;
}

export interface SubCaptionGroup {
  id: string;
  label: string;
  accounts: GroupedAccount[];
  subtotal: { current: string; comparative: string | null };
}

/**
 * Accounts of a line note grouped into sub-captions (in order), the rest under "Other".
 * Each account is in exactly one group, so the groups add up to the note total.
 */
export function groupAccounts(
  accounts: readonly GroupedAccount[],
  subCaptions: readonly SubCaption[],
  hasComparative: boolean,
): {
  groups: SubCaptionGroup[];
  total: { current: string; comparative: string | null };
  errors: string[];
} {
  const errors: string[] = [];
  const owner = new Map<string, string>();
  for (const s of subCaptions)
    for (const code of s.accounts) {
      if (owner.has(code)) errors.push(`Account ${code} is in more than one sub-caption.`);
      else owner.set(code, s.id);
    }
  const sum = (rows: GroupedAccount[], k: 'current' | 'comparative') =>
    rows.reduce((s, r) => (r[k] === null ? s : s.plus(r[k]!)), new Decimal(0)).toFixed(2);
  const group = (id: string, label: string, rows: GroupedAccount[]): SubCaptionGroup => ({
    id,
    label,
    accounts: rows,
    subtotal: {
      current: sum(rows, 'current'),
      comparative: hasComparative ? sum(rows, 'comparative') : null,
    },
  });
  const groups = subCaptions.map((s) =>
    group(
      s.id,
      s.label,
      accounts.filter((a) => owner.get(a.code) === s.id),
    ),
  );
  const other = accounts.filter((a) => !owner.has(a.code));
  if (other.length > 0 || subCaptions.length === 0)
    groups.push(group('other', subCaptions.length ? 'Other' : '', other));
  return {
    groups,
    total: {
      current: sum([...accounts], 'current'),
      comparative: hasComparative ? sum([...accounts], 'comparative') : null,
    },
    errors,
  };
}

/** A custom table: numeric cells validated; AGREE tables compare the CURRENT column total. */
export function checkTable(
  t: TableBlock,
  lineValue: string | null,
): { errors: string[]; total: string | null; ties: boolean | null } {
  const errors: string[] = [];
  const numeric = t.columns.filter((c) => c.numeric);
  for (const r of t.rows)
    for (const c of numeric) {
      const v = (r.cells[c.id] ?? '').replace(/,/g, '').trim();
      if (v !== '' && !/^-?\d+(\.\d{1,2})?$/.test(v) && !/^\(\d+(\.\d{1,2})?\)$/.test(v))
        errors.push(
          `"${r.cells[t.columns[0]!.id] ?? ''}" · ${c.label}: "${r.cells[c.id]}" is not a number.`,
        );
    }
  const cur = t.columns.find((c) => c.period === 'CURRENT' && c.numeric);
  if (!cur) return { errors, total: null, ties: null };
  const total = t.rows.reduce((s, r) => {
    const v = cellNumber(r.cells[cur.id] ?? '');
    return v === null ? s : s.plus(v);
  }, new Decimal(0));
  return {
    errors,
    total: total.toFixed(2),
    ties: t.mode === 'AGREE' && lineValue !== null ? total.equals(lineValue) : null,
  };
}

/** "1,200.50" → 1200.50; "(300)" → −300; not a number → null. */
export function cellNumber(text: string): Decimal | null {
  const v = text.replace(/,/g, '').trim();
  if (/^-?\d+(\.\d{1,2})?$/.test(v)) return new Decimal(v);
  const m = /^\((\d+(\.\d{1,2})?)\)$/.exec(v);
  return m ? new Decimal(m[1]!).negated() : null;
}

// ---------------------------------------------------------------------------------------
// Rich text helpers
// ---------------------------------------------------------------------------------------

/** Plain text of a rich document; figure tokens become "{figure}" placeholders (not typed). */
export function plainText(doc: RichNode, token = '{figure}'): string {
  const out: string[] = [];
  const walk = (n: RichNode) => {
    if (n.type === 'text') out.push(n.text ?? '');
    else if (n.type === 'figure') out.push(token);
    else {
      (n.content ?? []).forEach(walk);
      if (['paragraph', 'listItem', 'heading'].includes(n.type)) out.push('\n');
    }
  };
  walk(doc);
  return out.join('').replace(/\n+$/, '');
}

/** Every figure token in a document. */
export function figureTokens(doc: RichNode): FigureRef[] {
  const out: FigureRef[] = [];
  const walk = (n: RichNode) => {
    if (n.type === 'figure' && n.attrs) out.push(n.attrs as unknown as FigureRef);
    (n.content ?? []).forEach(walk);
  };
  walk(doc);
  return out;
}

// ---------------------------------------------------------------------------------------
// Stale-number check
// ---------------------------------------------------------------------------------------

/** Typed numbers in text, e.g. "30,000", "1,23,456.50", "40000" (years and small numbers skipped). */
export function typedNumbers(text: string): { text: string; value: string }[] {
  const out: { text: string; value: string }[] = [];
  for (const m of text.matchAll(
    /(?<![\d.,])\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?(?![\d,])|(?<![\d.,])\d+(?:\.\d{1,2})?(?![\d,])/g,
  )) {
    const raw = m[0];
    const value = new Decimal(raw.replace(/,/g, ''));
    if (value.lessThan(1000)) continue;
    if (!raw.includes(',') && !raw.includes('.') && value.gte(1900) && value.lte(2100)) continue; // a year
    out.push({ text: raw, value: value.toFixed(2) });
  }
  return out;
}

export interface StaleFlag {
  blockId: string;
  number: string;
  message: string;
}

/**
 * Typed (non-token) numbers that equal a figure of the last finalised period but no figure of
 * this period: probably not updated. Live figure tokens are never flagged.
 */
export function staleNumbers(
  texts: readonly { blockId: string; doc: RichNode }[],
  lastPeriod: readonly string[],
  thisPeriod: readonly string[],
): StaleFlag[] {
  const abs = (v: string) => new Decimal(v).abs().toFixed(2);
  const last = new Set(lastPeriod.map(abs));
  const now = new Set(thisPeriod.map(abs));
  const flags: StaleFlag[] = [];
  for (const t of texts)
    for (const n of typedNumbers(plainText(t.doc)))
      if (last.has(n.value) && !now.has(n.value))
        flags.push({
          blockId: t.blockId,
          number: n.text,
          message: `This looks like last period's figure (${n.text}). Update it or replace it with a live figure.`,
        });
  return flags;
}

// ---------------------------------------------------------------------------------------
// Word differences (for "what changed since the last finalised text")
// ---------------------------------------------------------------------------------------

export interface DiffPart {
  op: 'same' | 'added' | 'removed';
  text: string;
}

/** Word-level difference between two texts (longest common subsequence). */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.split(/(\s+)/).filter((x) => x !== '');
  const b = after.split(/(\s+)/).filter((x) => x !== '');
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: DiffPart[] = [];
  const push = (op: DiffPart['op'], text: string) => {
    const last = out.at(-1);
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i]!);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) push('removed', a[i++]!);
    else push('added', b[j++]!);
  }
  while (i < n) push('removed', a[i++]!);
  while (j < m) push('added', b[j++]!);
  return out;
}

/** Visible notes are numbered 1..n in order; a nil, empty, optional note is hidden. */
export function numberNotes<T extends { id: string; hidden: boolean }>(
  notes: readonly T[],
): Map<string, number> {
  const out = new Map<string, number>();
  let n = 0;
  for (const x of notes) if (!x.hidden) out.set(x.id, ++n);
  return out;
}
