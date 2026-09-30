import { findCounterparty, IC_NAME_PATTERNS, type InferenceEntity } from './fsli-inference';
import { Decimal } from './money';

/**
 * Review and map (page 4): which TB accounts still need mapping, suggested FSLIs, mapping
 * validation, totals per FSLI (with profit for the period) and the intercompany summary.
 * Amounts are exact decimal strings, debit positive / credit negative.
 */
export type FsliClassCode = 'A' | 'L' | 'E' | 'I' | 'X';

export interface MappingFsli {
  code: string;
  name: string;
  statement: 'BS' | 'PL';
  class: FsliClassCode;
  needsCounterparty: boolean;
  computed: boolean;
  consolidationOnly: boolean;
  sortOrder: number;
}

export interface MappedAccount {
  entityCode: string;
  accountCode: string;
  accountName: string;
  accountType: string | null;
  fsliCode: string | null;
  counterpartyCode: string | null;
}

export interface TbLineInput {
  accountCode: string;
  accountName: string;
  accountType: string | null;
  amount: string;
}

export type MapReason = 'NOT_IN_COA' | 'NO_FSLI' | 'NO_COUNTERPARTY';
export const MAP_REASON_TEXT: Record<MapReason, string> = {
  NOT_IN_COA: 'Not in the chart of accounts',
  NO_FSLI: 'No FSLI',
  NO_COUNTERPARTY: 'Needs a counterparty',
};

/** FSLIs an account may be mapped to (not computed, not consolidation-only). */
export function mappableFslis<T extends MappingFsli>(fslis: readonly T[]): T[] {
  return fslis.filter((f) => !f.computed && !f.consolidationOnly);
}

/**
 * TB accounts that need mapping: not in the entity's chart of accounts, no FSLI, or an FSLI
 * that needs a counterparty with none set.
 */
export function accountsToMap(
  lines: readonly TbLineInput[],
  coa: readonly MappedAccount[],
  fslis: readonly MappingFsli[],
): { line: TbLineInput; account: MappedAccount | null; reasons: MapReason[] }[] {
  const byCode = new Map(coa.map((a) => [a.accountCode, a]));
  const fsliBy = new Map(fslis.map((f) => [f.code, f]));
  return lines.flatMap((line) => {
    const account = byCode.get(line.accountCode) ?? null;
    const reasons: MapReason[] = [];
    if (!account) reasons.push('NOT_IN_COA');
    else if (!account.fsliCode) reasons.push('NO_FSLI');
    else if (fsliBy.get(account.fsliCode)?.needsCounterparty && !account.counterpartyCode)
      reasons.push('NO_COUNTERPARTY');
    return reasons.length > 0 ? [{ line, account, reasons }] : [];
  });
}

export interface FsliSuggestion {
  fsliCode: string;
  counterpartyCode: string | null;
  /** Where it came from: "Similar to UK 6390", "From account name", "From account type". */
  source: string;
}

type TypeKind = 'expense' | 'income' | 'other';
const typeKind = (type: string | null): TypeKind =>
  !type
    ? 'other'
    : /expense|cost of goods/i.test(type)
      ? 'expense'
      : /income/i.test(type)
        ? 'income'
        : 'other';

/** Keyword rules on the account name, checked in order (page 4 list). */
const KEYWORDS: [RegExp, string | ((kind: TypeKind) => string | null)][] = [
  [/welfare|salar|gratuity|bonus/i, 'EMP'],
  [/professional|legal|consult|audit fee/i, 'PROF'],
  [/software|subscription|licen[cs]e|cloud/i, 'SOFTWARE'],
  [/bank charge|\bfees?\b/i, 'OTH_EXP'],
  [/advance to supplier|prepaid|deposit/i, 'CUR_OTH'],
  [/\brent\b/i, 'RENT'],
  [/depreciation/i, 'DEPR'],
  [/interest/i, (kind) => (kind === 'expense' ? 'FIN_COST' : kind === 'income' ? 'OTH_INC' : null)],
  [/travel|conveyance/i, 'TRAVEL'],
];

const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Suggests an FSLI for an account, in priority order:
 *   1. the same account name already mapped in another entity's chart of accounts;
 *   2. the account name: intercompany patterns ("Due from …") with their counterparty, then
 *      keywords (welfare → EMP, bank charge → OTH_EXP, …);
 *   3. the account-type default.
 */
