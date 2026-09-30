/**
 * SAMPLE DATA (illustrative, not real figures). One definition used for:
 *   - the Zoho-format files in ./samples (npm run samples:generate)
 *   - the seed: each entity's chart of accounts (from its Jul-26 TB) and exchange rates
 *   - the automated tests of pages 3 and 4 (expected results are listed below).
 *
 * Every TB balances: the entity's main bank account is the balancing figure. Intercompany
 * accounts come in matching pairs, each side in its own currency at the Aug-26 rates
 * (closing for balances, average for revenue/charges). The Aug-26 TBs contain three accounts
 * that are NOT in the seeded chart of accounts: IN 1455 Advance to Suppliers, IN 6120 Staff
 * Welfare Expenses and UK 6390 Bank Charges.
 *
 * TBs are for the month: P&L is that month only, and Aug retained earnings = Jul retained
 * earnings + Jul profit (the roll-forward page 5 checks).
 *
 * Expected results (Aug-2026; Jul-2026 IN debits 769,056,584.16, RE 165,000,000.00 Cr, profit
 * 16,356,584.16; UK Jul RE 95,000.00 Cr, profit 27,000.00):
 *   IN  debits = credits = 787,777,348.66 INR; profit 17,760,764.50 INR
 *       IC receivables US 30,849,500.00 · UK 9,073,895.58 · AE 6,862,083.05 · UC 9,993,500.00
 *       IC revenue     US 15,588,000.00 · UK 4,649,664.43 · AE 3,537,100.07 · UC 5,196,000.00
 *   UK  profit 29,500.00 GBP
 *   INR per USD: opening 86.40, closing 86.90, average 86.60.
 */
import { Decimal } from '@finance-close/engine';

export interface SampleAccount {
  code: string;
  name: string;
  type: string;
  /** '' when the account is not in that month's TB. */
  jul: string;
  aug: string;
}

export interface SampleEntity {
  code: string;
  legalName: string;
  currency: string;
  bankName: string;
  accounts: SampleAccount[];
}

/** Units of currency per 1 USD (Apr-26 to Aug-26). Opening = prior month's closing. */
const RATE_TABLE: Record<
  string,
  [month: string, opening: string, closing: string, average: string][]
> = {
  INR: [
    ['2026-04-01', '83.4000', '84.1000', '83.7500'],
    ['2026-05-01', '84.1000', '84.9500', '84.5000'],
    ['2026-06-01', '84.9500', '85.6000', '85.3000'],
    ['2026-07-01', '85.6000', '86.4000', '86.0000'],
    ['2026-08-01', '86.4000', '86.9000', '86.6000'],
  ],
  AED: ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01'].map((m) => [
    m,
    '3.6725',
    '3.6725',
    '3.6725',
  ]),
  GBP: [
    ['2026-04-01', '0.7900', '0.7880', '0.7892'],
    ['2026-05-01', '0.7880', '0.7925', '0.7901'],
    ['2026-06-01', '0.7925', '0.7860', '0.7890'],
    ['2026-07-01', '0.7860', '0.7815', '0.7838'],
    ['2026-08-01', '0.7815', '0.7842', '0.7829'],
  ],
  SGD: [
    ['2026-04-01', '1.3450', '1.3480', '1.3462'],
    ['2026-05-01', '1.3480', '1.3425', '1.3450'],
    ['2026-06-01', '1.3425', '1.3510', '1.3468'],
    ['2026-07-01', '1.3510', '1.3555', '1.3530'],
    ['2026-08-01', '1.3555', '1.3490', '1.3521'],
  ],
  LKR: [
    ['2026-04-01', '300.5000', '301.2000', '300.8500'],
    ['2026-05-01', '301.2000', '302.1000', '301.6000'],
    ['2026-06-01', '302.1000', '301.4000', '301.7500'],
    ['2026-07-01', '301.4000', '303.0000', '302.2000'],
    ['2026-08-01', '303.0000', '304.2500', '303.6000'],
  ],
};

