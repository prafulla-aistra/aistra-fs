import type { FormatFsli } from './formats';
import { Decimal } from './money';
import { fsliAmounts } from './statements';

/**
 * Consolidation (CFS page 9): eliminations for one consolidation level, in the level currency.
 * Pure functions over the members' translated FSLI lines (debit +, credit −):
 *
 *   1. intercompany balances (IC_REC / IC_PAY) per marked pair, difference to FCTR (rounding,
 *      below the pair tolerance) or IC_DIFF (unreconciled, flagged);
 *   2. intercompany revenue / charges (IC_REV / IC_EXP), the same way;
 *   3. investment in subsidiary vs share capital, premium and pre-acquisition reserves, with
 *      goodwill (or a capital reserve when negative) and a translation balancing line;
 *   4. non-controlling interests for partly owned members (and their sub-groups);
 *   5. entries of lower levels are recomputed here from the same data, labelled with their
 *      origin level; manual adjustments of lower levels are carried at closing (BS) or average
 *      (P&L) rates with the difference to FCTR;
 *   6. manual adjustments of this level. A manual adjustment can replace a generated entry of
 *      the same level (replaces = its id, e.g. INVESTMENT:IN:AE: the generated one is left out
 *      and the manual one counts within the sub-group for NCI), and can be kept to its own level
 *      (thisLevelOnly: not carried up, e.g. when each level books its own figures).
 *
 * Every line is rounded to 2 dp (half away from zero); every entry balances to 0.00.
 */

export type EliminationType = 'IC_BALANCE' | 'IC_PNL' | 'INVESTMENT' | 'NCI' | 'MANUAL';

export interface ConsolAccount {
  fsliCode: string;
  counterpartyCode: string | null;
  /** Level currency, 2 dp, debit +. */
  amount: string;
}

export interface ConsolMember {
  code: string;
  /** Parent in the group tree (may be outside the level for the level parent). */
  parentCode: string | null;
  /** % of this entity held by its parent ("100", "58.49"); null for the ultimate parent. */
  heldByParentPct: string | null;
  functionalCurrency: string;
  /** Translated into the level currency. */
  accounts: readonly ConsolAccount[];
  /** Translation balancing figure into the level currency (null in its own currency). */
  fctr: string | null;
}

export interface AcquisitionStep {
  acquiredOn: string;
  /** % acquired in this step ("100"). */
  pct: string;
  /** Cost of investment, parent's functional currency. */
  cost: string;
  /** At acquisition, subsidiary's functional currency. */
  shareCapital: string;
  premium: string;
  preAcquisitionReserves: string;
  /** Acquisition-date rate: 1 unit of the subsidiary's currency = this many parent units. */
  rateToParent: string | null;
  /** Acquisition-date rate into the level currency. */
  rateToLevel: string | null;
}

export interface AcquisitionInput {
  subsidiaryCode: string;
  parentCode: string;
  steps: readonly AcquisitionStep[];
  /**
   * How NCI is measured at acquisition: proportionate share of net assets (default), or fair
   * value ("full goodwill"; the NCI's share of goodwill is added to NCI).
   */
  nciMeasurement?: 'PROPORTIONATE' | 'FAIR_VALUE';
  /** Fair value method: NCI fair value at the acquisition date, subsidiary's currency. */
  nciFairValue?: string | null;
}

export interface IcPairInput {
  a: string;
  b: string;
  /** Differences strictly below this go to FCTR as rounding (level currency). */
  tolerance: string;
}

export interface ManualLineInput {
  entityCode: string | null;
  fsliCode: string;
  /** The other group entity (an investment's subsidiary, an intercompany balance's party). */
  counterpartyCode?: string | null;
  /** In the adjustment's currency (the level where it was entered), debit +. */
  amount: string;
  /** Where the figure comes from (e.g. a workbook cell). */
  ref?: string | null;
}

export interface ManualAdjustmentInput {
  id: string;
  /** The level it was entered at. */
  level: number;
  currency: string;
  narration: string;
  reason: string;
  lines: readonly ManualLineInput[];
  /** The generated entry of the same level this adjustment replaces (e.g. INVESTMENT:IN:AE). */
  replaces?: string | null;
  /** Not carried to higher levels. */
  thisLevelOnly?: boolean;
  /** Where the entry comes from (e.g. "Financials Aug'26.xlsx · Aistra Group Elimination"). */
  sourceRef?: string | null;
}

export interface LevelInfo {
  level: number;
  parentCode: string;
  members: readonly string[];
}

