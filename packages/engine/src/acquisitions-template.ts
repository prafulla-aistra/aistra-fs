import { Decimal } from './money';
import { cellText, type Cell } from './tb-parser';

/**
 * Acquisitions register template (decision round 1, Q3): one row per acquisition (step). The
 * fixed columns come first, then one "Rate <CCY>" column per currency (acquisition-date rate:
 * 1 unit of the subsidiary's currency = rate units of CCY). Blank rate cells mean "no rate".
 */
export const ACQUISITION_COLUMNS = [
  'Subsidiary',
  'Parent',
  'Acquired on',
  '% acquired',
  'Cost',
  'Share capital',
  'Securities premium',
  'Pre-acquisition reserves',
  'NCI measurement',
  'NCI fair value',
  'To be confirmed',
  'Rates to be confirmed',
  'Note',
] as const;

export interface AcquisitionTemplateRow {
  /** Spreadsheet row number (1-based). */
  row: number;
  subsidiaryCode: string;
  parentCode: string;
  acquiredOn: string;
  pctAcquired: string;
  cost: string;
  shareCapital: string;
  premium: string;
  preAcquisitionReserves: string;
  nciMeasurement: 'PROPORTIONATE' | 'FAIR_VALUE' | null;
  nciFairValue: string | null;
  toBeConfirmed: boolean;
  ratesToBeConfirmed: boolean;
  note: string | null;
  rates: { currency: string; rate: string }[];
  problems: string[];
}

const norm = (c: Cell) =>
  cellText(c)
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();

/** Excel serial day number (1900 system) → ISO date. */
function serialToIso(n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > 2958465) return null;
  const ms = Date.UTC(1899, 11, 30) + n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function dateOf(c: Cell): string | null {
  if (typeof c === 'number') return serialToIso(c);
  const t = cellText(c);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : [];
  if (!y) return null;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return null;
  return date.toISOString().slice(0, 10);
}

/** A number cell or text ("1,234.50", "(500)") as a decimal string; null when blank or invalid. */
function numberOf(c: Cell): string | null | 'INVALID' {
  if (c === null || c === undefined || cellText(c) === '') return null;
  let t = typeof c === 'number' ? String(c) : cellText(c).replace(/,/g, '');
  const neg = /^\(.*\)$/.test(t);
  if (neg) t = t.slice(1, -1);
  if (!/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(t)) return 'INVALID';
  const d = new Decimal(t);
  return (neg ? d.negated() : d).toString();
}

function yes(c: Cell, fallback: boolean): boolean | 'INVALID' {
  const t = norm(c);
  if (t === '') return fallback;
  if (['y', 'yes', 'true', '1'].includes(t)) return true;
  if (['n', 'no', 'false', '0'].includes(t)) return false;
  return 'INVALID';
}

/**
 * Reads a filled acquisitions template. Checks each row's own values (types, ranges, required
 * cells); checks against the register and the group (entities exist, parent, currencies) are the
 * API's, which knows them.
 */
