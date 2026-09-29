/**
 * Builds the sample spreadsheets (Zoho layouts) from sample-data.ts, as file bytes. Used by
 * `npm run samples:generate` (writes ./samples) and by the demo seed (uploads them).
 * Amounts are written as numbers, the way an ERP export stores them.
 */
import * as XLSX from 'xlsx';
import { SAMPLE_ENTITIES, SAMPLE_RATES, type SampleEntity } from './sample-data';

export type SampleMonth = 'jul' | 'aug';
export const SAMPLE_MONTHS: Record<SampleMonth, { label: string; from: string; to: string }> = {
  jul: { label: 'Jul-26', from: '01/07/2026', to: '31/07/2026' },
  aug: { label: 'Aug-26', from: '01/08/2026', to: '31/08/2026' },
};

function workbook(rows: (string | number | null)[][], widths: number[]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = widths.map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  // Fixed properties, so regenerating gives byte-identical files.
  wb.Props = { Title: 'Finance Close sample', CreatedDate: new Date('2026-09-01T00:00:00Z') };
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;
}

export const tbFileName = (code: string, month: SampleMonth) =>
  `Trial_Balance_${code}_${SAMPLE_MONTHS[month].label}.xlsx`;

export function trialBalanceFile(e: SampleEntity, month: SampleMonth): Buffer {
  const m = SAMPLE_MONTHS[month];
  const lines = e.accounts.filter((a) => a[month] !== '');
  return workbook(
    [
      [e.legalName],
      ['Trial Balance'],
      [`From ${m.from} To ${m.to}`],
      [`Currency: ${e.currency}`],
      [],
      ['Account Code', 'Account Name', 'Account Type', 'Closing Balance'],
      ...lines.map((a) => [a.code, a.name, a.type, Number(a[month])]),
      [null, 'Total', null, 0],
    ],
    [14, 52, 26, 18],
  );
}

/** IN chart of accounts: every IN account (including the two new Aug ones) plus two unused. */
export function chartOfAccountsInFile(): Buffer {
  const inEntity = SAMPLE_ENTITIES.find((e) => e.code === 'IN')!;
  return workbook(
    [
      ['Account Name', 'Account Code', 'Account Type', 'Parent Account'],
      ...inEntity.accounts.map((a) => [a.name, a.code, a.type, '']),
      ['Office Supplies', '6150', 'Expense', ''],
      ['Fixed Deposit - HDFC', '1060', 'Bank', 'HDFC Bank Current Account'],
    ],
    [52, 14, 26, 30],
  );
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Month as text ("Aug-26"), as the rate file format asks. */
export function exchangeRatesFile(): Buffer {
  const label = (iso: string) => `${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)}`;
  return workbook(
    [
      ['Month', 'Currency', 'Opening', 'Closing', 'Average'],
      ...SAMPLE_RATES.map((r) => [
        label(r.month),
        r.currency,
        Number(r.opening),
        Number(r.closing),
        Number(r.average),
      ]),
    ],
    [10, 10, 12, 12, 12],
  );
}