export interface GenerateEliminationsInput {
  level: number;
  levelCurrency: string;
  levelParentCode: string;
  members: readonly ConsolMember[];
  /** Every level of the task (to label entries with their origin level). */
  levels: readonly LevelInfo[];
  icPairs: readonly IcPairInput[];
  acquisitions: readonly AcquisitionInput[];
  /** Closing rate (period) from a currency into the level currency, full precision. */
  closingToLevel: Readonly<Record<string, string>>;
  /** Average rate (period) from a currency into the level currency, full precision. */
  averageToLevel: Readonly<Record<string, string>>;
  /** Manual adjustments of this level and the levels below. */
  manual: readonly ManualAdjustmentInput[];
  fslis: readonly FormatFsli[];
}

export interface EliminationLine {
  /** null = group level (not one member's balance). */
  entityCode: string | null;
  fsliCode: string;
  counterpartyCode: string | null;
  /** Level currency, 2 dp, debit +. */
  amount: string;
  note: string;
}

export interface EliminationEntry {
  id: string;
  type: EliminationType;
  title: string;
  /** The level the entry first arises at (this level, or a lower one brought forward). */
  originLevel: number;
  /** Entities the entry is about (a pair, a parent and subsidiary, a sub-group). */
  entities: string[];
  lines: EliminationLine[];
  balanced: boolean;
  flagged: boolean;
  flags: string[];
  /** Step-by-step calculation (investment, NCI, carried manual adjustments). */
  calculation: string[];
  /** IC entries: the difference before it was posted (level currency, signed). */
  difference?: string;
  /** Investment entries: goodwill (positive) or capital reserve (negative), level currency. */
  goodwill?: string;
  /** Fair value method: the NCI's share of goodwill (level currency), included in goodwill. */
  nciGoodwill?: string;
  /** Investment entries: goodwill in the parent's currency, and the closing rate into the level. */
  goodwillParent?: string;
  parentCurrency?: string;
  goodwillRate?: string;
  /** NCI entries: the NCI share of the profit for the period (positive = profit). */
  nciProfit?: string;
  /** Manual adjustments. */
  manualId?: string;
}

export interface GenerateEliminationsResult {
  entries: EliminationEntry[];
  /** What could not be generated (missing acquisitions register rows, rates). */
  issues: string[];
}

const D = (v: string | Decimal) => new Decimal(v);
const two = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const pctOf = (p: string) => D(p).dividedBy(100);
const fmt = (d: Decimal) => {
  const [i = '0', f = '00'] = d.abs().toFixed(2).split('.');
  return `${d.isNegative() ? '−' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${f}`;
};
const fmtRate = (r: string) => D(r).toDecimalPlaces(10, Decimal.ROUND_HALF_UP).toFixed();
const pctText = (d: Decimal) => `${d.times(100).toDecimalPlaces(4).toFixed()}%`;

/** The lowest level whose members include every code. */
export function originLevel(
  levels: readonly LevelInfo[],
  codes: readonly string[],
  fallback: number,
): number {
  const ls = [...levels].sort((a, b) => a.level - b.level);
  return ls.find((l) => codes.every((c) => l.members.includes(c)))?.level ?? fallback;
}

function entry(
  base: Omit<EliminationEntry, 'balanced' | 'lines'> & { lines: EliminationLine[] },
): EliminationEntry {
  const lines = base.lines.filter((l) => !D(l.amount).isZero());
  const total = lines.reduce((s, l) => s.plus(l.amount), D('0'));
  return { ...base, lines, balanced: total.isZero() };
}

function sumWhere(m: ConsolMember, fsli: string, counterparty: string | null): Decimal {
  return m.accounts
    .filter(
      (a) => a.fsliCode === fsli && (counterparty === null || a.counterpartyCode === counterparty),
    )
    .reduce((s, a) => s.plus(a.amount), D('0'));
}

function icEntry(
  type: 'IC_BALANCE' | 'IC_PNL',
  a: ConsolMember,
  b: ConsolMember,
  tolerance: string,
  origin: number,
): EliminationEntry {
  const fslis = type === 'IC_BALANCE' ? ['IC_REC', 'IC_PAY'] : ['IC_REV', 'IC_EXP'];
  const lines: EliminationLine[] = [];
  for (const [m, other] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const f of fslis) {
      const v = sumWhere(m, f, other.code);
      if (!v.isZero())
        lines.push({
          entityCode: m.code,
          fsliCode: f,
          counterpartyCode: other.code,
          amount: v.negated().toFixed(2),
          note: `Reverse ${m.code}'s ${f} with ${other.code}`,
        });
    }
  }
  const diff = lines.reduce((s, l) => s.plus(l.amount), D('0')).negated();
  const flags: string[] = [];
  const kind = type === 'IC_BALANCE' ? 'balances' : 'revenue / charges';
  if (!diff.isZero()) {
    const rounding = diff.abs().lessThan(tolerance);
    lines.push({
      entityCode: null,
      fsliCode: rounding ? 'FCTR' : type === 'IC_BALANCE' ? 'IC_DIFF' : 'IC_DIFF_PL',
      counterpartyCode: null,
      amount: diff.toFixed(2),
      note: rounding ? 'Rounding' : 'Unreconciled – investigate',
    });
    if (!rounding)
      flags.push(
        `Intercompany ${kind} ${a.code}–${b.code} differ by ${fmt(diff.abs())} (tolerance ${fmt(D(tolerance))}): parked in ${type === 'IC_BALANCE' ? 'IC_DIFF' : 'IC_DIFF_PL'}.`,
      );
  }
  return entry({
    id: `${type}:${a.code}:${b.code}`,
    type,
    title: `Intercompany ${kind}: ${a.code} ↔ ${b.code}`,
    originLevel: origin,
    entities: [a.code, b.code],
    lines,
    flagged: flags.length > 0,
    flags,
    calculation: [],
    difference: diff.toFixed(2),
  });
}