export const SAMPLE_RATES = Object.entries(RATE_TABLE).flatMap(([currency, rows]) =>
  rows.map(([month, opening, closing, average]) => ({
    month,
    currency,
    opening,
    closing,
    average,
  })),
);

const aug = (currency: string, kind: 'closing' | 'average') => {
  if (currency === 'USD') return new Decimal(1);
  const r = RATE_TABLE[currency]!.at(-1)!;
  return new Decimal(kind === 'closing' ? r[2] : r[3]);
};
/** Converts an Aug-26 amount between currencies (via USD), 2 dp. */
const convert = (amount: string, from: string, to: string, kind: 'closing' | 'average') =>
  new Decimal(amount).dividedBy(aug(from, kind)).times(aug(to, kind)).toDecimalPlaces(2).toFixed(2);

interface Line {
  code: string;
  name: string;
  type: string;
  /** Explicit Aug-26 amount in the entity's currency (debit +, credit −). */
  aug?: string;
  /** Explicit Jul-26 amount; otherwise derived from Aug (see julFrom). */
  jul?: string;
  /** Otherwise: USD thousands, scaled by entity size and currency. */
  usdK?: string;
  /** Only in the Aug-26 TB. */
  augOnly?: boolean;
}

/** Accounts every entity has (unless overridden); amounts scaled by entity size and currency. */
const TEMPLATE: Line[] = [
  { code: '1010', name: 'Petty Cash', type: 'Cash', usdK: '0.35' },
  { code: '1100', name: 'Accounts Receivable', type: 'Accounts Receivable', usdK: '118.4' },
  { code: '1200', name: 'Prepaid Expenses', type: 'Other Current Asset', usdK: '7.9' },
  { code: '1250', name: 'Indirect Tax Receivable', type: 'Other Current Asset', usdK: '6.2' },
  { code: '1300', name: 'Security Deposit', type: 'Other Asset', usdK: '14.5' },
  { code: '1500', name: 'Computers and Equipment', type: 'Fixed Asset', usdK: '61.3' },
  {
    code: '1510',
    name: 'Accumulated Depreciation - Computers and Equipment',
    type: 'Fixed Asset',
    usdK: '-22.6',
  },
  { code: '1600', name: 'Deferred Tax Asset', type: 'Other Asset', usdK: '3.8' },
  { code: '2001', name: 'Accounts Payable', type: 'Accounts Payable', usdK: '-34.7' },
  { code: '2100', name: 'Accrued Expenses', type: 'Other Current Liability', usdK: '-17.9' },
  { code: '2150', name: 'Income Tax Payable', type: 'Other Current Liability', usdK: '-8.6' },
  {
    code: '2200',
    name: 'Provision for Leave Encashment',
    type: 'Other Current Liability',
    usdK: '-6.9',
  },
  { code: '3001', name: 'Equity Share Capital', type: 'Equity', usdK: '-150' },
  { code: '3100', name: 'Securities Premium', type: 'Equity', usdK: '-80' },
  { code: '3200', name: 'Retained Earnings', type: 'Equity', usdK: '-41.3' },
  { code: '4001', name: 'Consulting Revenue', type: 'Income', usdK: '-75.6' },
  { code: '4500', name: 'Interest Income', type: 'Other Income', usdK: '-0.5' },
  { code: '5001', name: 'Cost of Services', type: 'Cost Of Goods Sold', usdK: '27.4' },
  { code: '6001', name: 'Salaries and Wages', type: 'Expense', usdK: '23.7' },
  { code: '6100', name: 'Travel and Conveyance', type: 'Expense', usdK: '2.2' },
  { code: '6200', name: 'Professional Fees', type: 'Expense', usdK: '3.1' },
  { code: '6300', name: 'Software Subscriptions', type: 'Expense', usdK: '2.4' },
  { code: '6400', name: 'Rent', type: 'Expense', usdK: '4.0' },
  { code: '6500', name: 'Depreciation', type: 'Expense', usdK: '1.3' },
  { code: '6900', name: 'Income Tax Expense', type: 'Expense', usdK: '2.9' },
];

