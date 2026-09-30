import { type IsoDate, parseIsoDate } from './dates';
import type {
  FormatFsli,
  FormatLine,
  FormatLineType,
  FormatRole,
  FormatStatement,
} from './formats';
import { Decimal } from './money';

/**
 * Statements and notes (SFS step 5). Pure functions over FSLI totals (debit +, credit −):
 * the statement face from a report format, note numbering, line notes, the intercompany
 * note, presentation units and titles.
 */

/** Assets and expenses as they are (+1); liabilities, equity and income reversed (−1). */
export function displaySign(cls: FormatFsli['class']): 1 | -1 {
  return cls === 'A' || cls === 'X' ? 1 : -1;
}

export interface StatementAccount {
  code: string;
  name: string;
  fsliCode: string | null;
  counterpartyCode: string | null;
  /** Signed, debit +. */
  amount: string;
}

/**
 * FSLI totals from accounts, plus the computed items: PROFIT = the P&L total (so the balance
 * sheet carries the period's profit) and FCTR (the translation balancing figure, if any).
 */
export function fsliAmounts(
  accounts: readonly StatementAccount[],
  fslis: readonly FormatFsli[],
  fctr: string | null = null,
): { amounts: Record<string, string>; unmapped: string } {
  const statement = new Map(fslis.map((f) => [f.code, f.statement]));
  const sums = new Map<string, Decimal>();
  let unmapped = new Decimal(0);
  let profit = new Decimal(0);
  for (const a of accounts) {
    if (!a.fsliCode) {
      unmapped = unmapped.plus(a.amount);
      continue;
    }
    sums.set(a.fsliCode, (sums.get(a.fsliCode) ?? new Decimal(0)).plus(a.amount));
    if (statement.get(a.fsliCode) === 'PL') profit = profit.plus(a.amount);
  }
  const amounts: Record<string, string> = {};
  for (const [k, v] of sums) amounts[k] = v.toFixed(2);
  amounts.PROFIT = profit.toFixed(2);
  if (fctr !== null) amounts.FCTR = new Decimal(fctr).toFixed(2);
  return { amounts, unmapped: unmapped.toFixed(2) };
}

export interface StatementRow {
  key: string;
  type: FormatLineType;
  label: string;
  indent: number;
  role: FormatRole | null;
  fslis: string[];
  /** Displayed value, 2 dp; null for headings. */
  value: string | null;
}

export interface BuiltStatement {
  statement: FormatStatement;
  rows: StatementRow[];
  /** BS: the marked totals. */
  totalAssets: string | null;
  totalEquityLiabilities: string | null;
  /** BS: total equity and liabilities − total assets (0.00 when it ties). */
  balanceDifference: string | null;
  /** PL: the marked profit line. */
  profit: string | null;
  /** PL: profit carried to the balance sheet (−PROFIT, displayed). */
  profitCarried: string;
  /** PL: profit line − profit carried (0.00 when it ties). */
  profitDifference: string | null;
}

/**
 * One statement of a format. Line value = Σ FSLI amount × display sign; totals add (+) or
 * subtract (−) the displayed values of lines above them.
 */
export function buildStatement(
  lines: readonly FormatLine[],
  statement: FormatStatement,
  amounts: Readonly<Record<string, string>>,
  fslis: readonly FormatFsli[],
): BuiltStatement {
  const cls = new Map(fslis.map((f) => [f.code, f.class]));
  const shown = (code: string) => {
    const v = new Decimal(amounts[code] ?? '0');
    const c = cls.get(code);
    return c ? v.times(displaySign(c)) : v;
  };
  const values = new Map<string, Decimal>();
  const rows = lines
    .filter((l) => l.statement === statement)
    .map((l): StatementRow => {
      let value: Decimal | null = null;
      if (l.type === 'LINE') value = l.fslis.reduce((s, c) => s.plus(shown(c)), new Decimal(0));
      if (l.type === 'TOTAL')
        value = l.formula.reduce((s, p) => {
          const v = values.get(p.key) ?? new Decimal(0);
          return p.op === '+' ? s.plus(v) : s.minus(v);
        }, new Decimal(0));
      if (value) values.set(l.key, value);
      return {
        key: l.key,
        type: l.type,
        label: l.label,
        indent: l.indent,
        role: l.role,
        fslis: l.type === 'LINE' ? [...l.fslis] : [],
        value: value?.toFixed(2) ?? null,
      };
    });
  const byRole = (r: FormatRole) => rows.find((x) => x.role === r)?.value ?? null;
  const ta = byRole('TOTAL_ASSETS');
  const tel = byRole('TOTAL_EQUITY_LIABILITIES');
  const profit = byRole('PROFIT');
  const carried = new Decimal(amounts.PROFIT ?? '0').negated();
  return {
    statement,
    rows,
    totalAssets: ta,
    totalEquityLiabilities: tel,
    balanceDifference: ta !== null && tel !== null ? new Decimal(tel).minus(ta).toFixed(2) : null,
    profit,
    profitCarried: carried.toFixed(2),
    profitDifference: profit !== null ? new Decimal(profit).minus(carried).toFixed(2) : null,
  };
}

