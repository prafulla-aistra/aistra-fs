import { parseAmountText } from './amounts';
import { type IsoDate, parseIsoDate, toIsoDate } from './dates';
import { Decimal, roundAmount } from './money';
import { organisationKey, sameOrganisation, type TbColumnSettings } from './tb-parser';

/**
 * Zoho Books trial balance (GET /books/v3/reports/trialbalance) → GL-wise lines
 * "Account Code | Account Name | Amount (Dr−Cr)", debit positive / credit negative.
 *
 * Zoho does not formally document the report's JSON, so the reader is tolerant: an account row
 * is any object with an account id (or code) and a name that has amount fields and contains no
 * account rows itself (group and total rows do). The amount columns are chosen once for the
 * whole report, closing / net balances first, and named in the result so the user sees what was
 * used. Whatever goes wrong becomes a problem; the TB checks (balance to the cent) still run on
 * the result like on any uploaded file.
 */

export interface ZohoChartAccount {
  accountId: string;
  code: string | null;
  name: string;
  type: string | null;
}

export interface ZohoTbLine {
  code: string;
  name: string;
  type: string | null;
  /** Exact decimal, 2 dp, debit positive. */
  amount: string;
  accountId: string | null;
}

export interface ZohoTbResult {
  lines: ZohoTbLine[];
  /** e.g. "net_debit − net_credit", or null when no account rows were found. */
  amountFields: string | null;
  /** Dates the report says it covers, when it says so. */
  period: { from: IsoDate; to: IsoDate } | null;
  /** Blocking: the report could not be read. */
  problems: string[];
  /** Not blocking: e.g. accounts without an account code. */
  warnings: string[];
}

type Json = Record<string, unknown>;
type AmountRule =
  { kind: 'PAIR'; debit: string; credit: string } | { kind: 'SIGNED'; field: string };

/** In order of preference: closing / net balances before movements. */
const RULES: AmountRule[] = [
  { kind: 'PAIR', debit: 'net_debit', credit: 'net_credit' },
  { kind: 'PAIR', debit: 'net_debit_total', credit: 'net_credit_total' },
  { kind: 'PAIR', debit: 'closing_debit', credit: 'closing_credit' },
  { kind: 'PAIR', debit: 'closing_balance_debit', credit: 'closing_balance_credit' },
  { kind: 'PAIR', debit: 'debit_closing_balance', credit: 'credit_closing_balance' },
  { kind: 'SIGNED', field: 'closing_balance' },
  { kind: 'SIGNED', field: 'net_balance' },
  { kind: 'SIGNED', field: 'balance' },
  { kind: 'PAIR', debit: 'debit_total', credit: 'credit_total' },
  { kind: 'PAIR', debit: 'debit', credit: 'credit' },
];

const ruleLabel = (r: AmountRule) =>
  r.kind === 'PAIR' ? `${r.debit} − ${r.credit}` : `${r.field} (debit positive)`;
const has = (o: Json, k: string) => k in o && o[k] !== undefined;
const ruleFits = (o: Json, r: AmountRule) =>
  r.kind === 'PAIR' ? has(o, r.debit) && has(o, r.credit) : has(o, r.field);

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
const accountIdOf = (o: Json) => str(o.account_id);
const nameOf = (o: Json) => str(o.account_name) || str(o.name);
const looksLikeAccount = (o: Json): boolean =>
  !!(accountIdOf(o) || str(o.account_code)) && !!nameOf(o);

/** A JSON amount → exact Decimal. Numbers with more than 15 significant digits are refused. */
function amountOf(v: unknown): Decimal | string {
  if (v === null || v === undefined || v === '') return new Decimal(0);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return `"${String(v)}" is not a number`;
    const d = new Decimal(String(v));
    if (d.sd() > 15) return `${String(v)} has more digits than JSON can carry exactly`;
    return d;
  }
  if (typeof v === 'string') {
    const p = parseAmountText(v);
    if (!p.ok) return p.reason;
    return p.suffix === 'CR' ? p.value.abs().negated() : p.value;
  }
  return `"${JSON.stringify(v)}" is not a number`;
}