/**
 * India (INR), both months fully specified. Plugs: 1001 bank and 2001 accounts payable (to
 * hit the debit totals), 4001 consulting revenue (to hit the profit), and Aug 3200 retained
 * earnings = Jul retained earnings + Jul profit.
 */
const IN_LINES: Line[] = [
  { code: '1010', name: 'Petty Cash', type: 'Cash', aug: '85000.00', jul: '82000.00' },
  {
    code: '1100',
    name: 'Accounts Receivable',
    type: 'Accounts Receivable',
    aug: '142650000.00',
    jul: '138900000.00',
  },
  {
    code: '1200',
    name: 'Security Deposit',
    type: 'Other Asset',
    aug: '12350000.00',
    jul: '12350000.00',
  },
  {
    code: '1250',
    name: 'Indirect Tax Receivable',
    type: 'Other Current Asset',
    aug: '5180000.00',
    jul: '4960000.00',
  },
  {
    code: '1260',
    name: 'TDS Receivable',
    type: 'Other Current Asset',
    aug: '3420000.00',
    jul: '3180000.00',
  },
  {
    code: '1300',
    name: 'Prepaid Expenses',
    type: 'Other Current Asset',
    aug: '800000.00',
    jul: '1200000.00',
  },
  {
    code: '1400',
    name: 'Investment - Aistra Labs AI Software LLC (UAE)',
    type: 'Other Asset',
    aug: '18000000.00',
    jul: '18000000.00',
  },
  {
    code: '1401',
    name: 'Investment - Aistra Labs UK Ltd',
    type: 'Other Asset',
    aug: '20000000.00',
    jul: '20000000.00',
  },
  {
    code: '1402',
    name: 'Investment - Unconstrained INC',
    type: 'Other Asset',
    aug: '41000000.00',
    jul: '41000000.00',
  },
  {
    code: '1450',
    name: 'Due from Aistra Labs Inc (US)',
    type: 'Other Current Asset',
    aug: '30849500.00',
    jul: '29800000.00',
  },
  {
    code: '1451',
    name: 'Due from Aistra Labs UK Ltd',
    type: 'Other Current Asset',
    aug: '9073895.58',
    jul: '8700000.00',
  },
  {
    code: '1452',
    name: 'Due from Aistra Labs AI Software LLC (UAE)',
    type: 'Other Current Asset',
    aug: '6862083.05',
    jul: '6500000.00',
  },
  {
    code: '1453',
    name: 'Due from Unconstrained INC',
    type: 'Other Current Asset',
    aug: '9993500.00',
    jul: '9600000.00',
  },
  {
    code: '1455',
    name: 'Advance to Suppliers',
    type: 'Other Current Asset',
    aug: '400000.00',
    augOnly: true,
  },
  {
    code: '1500',
    name: 'Computers and Equipment',
    type: 'Fixed Asset',
    aug: '38400000.00',
    jul: '38400000.00',
  },
  {
    code: '1510',
    name: 'Accumulated Depreciation - Computers and Equipment',
    type: 'Fixed Asset',
    aug: '-14250000.00',
    jul: '-13700000.00',
  },
  {
    code: '1520',
    name: 'Furniture and Fixtures',
    type: 'Fixed Asset',
    aug: '6500000.00',
    jul: '6500000.00',
  },
  {
    code: '1530',
    name: 'Accumulated Depreciation - Furniture and Fixtures',
    type: 'Fixed Asset',
    aug: '-1850000.00',
    jul: '-1780000.00',
  },
  {
    code: '1600',
    name: 'Deferred Tax Asset',
    type: 'Other Asset',
    aug: '2940000.00',
    jul: '2940000.00',
  },
  { code: '2001', name: 'Accounts Payable', type: 'Accounts Payable' },
  {
    code: '2100',
    name: 'Accrued Expenses',
    type: 'Other Current Liability',
    aug: '-15320000.00',
    jul: '-14900000.00',
  },
  {
    code: '2150',
    name: 'Income Tax Payable',
    type: 'Other Current Liability',
    aug: '-6980000.00',
    jul: '-6200000.00',
  },
  {
    code: '2200',
    name: 'Provision for Leave Encashment',
    type: 'Other Current Liability',
    aug: '-5410000.00',
    jul: '-5300000.00',
  },
  {
    code: '2210',
    name: 'Provision for Gratuity',
    type: 'Other Current Liability',
    aug: '-8750000.00',
    jul: '-8600000.00',
  },
  {
    code: '2300',
    name: 'TDS Payable',
    type: 'Other Current Liability',
    aug: '-2140000.00',
    jul: '-2050000.00',
  },
  {
    code: '3001',
    name: 'Equity Share Capital',
    type: 'Equity',
    aug: '-100000000.00',
    jul: '-100000000.00',
  },
  {
    code: '3100',
    name: 'Securities Premium',
    type: 'Equity',
    aug: '-50000000.00',
    jul: '-50000000.00',
  },
  { code: '3200', name: 'Retained Earnings', type: 'Equity', jul: '-165000000.00' },
  { code: '4001', name: 'Consulting Revenue', type: 'Income' },
  {
    code: '4100',
    name: 'IC Revenue - US',
    type: 'Income',
    aug: '-15588000.00',
    jul: '-15100000.00',
  },
  { code: '4101', name: 'IC Revenue - UK', type: 'Income', aug: '-4649664.43', jul: '-4500000.00' },
  {
    code: '4102',
    name: 'IC Revenue - UAE',
    type: 'Income',
    aug: '-3537100.07',
    jul: '-3400000.00',
  },
  {
    code: '4103',
    name: 'IC Revenue - Unconstrained',
    type: 'Income',
    aug: '-5196000.00',
    jul: '-5050000.00',
  },
  {
    code: '4500',
    name: 'Interest Income',
    type: 'Other Income',
    aug: '-610000.00',
    jul: '-580000.00',
  },
  {
    code: '5001',
    name: 'Cost of Services',
    type: 'Cost Of Goods Sold',
    aug: '58300000.00',
    jul: '56900000.00',
  },
  {
    code: '6001',
    name: 'Salaries and Wages',
    type: 'Expense',
    aug: '92450000.00',
    jul: '91800000.00',
  },
  {
    code: '6010',
    name: 'Contribution to Provident Fund',
    type: 'Expense',
    aug: '5540000.00',
    jul: '5500000.00',
  },
  {
    code: '6100',
    name: 'Travel and Conveyance',
    type: 'Expense',
    aug: '4870000.00',
    jul: '4650000.00',
  },
  {
    code: '6120',
    name: 'Staff Welfare Expenses',
    type: 'Expense',
    aug: '350000.00',
    augOnly: true,
  },
  {
    code: '6200',
    name: 'Professional Fees',
    type: 'Expense',
    aug: '6930000.00',
    jul: '6700000.00',
  },
  { code: '6210', name: 'Audit Fees', type: 'Expense', aug: '850000.00', jul: '850000.00' },
  {
    code: '6300',
    name: 'Software Subscriptions',
    type: 'Expense',
    aug: '5260000.00',
    jul: '5180000.00',
  },
  { code: '6400', name: 'Office Expenses', type: 'Expense', aug: '350000.00', jul: '700000.00' },
  { code: '6410', name: 'Rent', type: 'Expense', aug: '7850000.00', jul: '7850000.00' },
  { code: '6500', name: 'Depreciation', type: 'Expense', aug: '2840000.00', jul: '2770000.00' },
  {
    code: '6900',
    name: 'Income Tax Expense',
    type: 'Expense',
    aug: '6210000.00',
    jul: '5900000.00',
  },
  {
    code: '6910',
    name: 'Deferred Tax Expense',
    type: 'Expense',
    aug: '150000.00',
    jul: '140000.00',
  },
];

