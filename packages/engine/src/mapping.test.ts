import { describe, expect, it } from 'vitest';
import { ACCOUNT_TYPE_DEFAULTS } from './fsli-inference';
import {
  accountsToMap,
  fsliTotals,
  intercompanySummary,
  type MappedAccount,
  type MappingFsli,
  suggestFsli,
  validateMapping,
} from './mapping';
import { crossRate, type MonthlyRate, periodUsdRate } from './rates';

const f = (
  code: string,
  statement: 'BS' | 'PL',
  cls: MappingFsli['class'],
  sortOrder: number,
  extra: Partial<MappingFsli> = {},
): MappingFsli => ({
  code,
  name: code,
  statement,
  class: cls,
  needsCounterparty: false,
  computed: false,
  consolidationOnly: false,
  sortOrder,
  ...extra,
});
const FSLIS: MappingFsli[] = [
  f('CASH', 'BS', 'A', 1),
  f('CUR_OTH', 'BS', 'A', 2),
  f('IC_REC', 'BS', 'A', 3, { needsCounterparty: true }),
  f('INV_SUB', 'BS', 'A', 4, { needsCounterparty: true }),
  f('TRADE_PAY', 'BS', 'L', 5),
  f('SHARE_CAP', 'BS', 'E', 6),
  f('FCTR', 'BS', 'E', 7, { computed: true }),
  f('GOODWILL', 'BS', 'A', 8, { consolidationOnly: true }),
  f('REV_OPS', 'PL', 'I', 9),
  f('IC_REV', 'PL', 'I', 10, { needsCounterparty: true }),
  f('EMP', 'PL', 'X', 11),
  f('OTH_EXP', 'PL', 'X', 12),
];
const acct = (
  code: string,
  name: string,
  fsliCode: string | null,
  counterpartyCode: string | null = null,
  entityCode = 'IN',
): MappedAccount => ({
  entityCode,
  accountCode: code,
  accountName: name,
  accountType: null,
  fsliCode,
  counterpartyCode,
});

describe('accountsToMap', () => {
  it('lists accounts not in the COA, without an FSLI, or missing a needed counterparty', () => {
    const line = (accountCode: string) => ({
      accountCode,
      accountName: accountCode,
      accountType: null,
      amount: '1',
    });
    const r = accountsToMap(
      [line('1001'), line('1455'), line('1200'), line('1450'), line('1451')],
      [
        acct('1001', 'Bank', 'CASH'),
        acct('1200', 'Prepaid', null),
        acct('1450', 'Due from US', 'IC_REC', 'US'),
        acct('1451', 'Due from UK', 'IC_REC'),
      ],
      FSLIS,
    );
    expect(r.map((x) => [x.line.accountCode, x.reasons])).toEqual([
      ['1455', ['NOT_IN_COA']],
      ['1200', ['NO_FSLI']],
      ['1451', ['NO_COUNTERPARTY']],
    ]);
  });
});

describe('suggestFsli', () => {
  const ctx = {
    entityCode: 'IN',
    otherAccounts: [
      acct('6390', 'Bank Charges', 'OTH_EXP', null, 'UK'),
      acct('1450', 'Due from India', 'IC_REC', 'IN', 'UK'),
    ],
    entities: [
      { code: 'IN', shortName: 'India', legalName: 'Aistra GenAI India Pvt Ltd' },
      { code: 'UK', shortName: 'UK', legalName: 'Aistra Labs UK Ltd' },
    ],
    typeDefaults: ACCOUNT_TYPE_DEFAULTS,
    intercompanyFslis: new Set(['IC_REC', 'IC_PAY', 'IC_REV', 'IC_EXP', 'INV_SUB']),
  };
  it.each([
    ['1455', 'Advance to Suppliers', 'Other Current Asset', 'CUR_OTH', 'From account name'],
    ['6120', 'Staff Welfare Expenses', 'Expense', 'EMP', 'From account name'],
    ['6390', 'Bank Charges', 'Expense', 'OTH_EXP', 'Similar to UK 6390'],
    ['6395', 'Bank charges on remittances', 'Expense', 'OTH_EXP', 'From account name'],
    ['6800', 'Interest on loan', 'Expense', 'FIN_COST', 'From account name'],
    ['4600', 'Interest received', 'Other Income', 'OTH_INC', 'From account name'],
    ['6410', 'Office rent', 'Expense', 'RENT', 'From account name'],
    ['6210', 'Audit fee', 'Expense', 'PROF', 'From account name'],
    ['6310', 'Cloud hosting', 'Expense', 'SOFTWARE', 'From account name'],
    ['6150', 'Office supplies', 'Expense', 'OTH_EXP', 'From account type'],
  ])('%s %s → %s (%s)', (code, name, type, fsli, source) => {
    expect(suggestFsli({ code, name, type }, ctx)).toMatchObject({ fsliCode: fsli, source });
  });
  it('suggests intercompany FSLIs with their counterparty, never copying another entity’s', () => {
    expect(
      suggestFsli(
        { code: '1460', name: 'Due from Aistra Labs UK Ltd', type: 'Other Current Asset' },
        ctx,
      ),
    ).toEqual({
      fsliCode: 'IC_REC',
      counterpartyCode: 'UK',
      source: 'From account name (intercompany)',
    });
    expect(suggestFsli({ code: '9999', name: 'Suspense', type: null }, ctx)).toBeNull();
  });
});

