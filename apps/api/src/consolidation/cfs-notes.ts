import {
  buildStatement,
  Decimal,
  type EliminationEntry,
  fctrSplit,
  type FormatFsli,
  type FormatLine,
  type GeneratedBlock,
  scaleAmount,
  type StatementAccount,
  type StatementUnit,
  statementTitle,
} from '@finance-close/engine';
import type { GeneratedViewDto } from '@finance-close/shared';
import { fromDbDate } from '../common/db-dates';
import type { PeriodFigures, EntityFigures } from '../uploads/statement-figures';
import type { NotesScope, NotesTask } from '../uploads/notes.service';
import type { LevelComparative, LevelData, MemberData } from './consolidation.service';
import { levelColumns } from './cfs-statements';

/**
 * Consolidation notes (page 10, step 5): the notes framework of the SFS, on a level. The level's
 * "accounts" are its members' accounts (prefixed with the entity) and the elimination lines, so
 * line notes, sub-captions and live figures work unchanged; generated tables (subsidiaries,
 * goodwill, NCI, intercompany, FCTR) are filled from the level each time they are shown.
 */

const fmt = (v: string | Decimal) => {
  const d = new Decimal(v);
  const [i = '0', f = '00'] = d.abs().toFixed(2).split('.');
  const t = `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${f}`;
  return d.isNegative() ? `(${t})` : t;
};

/** A period's figures of the level as the notes framework reads them. */
function periodFigures(
  members: readonly MemberData[] | null,
  entries: readonly EliminationEntry[],
  consolidated: Record<string, string>,
  fslis: readonly FormatFsli[],
): PeriodFigures {
  const name = new Map(fslis.map((f) => [f.code, f.name]));
  const accounts: StatementAccount[] = members
    ? [
        ...members.flatMap((m) =>
          m.accounts
            .filter((a) => a.fsliCode)
            .map((a) => ({
              code: `${m.code}·${a.code}`,
              name: `${m.code} · ${a.name}`,
              fsliCode: a.fsliCode,
              counterpartyCode: a.counterpartyCode,
              amount: a.amount,
            })),
        ),
        ...entries.flatMap((e) =>
          e.lines
            .filter((l) => l.fsliCode !== 'FCTR')
            .map((l, i) => ({
              code: `ELIM·${e.id}·${i}`,
              name: `Elimination · ${e.title}`,
              fsliCode: l.fsliCode,
              counterpartyCode: l.counterpartyCode,
              amount: l.amount,
            })),
        ),
      ]
    : // A comparative from a level snapshot: one line per FSLI.
      Object.entries(consolidated)
        .filter(([k]) => k !== 'PROFIT' && k !== 'FCTR')
        .map(([k, v]) => ({
          code: `FSLI·${k}`,
          name: name.get(k) ?? k,
          fsliCode: k,
          counterpartyCode: null,
          amount: v,
        }));
  return {
    status: 'OK',
    failures: [],
    warnings: [],
    accounts,
    fctr: consolidated.FCTR ?? '0.00',
    translation: null,
    rates: null,
  };
}

export function levelFigures(
  d: Pick<LevelData, 'members' | 'entries' | 'consolidated' | 'comparative' | 'fslis'> & {
    currency: string;
    periodEnd: string;
  },
): EntityFigures {
  const c: LevelComparative = d.comparative;
  return {
    version: 1,
    functionalCurrency: d.currency,
    comparative: {
      kind: c.kind === 'SNAPSHOT' ? 'FINALISED' : c.kind === 'RECOMPUTED' ? 'DRAFT' : 'NONE',
      periodLabel: c.periodLabel,
      periodEndDate: d.periodEnd,
      taskNumber: null,
    },
    currencies: [
      {
        currency: d.currency,
        translatedFrom: null,
        current: periodFigures(
          d.members.filter((m) => m.member),
          d.entries,
          d.consolidated,
          d.fslis,
        ),
        comparative: c.consolidated
          ? periodFigures(null, c.entries, c.consolidated, d.fslis)
          : null,
      },
    ],
  };
}

