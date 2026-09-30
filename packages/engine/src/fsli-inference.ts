/**
 * Suggests an FSLI (financial statement line item) and an intercompany counterparty for an
 * account, from its name and ERP account type. Used to seed charts of accounts and to
 * pre-fill mapping; a person confirms mappings on the mapping page.
 */
export interface InferenceEntity {
  code: string;
  shortName: string;
  legalName: string;
}

export interface InferredMapping {
  fsliCode: string | null;
  counterpartyCode: string | null;
  /** How it was decided, for display ("name: Due from …", "account type: Bank"). */
  rule: string;
}

/** Zoho account type → default FSLI (seeded as account-type defaults). */
export const ACCOUNT_TYPE_DEFAULTS: Record<string, string> = {
  Cash: 'CASH',
  Bank: 'CASH',
  'Accounts Receivable': 'TRADE_REC',
  'Other Current Asset': 'CUR_OTH',
  Stock: 'INVENTORY',
  'Fixed Asset': 'PPE',
  'Other Asset': 'NC_OTH',
  'Accounts Payable': 'TRADE_PAY',
  'Other Current Liability': 'CUR_OTH_LIAB',
  'Credit Card': 'CUR_FIN_LIAB',
  'Long Term Liability': 'LT_BORR',
  'Other Liability': 'CUR_OTH_LIAB',
  Equity: 'OTH_RES',
  Income: 'REV_OPS',
  'Other Income': 'OTH_INC',
  Expense: 'OTH_EXP',
  'Cost Of Goods Sold': 'COST_SERV',
  'Other Expense': 'OTH_EXP',
};

const ASSET_TYPES = /asset|receivable|stock|cash|bank/i;
const EXPENSE_TYPES = /expense|cost of goods/i;

/** Intercompany name patterns → FSLI; the rest of the name identifies the counterparty. */
export const IC_NAME_PATTERNS: [RegExp, string][] = [
  [/^due from\s+(.+)$/i, 'IC_REC'],
  [/^due to\s+(.+)$/i, 'IC_PAY'],
  [/^ic revenue\s*[-–:]\s*(.+)$/i, 'IC_REV'],
  [/^ic service charges\s*[-–:]\s*(.+)$/i, 'IC_EXP'],
  [/^investment\s*(?:in)?\s*[-–:]\s*(.+)$/i, 'INV_SUB'],
];

/** Keyword rules on the account name, checked in order. `types` limits a rule to account types. */
const NAME_RULES: [RegExp, string, RegExp?][] = [
  [/share capital|equity share|common stock/i, 'SHARE_CAP'],
  [/securities premium|share premium|additional paid|apic/i, 'SEC_PREM'],
  [
    /retained earnings|surplus in (the )?statement of profit|accumulated (profit|deficit)/i,
    'RETAINED',
  ],
  [/deferred tax/i, 'DTA', ASSET_TYPES],
  [/deferred tax/i, 'TAX_DEF', EXPENSE_TYPES],
  [/deferred tax/i, 'DTL'],
  [
    /accumulated depreciation|computer|furniture|equipment|vehicle|leasehold|plant/i,
    'PPE',
    /fixed asset/i,
  ],
  [/capital work|cwip/i, 'CWIP'],
  [/right[- ]of[- ]use/i, 'ROU'],
  [/lease liabilit/i, 'LEASE_C', /current liabilit/i],
  [/lease liabilit/i, 'LEASE_NC'],
  [/software|licen[cs]e|trademark|intangible/i, 'INTANG', /asset/i],
  [/fixed deposit|term deposit/i, 'BANK_OTH'],
  [/security deposit|rental deposit/i, 'NC_FIN'],
  [/(accounts|trade) receivable|debtors/i, 'TRADE_REC'],
  [/(accounts|trade) payable|creditors/i, 'TRADE_PAY'],
  [/income tax payable|provision for (income )?tax|current tax liab/i, 'CUR_TAX_LIAB'],
  [/advance tax|tds receivable|income tax refund|tax receivable/i, 'TAX_ASSET'],
  [/gratuity/i, 'NC_PROV'],
  [/provision for (leave|bonus|warrant)|leave encashment|bonus payable/i, 'CUR_PROV'],
  [/long[- ]term loan|term loan/i, 'LT_BORR'],
  [/short[- ]term loan|overdraft|working capital loan/i, 'ST_BORR'],
  [
    /(salar|wage|staff|payroll|employee|provident|pf contribution|esi|bonus)/i,
    'EMP',
    EXPENSE_TYPES,
  ],
  [/travel|conveyance|lodging|airfare/i, 'TRAVEL', EXPENSE_TYPES],
  [/professional|legal|audit|consultan|accounting fees/i, 'PROF', EXPENSE_TYPES],
  [/software|subscription|saas|cloud|hosting/i, 'SOFTWARE', EXPENSE_TYPES],
  [/rent|facilit|office maintenance|electricity|utilities/i, 'RENT', EXPENSE_TYPES],
  [/depreciation|amorti[sz]ation/i, 'DEPR', EXPENSE_TYPES],
  [/interest expense|bank interest|finance cost|interest on loan/i, 'FIN_COST', EXPENSE_TYPES],
  [/income tax expense|current tax/i, 'TAX_CUR', EXPENSE_TYPES],
  [/interest income|dividend|foreign exchange gain|other income|miscellaneous income/i, 'OTH_INC'],
  [/(sales|revenue|service income|consulting income|subscription income)/i, 'REV_OPS', /income/i],
  [/cash on hand|petty cash|bank|current account|savings account/i, 'CASH', /cash|bank/i],
];

export function findCounterparty(
  text: string,
  entities: readonly InferenceEntity[],
  self?: string,
): InferenceEntity | null {
  const t = text.toLowerCase().replace(/[()]/g, ' ').trim();
  const candidates = entities.filter((e) => e.code !== self);
  return (
    candidates.find((e) => new RegExp(`\\b${e.code.toLowerCase()}\\b`).test(t)) ??
    candidates.find((e) => t.includes(e.shortName.toLowerCase())) ??
    candidates.find(
      (e) => e.legalName.toLowerCase().includes(t) || t.includes(e.legalName.toLowerCase()),
    ) ??
    null
  );
}

export function inferMapping(
  account: { name: string; type?: string | null },
  entities: readonly InferenceEntity[],
  self?: string,
  typeDefaults: Record<string, string> = ACCOUNT_TYPE_DEFAULTS,
): InferredMapping {
  const name = account.name.trim();
  const type = account.type?.trim() ?? '';

  for (const [re, fsli] of IC_NAME_PATTERNS) {
    const m = re.exec(name);
    if (m) {
      const cp = findCounterparty(m[1]!, entities, self);
      if (cp) return { fsliCode: fsli, counterpartyCode: cp.code, rule: `name: ${name}` };
    }
  }
  for (const [re, fsli, types] of NAME_RULES) {
    if (re.test(name) && (!types || types.test(type)))
      return { fsliCode: fsli, counterpartyCode: null, rule: `name: ${name}` };
  }
  const byType = typeDefaults[type];
  if (byType) return { fsliCode: byType, counterpartyCode: null, rule: `account type: ${type}` };
  return { fsliCode: null, counterpartyCode: null, rule: 'no rule matched' };
}
