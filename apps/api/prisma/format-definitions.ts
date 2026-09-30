/**
 * The three seeded report formats (version 1). Built with small helpers:
 *   H(key, label)             heading
 *   L(key, label, [FSLIs])    line
 *   T(key, label, 'a + b - c', role?)  total of lines above
 */
import type { FormatLine, FormatRole, FormatStatement } from '@finance-close/engine';

type Builder = (statement: FormatStatement) => FormatLine;
const H =
  (key: string, label: string, indent = 0): Builder =>
  (statement) => ({
    key,
    statement,
    type: 'HEADING',
    label,
    indent,
    fslis: [],
    formula: [],
    role: null,
  });
const L =
  (key: string, label: string, fslis: string[], indent = 0): Builder =>
  (statement) => ({ key, statement, type: 'LINE', label, indent, fslis, formula: [], role: null });
const T =
  (key: string, label: string, expr: string, role: FormatRole | null = null, indent = 0): Builder =>
  (statement) => {
    const tokens = expr.split(/\s+/);
    const formula = tokens
      .map((t, i) => ({ t, i }))
      .filter(({ i }) => i % 2 === 0)
      .map(({ t, i }) => ({ key: t, op: (i === 0 ? '+' : tokens[i - 1]) as '+' | '-' }));
    return { key, statement, type: 'TOTAL', label, indent, fslis: [], formula, role };
  };
const build = (pl: Builder[], bs: Builder[]): FormatLine[] => [
  ...pl.map((b) => b('PL')),
  ...bs.map((b) => b('BS')),
];

const MANAGEMENT = build(
  [
    L('revenue', 'Revenue', ['REV_OPS', 'IC_REV']),
    L('direct', 'Direct costs', ['COST_SERV']),
    T('gross_margin', 'Gross margin', 'revenue - direct'),
    L('people', 'People cost', ['EMP'], 1),
    L('travel', 'Travel', ['TRAVEL'], 1),
    L('prof', 'Professional fees', ['PROF'], 1),
    L('software', 'Software and subscriptions', ['SOFTWARE'], 1),
    L('rent', 'Rent and facilities', ['RENT'], 1),
    L('ic_charges', 'Intercompany charges', ['IC_EXP'], 1),
    L('other_opex', 'Other operating expenses', ['OTH_EXP'], 1),
    T(
      'total_opex',
      'Total operating expenses',
      'people + travel + prof + software + rent + ic_charges + other_opex',
    ),
    T('ebitda', 'EBITDA', 'gross_margin - total_opex'),
    L('other_income', 'Other income', ['OTH_INC']),
    L('depr', 'Depreciation and amortisation', ['DEPR']),
    L('finance', 'Finance costs', ['FIN_COST']),
    T('pbt', 'Profit before tax', 'ebitda + other_income - depr - finance'),
    L('tax', 'Tax expense', ['TAX_CUR', 'TAX_DEF']),
    T('net_profit', 'Net profit for the period', 'pbt - tax', 'PROFIT'),
  ],
  [
    H('assets', 'Assets'),
    L('fixed', 'Fixed assets', ['PPE', 'CWIP', 'ROU', 'INTANG', 'GOODWILL'], 1),
    L('investments', 'Investments', ['INV_SUB', 'CUR_INV'], 1),
    L('trade_rec', 'Trade receivables', ['TRADE_REC'], 1),
    L('ic_rec', 'Intercompany receivables', ['IC_REC'], 1),
    L('cash', 'Cash and bank', ['CASH', 'BANK_OTH'], 1),
    L(
      'other_assets',
      'Other assets',
      ['NC_FIN', 'DTA', 'NC_OTH', 'INVENTORY', 'CUR_FIN', 'TAX_ASSET', 'CUR_OTH'],
      1,
    ),
    T(
      'total_assets',
      'Total assets',
      'fixed + investments + trade_rec + ic_rec + cash + other_assets',
      'TOTAL_ASSETS',
    ),
    H('eq_liab', 'Equity and liabilities'),
    L('share_cap', 'Share capital and premium', ['SHARE_CAP', 'SEC_PREM'], 1),
    L('reserves', 'Reserves and surplus', ['RETAINED', 'OTH_RES', 'PROFIT', 'PL_NCI'], 1),
    L('fctr', 'Translation reserve (FCTR)', ['FCTR'], 1),
    L('nci', 'Non-controlling interests', ['NCI'], 1),
    T('total_equity', 'Total equity', 'share_cap + reserves + fctr + nci'),
    L('borrowings', 'Borrowings', ['LT_BORR', 'ST_BORR'], 1),
    L('trade_pay', 'Trade payables', ['TRADE_PAY'], 1),
    L('ic_pay', 'Intercompany payables', ['IC_PAY'], 1),
    L('ic_diff', 'Intercompany differences (suspense)', ['IC_DIFF'], 1),
    L(
      'other_liab',
      'Other liabilities and provisions',
      [
        'LEASE_NC',
        'LEASE_C',
        'NC_PROV',
        'DTL',
        'CUR_FIN_LIAB',
        'CUR_OTH_LIAB',
        'CUR_PROV',
        'CUR_TAX_LIAB',
      ],
      1,
    ),
    T(
      'total_liabilities',
      'Total liabilities',
      'borrowings + trade_pay + ic_pay + ic_diff + other_liab',
    ),
    T(
      'total_eq_liab',
      'Total equity and liabilities',
      'total_equity + total_liabilities',
      'TOTAL_EQUITY_LIABILITIES',
    ),
  ],
);