function investmentEntry(
  input: GenerateEliminationsInput,
  parent: ConsolMember,
  sub: ConsolMember,
  acq: AcquisitionInput,
  origin: number,
): { entry: EliminationEntry | null; issue: string | null } {
  const missing = acq.steps.flatMap((s, i) => [
    ...(s.rateToParent === null
      ? [
          `step ${i + 1}: acquisition-date rate ${sub.functionalCurrency} → ${parent.functionalCurrency}`,
        ]
      : []),
    ...(s.rateToLevel === null
      ? [`step ${i + 1}: acquisition-date rate ${sub.functionalCurrency} → ${input.levelCurrency}`]
      : []),
  ]);
  const closing = input.closingToLevel[parent.functionalCurrency];
  if (closing === undefined)
    missing.push(`closing rate ${parent.functionalCurrency} → ${input.levelCurrency}`);
  if (acq.steps.length === 0) missing.push('no acquisition step');
  const fairValue =
    acq.nciMeasurement === 'FAIR_VALUE' &&
    acq.steps.reduce((s, x) => s.plus(pctOf(x.pct)), D('0')).lessThan(1);
  if (
    fairValue &&
    (acq.nciFairValue === null || acq.nciFairValue === undefined || acq.nciFairValue === '')
  )
    missing.push('NCI fair value at the acquisition date (NCI measured at fair value)');
  if (missing.length > 0)
    return {
      entry: null,
      issue: `Investment in ${sub.code} (held by ${parent.code}) not eliminated: missing ${missing.join('; ')}.`,
    };

  const calc: string[] = [];
  const totalPct = acq.steps.reduce((s, x) => s.plus(pctOf(x.pct)), D('0'));
  const cost = acq.steps.reduce((s, x) => s.plus(x.cost), D('0'));
  let netAssets = D('0');
  let preAcqLevel = D('0');
  acq.steps.forEach((s, i) => {
    const p = pctOf(s.pct);
    const base = D(s.shareCapital).plus(s.premium).plus(s.preAcquisitionReserves);
    const na = p.times(base).times(s.rateToParent!);
    netAssets = netAssets.plus(na);
    preAcqLevel = preAcqLevel.plus(p.times(s.preAcquisitionReserves).times(s.rateToLevel!));
    calc.push(
      `Step ${i + 1} (${s.acquiredOn}): ${pctText(p)} × (share capital ${fmt(D(s.shareCapital))} + premium ${fmt(D(s.premium))} + pre-acquisition reserves ${fmt(D(s.preAcquisitionReserves))}) ${sub.functionalCurrency} × ${fmtRate(s.rateToParent!)} = ${fmt(two(na))} ${parent.functionalCurrency}; cost ${fmt(D(s.cost))} ${parent.functionalCurrency}.`,
    );
  });
  const goodwillParent = two(cost.minus(netAssets));
  calc.push(
    `Goodwill (${parent.functionalCurrency}) = cost ${fmt(cost)} − net assets acquired ${fmt(two(netAssets))} = ${fmt(goodwillParent)}${goodwillParent.isNegative() ? ' (negative: capital reserve)' : ''}.`,
  );
  const goodwillLevel = two(goodwillParent.times(closing!));
  if (parent.functionalCurrency !== input.levelCurrency)
    calc.push(
      `In ${input.levelCurrency} at the closing rate ${parent.functionalCurrency} → ${input.levelCurrency} ${fmtRate(closing!)}: ${fmt(goodwillLevel)}.`,
    );
  // Fair value (full goodwill): NCI share = NCI fair value − NCI % × net assets at acquisition.
  let nciGoodwillParent = D('0');
  if (fairValue) {
    const first = acq.steps[0]!;
    const nciPct = D('1').minus(totalPct);
    const base100 = D(first.shareCapital).plus(first.premium).plus(first.preAcquisitionReserves);
    const fv = D(acq.nciFairValue!).times(first.rateToParent!);
    const nciNa = nciPct.times(base100).times(first.rateToParent!);
    nciGoodwillParent = two(fv.minus(nciNa));
    const total = goodwillParent.plus(nciGoodwillParent);
    calc.push(
      `NCI at fair value: ${fmt(D(acq.nciFairValue!))} ${sub.functionalCurrency} × ${fmtRate(first.rateToParent!)} = ${fmt(two(fv))} ${parent.functionalCurrency}; NCI share of net assets ${pctText(nciPct)} × ${fmt(base100)} × ${fmtRate(first.rateToParent!)} = ${fmt(two(nciNa))}; NCI share of goodwill = ${fmt(nciGoodwillParent)}.`,
    );
    calc.push(
      `Total goodwill (${parent.functionalCurrency}) = (cost ${fmt(cost)} + NCI fair value ${fmt(two(fv))}) − 100% × net assets ${fmt(two(base100.times(first.rateToParent!)))} = ${fmt(total)}: parent ${fmt(goodwillParent)}, NCI ${fmt(nciGoodwillParent)}.`,
    );
  }
  const nciGoodwillLevel = two(nciGoodwillParent.times(closing!));

  const inv = sumWhere(parent, 'INV_SUB', sub.code);
  const sc = two(sumWhere(sub, 'SHARE_CAP', null).times(totalPct)).negated();
  const prem = two(sumWhere(sub, 'SEC_PREM', null).times(totalPct)).negated();
  const pre = two(preAcqLevel);
  calc.push(`Cr investment in ${sub.code}: ${fmt(inv)} (${parent.code}'s column).`);
  calc.push(
    `Dr share capital ${pctText(totalPct)} × ${fmt(sumWhere(sub, 'SHARE_CAP', null).negated())} = ${fmt(sc)}; Dr premium ${fmt(prem)} (${sub.code}'s column).`,
  );
  if (!pre.isZero())
    calc.push(
      `Dr retained earnings (pre-acquisition reserves at the acquisition-date rate into ${input.levelCurrency}): ${fmt(pre)}.`,
    );

  const lines: EliminationLine[] = [
    {
      entityCode: parent.code,
      fsliCode: 'INV_SUB',
      counterpartyCode: sub.code,
      amount: inv.negated().toFixed(2),
      note: `Investment in ${sub.code}`,
    },
    {
      entityCode: sub.code,
      fsliCode: 'SHARE_CAP',
      counterpartyCode: null,
      amount: sc.toFixed(2),
      note: `${pctText(totalPct)} of ${sub.code}'s share capital`,
    },
    {
      entityCode: sub.code,
      fsliCode: 'SEC_PREM',
      counterpartyCode: null,
      amount: prem.toFixed(2),
      note: `${pctText(totalPct)} of ${sub.code}'s premium`,
    },
    {
      entityCode: sub.code,
      fsliCode: 'RETAINED',
      counterpartyCode: null,
      amount: pre.toFixed(2),
      note: 'Pre-acquisition reserves',
    },
    goodwillLevel.isNegative()
      ? {
          entityCode: null,
          fsliCode: 'OTH_RES',
          counterpartyCode: null,
          amount: goodwillLevel.toFixed(2),
          note: 'Capital reserve on consolidation',
        }
      : {
          entityCode: null,
          fsliCode: 'GOODWILL',
          counterpartyCode: null,
          amount: goodwillLevel.toFixed(2),
          note: `Goodwill on ${sub.code}`,
        },
    ...(nciGoodwillLevel.isZero()
      ? []
      : [
          {
            entityCode: null,
            fsliCode: 'GOODWILL',
            counterpartyCode: null,
            amount: nciGoodwillLevel.toFixed(2),
            note: `NCI share of goodwill on ${sub.code} (fair value)`,
          },
          {
            entityCode: null,
            fsliCode: 'NCI',
            counterpartyCode: null,
            amount: nciGoodwillLevel.negated().toFixed(2),
            note: `NCI share of goodwill on ${sub.code}`,
          },
        ]),
  ];
  const rest = lines.reduce((s, l) => s.plus(l.amount), D('0'));
  if (!rest.isZero()) {
    lines.push({
      entityCode: null,
      fsliCode: 'FCTR',
      counterpartyCode: null,
      amount: rest.negated().toFixed(2),
      note: 'Translation difference on historical equity / goodwill',
    });
    calc.push(
      `Balancing line to FCTR: ${fmt(rest.negated())} (translation difference on historical equity / goodwill).`,
    );
  } else calc.push('No translation difference (the entry balances without an FCTR line).');

  return {
    entry: entry({
      id: `INVESTMENT:${parent.code}:${sub.code}`,
      type: 'INVESTMENT',
      title: `Investment in ${sub.code} (held by ${parent.code})`,
      originLevel: origin,
      entities: [parent.code, sub.code],
      lines,
      flagged: false,
      flags: [],
      calculation: calc,
      goodwill: goodwillLevel.plus(nciGoodwillLevel).toFixed(2),
      goodwillParent: goodwillParent.plus(nciGoodwillParent).toFixed(2),
      ...(fairValue ? { nciGoodwill: nciGoodwillLevel.toFixed(2) } : {}),
      parentCurrency: parent.functionalCurrency,
      goodwillRate: fmtRate(closing!),
    }),
    issue: null,
  };
}