const inAmount = (code: string) => IN_LINES.find((l) => l.code === code)!.aug!;
const due = 'Due to Aistra GenAI India Pvt Ltd';
const icIndia = 'IC Service Charges - India';
const neg = (s: string) => new Decimal(s).negated().toFixed(2);

/** Entity-specific lines (override template lines with the same code). */
const EXTRA: Record<string, Line[]> = {
  US: [
    {
      code: '1400',
      name: 'Investment - Aistra GenAI India Pvt Ltd',
      type: 'Other Asset',
      aug: '1169800.00',
    },
    { code: '3001', name: 'Equity Share Capital', type: 'Equity', aug: '-2000000.00' },
    { code: '3100', name: 'Securities Premium', type: 'Equity', aug: '-1500000.00' },
    {
      code: '2300',
      name: due,
      type: 'Other Current Liability',
      aug: neg(convert(inAmount('1450'), 'INR', 'USD', 'closing')),
    },
    {
      code: '6600',
      name: icIndia,
      type: 'Expense',
      aug: convert(neg(inAmount('4100')), 'INR', 'USD', 'average'),
    },
  ],
  AE: [
    {
      code: '2300',
      name: due,
      type: 'Other Current Liability',
      aug: neg(convert(inAmount('1452'), 'INR', 'AED', 'closing')),
    },
    {
      code: '6600',
      name: icIndia,
      type: 'Expense',
      aug: convert(neg(inAmount('4102')), 'INR', 'AED', 'average'),
    },
    { code: '3001', name: 'Equity Share Capital', type: 'Equity', aug: '-550000.00' },
    { code: '3100', name: 'Securities Premium', type: 'Equity', aug: '-250000.00' },
  ],
  UK: [
    {
      code: '2300',
      name: due,
      type: 'Other Current Liability',
      aug: neg(convert(inAmount('1451'), 'INR', 'GBP', 'closing')),
    },
    {
      code: '6600',
      name: icIndia,
      type: 'Expense',
      aug: convert(neg(inAmount('4101')), 'INR', 'GBP', 'average'),
    },
    { code: '3001', name: 'Equity Share Capital', type: 'Equity', aug: '-150000.00' },
    { code: '3100', name: 'Securities Premium', type: 'Equity', aug: '-50000.00' },
    { code: '3200', name: 'Retained Earnings', type: 'Equity', jul: '-95000.00' },
    { code: '6390', name: 'Bank Charges', type: 'Expense', aug: '900.00', augOnly: true },
  ],
  UC: [
    { code: '1400', name: 'Investment - Veracity Services', type: 'Other Asset', aug: '57720.00' },
    {
      code: '2300',
      name: due,
      type: 'Other Current Liability',
      aug: neg(convert(inAmount('1453'), 'INR', 'USD', 'closing')),
    },
    {
      code: '6600',
      name: icIndia,
      type: 'Expense',
      aug: convert(neg(inAmount('4103')), 'INR', 'USD', 'average'),
    },
    { code: '3001', name: 'Equity Share Capital', type: 'Equity', aug: '-300000.00' },
    { code: '3100', name: 'Securities Premium', type: 'Equity', aug: '-200000.00' },
  ],
  VS: [
    { code: '1400', name: 'Investment - Veracity Sri Lanka', type: 'Other Asset', aug: '22000.00' },
    {
      code: '2300',
      name: 'Due to Veracity Sri Lanka',
      type: 'Other Current Liability',
      aug: neg(convert('1620000.00', 'LKR', 'SGD', 'closing')),
    },
    {
      code: '6600',
      name: 'IC Service Charges - Veracity Sri Lanka',
      type: 'Expense',
      aug: convert('3650000.00', 'LKR', 'SGD', 'average'),
    },
    { code: '3001', name: 'Equity Share Capital', type: 'Equity', aug: '-70000.00' },
    { code: '3100', name: 'Securities Premium', type: 'Equity', aug: '-8000.00' },
  ],
  VM: [
    {
      code: '1450',
      name: 'Due from Veracity Services',
      type: 'Other Current Asset',
      aug: '1620000.00',
    },
    { code: '4100', name: 'IC Revenue - Veracity Services', type: 'Income', aug: '-3650000.00' },
    { code: '3001', name: 'Equity Share Capital', type: 'Equity', aug: '-4000000.00' },
    { code: '3100', name: 'Securities Premium', type: 'Equity', aug: '-1000000.00' },
  ],
};