/**
 * Note numbers: 1 corporate information, 2 accounting policies, then one per line with a
 * value (current or comparative), balance sheet first, then P&L, in format order.
 */
export function noteNumbers(
  rows: readonly {
    key: string;
    statement: FormatStatement;
    type: FormatLineType;
    current: string | null;
    comparative: string | null;
  }[],
): Record<string, number> {
  const nonZero = (v: string | null) => v !== null && !new Decimal(v).isZero();
  const out: Record<string, number> = {};
  let n = 2;
  for (const st of ['BS', 'PL'] as const)
    for (const r of rows)
      if (r.statement === st && r.type === 'LINE' && (nonZero(r.current) || nonZero(r.comparative)))
        out[`${st}:${r.key}`] = ++n;
  return out;
}

export const COMPUTED_ITEMS: Record<string, string> = {
  PROFIT: 'Profit for the period (from the statement of profit and loss)',
  FCTR: 'Foreign currency translation reserve (balancing figure on translation)',
};

export interface LineNote {
  accounts: {
    code: string;
    name: string;
    counterpartyCode: string | null;
    fsliCode: string;
    current: string | null;
    comparative: string | null;
  }[];
  /** PROFIT and FCTR, which have no accounts. */
  computed: {
    fsliCode: string;
    label: string;
    current: string | null;
    comparative: string | null;
  }[];
  total: { current: string; comparative: string | null };
  /** Note total = the figure on the face. */
  ties: { current: boolean; comparative: boolean | null };
}

/** The accounts behind a statement line, shown with the line's display signs. */
export function lineNote(input: {
  fslis: readonly string[];
  classes: readonly FormatFsli[];
  current: { accounts: readonly StatementAccount[]; amounts: Readonly<Record<string, string>> };
  comparative: {
    accounts: readonly StatementAccount[];
    amounts: Readonly<Record<string, string>>;
  } | null;
  face: { current: string; comparative: string | null };
}): LineNote {
  const cls = new Map(input.classes.map((f) => [f.code, f.class]));
  const sign = (code: string) => {
    const c = cls.get(code);
    return c ? displaySign(c) : 1;
  };
  const inLine = new Set(input.fslis);
  const byCode = new Map<string, LineNote['accounts'][number]>();
  const add = (a: StatementAccount, which: 'current' | 'comparative') => {
    if (!a.fsliCode || !inLine.has(a.fsliCode)) return;
    const key = `${a.code}|${a.fsliCode}`;
    const row = byCode.get(key) ?? {
      code: a.code,
      name: a.name,
      counterpartyCode: a.counterpartyCode,
      fsliCode: a.fsliCode,
      current: null,
      comparative: null,
    };
    const prev = row[which] ? new Decimal(row[which]!) : new Decimal(0);
    row[which] = prev.plus(new Decimal(a.amount).times(sign(a.fsliCode))).toFixed(2);
    byCode.set(key, row);
  };
  input.current.accounts.forEach((a) => add(a, 'current'));
  input.comparative?.accounts.forEach((a) => add(a, 'comparative'));
  const accounts = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  const computed = input.fslis
    .filter((f) => f in COMPUTED_ITEMS)
    .map((f) => ({
      fsliCode: f,
      label: COMPUTED_ITEMS[f]!,
      current:
        input.current.amounts[f] !== undefined
          ? new Decimal(input.current.amounts[f]!).times(sign(f)).toFixed(2)
          : null,
      comparative:
        input.comparative && input.comparative.amounts[f] !== undefined
          ? new Decimal(input.comparative.amounts[f]!).times(sign(f)).toFixed(2)
          : null,
    }))
    .filter((c) => c.current !== null || c.comparative !== null);
  const total = (which: 'current' | 'comparative') =>
    [...accounts.map((a) => a[which]), ...computed.map((c) => c[which])].reduce(
      (s, v) => (v === null ? s : s.plus(v)),
      new Decimal(0),
    );
  const cur = total('current');
  const comp = input.comparative ? total('comparative') : null;
  return {
    accounts,
    computed,
    total: { current: cur.toFixed(2), comparative: comp?.toFixed(2) ?? null },
    ties: {
      current: cur.equals(input.face.current),
      comparative:
        comp === null || input.face.comparative === null
          ? null
          : comp.equals(input.face.comparative),
    },
  };
}

