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
 * Expected results (Aug-2026):
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
  { code: '4001', name: 'Consulting Revenue', type: 'Income', usdK: '-302.6' },
  { code: '4500', name: 'Interest Income', type: 'Other Income', usdK: '-1.9' },
  { code: '5001', name: 'Cost of Services', type: 'Cost Of Goods Sold', usdK: '109.8' },
  { code: '6001', name: 'Salaries and Wages', type: 'Expense', usdK: '94.7' },
  { code: '6100', name: 'Travel and Conveyance', type: 'Expense', usdK: '8.8' },
  { code: '6200', name: 'Professional Fees', type: 'Expense', usdK: '12.4' },
  { code: '6300', name: 'Software Subscriptions', type: 'Expense', usdK: '9.7' },
  { code: '6400', name: 'Rent', type: 'Expense', usdK: '15.9' },
  { code: '6500', name: 'Depreciation', type: 'Expense', usdK: '5.3' },
  { code: '6900', name: 'Income Tax Expense', type: 'Expense', usdK: '11.6' },
];

/** India's Aug-26 TB is fully specified (INR). 1001 Bank and 3200 Retained earnings are plugs. */
const IN_LINES: Line[] = [
  { code: '1010', name: 'Petty Cash', type: 'Cash', aug: '85000.00' },
  { code: '1100', name: 'Accounts Receivable', type: 'Accounts Receivable', aug: '142650000.00' },
  { code: '1200', name: 'Prepaid Expenses', type: 'Other Current Asset', aug: '6420000.00' },
  { code: '1250', name: 'Indirect Tax Receivable', type: 'Other Current Asset', aug: '5180000.00' },
  { code: '1300', name: 'Security Deposit', type: 'Other Asset', aug: '12350000.00' },
  {
    code: '1400',
    name: 'Investment - Aistra Labs AI Software LLC (UAE)',
    type: 'Other Asset',
    aug: '18000000.00',
  },
  {
    code: '1401',
    name: 'Investment - Aistra Labs UK Ltd',
    type: 'Other Asset',
    aug: '20000000.00',
  },
  { code: '1402', name: 'Investment - Unconstrained INC', type: 'Other Asset', aug: '41000000.00' },
  {
    code: '1450',
    name: 'Due from Aistra Labs Inc (US)',
    type: 'Other Current Asset',
    aug: '30849500.00',
  },
  {
    code: '1451',
    name: 'Due from Aistra Labs UK Ltd',
    type: 'Other Current Asset',
    aug: '9073895.58',
  },
  {
    code: '1452',
    name: 'Due from Aistra Labs AI Software LLC (UAE)',
    type: 'Other Current Asset',
    aug: '6862083.05',
  },
  {
    code: '1453',
    name: 'Due from Unconstrained INC',
    type: 'Other Current Asset',
    aug: '9993500.00',
  },
  {
    code: '1455',
    name: 'Advance to Suppliers',
    type: 'Other Current Asset',
    aug: '400000.00',
    augOnly: true,
  },
  { code: '1500', name: 'Computers and Equipment', type: 'Fixed Asset', aug: '38400000.00' },
  {
    code: '1510',
    name: 'Accumulated Depreciation - Computers and Equipment',
    type: 'Fixed Asset',
    aug: '-14250000.00',
  },
  { code: '1600', name: 'Deferred Tax Asset', type: 'Other Asset', aug: '2940000.00' },
  { code: '2001', name: 'Accounts Payable', type: 'Accounts Payable', aug: '-28760000.00' },
  { code: '2100', name: 'Accrued Expenses', type: 'Other Current Liability', aug: '-15320000.00' },
  { code: '2150', name: 'Income Tax Payable', type: 'Other Current Liability', aug: '-6980000.00' },
  {
    code: '2200',
    name: 'Provision for Leave Encashment',
    type: 'Other Current Liability',
    aug: '-5410000.00',
  },
  { code: '3001', name: 'Equity Share Capital', type: 'Equity', aug: '-150000000.00' },
  { code: '3100', name: 'Securities Premium', type: 'Equity', aug: '-225000000.00' },
  { code: '3200', name: 'Retained Earnings', type: 'Equity' },
  { code: '4001', name: 'Consulting Revenue', type: 'Income' },
  { code: '4100', name: 'IC Revenue - US', type: 'Income', aug: '-15588000.00' },
  { code: '4101', name: 'IC Revenue - UK', type: 'Income', aug: '-4649664.43' },
  { code: '4102', name: 'IC Revenue - UAE', type: 'Income', aug: '-3537100.07' },
  { code: '4103', name: 'IC Revenue - Unconstrained', type: 'Income', aug: '-5196000.00' },
  { code: '4500', name: 'Interest Income', type: 'Other Income', aug: '-610000.00' },
  { code: '5001', name: 'Cost of Services', type: 'Cost Of Goods Sold', aug: '58300000.00' },
  { code: '6001', name: 'Salaries and Wages', type: 'Expense', aug: '92450000.00' },
  { code: '6100', name: 'Travel and Conveyance', type: 'Expense', aug: '4870000.00' },
  {
    code: '6120',
    name: 'Staff Welfare Expenses',
    type: 'Expense',
    aug: '350000.00',
    augOnly: true,
  },
  { code: '6200', name: 'Professional Fees', type: 'Expense', aug: '6930000.00' },
  { code: '6300', name: 'Software Subscriptions', type: 'Expense', aug: '5260000.00' },
  { code: '6400', name: 'Rent', type: 'Expense', aug: '7850000.00' },
  { code: '6500', name: 'Depreciation', type: 'Expense', aug: '2840000.00' },
  { code: '6900', name: 'Income Tax Expense', type: 'Expense', aug: '6210000.00' },
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
      aug: '2924500.00',
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
    { code: '6390', name: 'Bank Charges', type: 'Expense', aug: '95.00', augOnly: true },
  ],
  UC: [
    { code: '1400', name: 'Investment - Veracity Services', type: 'Other Asset', aug: '35520.00' },
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
    { code: '1400', name: 'Investment - Veracity Sri Lanka', type: 'Other Asset', aug: '13200.00' },
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
    { code: '3001', name: 'Equity Share Capital', type: 'Equity', aug: '-40000.00' },
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
    { code: '3001', name: 'Equity Share Capital', type: 'Equity', aug: '-2500000.00' },
    { code: '3100', name: 'Securities Premium', type: 'Equity', aug: '-500000.00' },
  ],
};