export function suggestFsli(
  account: { code: string; name: string; type: string | null },
  ctx: {
    entityCode: string;
    /** Charts of accounts of the other entities. */
    otherAccounts: readonly MappedAccount[];
    entities: readonly InferenceEntity[];
    typeDefaults: Record<string, string>;
    /** Intercompany FSLIs (their counterparty differs per entity, so never copied). */
    intercompanyFslis: ReadonlySet<string>;
  },
): FsliSuggestion | null {
  const name = normName(account.name);
  const similar = ctx.otherAccounts
    .filter(
      (a) =>
        a.entityCode !== ctx.entityCode &&
        a.fsliCode &&
        !ctx.intercompanyFslis.has(a.fsliCode) &&
        normName(a.accountName) === name,
    )
    .sort(
      (a, b) => Number(b.accountCode === account.code) - Number(a.accountCode === account.code),
    );
  if (similar[0]) {
    return {
      fsliCode: similar[0].fsliCode!,
      counterpartyCode: null,
      source: `Similar to ${similar[0].entityCode} ${similar[0].accountCode}`,
    };
  }

  for (const [re, fsli] of IC_NAME_PATTERNS) {
    const m = re.exec(account.name.trim());
    const cp = m ? findCounterparty(m[1]!, ctx.entities, ctx.entityCode) : null;
    if (cp)
      return {
        fsliCode: fsli,
        counterpartyCode: cp.code,
        source: 'From account name (intercompany)',
      };
  }
  for (const [re, rule] of KEYWORDS) {
    if (!re.test(account.name)) continue;
    const fsli = typeof rule === 'string' ? rule : rule(typeKind(account.type));
    if (fsli) return { fsliCode: fsli, counterpartyCode: null, source: 'From account name' };
  }
  const byType = account.type ? ctx.typeDefaults[account.type] : undefined;
  return byType ? { fsliCode: byType, counterpartyCode: null, source: 'From account type' } : null;
}

/** Zoho account type → the FSLI class it normally maps to. */
export const ACCOUNT_TYPE_CLASS: Record<string, FsliClassCode> = {
  Cash: 'A',
  Bank: 'A',
  'Accounts Receivable': 'A',
  'Other Current Asset': 'A',
  Stock: 'A',
  'Fixed Asset': 'A',
  'Other Asset': 'A',
  'Accounts Payable': 'L',
  'Other Current Liability': 'L',
  'Credit Card': 'L',
  'Long Term Liability': 'L',
  'Other Liability': 'L',
  Equity: 'E',
  Income: 'I',
  'Other Income': 'I',
  Expense: 'X',
  'Cost Of Goods Sold': 'X',
  'Other Expense': 'X',
};
const CLASS_TEXT: Record<FsliClassCode, string> = {
  A: 'an asset',
  L: 'a liability',
  E: 'an equity',
  I: 'an income',
  X: 'an expense',
};

export interface MappingIssue {
  code: string;
  message: string;
}

/**
 * Checks one mapping. Errors block saving; warnings (account type vs FSLI class) must be
 * confirmed by the user.
 */
export function validateMapping(
  m: { accountType: string | null; fsliCode: string | null; counterpartyCode: string | null },
  ctx: {
    entityCode: string;
    fslis: readonly MappingFsli[];
    entities: readonly { code: string; isActive: boolean; parentCode: string | null }[];
  },
): { errors: MappingIssue[]; warnings: MappingIssue[] } {
  const errors: MappingIssue[] = [];
  const warnings: MappingIssue[] = [];
  const fsli = m.fsliCode ? ctx.fslis.find((f) => f.code === m.fsliCode) : undefined;
  if (!m.fsliCode) errors.push({ code: 'FSLI_REQUIRED', message: 'Choose an FSLI.' });
  else if (!fsli) errors.push({ code: 'FSLI_UNKNOWN', message: `Unknown FSLI ${m.fsliCode}.` });
  else if (fsli.computed || fsli.consolidationOnly)
    errors.push({
      code: 'FSLI_NOT_MAPPABLE',
      message: `${fsli.name} is ${fsli.computed ? 'calculated by the system' : 'produced only by consolidation'}; accounts cannot be mapped to it.`,
    });

  if (fsli?.needsCounterparty) {
    const cp = m.counterpartyCode
      ? ctx.entities.find((e) => e.code === m.counterpartyCode)
      : undefined;
    if (!m.counterpartyCode)
      errors.push({
        code: 'COUNTERPARTY_REQUIRED',
        message: `${fsli.name} needs a counterparty entity.`,
      });
    else if (m.counterpartyCode === ctx.entityCode)
      errors.push({
        code: 'COUNTERPARTY_SELF',
        message: 'The counterparty cannot be the entity itself.',
      });
    else if (!cp || !cp.isActive)
      errors.push({
        code: 'COUNTERPARTY_INVALID',
        message: `${m.counterpartyCode} is not an active group entity.`,
      });
    else if (fsli.code === 'INV_SUB' && cp.parentCode !== ctx.entityCode)
      errors.push({
        code: 'NOT_DIRECT_SUBSIDIARY',
        message: `${cp.code} is not a direct subsidiary of ${ctx.entityCode} in the group structure.`,
      });
  }

  const typeClass = m.accountType ? ACCOUNT_TYPE_CLASS[m.accountType] : undefined;
  if (fsli && typeClass && typeClass !== fsli.class) {
    warnings.push({
      code: 'TYPE_CLASS_CONFLICT',
      message: `Account type "${m.accountType}" is ${CLASS_TEXT[typeClass]} type, but ${fsli.name} is ${CLASS_TEXT[fsli.class]} line (${fsli.statement === 'BS' ? 'balance sheet' : 'profit and loss'}).`,
    });
  }
  return { errors, warnings };
}