const INVESTOR = build(
  [
    L('revenue', 'Revenue', ['REV_OPS', 'IC_REV']),
    L('cos', 'Cost of services', ['COST_SERV']),
    T('gross_profit', 'Gross profit', 'revenue - cos'),
    L('employee', 'Employee benefits', ['EMP']),
    L('other_opex', 'Other operating expenses', [
      'TRAVEL',
      'PROF',
      'SOFTWARE',
      'RENT',
      'OTH_EXP',
      'IC_EXP',
    ]),
    T('adj_ebitda', 'Adjusted EBITDA', 'gross_profit - employee - other_opex'),
    L('depr', 'Depreciation and amortisation', ['DEPR']),
    T('ebit', 'Operating profit (EBIT)', 'adj_ebitda - depr'),
    L('other_income', 'Other income', ['OTH_INC']),
    L('finance', 'Finance costs', ['FIN_COST']),
    T('pbt', 'Profit before tax', 'ebit + other_income - finance'),
    L('tax', 'Income tax expense', ['TAX_CUR', 'TAX_DEF']),
    T('profit', 'Profit for the period', 'pbt - tax', 'PROFIT'),
  ],
  [
    H('nca', 'Non-current assets'),
    L('ppe', 'Property, plant and equipment', ['PPE', 'CWIP'], 1),
    L('rou', 'Right-of-use assets', ['ROU'], 1),
    L('goodwill', 'Goodwill and intangible assets', ['GOODWILL', 'INTANG'], 1),
    L('inv_sub', 'Investments in subsidiaries', ['INV_SUB'], 1),
    L('other_nca', 'Other non-current assets', ['NC_FIN', 'DTA', 'NC_OTH'], 1),
    T('total_nca', 'Total non-current assets', 'ppe + rou + goodwill + inv_sub + other_nca'),
    H('ca', 'Current assets'),
    L('receivables', 'Trade and other receivables', ['TRADE_REC', 'IC_REC', 'CUR_FIN'], 1),
    L('cash', 'Cash, deposits and current investments', ['CASH', 'BANK_OTH', 'CUR_INV'], 1),
    L('other_ca', 'Other current assets', ['INVENTORY', 'TAX_ASSET', 'CUR_OTH'], 1),
    T('total_ca', 'Total current assets', 'receivables + cash + other_ca'),
    T('total_assets', 'Total assets', 'total_nca + total_ca', 'TOTAL_ASSETS'),
    H('equity', 'Equity'),
    L('share_cap', 'Share capital and APIC', ['SHARE_CAP', 'SEC_PREM'], 1),
    L('reserves', 'Retained earnings and reserves', ['RETAINED', 'OTH_RES', 'PROFIT', 'PL_NCI'], 1),
    L('fctr', 'Translation reserve', ['FCTR'], 1),
    T('equity_owners', 'Equity attributable to owners', 'share_cap + reserves + fctr'),
    L('nci', 'Non-controlling interests', ['NCI'], 1),
    T('total_equity', 'Total equity', 'equity_owners + nci'),
    H('ncl', 'Non-current liabilities'),
    L('borrowings_nc', 'Borrowings', ['LT_BORR'], 1),
    L('lease_nc', 'Lease liabilities', ['LEASE_NC'], 1),
    L('other_ncl', 'Other non-current liabilities', ['NC_PROV', 'DTL'], 1),
    T('total_ncl', 'Total non-current liabilities', 'borrowings_nc + lease_nc + other_ncl'),
    H('cl', 'Current liabilities'),
    L('payables', 'Trade and other payables', ['TRADE_PAY', 'IC_PAY', 'CUR_FIN_LIAB'], 1),
    L('ic_diff', 'Intercompany differences (suspense)', ['IC_DIFF'], 1),
    L('borrowings_c', 'Borrowings and lease liabilities', ['ST_BORR', 'LEASE_C'], 1),
    L('other_cl', 'Other current liabilities', ['CUR_OTH_LIAB', 'CUR_PROV', 'CUR_TAX_LIAB'], 1),
    T('total_cl', 'Total current liabilities', 'payables + ic_diff + borrowings_c + other_cl'),
    T(
      'total_eq_liab',
      'Total equity and liabilities',
      'total_equity + total_ncl + total_cl',
      'TOTAL_EQUITY_LIABILITIES',
    ),
  ],
);

