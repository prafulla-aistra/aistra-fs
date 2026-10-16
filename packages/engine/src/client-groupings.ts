import { type Cell, cellText, HEADER_SCAN_ROWS } from './tb-parser';

/**
 * The client's own groupings (the "Grouping" column of the entity TB sheets in the monthly
 * Financials workbook, e.g. "Financials Aug'26.xlsx") and the FSLI each one maps to. Groupings
 * the statutory FSLIs did not cover have FSLIs of their own (CLIENT_FSLIS), so the Management
 * format can show the client's lines one for one.
 *
 * Intercompany: the client keeps balances with group entities inside its ordinary groupings
 * ("Due to Aistra Labs Inc" under Other Current Liabilities). Consolidation needs them on the
 * intercompany FSLIs with a counterparty, so an account whose name names another group entity
 * goes to the intercompany FSLI of its grouping (IC_GROUPINGS); the Management format shows
 * those FSLIs on the client's line, so the presentation does not change.
 */

export type ClientFsliFlag = 'needsCounterparty' | 'intercompany';
export interface ClientFsli {
  code: string;
  name: string;
  statement: 'BS' | 'PL';
  class: 'A' | 'L' | 'E' | 'I' | 'X';
  rateBasis: 'CLOSING' | 'AVERAGE' | 'HISTORICAL' | 'OPENING';
  /** Statutory / investor formats: placed on the line of this FSLI. */
  anchor: string;
}

/** FSLIs added for the client groupings (names as the client writes them). */
export const CLIENT_FSLIS: readonly ClientFsli[] = [
  // Balance sheet
  {
    code: 'PUD',
    name: 'Product Under Development',
    statement: 'BS',
    class: 'A',
    rateBasis: 'CLOSING',
    anchor: 'INTANG',
  },
  {
    code: 'ACQ_COST',
    name: 'Other Assets (Acquisition, Organisation & Funding Cost)',
    statement: 'BS',
    class: 'A',
    rateBasis: 'CLOSING',
    anchor: 'NC_OTH',
  },
  {
    code: 'SEC_DEP',
    name: 'Security Deposits',
    statement: 'BS',
    class: 'A',
    rateBasis: 'CLOSING',
    anchor: 'NC_FIN',
  },
  {
    code: 'ACCRUED_EXP',
    name: 'Accrued Expenses',
    statement: 'BS',
    class: 'L',
    rateBasis: 'CLOSING',
    anchor: 'CUR_OTH_LIAB',
  },
  {
    code: 'DEFERRED_REV',
    name: 'Deferred Revenue',
    statement: 'BS',
    class: 'L',
    rateBasis: 'CLOSING',
    anchor: 'CUR_OTH_LIAB',
  },
  // Equity: share application money like share capital (historical); the stock compensation
  // reserve like other reserves (opening rate) — both to be confirmed.
  {
    code: 'SHARE_APP',
    name: 'Share Application Money',
    statement: 'BS',
    class: 'E',
    rateBasis: 'HISTORICAL',
    anchor: 'OTH_RES',
  },
  {
    code: 'SBC_RES',
    name: 'Stock Compensation Reserve',
    statement: 'BS',
    class: 'E',
    rateBasis: 'OPENING',
    anchor: 'OTH_RES',
  },
  // P&L — income
  {
    code: 'REV_ONETIME',
    name: 'Revenue-Onetime',
    statement: 'PL',
    class: 'I',
    rateBasis: 'AVERAGE',
    anchor: 'REV_OPS',
  },
  {
    code: 'REV_RECUR',
    name: 'Revenue-Recurring',
    statement: 'PL',
    class: 'I',
    rateBasis: 'AVERAGE',
    anchor: 'REV_OPS',
  },
  {
    code: 'REV_ACQ',
    name: 'Revenue from Acquisitions',
    statement: 'PL',
    class: 'I',
    rateBasis: 'AVERAGE',
    anchor: 'REV_OPS',
  },
  // P&L — cost of revenue
  {
    code: 'SAL_DIRECT',
    name: 'Salaries- Direct Tech',
    statement: 'PL',
    class: 'X',
    rateBasis: 'AVERAGE',
    anchor: 'EMP',
  },
  {
    code: 'DELIVERY_FTE',
    name: 'Delivery FTE Costs',
    statement: 'PL',
    class: 'X',
    rateBasis: 'AVERAGE',
    anchor: 'COST_SERV',
  },
  {
    code: 'SUBS_DIRECT',
    name: 'Dues and Subscriptions - Direct',
    statement: 'PL',
    class: 'X',
    rateBasis: 'AVERAGE',
    anchor: 'COST_SERV',
  },
  {
    code: 'COST_ACQ',
    name: 'Cost of revenue from Acquisitions',
    statement: 'PL',
    class: 'X',
    rateBasis: 'AVERAGE',
    anchor: 'COST_SERV',
  },
  // P&L — operating expenses
  {
    code: 'BU_MGMT',
    name: 'Dedicated BU Management',
    statement: 'PL',
    class: 'X',
    rateBasis: 'AVERAGE',
    anchor: 'EMP',
  },
  {
    code: 'BU_SALES',
    name: 'BU sales & Support',
    statement: 'PL',
    class: 'X',
    rateBasis: 'AVERAGE',
    anchor: 'EMP',
  },
  {
    code: 'SAL_ADMIN',
    name: 'Admin Salaries',
    statement: 'PL',
    class: 'X',
    rateBasis: 'AVERAGE',
    anchor: 'EMP',
  },
  {
    code: 'CORP_FIN',
    name: 'Corporate Finance',
    statement: 'PL',
    class: 'X',
    rateBasis: 'AVERAGE',
    anchor: 'EMP',
  },
  {
    code: 'CORP_STRAT',
    name: 'Corporate Strategy',
    statement: 'PL',
    class: 'X',
    rateBasis: 'AVERAGE',
    anchor: 'EMP',
  },
  {
    code: 'SAL_LEAD',
    name: 'Leadership Salary',
    statement: 'PL',
    class: 'X',
    rateBasis: 'AVERAGE',
    anchor: 'EMP',
  },
  {
    code: 'INTEG_TECH',
    name: 'Integration /tech cost',
    statement: 'PL',
    class: 'X',
    rateBasis: 'AVERAGE',
    anchor: 'SOFTWARE',
  },
  {
    code: 'SALES_MKT',
    name: 'Sales and Marketing',
    statement: 'PL',
    class: 'X',
    rateBasis: 'AVERAGE',
    anchor: 'OTH_EXP',
  },
  {
    code: 'ADVISOR',
    name: "Advisor's Fee",
    statement: 'PL',
    class: 'X',
    rateBasis: 'AVERAGE',
    anchor: 'PROF',
  },
  {
    code: 'HIRING',
    name: 'Hiring Cost',
    statement: 'PL',
    class: 'X',
    rateBasis: 'AVERAGE',
    anchor: 'OTH_EXP',
  },
  {
    code: 'FUNDRAISE',
    name: 'Professional Fees for Fundraise and Advisory',
    statement: 'PL',
    class: 'X',
    rateBasis: 'AVERAGE',
    anchor: 'PROF',
  },
  {
    code: 'HEALTH_INS',
    name: 'Health insurance exp',
    statement: 'PL',
    class: 'X',
    rateBasis: 'AVERAGE',
    anchor: 'EMP',
  },
];