const NCI_COMPONENTS = ['SHARE_CAP', 'SEC_PREM', 'RETAINED', 'OTH_RES', 'FCTR'] as const;

function nciEntry(
  input: GenerateEliminationsInput,
  member: ConsolMember,
  subgroup: readonly ConsolMember[],
  internal: readonly EliminationEntry[],
  origin: number,
): EliminationEntry {
  const pl = new Set(input.fslis.filter((f) => f.statement === 'PL').map((f) => f.code));
  const nciPct = D('100').minus(member.heldByParentPct!).dividedBy(100);
  const codes = new Set(subgroup.map((m) => m.code));
  const all = [
    ...subgroup.flatMap((m) => [
      ...m.accounts.map((a) => ({ fsliCode: a.fsliCode, amount: a.amount })),
      ...(m.fctr ? [{ fsliCode: 'FCTR', amount: m.fctr }] : []),
    ]),
    ...internal.flatMap((e) => e.lines.map((l) => ({ fsliCode: l.fsliCode, amount: l.amount }))),
  ];
  const component = (f: string) =>
    all.filter((x) => x.fsliCode === f).reduce((s, x) => s.plus(x.amount), D('0'));
  const profit = all.filter((x) => pl.has(x.fsliCode)).reduce((s, x) => s.plus(x.amount), D('0'));
  const calc = [
    `NCI ${pctText(nciPct)} (100% − ${member.heldByParentPct}% held by ${member.parentCode}) of the ${[...codes].join(' + ')} sub-group${internal.length ? `, after ${internal.length} elimination(s) within it` : ''}.`,
  ];
  const lines: EliminationLine[] = [];
  for (const f of NCI_COMPONENTS) {
    const v = component(f);
    const share = two(v.times(nciPct)).negated();
    calc.push(`${f}: ${fmt(v)} × ${pctText(nciPct)} → Dr ${fmt(share)}.`);
    lines.push({
      entityCode: null,
      fsliCode: f,
      counterpartyCode: null,
      amount: share.toFixed(2),
      note: `NCI share of ${f}`,
    });
  }
  const profitShare = two(profit.times(nciPct)).negated();
  calc.push(
    `Profit for the period: ${fmt(profit.negated())} × ${pctText(nciPct)} = ${fmt(profitShare)} (to PL_NCI).`,
  );
  lines.push({
    entityCode: null,
    fsliCode: 'PL_NCI',
    counterpartyCode: null,
    amount: profitShare.toFixed(2),
    note: 'NCI share of the profit for the period',
  });
  const total = lines.reduce((s, l) => s.plus(l.amount), D('0'));
  lines.push({
    entityCode: null,
    fsliCode: 'NCI',
    counterpartyCode: null,
    amount: total.negated().toFixed(2),
    note: 'Non-controlling interests',
  });
  calc.push(`Cr NCI ${fmt(total)}.`);
  return entry({
    id: `NCI:${member.code}`,
    type: 'NCI',
    title: `Non-controlling interests in ${member.code} (${pctText(nciPct)})`,
    originLevel: origin,
    entities: [...codes],
    lines,
    flagged: false,
    flags: [],
    calculation: calc,
    nciProfit: profitShare.toFixed(2),
  });
}