describe('validateMapping', () => {
  const ctx = {
    entityCode: 'IN',
    fslis: FSLIS,
    entities: [
      { code: 'US', isActive: true, parentCode: null },
      { code: 'IN', isActive: true, parentCode: 'US' },
      { code: 'UK', isActive: true, parentCode: 'IN' },
      { code: 'VS', isActive: true, parentCode: 'UC' },
      { code: 'OLD', isActive: false, parentCode: 'IN' },
    ],
  };
  const codes = (m: Parameters<typeof validateMapping>[0]) =>
    validateMapping(m, ctx).errors.map((e) => e.code);
  it('requires an FSLI and refuses computed / consolidation-only ones', () => {
    expect(codes({ accountType: null, fsliCode: null, counterpartyCode: null })).toEqual([
      'FSLI_REQUIRED',
    ]);
    expect(codes({ accountType: null, fsliCode: 'FCTR', counterpartyCode: null })).toEqual([
      'FSLI_NOT_MAPPABLE',
    ]);
    expect(codes({ accountType: null, fsliCode: 'GOODWILL', counterpartyCode: null })).toEqual([
      'FSLI_NOT_MAPPABLE',
    ]);
  });
  it('checks counterparties: required, not itself, active, direct subsidiary for investments', () => {
    expect(codes({ accountType: null, fsliCode: 'IC_REC', counterpartyCode: null })).toEqual([
      'COUNTERPARTY_REQUIRED',
    ]);
    expect(codes({ accountType: null, fsliCode: 'IC_REC', counterpartyCode: 'IN' })).toEqual([
      'COUNTERPARTY_SELF',
    ]);
    expect(codes({ accountType: null, fsliCode: 'IC_REC', counterpartyCode: 'OLD' })).toEqual([
      'COUNTERPARTY_INVALID',
    ]);
    expect(codes({ accountType: null, fsliCode: 'IC_REC', counterpartyCode: 'US' })).toEqual([]);
    expect(codes({ accountType: null, fsliCode: 'INV_SUB', counterpartyCode: 'US' })).toEqual([
      'NOT_DIRECT_SUBSIDIARY',
    ]);
    expect(codes({ accountType: null, fsliCode: 'INV_SUB', counterpartyCode: 'VS' })).toEqual([
      'NOT_DIRECT_SUBSIDIARY',
    ]);
    expect(codes({ accountType: null, fsliCode: 'INV_SUB', counterpartyCode: 'UK' })).toEqual([]);
  });
  it('warns when the account type conflicts with the FSLI class', () => {
    const w = validateMapping(
      { accountType: 'Expense', fsliCode: 'TRADE_PAY', counterpartyCode: null },
      ctx,
    ).warnings;
    expect(w[0]!.message).toBe(
      'Account type "Expense" is an expense type, but TRADE_PAY is a liability line (balance sheet).',
    );
    expect(
      validateMapping(
        { accountType: 'Other Current Asset', fsliCode: 'CUR_OTH', counterpartyCode: null },
        ctx,
      ).warnings,
    ).toEqual([]);
    expect(
      validateMapping(
        { accountType: 'Other Current Asset', fsliCode: 'TRADE_PAY', counterpartyCode: null },
        ctx,
      ).warnings,
    ).toHaveLength(1);
  });
});