/** Normalised grouping text: lower case, single spaces, no trailing punctuation. */
export const groupingKey = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.:]+$/, '')
    .trim();

/** Client grouping → FSLI (as written in the workbook; matched by groupingKey). */
const GROUPINGS: [grouping: string, fsli: string][] = [
  // Balance sheet
  ['Cash and Cash Equivalents', 'CASH'],
  ['Accounts Receivable', 'TRADE_REC'],
  ['Investment', 'CUR_INV'],
  ['Other Current Assets', 'CUR_OTH'],
  ['Property, Plant and Equipments (Net)', 'PPE'],
  ['Product Under Development', 'PUD'],
  ['Other Asset', 'NC_OTH'],
  ['Other Assets (Acquisition, Organisation & Funding Cost)', 'ACQ_COST'],
  ['Security Deposits', 'SEC_DEP'],
  ['Accounts Payable', 'TRADE_PAY'],
  ['Accrued Expenses', 'ACCRUED_EXP'],
  ['Deferred Revenue', 'DEFERRED_REV'],
  ['Other Current Liabilities', 'CUR_OTH_LIAB'],
  ['Loan Payable-Others', 'LT_BORR'],
  ['Common Shares', 'SHARE_CAP'],
  ['Reserves & Surplus', 'OTH_RES'],
  ['Share Application Money', 'SHARE_APP'],
  ['Stock Compensation Reserve', 'SBC_RES'],
  ['Retained Earnings', 'RETAINED'],
  // P&L
  ['Revenue-Onetime', 'REV_ONETIME'],
  ['Revenue-Recurring', 'REV_RECUR'],
  ['Intercompany Revenue', 'IC_REV'],
  ['Revenue from Acquisions', 'REV_ACQ'],
  ['Revenue from Acquisitions', 'REV_ACQ'],
  ['Other Income', 'OTH_INC'],
  ['Cost of Revenue-Intercompany', 'IC_EXP'],
  ['Salaries- Direct Tech', 'SAL_DIRECT'],
  ['Delivery FTE Costs', 'DELIVERY_FTE'],
  ['Dues and Subscriptions - Direct', 'SUBS_DIRECT'],
  ['Cost of revenue from Acquisitions', 'COST_ACQ'],
  ['Dedicated BU Management', 'BU_MGMT'],
  ['BU sales & Support', 'BU_SALES'],
  ['Admin Salaries', 'SAL_ADMIN'],
  ['Corporate Finance', 'CORP_FIN'],
  ['Corporate Strategy', 'CORP_STRAT'],
  ['Leadership Salary', 'SAL_LEAD'],
  ['Integration /tech cost', 'INTEG_TECH'],
  ['Sales and Marketing', 'SALES_MKT'],
  ["Advisor's Fee", 'ADVISOR'],
  ["Advisor's Fee & Accounting fee", 'ADVISOR'],
  ['Legal and Compliance', 'PROF'],
  ['Rent & Utlitiies', 'RENT'],
  ['Rent & Utilities', 'RENT'],
  ['Hiring Cost', 'HIRING'],
  ['Professional Fees for Fundraise and Advisory', 'FUNDRAISE'],
  ['Travel expenses', 'TRAVEL'],
  ['Dues and subscription', 'SOFTWARE'],
  ['Health insurance exp', 'HEALTH_INS'],
  ['Other Expenses', 'OTH_EXP'],
];
export const GROUPING_FSLI: ReadonlyMap<string, string> = new Map(
  GROUPINGS.map(([g, f]) => [groupingKey(g), f]),
);

