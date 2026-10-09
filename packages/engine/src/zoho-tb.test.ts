import { describe, expect, it } from 'vitest';
import { checkTrialBalance } from './tb-checks';
import { detectTbLayout } from './tb-parser';
import {
  parseZohoTrialBalance,
  suggestOrganisationLinks,
  ZOHO_TB_SETTINGS,
  zohoFetchRange,
  zohoTbCsv,
} from './zoho-tb';

/** Grouped like the Zoho report: type groups → account rows, with group totals. */
const REPORT = {
  code: 0,
  message: 'success',
  page_context: { from_date: '2026-08-01', to_date: '2026-08-31' },
  trial_balance: [
    {
      name: 'Assets',
      net_debit: 1500.5,
      net_credit: 0,
      account_transactions: [
        {
          account_id: '101',
          account_name: 'Bank, HDFC',
          account_code: '1001',
          account_type: 'bank',
          net_debit: 1000.25,
          net_credit: 0,
        },
        // No code in the report: taken from the chart of accounts.
        { account_id: '102', account_name: 'Receivables', net_debit: '500.25', net_credit: '' },
      ],
    },
    {
      name: 'Liabilities and equity',
      account_transactions: [
        {
          account_id: '201',
          account_name: 'Share capital',
          account_code: '3001',
          net_debit: 0,
          net_credit: 1000,
        },
        // Neither in the report nor in the chart: the Zoho id becomes the code.
        { account_id: '202', account_name: 'Suspense', net_debit: 0, net_credit: '1,234.00' },
      ],
    },
    {
      name: 'Income and expense',
      account_transactions: [
        {
          account_id: '401',
          account_name: 'Revenue',
          account_code: '4001',
          net_debit: 0,
          net_credit: 2000.005,
        },
        {
          account_id: '501',
          account_name: 'Salaries',
          account_code: '5001',
          net_debit: 2733.505,
          net_credit: 0,
        },
      ],
    },
  ],
};
const CHART = [
  { accountId: '102', code: '1101', name: 'Receivables', type: 'accounts_receivable' },
  { accountId: '202', code: null, name: 'Suspense', type: 'other_current_liability' },
];