function manualEntry(
  input: GenerateEliminationsInput,
  m: ManualAdjustmentInput,
): { entry: EliminationEntry | null; issue: string | null } {
  const pl = new Set(input.fslis.filter((f) => f.statement === 'PL').map((f) => f.code));
  const same = m.currency === input.levelCurrency;
  const closing = same ? '1' : input.closingToLevel[m.currency];
  const average = same ? '1' : input.averageToLevel[m.currency];
  if (closing === undefined || average === undefined)
    return {
      entry: null,
      issue: `Manual adjustment "${m.narration}" (level ${m.level}) not carried: no rate ${m.currency} → ${input.levelCurrency}.`,
    };
  const lines: EliminationLine[] = m.lines.map((l) => ({
    entityCode: l.entityCode,
    fsliCode: l.fsliCode,
    counterpartyCode: l.counterpartyCode ?? null,
    amount: two(D(l.amount).times(pl.has(l.fsliCode) ? average : closing)).toFixed(2),
    note: [
      l.ref ? `Source: ${l.ref}` : '',
      same
        ? ''
        : `${fmt(D(l.amount))} ${m.currency} at the ${pl.has(l.fsliCode) ? 'average' : 'closing'} rate ${fmtRate(pl.has(l.fsliCode) ? average : closing)}`,
    ]
      .filter(Boolean)
      .join('; '),
  }));
  const calc: string[] = [`Reason: ${m.reason}`];
  if (m.sourceRef) calc.push(`Source: ${m.sourceRef}`);
  if (m.replaces && m.level === input.level)
    calc.push(`Replaces the generated entry ${m.replaces}.`);
  const rest = lines.reduce((s, l) => s.plus(l.amount), D('0'));
  if (!rest.isZero()) {
    lines.push({
      entityCode: null,
      fsliCode: 'FCTR',
      counterpartyCode: null,
      amount: rest.negated().toFixed(2),
      note: 'Translation difference on a carried adjustment',
    });
    calc.push(
      `Carried from level ${m.level} (${m.currency}): BS lines at closing, P&L lines at average; difference ${fmt(rest.negated())} to FCTR.`,
    );
  }
  return {
    entry: entry({
      id: `MANUAL:${m.id}`,
      type: 'MANUAL',
      title: m.narration,
      originLevel: m.level,
      entities: [
        ...new Set(m.lines.map((l) => l.entityCode).filter((c): c is string => c !== null)),
      ],
      lines,
      flagged: false,
      flags: [],
      calculation: calc,
      manualId: m.id,
    }),
    issue: null,
  };
}