export interface FsliTotalsResult {
  rows: { code: string; name: string; statement: 'BS' | 'PL'; amount: string }[];
  /** Lines without an FSLI. */
  unmapped: string;
  bsTotal: string;
  plTotal: string;
  /** Profit for the period = −(sum of P&L FSLIs): a credit P&L total is a profit. */
  profit: string;
  /** All FSLIs plus unmapped: equals the TB total, which must be nil. */
  total: string;
  nil: boolean;
}

/** Totals per FSLI (FSLI order), with profit for the period and the "total = TB total" check. */
export function fsliTotals(
  lines: readonly { amount: string; fsliCode: string | null }[],
  fslis: readonly MappingFsli[],
): FsliTotalsResult {
  const by = new Map<string, Decimal>();
  let unmapped = new Decimal(0);
  const known = new Map(fslis.map((f) => [f.code, f]));
  for (const l of lines) {
    if (l.fsliCode && known.has(l.fsliCode))
      by.set(l.fsliCode, (by.get(l.fsliCode) ?? new Decimal(0)).plus(l.amount));
    else unmapped = unmapped.plus(l.amount);
  }
  const rows = [...fslis]
    .filter((f) => by.has(f.code))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((f) => ({
      code: f.code,
      name: f.name,
      statement: f.statement,
      amount: by.get(f.code)!.toFixed(2),
    }));
  const sum = (st: 'BS' | 'PL') =>
    rows.filter((r) => r.statement === st).reduce((s, r) => s.plus(r.amount), new Decimal(0));
  const pl = sum('PL');
  const total = sum('BS').plus(pl).plus(unmapped);
  return {
    rows,
    unmapped: unmapped.toFixed(2),
    bsTotal: sum('BS').toFixed(2),
    plTotal: pl.toFixed(2),
    profit: pl.negated().toFixed(2),
    total: total.toFixed(2),
    nil: total.isZero(),
  };
}

export interface IntercompanyRow {
  counterpartyCode: string;
  receivable: string;
  payable: string;
  revenue: string;
  charges: string;
}

const IC_COLUMNS: Record<string, keyof Omit<IntercompanyRow, 'counterpartyCode'>> = {
  IC_REC: 'receivable',
  IC_PAY: 'payable',
  IC_REV: 'revenue',
  IC_EXP: 'charges',
};

/** One row per counterparty: IC receivable, payable, revenue and charges (signed). */
export function intercompanySummary(
  lines: readonly { amount: string; fsliCode: string | null; counterpartyCode: string | null }[],
): IntercompanyRow[] {
  const rows = new Map<string, Record<string, Decimal>>();
  for (const l of lines) {
    const col = l.fsliCode ? IC_COLUMNS[l.fsliCode] : undefined;
    if (!col || !l.counterpartyCode) continue;
    const r = rows.get(l.counterpartyCode) ?? {};
    r[col] = (r[col] ?? new Decimal(0)).plus(l.amount);
    rows.set(l.counterpartyCode, r);
  }
  return [...rows.entries()].map(([counterpartyCode, r]) => ({
    counterpartyCode,
    receivable: (r.receivable ?? new Decimal(0)).toFixed(2),
    payable: (r.payable ?? new Decimal(0)).toFixed(2),
    revenue: (r.revenue ?? new Decimal(0)).toFixed(2),
    charges: (r.charges ?? new Decimal(0)).toFixed(2),
  }));
}