describe('fsliTotals', () => {
  it('totals per FSLI, profit for the period, and the nil check', () => {
    const r = fsliTotals(
      [
        { amount: '1000.00', fsliCode: 'CASH' },
        { amount: '250.50', fsliCode: 'CASH' },
        { amount: '-500.00', fsliCode: 'SHARE_CAP' },
        { amount: '-2000.00', fsliCode: 'REV_OPS' },
        { amount: '1249.50', fsliCode: 'EMP' },
      ],
      FSLIS,
    );
    expect(r.rows.map((x) => [x.code, x.amount])).toEqual([
      ['CASH', '1250.50'],
      ['SHARE_CAP', '-500.00'],
      ['REV_OPS', '-2000.00'],
      ['EMP', '1249.50'],
    ]);
    expect(r).toMatchObject({
      plTotal: '-750.50',
      profit: '750.50',
      total: '0.00',
      nil: true,
      unmapped: '0.00',
    });
  });
  it('shows unmapped lines separately; the total still ties to the TB', () => {
    const r = fsliTotals(
      [
        { amount: '10', fsliCode: 'CASH' },
        { amount: '-10', fsliCode: null },
      ],
      FSLIS,
    );
    expect(r).toMatchObject({ unmapped: '-10.00', total: '0.00', nil: true });
  });
});

describe('intercompanySummary', () => {
  it('one row per counterparty with receivable, payable, revenue and charges', () => {
    expect(
      intercompanySummary([
        { amount: '30849500.00', fsliCode: 'IC_REC', counterpartyCode: 'US' },
        { amount: '-15588000.00', fsliCode: 'IC_REV', counterpartyCode: 'US' },
        { amount: '100', fsliCode: 'IC_REC', counterpartyCode: 'UK' },
        { amount: '50', fsliCode: 'IC_REC', counterpartyCode: 'UK' },
        { amount: '999', fsliCode: 'CASH', counterpartyCode: null },
      ]),
    ).toEqual([
      {
        counterpartyCode: 'US',
        receivable: '30849500.00',
        payable: '0.00',
        revenue: '-15588000.00',
        charges: '0.00',
      },
      {
        counterpartyCode: 'UK',
        receivable: '150.00',
        payable: '0.00',
        revenue: '0.00',
        charges: '0.00',
      },
    ]);
  });
});

describe('crossRate', () => {
  const r = (
    month: string,
    currency: string,
    opening: string,
    closing: string,
    average: string,
  ): MonthlyRate => ({
    month,
    currency,
    opening,
    closing,
    average,
  });
  const rates = [
    r('2026-07-01', 'INR', '85.60', '86.40', '86.00'),
    r('2026-08-01', 'INR', '86.40', '86.90', '86.60'),
    r('2026-09-01', 'INR', '86.90', '87.20', '87.10'),
    r('2026-08-01', 'GBP', '0.7815', '0.7842', '0.7829'),
  ];
  const aug = { startDate: '2026-08-01', endDate: '2026-08-31' };
  it('INR → USD for Aug-2026 matches the expected rates', () => {
    expect(crossRate(rates, aug, 'INR', 'USD', 'opening')).toEqual({
      value: '0.0115740741',
      formula: '1 ÷ 86.40',
      missing: [],
    });
    expect(crossRate(rates, aug, 'INR', 'USD', 'closing')).toMatchObject({
      value: '0.0115074799',
      formula: '1 ÷ 86.90',
    });
    expect(crossRate(rates, aug, 'INR', 'USD', 'average').value).toBe('0.0115473441');
  });
  it('derives cross rates between two non-USD currencies', () => {
    // 1 GBP = 86.90 / 0.7842 INR
    expect(crossRate(rates, aug, 'GBP', 'INR', 'closing')).toMatchObject({
      value: '110.8135679674',
      formula: '86.90 ÷ 0.7842',
    });
    expect(crossRate(rates, aug, 'USD', 'INR', 'closing').value).toBe('86.9000000000');
  });
  it('quarter: first opening, last closing, simple mean of monthly averages', () => {
    const q2 = { startDate: '2026-07-01', endDate: '2026-09-30' };
    expect(periodUsdRate(rates, q2, 'INR', 'opening').value!.toFixed()).toBe('85.6');
    expect(periodUsdRate(rates, q2, 'INR', 'closing').value!.toFixed()).toBe('87.2');
    expect(periodUsdRate(rates, q2, 'INR', 'average').value!.toFixed(10)).toBe('86.5666666667');
  });
  it('reports missing rates', () => {
    expect(crossRate(rates, aug, 'GBP', 'SGD', 'closing')).toEqual({
      value: null,
      formula: null,
      missing: ['SGD Aug-2026 closing'],
    });
  });
});