export function parseAcquisitionTemplate(rows: readonly (readonly Cell[])[]): {
  rows: AcquisitionTemplateRow[];
  problems: string[];
} {
  let header = -1;
  for (let r = 0; r < Math.min(rows.length, 20); r++)
    if ((rows[r] ?? []).some((c) => norm(c) === 'subsidiary')) {
      header = r;
      break;
    }
  if (header < 0)
    return {
      rows: [],
      problems: ['No header row found: download the template and keep its column headings.'],
    };
  const h = (rows[header] ?? []).map(norm);
  const col = new Map<string, number>();
  for (const name of ACQUISITION_COLUMNS) col.set(name, h.indexOf(norm(name)));
  const missing = ACQUISITION_COLUMNS.filter(
    (n) =>
      col.get(n)! < 0 &&
      !['Note', 'Rates to be confirmed', 'NCI measurement', 'NCI fair value'].includes(n),
  );
  if (missing.length) return { rows: [], problems: [`Columns missing: ${missing.join(', ')}.`] };
  const rateCols = h
    .map((x, i) => ({ m: /^rate ([a-z]{3})$/.exec(x), i }))
    .filter((x) => x.m)
    .map((x) => ({ currency: x.m![1]!.toUpperCase(), i: x.i }));

  const out: AcquisitionTemplateRow[] = [];
  for (let r = header + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => cellText(c) === '')) continue;
    const get = (n: (typeof ACQUISITION_COLUMNS)[number]): Cell => {
      const i = col.get(n)!;
      return i < 0 ? null : row[i];
    };
    const problems: string[] = [];
    const amount = (n: (typeof ACQUISITION_COLUMNS)[number], required: boolean, min0: boolean) => {
      const v = numberOf(get(n));
      if (v === 'INVALID') {
        problems.push(`${n}: not a number.`);
        return '0';
      }
      if (v === null) {
        if (required) problems.push(`${n}: required.`);
        return '0';
      }
      if (min0 && new Decimal(v).isNegative()) problems.push(`${n}: 0 or more.`);
      return new Decimal(v).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString();
    };
    const sub = cellText(get('Subsidiary')).toUpperCase();
    const parent = cellText(get('Parent')).toUpperCase();
    if (!/^[A-Z0-9]{1,10}$/.test(sub)) problems.push('Subsidiary: an entity code.');
    if (!/^[A-Z0-9]{1,10}$/.test(parent)) problems.push('Parent: an entity code.');
    if (sub && sub === parent) problems.push('The subsidiary and the parent must differ.');
    const acquiredOn = dateOf(get('Acquired on'));
    if (!acquiredOn) problems.push('Acquired on: a date (YYYY-MM-DD).');
    let pct = numberOf(get('% acquired'));
    if (pct === 'INVALID' || pct === null) {
      problems.push('% acquired: a number.');
      pct = '0';
    } else {
      // A percentage-formatted cell holds 0.5849 for 58.49%.
      if (typeof get('% acquired') === 'number' && new Decimal(pct).lte(1))
        pct = new Decimal(pct).times(100).toString();
      if (!(new Decimal(pct).greaterThan(0) && new Decimal(pct).lte(100)))
        problems.push('% acquired: more than 0 and at most 100.');
      pct = new Decimal(pct).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString();
    }
    const cost = amount('Cost', true, true);
    const shareCapital = amount('Share capital', true, false);
    const premium = amount('Securities premium', false, false);
    const pre = amount('Pre-acquisition reserves', false, false);
    const m = norm(get('NCI measurement')).replace(/ /g, '_');
    let nciMeasurement: AcquisitionTemplateRow['nciMeasurement'] = null;
    if (['proportionate', 'proportionate_share'].includes(m)) nciMeasurement = 'PROPORTIONATE';
    else if (['fair_value', 'fv', 'full_goodwill'].includes(m)) nciMeasurement = 'FAIR_VALUE';
    else if (m && m !== 'default')
      problems.push('NCI measurement: Proportionate, Fair value or blank (default by GAAP).');
    const fvRaw = numberOf(get('NCI fair value'));
    let nciFairValue: string | null = null;
    if (fvRaw === 'INVALID') problems.push('NCI fair value: not a number.');
    else if (fvRaw !== null) {
      if (new Decimal(fvRaw).isNegative()) problems.push('NCI fair value: 0 or more.');
      nciFairValue = new Decimal(fvRaw).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString();
    }
    if (nciMeasurement === 'FAIR_VALUE' && nciFairValue === null && new Decimal(pct).lessThan(100))
      problems.push('NCI fair value: required when NCI is measured at fair value.');
    const tbc = yes(get('To be confirmed'), true);
    const rtbc = yes(get('Rates to be confirmed'), true);
    if (tbc === 'INVALID') problems.push('To be confirmed: Y or N.');
    if (rtbc === 'INVALID') problems.push('Rates to be confirmed: Y or N.');
    const rates: { currency: string; rate: string }[] = [];
    for (const rc of rateCols) {
      const v = numberOf(row[rc.i]);
      if (v === null) continue;
      if (v === 'INVALID' || !new Decimal(v).greaterThan(0)) {
        problems.push(`Rate ${rc.currency}: a number more than 0.`);
        continue;
      }
      rates.push({
        currency: rc.currency,
        rate: new Decimal(v).toDecimalPlaces(10, Decimal.ROUND_HALF_UP).toString(),
      });
    }
    const note = cellText(get('Note'));
    if (note.length > 500) problems.push('Note: at most 500 characters.');
    out.push({
      row: r + 1,
      subsidiaryCode: sub,
      parentCode: parent,
      acquiredOn: acquiredOn ?? '',
      pctAcquired: pct,
      cost,
      shareCapital,
      premium,
      preAcquisitionReserves: pre,
      nciMeasurement,
      nciFairValue,
      toBeConfirmed: tbc === true,
      ratesToBeConfirmed: rtbc === true,
      note: note || null,
      rates,
      problems,
    });
  }
  const keys = new Map<string, number>();
  for (const x of out) {
    const k = `${x.subsidiaryCode}|${x.parentCode}|${x.acquiredOn}`;
    const first = keys.get(k);
    if (first !== undefined) x.problems.push(`Same subsidiary, parent and date as row ${first}.`);
    else keys.set(k, x.row);
  }
  return { rows: out, problems: out.length ? [] : ['The file has no acquisition rows.'] };
}