interface MonthTarget {
  /** Profit for the month (4001 revenue is the plug). */
  profit?: string;
  /** Total debits (1001 bank and 2001 accounts payable are the plugs). */
  debits?: string;
}

const ENTITY_INFO: {
  code: string;
  legalName: string;
  currency: string;
  size: string;
  bankName: string;
  target?: { jul?: MonthTarget; aug?: MonthTarget };
}[] = [
  {
    code: 'US',
    legalName: 'Aistra Labs Inc (US)',
    currency: 'USD',
    size: '1.5',
    bankName: 'Chase Bank Operating Account',
    target: { jul: { profit: '42000.00' }, aug: { profit: '45500.00' } },
  },
  {
    code: 'IN',
    legalName: 'Aistra GenAI India Pvt Ltd',
    currency: 'INR',
    size: '1',
    bankName: 'HDFC Bank Current Account',
    target: {
      jul: { profit: '16356584.16', debits: '769056584.16' },
      aug: { profit: '17760764.50', debits: '787777348.66' },
    },
  },
  {
    code: 'AE',
    legalName: 'Aistra Labs AI Software LLC (UAE)',
    currency: 'AED',
    size: '0.3',
    bankName: 'Emirates NBD Current Account',
    target: { jul: { profit: '18000.00' }, aug: { profit: '19500.00' } },
  },
  {
    code: 'UK',
    legalName: 'Aistra Labs UK Ltd',
    currency: 'GBP',
    size: '0.4',
    bankName: 'Barclays Business Account',
    target: { jul: { profit: '27000.00' }, aug: { profit: '29500.00' } },
  },
  {
    code: 'UC',
    legalName: 'Unconstrained INC',
    currency: 'USD',
    size: '0.6',
    bankName: 'Silicon Valley Bank Operating Account',
    target: { jul: { profit: '9000.00' }, aug: { profit: '9800.00' } },
  },
  {
    code: 'VS',
    legalName: 'Veracity Services Pte (Singapore)',
    currency: 'SGD',
    size: '0.35',
    bankName: 'DBS Bank Current Account',
    target: { jul: { profit: '3200.00' }, aug: { profit: '3500.00' } },
  },
  {
    code: 'VM',
    legalName: 'Veracity Managed Services (Sri Lanka)',
    currency: 'LKR',
    size: '0.25',
    bankName: 'Commercial Bank Current Account',
    target: { jul: { profit: '3000000.00' }, aug: { profit: '3200000.00' } },
  },
];

