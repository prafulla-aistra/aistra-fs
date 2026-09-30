import { Decimal } from './money';

/**
 * Report formats: the layout of the balance sheet and P&L, built from FSLIs.
 *
 *   HEADING  a caption, no figure
 *   LINE     the sum of its FSLIs
 *   TOTAL    other lines added (+) or taken away (−)
 *
 * Display sign: assets and expenses as they are (debit +); liabilities, equity and income
 * reversed, so they show as positive. Totals work on displayed values, so "Gross margin =
 * Revenue − Direct costs" reads naturally.
 */
export type FormatStatement = 'BS' | 'PL';
export type FormatLineType = 'HEADING' | 'LINE' | 'TOTAL';
export type FormatRole = 'PROFIT' | 'TOTAL_ASSETS' | 'TOTAL_EQUITY_LIABILITIES';

export interface FormatLine {
  /** Stable id within the format version, referenced by totals. */
  key: string;
  statement: FormatStatement;
  type: FormatLineType;
  label: string;
  indent: number;
  /** LINE only. */
  fslis: string[];
  /** TOTAL only. */
  formula: { key: string; op: '+' | '-' }[];
  /** The marked line: profit (P&L), total assets and total equity and liabilities (BS). */
  role: FormatRole | null;
}

export interface FormatFsli {
  code: string;
  name: string;
  statement: FormatStatement;
  class: 'A' | 'L' | 'E' | 'I' | 'X';
}

export interface FormatIssue {
  code:
    | 'UNPLACED'
    | 'PLACED_TWICE'
    | 'WRONG_STATEMENT'
    | 'UNKNOWN_FSLI'
    | 'EMPTY_LINE'
    | 'EMPTY_TOTAL'
    | 'BAD_REFERENCE'
    | 'FORWARD_REFERENCE'
    | 'MISSING_MARKER'
    | 'DUPLICATE_MARKER'
    | 'MARKER_NOT_TOTAL'
    | 'DUPLICATE_KEY'
    | 'NO_LABEL';
  statement: FormatStatement;
  message: string;
  lineKey?: string;
  fsliCode?: string;
}

const REQUIRED_MARKERS: Record<FormatStatement, { role: FormatRole; label: string }[]> = {
  PL: [{ role: 'PROFIT', label: 'profit for the period' }],
  BS: [
    { role: 'TOTAL_ASSETS', label: 'total assets' },
    { role: 'TOTAL_EQUITY_LIABILITIES', label: 'total equity and liabilities' },
  ],
};
const STATEMENT_NAME: Record<FormatStatement, string> = { BS: 'balance sheet', PL: 'P&L' };

/**
 * Checks a format: every FSLI placed on exactly one line of its own statement; lines have
 * FSLIs and totals have parts; totals refer only to lines above them on the same statement;
 * the marked totals exist once each. An empty list means the format can be saved.
 */