/** Grouping FSLI → its intercompany FSLI, for accounts with another group entity. */
const IC_GROUPINGS: Readonly<Record<string, string>> = {
  TRADE_REC: 'IC_REC',
  CUR_OTH: 'IC_REC',
  CUR_INV: 'INV_SUB',
  TRADE_PAY: 'IC_PAY',
  CUR_OTH_LIAB: 'IC_PAY',
  LT_BORR: 'IC_PAY',
  IC_REV: 'IC_REV',
  IC_EXP: 'IC_EXP',
};

/** Group entity named in an account name (most specific names first). */
const COUNTERPARTY_NAMES: [entity: string, pattern: RegExp][] = [
  ['AE', /ai software/i],
  ['UK', /aistra labs uk/i],
  ['IN', /aistra ?gen|asitra ?gen|genai|india/i],
  ['UC', /unconstrained/i],
  ['VS', /veracity services/i],
  ['VM', /veracity managed/i],
  ['US', /aistra labs(\s*,?\s*inc\b|\s*$)/i],
];

export function counterpartyInName(name: string, self: string): string | null {
  for (const [entity, re] of COUNTERPARTY_NAMES)
    if (re.test(name)) return entity === self ? null : entity;
  return null;
}

export interface GroupingRow {
  code: string;
  name: string;
  grouping: string;
}

/**
 * The "Account | Account Code | Grouping" table of an entity TB sheet: the header row is the
 * first (within HEADER_SCAN_ROWS) with "Account Code" and "Grouping"; rows without a code and
 * "Total for …" rows are skipped. Null when the sheet has no such header.
 */
export function readGroupingSheet(rows: readonly (readonly Cell[])[]): GroupingRow[] | null {
  for (let r = 0; r < Math.min(rows.length, HEADER_SCAN_ROWS); r++) {
    const h = (rows[r] ?? []).map((c) => groupingKey(cellText(c)));
    const code = h.indexOf('account code');
    const grouping = h.findIndex((x) => x === 'grouping' || x === 'fsli');
    if (code < 0 || grouping < 0) continue;
    const name = h.findIndex((x) => x === 'account' || x === 'account name');
    const out: GroupingRow[] = [];
    const seen = new Set<string>();
    for (const row of rows.slice(r + 1)) {
      const c = cellText(row[code]).trim();
      const n = name >= 0 ? cellText(row[name]).trim() : '';
      if (!c || /^total for\b/i.test(n) || seen.has(c)) continue;
      seen.add(c);
      out.push({ code: c, name: n, grouping: cellText(row[grouping]).trim() });
    }
    return out;
  }
  return null;
}