function subtreeHasAccount(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(subtreeHasAccount);
  if (!isObject(v)) return false;
  return looksLikeAccount(v) || Object.values(v).some(subtreeHasAccount);
}

/** Group and total rows hold account rows; account rows do not. */
const containsAccount = (o: Json) => Object.values(o).some(subtreeHasAccount);

/** Account rows: objects that look like an account and hold no account rows themselves. */
function accountRows(v: unknown, out: Json[] = []): Json[] {
  if (Array.isArray(v)) {
    for (const x of v) accountRows(x, out);
  } else if (isObject(v)) {
    if (looksLikeAccount(v) && !containsAccount(v)) out.push(v);
    else for (const c of Object.values(v)) if (Array.isArray(c) || isObject(c)) accountRows(c, out);
  }
  return out;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function reportPeriod(body: Json): ZohoTbResult['period'] {
  for (const o of [body, body.page_context, body.trial_balance_context].filter(isObject)) {
    const from = str(o.from_date);
    const to = str(o.to_date);
    if (ISO.test(from) && ISO.test(to)) return { from, to };
  }
  return null;
}

export function parseZohoTrialBalance(
  body: unknown,
  chart: readonly ZohoChartAccount[],
): ZohoTbResult {
  const empty = (problem: string): ZohoTbResult => ({
    lines: [],
    amountFields: null,
    period: null,
    problems: [problem],
    warnings: [],
  });
  if (!isObject(body)) return empty('Zoho returned no trial balance.');
  const code = body.code;
  if (typeof code === 'number' && code !== 0)
    return empty(`Zoho refused the request: ${str(body.message) || `code ${code}`}.`);

  const rows = accountRows(body);
  const period = reportPeriod(body);
  if (rows.length === 0)
    return {
      ...empty('The Zoho trial balance has no account rows (or an unexpected layout).'),
      period,
    };

  // One rule for the whole report: the first that every row has, else the first most rows have.
  const counts = RULES.map((r) => rows.filter((o) => ruleFits(o, r)).length);
  const allIdx = counts.findIndex((n) => n === rows.length);
  const best = Math.max(...counts);
  const idx = allIdx >= 0 ? allIdx : best > 0 ? counts.indexOf(best) : -1;
  if (idx < 0)
    return {
      ...empty('The Zoho trial balance rows have no debit / credit or balance amounts.'),
      period,
    };
  const rule = RULES[idx]!;

  const byId = new Map(chart.map((a) => [a.accountId, a]));
  const problems: string[] = [];
  const noCode: string[] = [];
  const lines: ZohoTbLine[] = [];
  for (const o of rows) {
    const accountId = accountIdOf(o) || null;
    const coa = accountId ? byId.get(accountId) : undefined;
    const name = nameOf(o);
    let accountCode = str(o.account_code) || coa?.code?.trim() || '';
    if (!accountCode) {
      if (!accountId) continue; // looksLikeAccount guarantees one of the two
      accountCode = `ZOHO-${accountId}`;
      noCode.push(name);
    }
    if (!ruleFits(o, rule)) {
      problems.push(`${accountCode} ${name}: no ${ruleLabel(rule)} amount in the Zoho report.`);
      continue;
    }
    let amount: Decimal;
    if (rule.kind === 'PAIR') {
      const dr = amountOf(o[rule.debit]);
      const cr = amountOf(o[rule.credit]);
      if (typeof dr === 'string' || typeof cr === 'string') {
        problems.push(`${accountCode} ${name}: ${typeof dr === 'string' ? dr : cr}.`);
        continue;
      }
      amount = dr.abs().minus(cr.abs());
    } else {
      const v = amountOf(o[rule.field]);
      if (typeof v === 'string') {
        problems.push(`${accountCode} ${name}: ${v}.`);
        continue;
      }
      const side = str(o.debit_or_credit ?? o.balance_type).toLowerCase();
      amount = side === 'credit' || side === 'cr' ? v.abs().negated() : side ? v.abs() : v;
    }
    lines.push({
      code: accountCode,
      name,
      type: str(o.account_type) || coa?.type || null,
      amount: roundAmount(amount).toFixed(2),
      accountId,
    });
  }

  const warnings: string[] = [];
  if (noCode.length)
    warnings.push(
      `${noCode.length} Zoho account${noCode.length === 1 ? ' has' : 's have'} no account code; the Zoho account id is used as the code (ZOHO-…): ${noCode.join(', ')}. Add account codes in Zoho to keep mappings readable.`,
    );
  return { lines, amountFields: ruleLabel(rule), period, problems, warnings };
}

/** Column layout of the CSV built by zohoTbCsv. */
export const ZOHO_TB_HEADER_ROW = 5;
export const ZOHO_TB_SETTINGS: TbColumnSettings = {
  headerRow: ZOHO_TB_HEADER_ROW,
  codeColumn: 0,
  nameColumn: 1,
  typeColumn: 2,
  balanceColumn: 3,
  debitColumn: null,
  creditColumn: null,
  signConvention: 'DEBIT_POSITIVE',
};

const csvCell = (s: string) => (/[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const dmy = (d: IsoDate) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/**
 * Dates to ask Zoho for. P&L basis PERIOD: the task period. YTD: from 1 April of the Indian
 * financial year to the period end (the upload step then converts the P&L to the period).
 */
export function zohoFetchRange(
  period: { startDate: IsoDate; endDate: IsoDate },
  plBasis: 'PERIOD' | 'YTD',
): { from: IsoDate; to: IsoDate } {
  if (plBasis === 'PERIOD') return { from: period.startDate, to: period.endDate };
  const { year, month } = parseIsoDate(period.startDate);
  return { from: toIsoDate(month >= 4 ? year : year - 1, 4, 1), to: period.endDate };
}

/**
 * The fetched TB as a CSV in the shape of a Zoho export, so it goes through the same checks
 * as an uploaded file (organisation and period lines above the header are checked too). A
 * year-to-date TB is labelled "As of <end>" (its period check is against the period end).
 */
export function zohoTbCsv(input: {
  organisation: string;
  from: IsoDate;
  to: IsoDate;
  ytd: boolean;
  amountFields: string;
  lines: readonly ZohoTbLine[];
}): string {
  const rows = [
    [input.organisation],
    ['Trial Balance'],
    [
      input.ytd
        ? `As of ${dmy(input.to)} (year to date since ${dmy(input.from)})`
        : `From ${dmy(input.from)} To ${dmy(input.to)}`,
    ],
    [`Source: Zoho Books trial balance report API (amount = ${input.amountFields})`],
    [],
    ['Account Code', 'Account Name', 'Account Type', 'Amount (Dr-Cr)'],
    ...input.lines.map((l) => [l.code, l.name, l.type ?? '', l.amount]),
  ];
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/**
 * Suggested Zoho organisation per entity, by name (legal name vs organisation name, ignoring
 * Pvt / Ltd / Inc …). Only unambiguous one-to-one matches are suggested.
 */
export function suggestOrganisationLinks(
  entities: readonly { code: string; legalName: string }[],
  organisations: readonly { organizationId: string; name: string }[],
): Map<string, string> {
  // Same name (ignoring Pvt / Ltd …) first; a looser "one name contains the other" otherwise.
  const matchesOf = (e: { legalName: string }) => {
    const exact = organisations.filter(
      (o) => organisationKey(o.name) === organisationKey(e.legalName),
    );
    return exact.length
      ? exact
      : organisations.filter((o) => sameOrganisation(o.name, e.legalName));
  };
  const out = new Map<string, string>();
  for (const e of entities) {
    const m = matchesOf(e);
    if (m.length !== 1) continue;
    const org = m[0]!;
    // The organisation must not match another entity as well.
    if (entities.every((x) => x === e || !matchesOf(x).includes(org)))
      out.set(e.code, org.organizationId);
  }
  return out;
}