/** All entries for one level (including those brought forward from lower levels). */
export function generateEliminations(input: GenerateEliminationsInput): GenerateEliminationsResult {
  const byCode = new Map(input.members.map((m) => [m.code, m]));
  const inLevel = (c: string | null) => c !== null && byCode.has(c);
  const entries: EliminationEntry[] = [];
  const issues: string[] = [];
  const origin = (codes: string[]) => originLevel(input.levels, codes, input.level);

  // 1–2. Intercompany pairs (marked in the matrix, both members of this level).
  for (const p of input.icPairs) {
    const a = byCode.get(p.a);
    const b = byCode.get(p.b);
    if (!a || !b) continue;
    for (const type of ['IC_BALANCE', 'IC_PNL'] as const) {
      const e = icEntry(type, a, b, p.tolerance, origin([a.code, b.code]));
      if (e.lines.length > 0) entries.push(e);
    }
  }

  // 3. Investment in subsidiary: every member whose parent is also a member.
  const investments: EliminationEntry[] = [];
  for (const sub of input.members) {
    if (!inLevel(sub.parentCode) || sub.code === input.levelParentCode) continue;
    const parent = byCode.get(sub.parentCode!)!;
    const acq = input.acquisitions.find(
      (a) => a.subsidiaryCode === sub.code && a.parentCode === parent.code,
    );
    if (!acq) {
      issues.push(
        `Investment in ${sub.code} (held by ${parent.code}) not eliminated: no acquisitions register row.`,
      );
      continue;
    }
    const r = investmentEntry(input, parent, sub, acq, origin([parent.code, sub.code]));
    if (r.issue) issues.push(r.issue);
    if (r.entry) investments.push(r.entry);
  }
  entries.push(...investments);

  // 5–6. Manual adjustments (this level, and carried from lower levels unless kept to their
  // level). Those replacing a generated entry of this level take its place.
  const manual: EliminationEntry[] = [];
  const replaced = new Set<string>();
  for (const m of [...input.manual].sort((a, b) => a.level - b.level)) {
    if (m.level > input.level || (m.level < input.level && m.thisLevelOnly)) continue;
    const r = manualEntry(input, m);
    if (r.issue) issues.push(r.issue);
    if (!r.entry) continue;
    manual.push(r.entry);
    if (m.replaces && m.level === input.level) replaced.add(m.replaces);
  }
  for (let i = entries.length - 1; i >= 0; i--)
    if (replaced.has(entries[i]!.id)) entries.splice(i, 1);
  const replacing = manual.filter((e) => {
    const m = input.manual.find((x) => `MANUAL:${x.id}` === e.id);
    return !!m?.replaces && m.level === input.level;
  });

  // 4. NCI: members (not the level parent) whose parent holds less than 100%.
  const descendants = (code: string): string[] =>
    input.members
      .filter((m) => m.parentCode === code)
      .flatMap((m) => [m.code, ...descendants(m.code)]);
  for (const m of input.members) {
    if (m.code === input.levelParentCode || !inLevel(m.parentCode) || m.heldByParentPct === null)
      continue;
    if (!D(m.heldByParentPct).lessThan(100)) continue;
    const codes = [m.code, ...descendants(m.code)];
    const internal = [...entries, ...replacing].filter(
      (e) =>
        e.type !== 'NCI' && e.entities.length > 0 && e.entities.every((c) => codes.includes(c)),
    );
    entries.push(
      nciEntry(
        input,
        m,
        codes.map((c) => byCode.get(c)!),
        internal,
        origin([m.code, m.parentCode!]),
      ),
    );
  }

  entries.push(...manual);
  return { entries, issues };
}