export function checkFormatCoverage(
  lines: readonly FormatLine[],
  fslis: readonly FormatFsli[],
): FormatIssue[] {
  const issues: FormatIssue[] = [];
  const byCode = new Map(fslis.map((f) => [f.code, f]));
  const keys = new Set<string>();
  for (const l of lines) {
    if (keys.has(l.key))
      issues.push({
        code: 'DUPLICATE_KEY',
        statement: l.statement,
        lineKey: l.key,
        message: `Two lines share the id "${l.key}".`,
      });
    keys.add(l.key);
    if (!l.label.trim())
      issues.push({
        code: 'NO_LABEL',
        statement: l.statement,
        lineKey: l.key,
        message: 'A line has no name.',
      });
  }

  for (const st of ['PL', 'BS'] as const) {
    const own = lines.filter((l) => l.statement === st);
    const placed = new Map<string, string[]>();
    own.forEach((l, i) => {
      if (l.type === 'LINE') {
        if (l.fslis.length === 0)
          issues.push({
            code: 'EMPTY_LINE',
            statement: st,
            lineKey: l.key,
            message: `"${l.label}" has no FSLIs.`,
          });
        for (const code of l.fslis) {
          const f = byCode.get(code);
          if (!f) {
            issues.push({
              code: 'UNKNOWN_FSLI',
              statement: st,
              lineKey: l.key,
              fsliCode: code,
              message: `"${l.label}" uses an unknown FSLI ${code}.`,
            });
            continue;
          }
          if (f.statement !== st) {
            issues.push({
              code: 'WRONG_STATEMENT',
              statement: st,
              lineKey: l.key,
              fsliCode: code,
              message: `${f.name} (${code}) is a ${STATEMENT_NAME[f.statement]} FSLI but sits on the ${STATEMENT_NAME[st]} line "${l.label}".`,
            });
            continue;
          }
          placed.set(code, [...(placed.get(code) ?? []), l.label]);
        }
      }
      if (l.type === 'TOTAL') {
        if (l.formula.length === 0)
          issues.push({
            code: 'EMPTY_TOTAL',
            statement: st,
            lineKey: l.key,
            message: `"${l.label}" adds up nothing.`,
          });
        for (const part of l.formula) {
          const target = own.findIndex((x) => x.key === part.key);
          if (target < 0) {
            issues.push({
              code: 'BAD_REFERENCE',
              statement: st,
              lineKey: l.key,
              message: `"${l.label}" refers to a line that does not exist on the ${STATEMENT_NAME[st]}.`,
            });
          } else if (target >= i) {
            issues.push({
              code: 'FORWARD_REFERENCE',
              statement: st,
              lineKey: l.key,
              message: `"${l.label}" can only use lines above it ("${own[target]!.label}" is not).`,
            });
          } else if (own[target]!.type === 'HEADING') {
            issues.push({
              code: 'BAD_REFERENCE',
              statement: st,
              lineKey: l.key,
              message: `"${l.label}" uses the heading "${own[target]!.label}", which has no figure.`,
            });
          }
        }
      }
      if (l.role && l.type !== 'TOTAL')
        issues.push({
          code: 'MARKER_NOT_TOTAL',
          statement: st,
          lineKey: l.key,
          message: `"${l.label}" is marked but is not a total.`,
        });
    });

    for (const f of fslis.filter((x) => x.statement === st)) {
      const on = placed.get(f.code) ?? [];
      if (on.length === 0)
        issues.push({
          code: 'UNPLACED',
          statement: st,
          fsliCode: f.code,
          message: `${f.name} (${f.code}) is not placed on any ${STATEMENT_NAME[st]} line.`,
        });
      if (on.length > 1)
        issues.push({
          code: 'PLACED_TWICE',
          statement: st,
          fsliCode: f.code,
          message: `${f.name} (${f.code}) is on more than one line: ${on.join(', ')}.`,
        });
    }
    for (const m of REQUIRED_MARKERS[st]) {
      const marked = own.filter((l) => l.role === m.role);
      if (marked.length === 0)
        issues.push({
          code: 'MISSING_MARKER',
          statement: st,
          message: `Mark the ${m.label} line of the ${STATEMENT_NAME[st]}.`,
        });
      if (marked.length > 1)
        issues.push({
          code: 'DUPLICATE_MARKER',
          statement: st,
          message: `Only one line can be marked as ${m.label}.`,
        });
    }
  }
  return issues;
}

export interface RenderedRow {
  key: string;
  statement: FormatStatement;
  type: FormatLineType;
  label: string;
  indent: number;
  role: FormatRole | null;
  /** Displayed value (liabilities, equity and income shown positive); null for headings. */
  value: string | null;
}

/**
 * Figures for a format from FSLI totals (signed, debit +). PROFIT, when not given, is the
 * P&L total (so the balance sheet includes the period's profit). Returns rows in order and
 * whether total assets = total equity and liabilities.
 */
export function renderFormat(
  lines: readonly FormatLine[],
  amounts: Readonly<Record<string, string>>,
  fslis: readonly FormatFsli[],
): { rows: RenderedRow[]; balanced: boolean | null } {
  const byCode = new Map(fslis.map((f) => [f.code, f]));
  const signed = { ...amounts };
  if (signed.PROFIT === undefined) {
    signed.PROFIT = fslis
      .filter((f) => f.statement === 'PL')
      .reduce((s, f) => s.plus(amounts[f.code] ?? '0'), new Decimal(0))
      .toFixed(2);
  }
  const shown = (code: string) => {
    const f = byCode.get(code);
    const v = new Decimal(signed[code] ?? '0');
    return f && (f.class === 'L' || f.class === 'E' || f.class === 'I') ? v.negated() : v;
  };
  const values = new Map<string, Decimal>();
  const rows = lines.map((l): RenderedRow => {
    let value: Decimal | null = null;
    if (l.type === 'LINE') value = l.fslis.reduce((s, c) => s.plus(shown(c)), new Decimal(0));
    if (l.type === 'TOTAL')
      value = l.formula.reduce((s, p) => {
        const v = values.get(`${l.statement}:${p.key}`) ?? new Decimal(0);
        return p.op === '+' ? s.plus(v) : s.minus(v);
      }, new Decimal(0));
    if (value) values.set(`${l.statement}:${l.key}`, value);
    return {
      key: l.key,
      statement: l.statement,
      type: l.type,
      label: l.label,
      indent: l.indent,
      role: l.role,
      value: value?.toFixed(2) ?? null,
    };
  });
  const ta = rows.find((r) => r.role === 'TOTAL_ASSETS')?.value;
  const tel = rows.find((r) => r.role === 'TOTAL_EQUITY_LIABILITIES')?.value;
  return { rows, balanced: ta && tel ? new Decimal(ta).equals(tel) : null };
}