interface GeneratedContext {
  d: LevelData;
  lines: FormatLine[];
  entities: Map<string, { legalName: string; country: string; incorporatedOn: Date | null }>;
  acquisitions: { subsidiaryCode: string; acquiredOn: Date }[];
}

function generated(
  ctx: GeneratedContext,
  block: GeneratedBlock,
  unit: StatementUnit,
): GeneratedViewDto {
  const { d } = ctx;
  const sc = (v: string | Decimal | null) =>
    v === null ? null : fmt(scaleAmount(new Decimal(v).toFixed(2), unit));
  const ccy = d.level.currency;
  switch (block.source) {
    case 'SUBSIDIARIES': {
      const subs = d.members.filter((m) => m.code !== d.level.parentEntityCode);
      return {
        columns: [
          { label: 'Subsidiary', numeric: false },
          { label: 'Country', numeric: false },
          { label: 'Functional currency', numeric: false },
          { label: '% held by parent', numeric: true },
          { label: 'Effective group %', numeric: true },
          { label: 'Consolidated from', numeric: false },
        ],
        rows: subs.map((m) => {
          const e = ctx.entities.get(m.code);
          const acq = ctx.acquisitions
            .filter((a) => a.subsidiaryCode === m.code)
            .sort((a, b) => a.acquiredOn.getTime() - b.acquiredOn.getTime())[0];
          const from = acq?.acquiredOn ?? e?.incorporatedOn ?? null;
          return {
            cells: [
              `${e?.legalName ?? m.shortName} (held by ${m.parentCode})`,
              e?.country ?? '',
              m.functionalCurrency,
              m.heldByParentPct ? `${m.heldByParentPct}%` : '–',
              `${m.effectiveGroupPct}%`,
              from ? fromDbDate(from) : '–',
            ],
          };
        }),
        footnote: subs.length ? null : 'No subsidiaries at this level.',
      };
    }
    case 'GOODWILL': {
      const inv = d.entries.filter((e) => e.type === 'INVESTMENT');
      const comp = new Map(
        d.comparative.entries.filter((e) => e.type === 'INVESTMENT').map((e) => [e.id, e]),
      );
      const rows = inv.map((e) => {
        const c = comp.get(e.id);
        const negative = new Decimal(e.goodwill ?? '0').isNegative();
        const amount = new Decimal(e.goodwill ?? '0').abs();
        const before = c ? new Decimal(c.goodwill ?? '0').abs() : null;
        return {
          cells: [
            `${e.title}${negative ? ' — capital reserve' : ''}`,
            e.goodwillParent
              ? `${fmt(new Decimal(e.goodwillParent).abs())} ${e.parentCurrency ?? ''}`
              : '–',
            e.goodwillRate ?? '–',
            sc(amount),
            before === null ? '–' : sc(before),
            before === null ? '–' : sc(amount.minus(before)),
          ],
        };
      });
      const gw = inv
        .filter((e) => !new Decimal(e.goodwill ?? '0').isNegative())
        .reduce((s, e) => s.plus(e.goodwill ?? '0'), new Decimal(0));
      const cr = inv
        .filter((e) => new Decimal(e.goodwill ?? '0').isNegative())
        .reduce((s, e) => s.minus(e.goodwill ?? '0'), new Decimal(0));
      return {
        columns: [
          { label: 'Acquisition', numeric: false },
          { label: 'Goodwill (parent currency)', numeric: true },
          { label: `Closing rate into ${ccy}`, numeric: true },
          { label: `${d.task.period.label} (${ccy})`, numeric: true },
          { label: `${d.comparative.periodLabel || 'Comparative'} (${ccy})`, numeric: true },
          { label: 'Translation difference', numeric: true },
        ],
        rows: [
          ...rows,
          { cells: ['Goodwill on consolidation', null, null, sc(gw), null, null], total: true },
          ...(cr.isZero()
            ? []
            : [
                {
                  cells: [
                    'Capital reserve on consolidation (shown in other reserves)',
                    null,
                    null,
                    sc(cr),
                    null,
                    null,
                  ],
                  total: true,
                },
              ]),
        ],
        footnote: inv.length
          ? 'Movement from the comparative is the translation difference (goodwill is fixed in the parent’s currency).'
          : 'No investments eliminated at this level.',
      };
    }
    case 'NCI': {
      const nci = d.entries.filter((e) => e.type === 'NCI');
      const share = (e: EliminationEntry, f: string) =>
        e.lines.filter((l) => l.fsliCode === f).reduce((s, l) => s.plus(l.amount), new Decimal(0));
      return {
        columns: [
          { label: 'Partly owned subsidiary', numeric: false },
          { label: 'NCI %', numeric: true },
          { label: 'Share capital', numeric: true },
          { label: 'Premium', numeric: true },
          { label: 'Retained earnings', numeric: true },
          { label: 'Other reserves', numeric: true },
          { label: 'FCTR', numeric: true },
          { label: 'Share of profit', numeric: true },
          { label: 'Total NCI', numeric: true },
        ],
        rows: nci.map((e) => {
          const m = d.members.find((x) => x.code === e.entities[0]);
          return {
            cells: [
              e.title.replace(/^Non-controlling interests in /, ''),
              m?.heldByParentPct ? `${new Decimal(100).minus(m.heldByParentPct).toFixed()}%` : '–',
              sc(share(e, 'SHARE_CAP')),
              sc(share(e, 'SEC_PREM')),
              sc(share(e, 'RETAINED')),
              sc(share(e, 'OTH_RES')),
              sc(share(e, 'FCTR')),
              sc(e.nciProfit ?? '0'),
              sc(share(e, 'NCI').negated()),
            ],
          };
        }),
        footnote: nci.length
          ? 'NCI measured at the proportionate share of the subsidiary’s net assets.'
          : 'No partly owned subsidiaries at this level.',
      };
    }
    case 'IC_SUMMARY': {
      const pairs = new Map<string, { bal: Decimal; pnl: Decimal; diff: Decimal; ids: string[] }>();
      for (const e of d.entries.filter((x) => x.type === 'IC_BALANCE' || x.type === 'IC_PNL')) {
        const k = e.entities.join(' ↔ ');
        const p = pairs.get(k) ?? {
          bal: new Decimal(0),
          pnl: new Decimal(0),
          diff: new Decimal(0),
          ids: [],
        };
        const dr = e.lines
          .filter(
            (l) =>
              l.fsliCode !== 'IC_DIFF' &&
              l.fsliCode !== 'IC_DIFF_PL' &&
              l.fsliCode !== 'FCTR' &&
              new Decimal(l.amount).isPositive(),
          )
          .reduce((s, l) => s.plus(l.amount), new Decimal(0));
        if (e.type === 'IC_BALANCE') p.bal = p.bal.plus(dr);
        else p.pnl = p.pnl.plus(dr);
        p.diff = p.diff.plus(
          e.lines
            .filter((l) => l.fsliCode === 'IC_DIFF' || l.fsliCode === 'IC_DIFF_PL')
            .reduce((s, l) => s.plus(l.amount), new Decimal(0))
            .abs(),
        );
        if (e.flagged) p.ids.push(e.id);
        pairs.set(k, p);
      }
      return {
        columns: [
          { label: 'Pair', numeric: false },
          { label: 'Balances eliminated', numeric: true },
          { label: 'Revenue / charges eliminated', numeric: true },
          { label: 'In IC suspense', numeric: true },
          { label: 'Explanation', numeric: false },
        ],
        rows: [...pairs].map(([k, p]) => ({
          cells: [
            k,
            sc(p.bal),
            sc(p.pnl),
            sc(p.diff),
            p.ids
              .map((id) => d.explanations.find((x) => x.entryId === id)?.text ?? 'Not explained')
              .join(' ') || '–',
          ],
        })),
        footnote: pairs.size ? null : 'No intercompany pairs at this level.',
      };
    }
    case 'FCTR': {
      const cur = fctrSplit(d.consolidated, d.entries);
      const comp =
        d.comparative.consolidated && d.comparative.immediatelyPreceding
          ? fctrSplit(d.comparative.consolidated, d.comparative.entries)
          : null;
      // Shown as a reserve: a credit balance is positive.
      const show = (v: string) => sc(new Decimal(v).negated());
      const move = (k: 'owners' | 'nci' | 'total') =>
        comp ? sc(new Decimal(comp[k]).minus(cur[k])) : '–';
      return {
        columns: [
          { label: '', numeric: false },
          { label: 'Owners of the parent', numeric: true },
          { label: 'Non-controlling interests', numeric: true },
          { label: 'Total', numeric: true },
        ],
        rows: [
          {
            cells: [
              `Opening (${d.comparative.periodLabel || 'comparative'})`,
              comp ? show(comp.owners) : '–',
              comp ? show(comp.nci) : '–',
              comp ? show(comp.total) : '–',
            ],
          },
          { cells: ['Movement for the period', move('owners'), move('nci'), move('total')] },
          { cells: ['Closing', show(cur.owners), show(cur.nci), show(cur.total)], total: true },
        ],
        footnote: comp
          ? null
          : 'Opening and movement need the immediately preceding period as the comparative.',
      };
    }
  }
}