const STATUTORY = build(
  [
    L('revenue', 'I Revenue from operations', ['REV_OPS', 'IC_REV']),
    L('other_income', 'II Other income', ['OTH_INC']),
    T('total_income', 'III Total income (I + II)', 'revenue + other_income'),
    H('expenses', 'IV Expenses'),
    L('employee', 'Employee benefits expense', ['EMP'], 1),
    L('finance', 'Finance costs', ['FIN_COST'], 1),
    L('depr', 'Depreciation and amortisation expense', ['DEPR'], 1),
    L(
      'other_exp',
      'Other expenses',
      ['COST_SERV', 'TRAVEL', 'PROF', 'SOFTWARE', 'RENT', 'OTH_EXP', 'IC_EXP'],
      1,
    ),
    T('total_expenses', 'Total expenses (IV)', 'employee + finance + depr + other_exp'),
    T('pbt', 'V Profit before tax (III − IV)', 'total_income - total_expenses'),
    H('tax_head', 'VI Tax expense'),
    L('tax_current', '(1) Current tax', ['TAX_CUR'], 1),
    L('tax_deferred', '(2) Deferred tax', ['TAX_DEF'], 1),
    T('total_tax', 'Total tax expense (VI)', 'tax_current + tax_deferred'),
    T('profit', 'VII Profit for the period (V − VI)', 'pbt - total_tax', 'PROFIT'),
  ],
  [
    H('assets', 'Assets'),
    H('nca', 'Non-current assets', 1),
    L('ppe', '(a) Property, plant and equipment', ['PPE'], 2),
    L('cwip', '(b) Capital work-in-progress', ['CWIP'], 2),
    L('rou', '(c) Right-of-use assets', ['ROU'], 2),
    L('goodwill', '(d) Goodwill', ['GOODWILL'], 2),
    L('intang', '(e) Other intangible assets', ['INTANG'], 2),
    H('nca_fin', '(f) Financial assets', 2),
    L('nca_inv', '(i) Investments', ['INV_SUB'], 3),
    L('nca_fin_oth', '(ii) Others', ['NC_FIN'], 3),
    L('dta', '(g) Deferred tax assets (net)', ['DTA'], 2),
    L('nca_oth', '(h) Other non-current assets', ['NC_OTH'], 2),
    T(
      'total_nca',
      'Total non-current assets',
      'ppe + cwip + rou + goodwill + intang + nca_inv + nca_fin_oth + dta + nca_oth',
      null,
      1,
    ),
    H('ca', 'Current assets', 1),
    L('inventory', '(a) Inventories', ['INVENTORY'], 2),
    H('ca_fin', '(b) Financial assets', 2),
    L('ca_inv', '(i) Investments', ['CUR_INV'], 3),
    L('trade_rec', '(ii) Trade receivables', ['TRADE_REC', 'IC_REC'], 3),
    L('cash', '(iii) Cash and cash equivalents', ['CASH'], 3),
    L('bank_oth', '(iv) Bank balances other than (iii) above', ['BANK_OTH'], 3),
    L('ca_fin_oth', '(v) Others', ['CUR_FIN'], 3),
    L('tax_asset', '(c) Current tax assets (net)', ['TAX_ASSET'], 2),
    L('ca_oth', '(d) Other current assets', ['CUR_OTH'], 2),
    T(
      'total_ca',
      'Total current assets',
      'inventory + ca_inv + trade_rec + cash + bank_oth + ca_fin_oth + tax_asset + ca_oth',
      null,
      1,
    ),
    T('total_assets', 'Total assets', 'total_nca + total_ca', 'TOTAL_ASSETS'),
    H('eq_liab', 'Equity and liabilities'),
    H('equity', 'Equity', 1),
    L('share_cap', '(a) Equity share capital', ['SHARE_CAP'], 2),
    L(
      'other_equity',
      '(b) Other equity',
      ['SEC_PREM', 'RETAINED', 'OTH_RES', 'PROFIT', 'PL_NCI', 'FCTR'],
      2,
    ),
    T('equity_owners', 'Equity attributable to owners', 'share_cap + other_equity', null, 1),
    L('nci', 'Non-controlling interests', ['NCI'], 1),
    T('total_equity', 'Total equity', 'equity_owners + nci', null, 1),
    H('ncl', 'Non-current liabilities', 1),
    H('ncl_fin', '(a) Financial liabilities', 2),
    L('lt_borr', '(i) Borrowings', ['LT_BORR'], 3),
    L('lease_nc', '(ia) Lease liabilities', ['LEASE_NC'], 3),
    L('nc_prov', '(b) Provisions', ['NC_PROV'], 2),
    L('dtl', '(c) Deferred tax liabilities (net)', ['DTL'], 2),
    T('total_ncl', 'Total non-current liabilities', 'lt_borr + lease_nc + nc_prov + dtl', null, 1),
    H('cl', 'Current liabilities', 1),
    H('cl_fin', '(a) Financial liabilities', 2),
    L('st_borr', '(i) Borrowings', ['ST_BORR'], 3),
    L('lease_c', '(ia) Lease liabilities', ['LEASE_C'], 3),
    L('trade_pay', '(ii) Trade payables', ['TRADE_PAY', 'IC_PAY'], 3),
    L('cl_fin_oth', '(iii) Other financial liabilities', ['CUR_FIN_LIAB', 'IC_DIFF'], 3),
    L('cl_oth', '(b) Other current liabilities', ['CUR_OTH_LIAB'], 2),
    L('cur_prov', '(c) Provisions', ['CUR_PROV'], 2),
    L('cur_tax', '(d) Current tax liabilities (net)', ['CUR_TAX_LIAB'], 2),
    T(
      'total_cl',
      'Total current liabilities',
      'st_borr + lease_c + trade_pay + cl_fin_oth + cl_oth + cur_prov + cur_tax',
      null,
      1,
    ),
    T(
      'total_eq_liab',
      'Total equity and liabilities',
      'total_equity + total_ncl + total_cl',
      'TOTAL_EQUITY_LIABILITIES',
    ),
  ],
);

export const FORMAT_DEFINITIONS: {
  code: string;
  name: string;
  description: string;
  sortOrder: number;
  lines: FormatLine[];
}[] = [
  {
    code: 'MANAGEMENT',
    name: 'Monthly internal (management)',
    description:
      'Management P&L down to EBITDA and net profit, and a condensed balance sheet, for internal monthly reporting.',
    sortOrder: 1,
    lines: MANAGEMENT,
  },
  {
    code: 'INVESTOR',
    name: 'Investor reporting',
    description:
      'Adjusted EBITDA and EBIT, and a current / non-current balance sheet, for investor packs.',
    sortOrder: 2,
    lines: INVESTOR,
  },
  {
    code: 'STATUTORY',
    name: 'Statutory FS (Schedule III, Division II)',
    description:
      'Balance sheet and statement of profit and loss in the Ind AS Schedule III (Division II) layout. Not yet included: the MSME / other split of trade payables and the ageing schedules.',
    sortOrder: 3,
    lines: STATUTORY,
  },
];