export type GroupingStatus =
  | 'NEW' // account unmapped → mapped
  | 'CHANGE' // mapping differs from the current one
  | 'SAME'
  | 'NO_GROUPING' // blank grouping in the file: left as is
  | 'UNKNOWN_GROUPING' // grouping not in the table: left as is
  | 'NEEDS_COUNTERPARTY' // intercompany FSLI without a group entity in the name: left as is
  | 'NOT_IN_COA'; // code not in the entity's chart of accounts

export interface GroupingPlanItem {
  code: string;
  name: string;
  grouping: string;
  fsliCode: string | null;
  counterpartyCode: string | null;
  status: GroupingStatus;
  before: { fsliCode: string | null; counterpartyCode: string | null } | null;
}

/**
 * What importing a grouping sheet would do to an entity's chart of accounts. Only accounts
 * already in the chart are mapped; rows that cannot be resolved are listed, never guessed.
 */
export function planGroupingImport(input: {
  entityCode: string;
  rows: readonly GroupingRow[];
  coa: readonly {
    code: string;
    name: string;
    fsliCode: string | null;
    counterpartyCode: string | null;
  }[];
  fslis: readonly {
    code: string;
    name?: string;
    needsCounterparty: boolean;
    computed: boolean;
    consolidationOnly: boolean;
  }[];
}): GroupingPlanItem[] {
  const coa = new Map(input.coa.map((a) => [a.code, a]));
  const fslis = new Map(input.fslis.map((f) => [f.code, f]));
  return input.rows.map((row) => {
    const account = coa.get(row.code);
    const before = account
      ? { fsliCode: account.fsliCode, counterpartyCode: account.counterpartyCode }
      : null;
    const base = {
      code: row.code,
      name: account?.name || row.name,
      grouping: row.grouping,
      before,
    };
    const none = { fsliCode: null, counterpartyCode: null };
    if (!account) return { ...base, ...none, status: 'NOT_IN_COA' as const };
    if (!row.grouping) return { ...base, ...none, status: 'NO_GROUPING' as const };
    // The table first; else an FSLI with the grouping's name (added in Configuration).
    let fsliCode =
      GROUPING_FSLI.get(groupingKey(row.grouping)) ??
      input.fslis.find(
        (f) =>
          !f.computed &&
          !f.consolidationOnly &&
          !!f.name &&
          groupingKey(f.name) === groupingKey(row.grouping),
      )?.code ??
      null;
    if (!fsliCode || !fslis.has(fsliCode))
      return { ...base, ...none, status: 'UNKNOWN_GROUPING' as const };
    const cp = counterpartyInName(base.name, input.entityCode);
    const icFsli = IC_GROUPINGS[fsliCode];
    if (cp && icFsli) fsliCode = icFsli;
    const needsCp = fslis.get(fsliCode)!.needsCounterparty;
    // No group entity in the name: the counterparty chosen by hand (if any) stands.
    const handCp = needsCp && !cp && before?.fsliCode === fsliCode ? before.counterpartyCode : null;
    if (needsCp && !cp && !handCp)
      return { ...base, ...none, status: 'NEEDS_COUNTERPARTY' as const };
    const counterpartyCode = needsCp ? (cp ?? handCp) : null;
    const status =
      before?.fsliCode == null
        ? ('NEW' as const)
        : before.fsliCode === fsliCode && before.counterpartyCode === counterpartyCode
          ? ('SAME' as const)
          : ('CHANGE' as const);
    return { ...base, fsliCode, counterpartyCode, status };
  });
}

/**
 * How an account's mapping stands, for the tags the finance team works through:
 * GROUPING (from the client's groupings) is the target; NOT_IN_GROUPINGS (mapped by hand or
 * suggested and confirmed elsewhere) and SUGGESTED need adding to the client's groupings or a
 * check; NO_COUNTERPARTY and UNMAPPED must be fixed before the entity can continue.
 */
export type MappingStatus =
  'SYSTEM' | 'GROUPING' | 'NOT_IN_GROUPINGS' | 'SUGGESTED' | 'NO_COUNTERPARTY' | 'UNMAPPED';

export function mappingStatus(a: {
  code?: string;
  fsliCode: string | null;
  needsCounterparty: boolean;
  counterpartyCode: string | null;
  suggested: boolean;
  grouping: string | null;
}): MappingStatus {
  if (a.code === 'YTD-PRIOR') return 'SYSTEM';
  if (!a.fsliCode) return 'UNMAPPED';
  if (a.needsCounterparty && !a.counterpartyCode) return 'NO_COUNTERPARTY';
  if (a.grouping) return 'GROUPING';
  return a.suggested ? 'SUGGESTED' : 'NOT_IN_GROUPINGS';
}
