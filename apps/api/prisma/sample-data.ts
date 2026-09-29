/**
 * SAMPLE DATA (illustrative, not real figures). One definition used for:
 *   - the Zoho-format files in ./samples (npm run samples:generate)
 *   - the seed: each entity's chart of accounts (from its Jul-26 TB) and exchange rates.
 *
 * Every TB balances: the entity's main bank account is the balancing figure. Intercompany
 * accounts come in matching pairs (in each side's own currency). The Aug-26 TBs contain three
 * accounts that are NOT in the seeded chart of accounts, for the mapping page to demonstrate:
 * IN 6120 Staff Welfare Expenses, IN 1455 Advance to Suppliers, UK 6390 Bank Charges.
 */
import { Decimal } from '@finance-close/engine';

export interface SampleAccount {
  code: string;
  name: string;
  type: string;
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

/** Units of currency per 1 USD, roughly (only to scale the sample amounts). */
const FX: Record<string, string> = {
  USD: '1',
  INR: '83',
  AED: '3.6725',
  GBP: '0.79',
  SGD: '1.35',
  LKR: '300',
};

interface Line {
  code: string;
  name: string;
  type: string;
  /** USD thousands, Jul-26 year to date (debit +, credit −). */
  usdK: string;
  /** Growth Jul → Aug (P&L grows as five months vs four). */
  aug?: string;
  /** Not scaled by entity size (intercompany amounts). */
  fixed?: boolean;
  /** Only in the Aug-26 TB. */
  augOnly?: boolean;
}

const PL_GROWTH = '1.25';

/** Accounts every entity has; amounts are scaled by entity size and currency. */
const TEMPLATE: Line[] = [
  { code: '1010', name: 'Petty Cash', type: 'Cash', usdK: '0.35', aug: '1.1' },
  {
    code: '1100',
    name: 'Accounts Receivable',
    type: 'Accounts Receivable',
    usdK: '118.4',
    aug: '1.06',
  },
  { code: '1200', name: 'Prepaid Expenses', type: 'Other Current Asset', usdK: '7.9', aug: '0.94' },
  {
    code: '1250',
    name: 'Indirect Tax Receivable',
    type: 'Other Current Asset',
    usdK: '6.2',
    aug: '1.08',
  },
  { code: '1300', name: 'Security Deposit', type: 'Other Asset', usdK: '14.5', aug: '1' },
  { code: '1500', name: 'Computers and Equipment', type: 'Fixed Asset', usdK: '61.3', aug: '1.03' },
  {
    code: '1510',
    name: 'Accumulated Depreciation - Computers and Equipment',
    type: 'Fixed Asset',
    usdK: '-22.6',
    aug: '1.06',
  },
  { code: '1600', name: 'Deferred Tax Asset', type: 'Other Asset', usdK: '3.8', aug: '1' },
  { code: '2001', name: 'Accounts Payable', type: 'Accounts Payable', usdK: '-34.7', aug: '1.05' },
  {
    code: '2100',
    name: 'Accrued Expenses',
    type: 'Other Current Liability',
    usdK: '-17.9',
    aug: '1.09',
  },
  {
    code: '2150',
    name: 'Income Tax Payable',
    type: 'Other Current Liability',
    usdK: '-8.6',
    aug: '1.25',
  },
  {
    code: '2200',
    name: 'Provision for Leave Encashment',
    type: 'Other Current Liability',
    usdK: '-6.9',
    aug: '1.04',
  },
  { code: '3001', name: 'Equity Share Capital', type: 'Equity', usdK: '-150', aug: '1' },
  { code: '3100', name: 'Securities Premium', type: 'Equity', usdK: '-80', aug: '1' },
  { code: '3200', name: 'Retained Earnings', type: 'Equity', usdK: '-41.3', aug: '1' },
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

/** Entity-specific lines: intercompany pairs, investments, and the Aug-only new accounts. */
const EXTRA: Record<string, Line[]> = {
  US: [
    {
      code: '1400',
      name: 'Investment - Aistra GenAI India Pvt Ltd',
      type: 'Other Asset',
      usdK: '120',
      aug: '1',
      fixed: true,
    },
    {
      code: '2300',
      name: 'Due to Aistra GenAI India Pvt Ltd',
      type: 'Other Current Liability',
      usdK: '-15.2',
      aug: '1.12',
      fixed: true,
    },
    {
      code: '6600',
      name: 'IC Service Charges - India',
      type: 'Expense',
      usdK: '40.4',
      fixed: true,
    },
  ],
  IN: [
    {
      code: '1400',
      name: 'Investment - Aistra Labs AI Software LLC (UAE)',
      type: 'Other Asset',
      usdK: '20',
      aug: '1',
      fixed: true,
    },
    {
      code: '1401',
      name: 'Investment - Aistra Labs UK Ltd',
      type: 'Other Asset',
      usdK: '25',
      aug: '1',
      fixed: true,
    },
    {
      code: '1402',
      name: 'Investment - Unconstrained INC',
      type: 'Other Asset',
      usdK: '60',
      aug: '1',
      fixed: true,
    },
    {
      code: '1450',
      name: 'Due from Aistra Labs Inc (US)',
      type: 'Other Current Asset',
      usdK: '15.2',
      aug: '1.12',
      fixed: true,
    },
    {
      code: '1451',
      name: 'Due from Aistra Labs UK Ltd',
      type: 'Other Current Asset',
      usdK: '4.1',
      aug: '1.1',
      fixed: true,
    },
    { code: '4100', name: 'IC Revenue - US', type: 'Income', usdK: '-40.4', fixed: true },
    { code: '4101', name: 'IC Revenue - UK', type: 'Income', usdK: '-10.3', fixed: true },
    { code: '3001', name: 'Equity Share Capital', type: 'Equity', usdK: '-210', aug: '1' }, // overrides template
    {
      code: '1455',
      name: 'Advance to Suppliers',
      type: 'Other Current Asset',
      usdK: '2.35',
      augOnly: true,
      fixed: true,
    },
    {
      code: '6120',
      name: 'Staff Welfare Expenses',
      type: 'Expense',
      usdK: '0.84',
      augOnly: true,
      fixed: true,
    },
  ],
  UK: [
    {
      code: '2300',
      name: 'Due to Aistra GenAI India Pvt Ltd',
      type: 'Other Current Liability',
      usdK: '-4.1',
      aug: '1.1',
      fixed: true,
    },
    {
      code: '6600',
      name: 'IC Service Charges - India',
      type: 'Expense',
      usdK: '10.3',
      fixed: true,
    },
    {
      code: '6390',
      name: 'Bank Charges',
      type: 'Expense',
      usdK: '0.12',
      augOnly: true,
      fixed: true,
    },
  ],
  UC: [
    {
      code: '1400',
      name: 'Investment - Veracity Services',
      type: 'Other Asset',
      usdK: '35',
      aug: '1',
      fixed: true,
    },
  ],
  VS: [
    {
      code: '1400',
      name: 'Investment - Veracity Sri Lanka',
      type: 'Other Asset',
      usdK: '12',
      aug: '1',
      fixed: true,
    },
    {
      code: '2300',
      name: 'Due to Veracity Sri Lanka',
      type: 'Other Current Liability',
      usdK: '-5.4',
      aug: '1.15',
      fixed: true,
    },
    {
      code: '6600',
      name: 'IC Service Charges - Veracity Sri Lanka',
      type: 'Expense',
      usdK: '12.2',
      fixed: true,
    },
  ],
  VM: [
    {
      code: '1450',
      name: 'Due from Veracity Services',
      type: 'Other Current Asset',
      usdK: '5.4',
      aug: '1.15',
      fixed: true,
    },
    {
      code: '4100',
      name: 'IC Revenue - Veracity Services',
      type: 'Income',
      usdK: '-12.2',
      fixed: true,
    },
  ],
};

const ENTITY_INFO: {
  code: string;
  legalName: string;
  currency: string;
  size: string;
  bankName: string;
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

/** Amount in the entity's currency, 2 dp; a small code-based factor avoids round numbers. */
function amount(line: Line, size: string, currency: string, month: 'jul' | 'aug'): string {
  const isPL = /^[4-6]/.test(line.code);
  const growth = month === 'aug' ? (line.aug ?? (isPL ? PL_GROWTH : '1')) : '1';
  const wobble = new Decimal(1).plus(
    new Decimal(Number.parseInt(line.code, 10) % 7).dividedBy(1000),
  );
  return new Decimal(line.usdK)
    .times(1000)
    .times(line.fixed ? '1' : size)
    .times(FX[currency]!)
    .times(growth)
    .times(line.fixed ? '1' : wobble)
    .toDecimalPlaces(2)
    .toFixed(2);
}

function build(): SampleEntity[] {
  return ENTITY_INFO.map((e) => {
    const extra = EXTRA[e.code] ?? [];
    const overridden = new Set(extra.map((l) => l.code));
    const lines = [...TEMPLATE.filter((l) => !overridden.has(l.code)), ...extra];
    const accounts: SampleAccount[] = lines
      .map((l) => ({
        code: l.code,
        name: l.name,
        type: l.type,
        jul: l.augOnly ? '' : amount(l, e.size, e.currency, 'jul'),
        aug: amount(l, e.size, e.currency, 'aug'),
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
    // Balancing figure: the main bank account.
    const plug = (month: 'jul' | 'aug') => {
      const sum = accounts.reduce((s, a) => (a[month] ? s.plus(a[month]) : s), new Decimal(0));
      const bank = sum.negated();
      if (bank.isNegative())
        throw new Error(`Sample ${e.code} ${month}: bank balance would be negative (${bank})`);
      return bank.toFixed(2);
    };
    accounts.unshift({
      code: '1001',
      name: e.bankName,
      type: 'Bank',
      jul: plug('jul'),
      aug: plug('aug'),
    });
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

/** Units per 1 USD. Opening = prior closing; illustrative values. */
export const SAMPLE_RATES: {
  month: string;
  currency: string;
  opening: string;
  closing: string;
  average: string;
}[] = [
  ...[
    ['2026-04-01', '83.4000', '83.5500', '83.4800'],
    ['2026-05-01', '83.5500', '83.3000', '83.4200'],
    ['2026-06-01', '83.3000', '83.6200', '83.4500'],
    ['2026-07-01', '83.6200', '83.9000', '83.7600'],
    ['2026-08-01', '83.9000', '84.1200', '84.0100'],
  ].map(([month, opening, closing, average]) => ({
    month: month!,
    currency: 'INR',
    opening: opening!,
    closing: closing!,
    average: average!,
  })),
  ...['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01'].map((month) => ({
    month,
    currency: 'AED',
    opening: '3.6725',
    closing: '3.6725',
    average: '3.6725',
  })),
  ...[
    ['2026-04-01', '0.7900', '0.7880', '0.7892'],
    ['2026-05-01', '0.7880', '0.7925', '0.7901'],
    ['2026-06-01', '0.7925', '0.7860', '0.7890'],
    ['2026-07-01', '0.7860', '0.7815', '0.7838'],
    ['2026-08-01', '0.7815', '0.7842', '0.7829'],
  ].map(([month, opening, closing, average]) => ({
    month: month!,
    currency: 'GBP',
    opening: opening!,
    closing: closing!,
    average: average!,
  })),
  ...[
    ['2026-04-01', '1.3450', '1.3480', '1.3462'],
    ['2026-05-01', '1.3480', '1.3425', '1.3450'],
    ['2026-06-01', '1.3425', '1.3510', '1.3468'],
    ['2026-07-01', '1.3510', '1.3555', '1.3530'],
    ['2026-08-01', '1.3555', '1.3490', '1.3521'],
  ].map(([month, opening, closing, average]) => ({
    month: month!,
    currency: 'SGD',
    opening: opening!,
    closing: closing!,
    average: average!,
  })),
  ...[
    ['2026-04-01', '300.5000', '301.2000', '300.8500'],
    ['2026-05-01', '301.2000', '302.1000', '301.6000'],
    ['2026-06-01', '302.1000', '301.4000', '301.7500'],
    ['2026-07-01', '301.4000', '303.0000', '302.2000'],
    ['2026-08-01', '303.0000', '304.2500', '303.6000'],
  ].map(([month, opening, closing, average]) => ({
    month: month!,
    currency: 'LKR',
    opening: opening!,
    closing: closing!,
    average: average!,
  })),
];
