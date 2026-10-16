import * as XLSX from 'xlsx';
import type { Cell } from '@finance-close/engine';

/**
 * Reads the first sheet of an .xlsx / .xls / .csv file into rows of cells, starting at A1 so
 * that row index + 1 is the spreadsheet row number shown to the user.
 *
 * Numbers are returned as the stored numeric cell value (the engine turns them into exact
 * decimals through text, rounding to 2 dp). CSV files are read as text only, so amounts in
 * them are never converted through floating point at all.
 */
export function readSheetRows(buffer: Buffer, fileName: string): Cell[][] {
  const csv = fileName.toLowerCase().endsWith('.csv');
  const wb = XLSX.read(buffer, {
    type: 'buffer',
    raw: csv,
    cellDates: false,
    cellFormula: false,
    cellHTML: false,
  });
  const name = wb.SheetNames[0];
  const ws = name ? wb.Sheets[name] : undefined;
  if (!ws?.['!ref']) return [];
  const end = XLSX.utils.decode_range(ws['!ref']).e;
  return XLSX.utils.sheet_to_json<Cell[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
    range: { s: { r: 0, c: 0 }, e: end },
  });
}

/** "D" for 3. */
export function columnLetter(index: number): string {
  return XLSX.utils.encode_col(index);
}

/** Every sheet of a workbook as rows of cells (same reading rules as readSheetRows). */
export function readWorkbookSheets(
  buffer: Buffer,
  fileName: string,
): { name: string; rows: Cell[][] }[] {
  const csv = fileName.toLowerCase().endsWith('.csv');
  const wb = XLSX.read(buffer, {
    type: 'buffer',
    raw: csv,
    cellDates: false,
    cellFormula: false,
    cellHTML: false,
  });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    if (!ws?.['!ref']) return { name, rows: [] };
    const end = XLSX.utils.decode_range(ws['!ref']).e;
    const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
      range: { s: { r: 0, c: 0 }, e: end },
    });
    return { name, rows };
  });
}