const IC_FSLI = {
  IC_REC: 'receivable',
  IC_PAY: 'payable',
  IC_REV: 'revenue',
  IC_EXP: 'charges',
} as const;
type IcColumn = (typeof IC_FSLI)[keyof typeof IC_FSLI];

export interface IntercompanyNoteRow {
  counterpartyCode: string;
  current: Record<IcColumn, string>;
  comparative: Record<IcColumn, string> | null;
}

/**
 * Intercompany balances by counterparty, shown positive: receivable (Dr), payable (Cr),
 * revenue (Cr), charges (Dr).
 */
export function intercompanyNote(
  current: readonly StatementAccount[],
  comparative: readonly StatementAccount[] | null,
): IntercompanyNoteRow[] {
  const collect = (accounts: readonly StatementAccount[]) => {
    const m = new Map<string, Record<IcColumn, Decimal>>();
    for (const a of accounts) {
      const col = a.fsliCode ? IC_FSLI[a.fsliCode as keyof typeof IC_FSLI] : undefined;
      if (!col || !a.counterpartyCode) continue;
      const r = m.get(a.counterpartyCode) ?? {
        receivable: new Decimal(0),
        payable: new Decimal(0),
        revenue: new Decimal(0),
        charges: new Decimal(0),
      };
      const v = new Decimal(a.amount);
      r[col] = r[col].plus(col === 'payable' || col === 'revenue' ? v.negated() : v);
      m.set(a.counterpartyCode, r);
    }
    return m;
  };
  const cur = collect(current);
  const comp = comparative ? collect(comparative) : null;
  const text = (r: Record<IcColumn, Decimal> | undefined) => ({
    receivable: (r?.receivable ?? new Decimal(0)).toFixed(2),
    payable: (r?.payable ?? new Decimal(0)).toFixed(2),
    revenue: (r?.revenue ?? new Decimal(0)).toFixed(2),
    charges: (r?.charges ?? new Decimal(0)).toFixed(2),
  });
  const codes = [...new Set([...cur.keys(), ...(comp?.keys() ?? [])])].sort();
  return codes.map((c) => ({
    counterpartyCode: c,
    current: text(cur.get(c)),
    comparative: comp ? text(comp.get(c)) : null,
  }));
}

export type StatementUnit = 'ACTUAL' | 'THOUSANDS' | 'LAKHS' | 'CRORES' | 'MILLIONS';
const UNIT_DIVISOR: Record<StatementUnit, string> = {
  ACTUAL: '1',
  THOUSANDS: '1000',
  LAKHS: '100000',
  CRORES: '10000000',
  MILLIONS: '1000000',
};

/** A figure in presentation units, rounded on its own to 2 dp (half away from zero). */
export function scaleAmount(value: string, unit: StatementUnit): string {
  return new Decimal(value)
    .dividedBy(UNIT_DIVISOR[unit])
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2);
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "31 August 2026" */
export function longDate(date: IsoDate): string {
  const { year, month, day } = parseIsoDate(date);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** "Balance sheet as at 31 August 2026" / "Statement of profit and loss for the month ended …" */
export function statementTitle(
  statement: FormatStatement,
  periodType: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL',
  endDate: IsoDate,
): string {
  if (statement === 'BS') return `Balance sheet as at ${longDate(endDate)}`;
  const span = periodType === 'MONTHLY' ? 'month' : periodType === 'QUARTERLY' ? 'quarter' : 'year';
  return `Statement of profit and loss for the ${span} ended ${longDate(endDate)}`;
}