const isPL = (code: string) => /^[4-6]/.test(code);
const d = (s: string) => new Decimal(s);

/** Template amount in the entity's currency; a small code-based factor avoids round numbers. */
function templateAmount(line: Line, size: string, currency: string): string {
  const wobble = d('1').plus(d(String(Number.parseInt(line.code, 10) % 7)).dividedBy(1000));
  return d(line.usdK!)
    .times(1000)
    .times(size)
    .times(aug(currency, 'closing'))
    .times(wobble)
    .toDecimalPlaces(2)
    .toFixed(2);
}

/** Jul-26 from Aug-26 (TBs are for the month: P&L is that month's only). */
function julFrom(code: string, name: string, augAmount: string): string {
  const factor = isPL(code)
    ? '0.96'
    : code.startsWith('3') || name.startsWith('Investment')
      ? '1'
      : '0.97';
  return d(augAmount).times(factor).toDecimalPlaces(2).toFixed(2);
}

function build(): SampleEntity[] {
  return ENTITY_INFO.map((e) => {
    const lines =
      e.code === 'IN'
        ? IN_LINES
        : (() => {
            const extra = EXTRA[e.code] ?? [];
            const overridden = new Set(extra.map((l) => l.code));
            return [...TEMPLATE.filter((l) => !overridden.has(l.code)), ...extra];
          })();
    const template = new Map(lines.map((l) => [l.code, l]));
    const accounts: SampleAccount[] = lines.map((l) => ({
      code: l.code,
      name: l.name,
      type: l.type,
      jul: '',
      aug: '',
    }));
    const bank: SampleAccount = { code: '1001', name: e.bankName, type: 'Bank', jul: '', aug: '' };
    accounts.unshift(bank);
    const find = (code: string) => accounts.find((a) => a.code === code)!;
    const sum = (m: 'jul' | 'aug', f: (a: SampleAccount) => boolean) =>
      accounts.filter((a) => a[m] !== '' && f(a)).reduce((s, a) => s.plus(a[m]), d('0'));

    // Base amounts. Aug first (explicit or template); Jul explicit or derived from Aug.
    for (const a of accounts) {
      if (a === bank) continue;
      const l = template.get(a.code)!;
      a.aug = l.aug ?? (l.usdK ? templateAmount(l, e.size, e.currency) : '0.00');
      a.jul = l.augOnly ? '' : (l.jul ?? julFrom(a.code, a.name, a.aug));
    }

    const plug = (m: 'jul' | 'aug') => {
      const t = e.target?.[m];
      if (t?.profit) {
        const revenue = find('4001');
        revenue[m] = '0.00';
        revenue[m] = d(t.profit)
          .negated()
          .minus(sum(m, (a) => isPL(a.code)))
          .toFixed(2);
      }
      if (t?.debits) {
        const ap = find('2001');
        bank[m] = '0.00';
        ap[m] = '0.00';
        bank[m] = d(t.debits)
          .minus(sum(m, (a) => d(a[m]).isPositive()))
          .toFixed(2);
        ap[m] = sum(m, () => true)
          .negated()
          .toFixed(2);
      } else {
        bank[m] = '0.00';
        bank[m] = sum(m, () => true)
          .negated()
          .toFixed(2);
      }
    };
    plug('jul');
    // Opening retained earnings for Aug = Jul retained earnings + Jul profit (roll-forward).
    find('3200').aug = d(find('3200').jul)
      .plus(sum('jul', (a) => isPL(a.code)))
      .toFixed(2);
    plug('aug');

    for (const m of ['jul', 'aug'] as const) {
      if (d(bank[m]).isNegative())
        throw new Error(`Sample ${e.code} ${m}: bank balance would be negative (${bank[m]})`);
      if (e.target?.[m]?.debits && !d(find('2001')[m]).isNegative())
        throw new Error(`Sample ${e.code} ${m}: accounts payable would be a debit`);
      if (!sum(m, () => true).isZero()) throw new Error(`Sample ${e.code} ${m} does not balance`);
    }
    accounts.sort((a, b) => a.code.localeCompare(b.code));
    return {
      code: e.code,
      legalName: e.legalName,
      currency: e.currency,
      bankName: e.bankName,
      accounts,
    };
  });
}

export const SAMPLE_ENTITIES: SampleEntity[] = build();

/** Accounts only in the Aug-26 TBs (not in the seeded chart of accounts). */
export const AUG_ONLY_ACCOUNTS: Record<string, string[]> = { IN: ['1455', '6120'], UK: ['6390'] };

/** Materiality per entity (functional currency), for the variance flags on page 5. */
export const SAMPLE_MATERIALITY: Record<string, string> = {
  US: '1000',
  IN: '100000',
  AE: '5000',
  UK: '1000',
  UC: '1000',
  VS: '1500',
  VM: '300000',
};