const ENTITY_INFO: {
  code: string;
  legalName: string;
  currency: string;
  size: string;
  bankName: string;
  /** Aug-26 targets: profit for the period; total debits (then retained earnings is a plug too). */
  target?: { profit: string; debits?: string };
}[] = [
  {
    code: 'US',
    legalName: 'Aistra Labs Inc (US)',
    currency: 'USD',
    size: '1.5',
    bankName: 'Chase Bank Operating Account',
  },
  {
    code: 'IN',
    legalName: 'Aistra GenAI India Pvt Ltd',
    currency: 'INR',
    size: '1',
    bankName: 'HDFC Bank Current Account',
    target: { profit: '17760764.50', debits: '787777348.66' },
  },
  {
    code: 'AE',
    legalName: 'Aistra Labs AI Software LLC (UAE)',
    currency: 'AED',
    size: '0.3',
    bankName: 'Emirates NBD Current Account',
  },
  {
    code: 'UK',
    legalName: 'Aistra Labs UK Ltd',
    currency: 'GBP',
    size: '0.4',
    bankName: 'Barclays Business Account',
    target: { profit: '29500.00' },
  },
  {
    code: 'UC',
    legalName: 'Unconstrained INC',
    currency: 'USD',
    size: '0.6',
    bankName: 'Silicon Valley Bank Operating Account',
  },
  {
    code: 'VS',
    legalName: 'Veracity Services Pte (Singapore)',
    currency: 'SGD',
    size: '0.35',
    bankName: 'DBS Bank Current Account',
  },
  {
    code: 'VM',
    legalName: 'Veracity Managed Services (Sri Lanka)',
    currency: 'LKR',
    size: '0.25',
    bankName: 'Commercial Bank Current Account',
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

/** Jul-26 from Aug-26: P&L is four months of five; balances move a little; equity is unchanged. */
function julFrom(code: string, name: string, augAmount: string): string {
  const factor = isPL(code)
    ? '0.8'
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
    const accounts: SampleAccount[] = lines.map((l) => ({
      code: l.code,
      name: l.name,
      type: l.type,
      jul: '',
      aug: l.aug ?? (l.usdK ? templateAmount(l, e.size, e.currency) : ''),
    }));
    const find = (code: string) => accounts.find((a) => a.code === code)!;
    const sum = (month: 'jul' | 'aug', filter: (a: SampleAccount) => boolean) =>
      accounts
        .filter((a) => a[month] !== '' && filter(a))
        .reduce((s, a) => s.plus(a[month]), d('0'));

    // Aug-26 plugs: revenue for the profit target; bank (and retained earnings) to balance.
    if (e.target) {
      const revenue = find('4001');
      revenue.aug = '0.00';
      revenue.aug = d(e.target.profit)
        .negated()
        .minus(sum('aug', (a) => isPL(a.code)))
        .toFixed(2);
    }
    const bank: SampleAccount = {
      code: '1001',
      name: e.bankName,
      type: 'Bank',
      jul: '',
      aug: '0.00',
    };
    accounts.unshift(bank);
    if (e.target?.debits) {
      const re = find('3200');
      re.aug = '0.00';
      bank.aug = d(e.target.debits)
        .minus(sum('aug', (a) => d(a.aug).isPositive()))
        .toFixed(2);
      re.aug = sum('aug', () => true)
        .negated()
        .toFixed(2);
    } else {
      bank.aug = sum('aug', () => true)
        .negated()
        .toFixed(2);
    }

    // Jul-26: derived from Aug (accounts marked Aug-only are left out), bank balances it.
    const augOnly = new Set(lines.filter((l) => l.augOnly).map((l) => l.code));
    for (const a of accounts)
      if (a !== bank && !augOnly.has(a.code)) a.jul = julFrom(a.code, a.name, a.aug);
    bank.jul = '0.00';
    bank.jul = sum('jul', () => true)
      .negated()
      .toFixed(2);

    for (const m of ['jul', 'aug'] as const) {
      if (d(bank[m]).isNegative())
        throw new Error(`Sample ${e.code} ${m}: bank balance would be negative (${bank[m]})`);
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