describe('parseZohoTrialBalance', () => {
  const r = parseZohoTrialBalance(REPORT, CHART);

  it('reads account rows only, Dr − Cr, rounded half away from zero', () => {
    expect(r.problems).toEqual([]);
    expect(r.amountFields).toBe('net_debit − net_credit');
    expect(r.period).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(r.lines.map((l) => [l.code, l.name, l.type, l.amount])).toEqual([
      ['1001', 'Bank, HDFC', 'bank', '1000.25'],
      ['1101', 'Receivables', 'accounts_receivable', '500.25'],
      ['3001', 'Share capital', null, '-1000.00'],
      ['ZOHO-202', 'Suspense', 'other_current_liability', '-1234.00'],
      ['4001', 'Revenue', null, '-2000.01'],
      ['5001', 'Salaries', null, '2733.51'],
    ]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('Suspense');
  });

  it('prefers net / closing balances over movement totals', () => {
    const x = parseZohoTrialBalance(
      {
        accounts: [
          {
            account_id: '1',
            account_name: 'A',
            debit_total: 5,
            credit_total: 1,
            net_debit: 4,
            net_credit: 0,
          },
        ],
      },
      [],
    );
    expect(x.amountFields).toBe('net_debit − net_credit');
    expect(x.lines[0]!.amount).toBe('4.00');
  });

  it('signed balance with a debit / credit indicator', () => {
    const x = parseZohoTrialBalance(
      {
        rows: [
          {
            account_id: '1',
            account_name: 'A',
            closing_balance: '250.00',
            debit_or_credit: 'credit',
          },
          { account_id: '2', account_name: 'B', closing_balance: 250, debit_or_credit: 'debit' },
        ],
      },
      [],
    );
    expect(x.lines.map((l) => l.amount)).toEqual(['-250.00', '250.00']);
  });

  it('turns Zoho errors and unreadable reports into problems', () => {
    expect(parseZohoTrialBalance({ code: 57, message: 'Not authorized' }, []).problems).toEqual([
      'Zoho refused the request: Not authorized.',
    ]);
    expect(parseZohoTrialBalance({ code: 0, trial_balance: [] }, []).problems[0]).toMatch(
      /no account rows/,
    );
    expect(
      parseZohoTrialBalance(
        { x: [{ account_id: '1', account_name: 'A', net_debit: 'abc', net_credit: 0 }] },
        [],
      ).problems[0],
    ).toMatch(/"abc" is not a number/);
  });
});

/** Minimal CSV reader for the test (quoted cells may hold commas). */
const readCsv = (text: string) =>
  text
    .trimEnd()
    .split('\r\n')
    .map((line) =>
      line === ''
        ? []
        : [...line.matchAll(/("([^"]|"")*"|[^,]*)(,|$)/g)]
            .filter((m) => m.index! < line.length || m[1] !== '')
            .map((m) => (m[1]!.startsWith('"') ? m[1]!.slice(1, -1).replace(/""/g, '"') : m[1]!)),
    );

describe('zohoTbCsv', () => {
  const r = parseZohoTrialBalance(REPORT, CHART);
  const csv = zohoTbCsv({
    organisation: 'Aistra GenAI India Pvt Ltd',
    from: '2026-08-01',
    to: '2026-08-31',
    ytd: false,
    amountFields: r.amountFields!,
    lines: r.lines,
  });
  const rows = readCsv(csv);

  it('is a Zoho-style export the TB checks read: organisation, period, columns', () => {
    expect(rows[5]).toEqual(['Account Code', 'Account Name', 'Account Type', 'Amount (Dr-Cr)']);
    expect(rows[6]).toEqual(['1001', 'Bank, HDFC', 'bank', '1000.25']);
    const layout = detectTbLayout(rows);
    expect(layout.headerRow).toBe(ZOHO_TB_SETTINGS.headerRow);
    expect(layout.period).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(layout.organisation).toBe('Aistra GenAI India Pvt Ltd');
    const check = checkTrialBalance({
      rows,
      settings: ZOHO_TB_SETTINGS,
      layout,
      period: { startDate: '2026-08-01', endDate: '2026-08-31', label: 'Aug-2026' },
      legalName: 'Aistra GenAI India Private Limited',
      knownAccounts: new Set(['1001', '1101', '3001', '4001', '5001']),
      sameFileElsewhere: [],
    });
    expect(check.errors).toEqual([]);
    expect(check.needsAcknowledgement).toEqual([]);
    expect(check.balanced).toBe(true);
    expect(check.totals).toEqual({ debits: '4234.01', credits: '4234.01', difference: '0.00' });
    expect(check.lines.find((l) => l.accountCode === 'ZOHO-202')!.amount).toBe('-1234');
  });
});

describe('suggestOrganisationLinks', () => {
  it('matches by legal name, only one-to-one', () => {
    const s = suggestOrganisationLinks(
      [
        { code: 'US', legalName: 'Aistra Labs Inc' },
        { code: 'IN', legalName: 'Aistra GenAI India Pvt Ltd' },
        { code: 'UK', legalName: 'Aistra Labs UK Ltd' },
        { code: 'UC', legalName: 'Unconstrained INC' },
      ],
      [
        { organizationId: '1', name: 'Aistra Labs Inc.' },
        { organizationId: '2', name: 'Aistra GenAI India Private Limited' },
        { organizationId: '3', name: 'Aistra Labs UK Limited' },
        { organizationId: '4', name: 'Something else' },
      ],
    );
    expect(Object.fromEntries(s)).toEqual({ US: '1', IN: '2', UK: '3' });
  });
});

describe('zohoFetchRange', () => {
  const aug = { startDate: '2026-08-01', endDate: '2026-08-31' };
  it('period basis: the task period; YTD: from 1 April of the financial year', () => {
    expect(zohoFetchRange(aug, 'PERIOD')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(zohoFetchRange(aug, 'YTD')).toEqual({ from: '2026-04-01', to: '2026-08-31' });
    expect(zohoFetchRange({ startDate: '2027-02-01', endDate: '2027-02-28' }, 'YTD')).toEqual({
      from: '2026-04-01',
      to: '2027-02-28',
    });
  });

  it('a YTD CSV is labelled "as of" the period end, so the period check passes', () => {
    const csv = zohoTbCsv({
      organisation: 'X',
      from: '2026-04-01',
      to: '2026-08-31',
      ytd: true,
      amountFields: 'net_debit − net_credit',
      lines: [],
    });
    expect(detectTbLayout(readCsv(csv)).period).toEqual({ asOf: '2026-08-31' });
  });
});