/** The line split by member, eliminations and consolidated (current period). */
function breakdown(d: LevelData, lines: FormatLine[], lineKeys: string[], unit: StatementUnit) {
  const cols = levelColumns(d, true).filter((c) => c.kind !== 'COMPARATIVE');
  const value = (amounts: Record<string, string> | null) => {
    if (!amounts) return null;
    let t = new Decimal(0);
    for (const st of ['BS', 'PL'] as const) {
      const rows = buildStatement(lines, st, amounts, d.fslis).rows;
      for (const k of lineKeys) {
        const [s, key] = k.split(':');
        if (s !== st) continue;
        t = t.plus(rows.find((r) => r.key === key)?.value ?? '0');
      }
    }
    return scaleAmount(t.toFixed(2), unit);
  };
  return {
    columns: cols.map((c) => ({ code: c.code, label: c.label })),
    current: Object.fromEntries(cols.map((c) => [c.code, value(c.amounts)])),
  };
}

/** The notes scope of a level. */
export function levelNotesScope(input: {
  d: LevelData;
  lines: FormatLine[];
  parent: {
    legalName: string;
    country: string;
    functionalCurrency: string;
    gaap: string;
    erp: string;
  };
  entities: GeneratedContext['entities'];
  acquisitions: GeneratedContext['acquisitions'];
  prior: NotesScope['prior'];
  changed: NotesScope['changed'];
}): NotesScope {
  const { d } = input;
  const end = fromDbDate(d.task.period.endDate);
  const span =
    d.task.period.type === 'MONTHLY'
      ? 'month'
      : d.task.period.type === 'QUARTERLY'
        ? 'quarter'
        : 'year';
  const subs = d.members
    .filter((m) => m.code !== d.level.parentEntityCode)
    .map((m) => input.entities.get(m.code)?.legalName ?? m.shortName);
  const task: NotesTask = d.task;
  const ctx: GeneratedContext = {
    d,
    lines: input.lines,
    entities: input.entities,
    acquisitions: input.acquisitions,
  };
  return {
    task,
    key: `L${d.level.level}`,
    appliesTo: 'CFS',
    header: {
      code: `L${d.level.level}`,
      legalName: `${input.parent.legalName} — consolidated (Level ${d.level.level} ${d.level.name})`,
      shortName: d.level.name,
      functionalCurrency: d.level.currency,
      itemStatus: d.level.status,
    },
    readOnlyReason: d.header.readOnlyReason,
    figures: levelFigures({ ...d, currency: d.level.currency, periodEnd: end }),
    placeholders: {
      legalName: input.parent.legalName,
      country: input.parent.country,
      functionalCurrency: d.level.currency,
      levelCurrency: d.level.currency,
      gaap: input.parent.gaap,
      erp: input.parent.erp,
      subsidiaries: subs.length ? subs.join(', ') : 'none',
      periodLabel: d.task.period.label,
      periodEnd: statementTitle('BS', d.task.period.type, end).replace('Balance sheet as at ', ''),
      periodSpan: span,
    },
    prior: input.prior,
    changed: input.changed,
    generated: (block, unit) => generated(ctx, block, unit),
    breakdown: (lineKeys, unit) => breakdown(d, input.lines, lineKeys, unit),
  };
}