/** A manual adjustment balances (Σ lines = 0.00) and has at least two non-zero lines. */
export function validateManualAdjustment(lines: readonly ManualLineInput[]): string[] {
  const problems: string[] = [];
  const nonZero = lines.filter((l) => !D(l.amount).isZero());
  if (nonZero.length < 2) problems.push('Enter at least two lines.');
  const total = lines.reduce((s, l) => s.plus(l.amount), D('0'));
  if (!total.isZero())
    problems.push(`The adjustment does not balance: debits − credits = ${fmt(total)}.`);
  return problems;
}

/** FSLI amounts of one member (adds the computed PROFIT, and FCTR when translated). */
export function memberAmounts(
  m: ConsolMember,
  fslis: readonly FormatFsli[],
): Record<string, string> {
  return fsliAmounts(
    m.accounts.map((a, i) => ({
      code: String(i),
      name: '',
      fsliCode: a.fsliCode,
      counterpartyCode: a.counterpartyCode,
      amount: a.amount,
    })),
    fslis,
    m.fctr,
  ).amounts;
}

/** Σ of FSLI amount records (PROFIT and FCTR add up like any other item). */
export function addAmounts(
  records: readonly Readonly<Record<string, string>>[],
): Record<string, string> {
  const out = new Map<string, Decimal>();
  for (const r of records)
    for (const [k, v] of Object.entries(r)) out.set(k, (out.get(k) ?? D('0')).plus(v));
  return Object.fromEntries([...out].map(([k, v]) => [k, v.toFixed(2)]));
}

/** Aggregate + eliminations, with PROFIT recomputed from the P&L items. */
export function consolidatedAmounts(
  members: readonly ConsolMember[],
  entries: readonly EliminationEntry[],
  fslis: readonly FormatFsli[],
): Record<string, string> {
  const pl = new Set(fslis.filter((f) => f.statement === 'PL').map((f) => f.code));
  const agg = addAmounts(members.map((m) => memberAmounts(m, fslis)));
  const sums = new Map(Object.entries(agg).map(([k, v]) => [k, D(v)]));
  for (const e of entries)
    for (const l of e.lines) sums.set(l.fsliCode, (sums.get(l.fsliCode) ?? D('0')).plus(l.amount));
  let profit = D('0');
  for (const [k, v] of sums) if (pl.has(k)) profit = profit.plus(v);
  sums.set('PROFIT', profit);
  return Object.fromEntries([...sums].map(([k, v]) => [k, v.toFixed(2)]));
}

export interface EliminationCheck {
  code: 'INVESTMENTS_ELIMINATED' | 'IC_ELIMINATED' | 'CONSOLIDATED_BALANCES' | 'ENTRIES_BALANCE';
  label: string;
  passed: boolean;
  details: string;
}

/** The checks shown under the eliminations. */
export function eliminationChecks(
  members: readonly ConsolMember[],
  entries: readonly EliminationEntry[],
  fslis: readonly FormatFsli[],
): EliminationCheck[] {
  const codes = new Set(members.map((m) => m.code));
  const residual = (fsli: string) => {
    let v = D('0');
    for (const m of members)
      for (const a of m.accounts)
        if (a.fsliCode === fsli && a.counterpartyCode && codes.has(a.counterpartyCode))
          v = v.plus(a.amount);
    for (const e of entries)
      for (const l of e.lines)
        if (l.fsliCode === fsli && l.counterpartyCode && codes.has(l.counterpartyCode))
          v = v.plus(l.amount);
    return v;
  };
  const inv = residual('INV_SUB');
  const ic = (['IC_REC', 'IC_PAY', 'IC_REV', 'IC_EXP'] as const).map((f) => ({
    f,
    v: residual(f),
  }));
  const consolidated = consolidatedAmounts(members, entries, fslis);
  const total = Object.entries(consolidated)
    .filter(([k]) => k !== 'PROFIT')
    .reduce((s, [, v]) => s.plus(v), D('0'));
  const unbalanced = entries.filter((e) => !e.balanced);
  return [
    {
      code: 'ENTRIES_BALANCE',
      label: 'Every entry balances',
      passed: unbalanced.length === 0,
      details:
        unbalanced.length === 0
          ? `${entries.length} entries, each Dr = Cr.`
          : `Not balanced: ${unbalanced.map((e) => e.title).join('; ')}.`,
    },
    {
      code: 'INVESTMENTS_ELIMINATED',
      label: 'Investments in member subsidiaries fully eliminated',
      passed: inv.isZero(),
      details: `Residual investment in subsidiaries within the level: ${fmt(inv)}.`,
    },
    {
      code: 'IC_ELIMINATED',
      label: 'Intercompany balances and transactions eliminated',
      passed: ic.every((x) => x.v.isZero()),
      details: `${ic.map((x) => `${x.f} ${fmt(x.v)}`).join(' · ')} (differences parked in IC_DIFF / IC_DIFF_PL excluded).`,
    },
    {
      code: 'CONSOLIDATED_BALANCES',
      label: 'Consolidated balance sheet balances',
      passed: total.isZero(),
      details: `Aggregate + eliminations net to ${fmt(total)}.`,
    },
  ];
}

export interface EliminationSummary {
  entries: number;
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
  icDifferencesFlagged: number;
  goodwill: string;
  capitalReserve: string;
}

export function eliminationSummary(entries: readonly EliminationEntry[]): EliminationSummary {
  const lines = entries.flatMap((e) => e.lines);
  const dr = lines
    .filter((l) => D(l.amount).isPositive())
    .reduce((s, l) => s.plus(l.amount), D('0'));
  const cr = lines
    .filter((l) => D(l.amount).isNegative())
    .reduce((s, l) => s.minus(l.amount), D('0'));
  const sumFsli = (f: string) =>
    lines
      .filter((l) => l.fsliCode === f && l.note !== 'Rounding')
      .reduce((s, l) => s.plus(l.amount), D('0'));
  const capital = entries
    .filter((e) => e.type === 'INVESTMENT')
    .flatMap((e) => e.lines)
    .filter((l) => l.fsliCode === 'OTH_RES')
    .reduce((s, l) => s.minus(l.amount), D('0'));
  return {
    entries: entries.length,
    totalDebit: dr.toFixed(2),
    totalCredit: cr.toFixed(2),
    balanced: dr.equals(cr),
    icDifferencesFlagged: entries.filter(
      (e) => (e.type === 'IC_BALANCE' || e.type === 'IC_PNL') && e.flagged,
    ).length,
    goodwill: sumFsli('GOODWILL').toFixed(2),
    capitalReserve: capital.toFixed(2),
  };
}

// ---------------------------------------------------------------------------------------
// Attribution (page 10): owners of the parent vs non-controlling interests
// ---------------------------------------------------------------------------------------

/** Profit for the period (positive = profit), split owners / NCI (NCI entries' profit share). */
export function profitAttribution(
  consolidated: Readonly<Record<string, string>>,
  entries: readonly EliminationEntry[],
): { total: string; owners: string; nci: string } {
  const total = D(consolidated.PROFIT ?? '0').negated();
  const nci = entries
    .filter((e) => e.type === 'NCI')
    .reduce((s, e) => s.plus(e.nciProfit ?? '0'), D('0'));
  return { total: total.toFixed(2), owners: total.minus(nci).toFixed(2), nci: nci.toFixed(2) };
}

/**
 * FCTR (signed, debit +): the consolidated FCTR is the owners' share (the NCI entries moved the
 * NCI share into NCI); the NCI share is what those entries moved.
 */
export function fctrSplit(
  consolidated: Readonly<Record<string, string>>,
  entries: readonly EliminationEntry[],
): { total: string; owners: string; nci: string } {
  const owners = D(consolidated.FCTR ?? '0');
  const nci = entries
    .filter((e) => e.type === 'NCI')
    .flatMap((e) => e.lines)
    .filter((l) => l.fsliCode === 'FCTR')
    .reduce((s, l) => s.minus(l.amount), D('0'));
  return { total: owners.plus(nci).toFixed(2), owners: owners.toFixed(2), nci: nci.toFixed(2) };
}

/**
 * "Exchange differences on translation of foreign operations": the FCTR movement against the
 * immediately preceding period, presented as a gain (positive) or loss (negative).
 */
export function fctrMovement(
  current: { total: string; owners: string; nci: string },
  comparative: { total: string; owners: string; nci: string },
): { total: string; owners: string; nci: string } {
  const m = (k: 'total' | 'owners' | 'nci') => D(comparative[k]).minus(current[k]).toFixed(2);
  return { total: m('total'), owners: m('owners'), nci: m('nci') };
}

/** Equity attributable to owners, NCI and total equity (presentation signs: credit positive). */
export function equityAttribution(
  amounts: Readonly<Record<string, string>>,
  fslis: readonly FormatFsli[],
): { owners: string; nci: string; total: string } {
  let owners = D('0');
  for (const f of fslis)
    if (f.class === 'E' && f.code !== 'NCI') owners = owners.minus(amounts[f.code] ?? '0');
  const nci = D(amounts.NCI ?? '0').negated();
  return { owners: owners.toFixed(2), nci: nci.toFixed(2), total: owners.plus(nci).toFixed(2) };
}
