import {
  buildStatement,
  Decimal,
  displaySign,
  type EliminationEntry,
  equityAttribution,
  fctrMovement,
  fctrSplit,
  type FormatFsli,
  type FormatLine,
  memberAmounts,
  profitAttribution,
  scaleAmount,
  type StatementUnit,
  statementTitle,
} from '@finance-close/engine';
import {
  ROUNDING_NOTE,
  STATEMENT_UNITS,
  type CfsAttributionDto,
  type CfsStatementRowDto,
  type CfsStatementsDto,
  type EntityStatementsDto,
  type StatementUnitCode,
} from '@finance-close/shared';
import { fromDbDate } from '../common/db-dates';
import type { LevelData } from './consolidation.service';

/**
 * Consolidated statements of a level (page 10, step 4): member columns, eliminations brought
 * forward / at this level, consolidated and comparative. Every figure comes from the engine
 * (buildStatement, attribution); this module only arranges columns and units.
 */

export interface Column {
  code: string;
  label: string;
  kind: CfsStatementsDto['columns'][number]['kind'];
  amounts: Record<string, string> | null;
}

/** FSLI totals of a set of elimination entries (PROFIT = their P&L lines). */
export function entryAmounts(
  entries: readonly EliminationEntry[],
  fslis: readonly FormatFsli[],
): Record<string, string> {
  const pl = new Set(fslis.filter((f) => f.statement === 'PL').map((f) => f.code));
  const sums = new Map<string, Decimal>();
  let profit = new Decimal(0);
  for (const e of entries)
    for (const l of e.lines) {
      sums.set(l.fsliCode, (sums.get(l.fsliCode) ?? new Decimal(0)).plus(l.amount));
      if (pl.has(l.fsliCode)) profit = profit.plus(l.amount);
    }
  const out: Record<string, string> = Object.fromEntries(
    [...sums].map(([k, v]) => [k, v.toFixed(2)]),
  );
  out.PROFIT = profit.toFixed(2);
  return out;
}

export function levelColumns(d: LevelData, withEntities: boolean): Column[] {
  const level = d.level.level;
  const cols: Column[] = [];
  if (withEntities) {
    for (const m of d.members)
      if (m.member)
        cols.push({
          code: m.code,
          label: `${m.code} ${m.shortName}`,
          kind: 'ENTITY',
          amounts: memberAmounts(m.member, d.fslis),
        });
    cols.push({
      code: 'ELIM_BF',
      label: 'Eliminations brought forward',
      kind: 'ELIM_BF',
      amounts: entryAmounts(
        d.entries.filter((e) => e.originLevel < level),
        d.fslis,
      ),
    });
    cols.push({
      code: 'ELIM_LEVEL',
      label: 'Eliminations at this level',
      kind: 'ELIM_LEVEL',
      amounts: entryAmounts(
        d.entries.filter((e) => e.originLevel >= level),
        d.fslis,
      ),
    });
  }
  cols.push({
    code: 'CONSOLIDATED',
    label: `Consolidated ${d.task.period.label}`,
    kind: 'CONSOLIDATED',
    amounts: d.consolidated,
  });
  if (d.comparative.kind !== 'NONE')
    cols.push({
      code: 'COMPARATIVE',
      label: `Consolidated ${d.comparative.periodLabel}`,
      kind: 'COMPARATIVE',
      amounts: d.comparative.consolidated,
    });
  return cols;
}

const zero = (v: string | null | undefined) =>
  v === null || v === undefined || new Decimal(v).isZero();

export function buildCfsStatements(
  d: LevelData,
  fmt: {
    code: string;
    name: string;
    lines: FormatLine[];
    options: CfsStatementsDto['options']['formats'];
  },
  opts: { unit: StatementUnitCode; showNil: boolean; showEntities: boolean },
  noteNumbers: Record<string, number>,
  legalName: string,
): CfsStatementsDto {
  const cols = levelColumns(d, opts.showEntities);
  const allCols = levelColumns(d, true);
  const unit = opts.unit as StatementUnit;
  const scale = (v: string | null) => (v === null ? null : scaleAmount(v, unit));
  const end = fromDbDate(d.task.period.endDate);
  const build = (st: 'BS' | 'PL') => {
    const built = cols.map((c) => ({
      c,
      s: c.amounts ? buildStatement(fmt.lines, st, c.amounts, d.fslis) : null,
    }));
    const base = buildStatement(fmt.lines, st, d.consolidated, d.fslis);
    const rows: CfsStatementRowDto[] = base.rows.map((r, i) => ({
      key: r.key,
      type: r.type,
      label: r.label,
      indent: r.indent,
      role: r.role,
      note: noteNumbers[`${st}:${r.key}`] ?? null,
      values: Object.fromEntries(
        built.map(({ c, s }) => [c.code, s ? scale(s.rows[i]!.value) : null]),
      ),
    }));
    // Nil lines: no value in any column (all members included, whatever is shown).
    const allBuilt = allCols.map((c) =>
      c.amounts ? buildStatement(fmt.lines, st, c.amounts, d.fslis) : null,
    );
    const visible = opts.showNil
      ? rows
      : rows.filter(
          (r, i) => r.type !== 'LINE' || allBuilt.some((b) => b && !zero(b.rows[i]!.value)),
        );
    return { rows: visible, consolidated: base };
  };
  const bs = build('BS');
  const pl = build('PL');
  const attrib = (amounts: Record<string, string> | null, entries: readonly EliminationEntry[]) =>
    amounts ? profitAttribution(amounts, entries) : null;
  const scaled = (a: CfsAttributionDto | null): CfsAttributionDto | null =>
    a ? { owners: scale(a.owners)!, nci: scale(a.nci)!, total: scale(a.total)! } : null;
  const cur = attrib(d.consolidated, d.entries)!;
  const comp = attrib(d.comparative.consolidated, d.comparative.entries);
  const equity = (a: Record<string, string> | null) => (a ? equityAttribution(a, d.fslis) : null);

  // Cross-foot: members + eliminations = consolidated, for every FSLI.
  const fsliCodes = new Set<string>();
  for (const c of allCols)
    for (const [k, v] of Object.entries(c.amounts ?? {})) if (!zero(v)) fsliCodes.add(k);
  const parts = allCols.filter(
    (c) => c.kind === 'ENTITY' || c.kind === 'ELIM_BF' || c.kind === 'ELIM_LEVEL',
  );
  const fsliRows = d.fslis
    .filter((f) => fsliCodes.has(f.code))
    .map((f) => {
      const sign = displaySign(f.class);
      const show = (v: string | undefined) =>
        v === undefined ? null : scale(new Decimal(v).times(sign).toFixed(2));
      const sum = parts.reduce((s, c) => s.plus(c.amounts?.[f.code] ?? '0'), new Decimal(0));
      return {
        code: f.code,
        name: f.name,
        statement: f.statement,
        values: Object.fromEntries(
          cols.map((c) => [c.code, show(c.amounts?.[f.code] ?? (c.amounts ? '0' : undefined))]),
        ),
        crossFoots: sum.equals(d.consolidated[f.code] ?? '0'),
      };
    });

  const memo = (() => {
    if (d.comparative.kind === 'NONE' || !d.comparative.consolidated)
      return { available: false, reason: 'No comparative.', movement: null };
    if (!d.comparative.immediatelyPreceding)
      return {
        available: false,
        reason: 'The comparative is not the immediately preceding period.',
        movement: null,
      };
    const m = fctrMovement(
      fctrSplit(d.consolidated, d.entries),
      fctrSplit(d.comparative.consolidated, d.comparative.entries),
    );
    return { available: true, reason: null, movement: scaled(m) };
  })();

  const bsDiff = bs.consolidated.balanceDifference ?? '0.00';
  return {
    level: d.header,
    fromSnapshot: d.fromSnapshot,
    currency: d.level.currency,
    options: { formats: fmt.options, units: STATEMENT_UNITS },
    selection: {
      format: fmt.code,
      formatName: fmt.name,
      unit: opts.unit,
      showNil: opts.showNil,
      showEntities: opts.showEntities,
    },
    header: {
      legalName,
      periodLabel: d.task.period.label,
      comparativeLabel: d.comparative.kind === 'NONE' ? '' : d.comparative.periodLabel,
      comparativeSource: { kind: d.comparative.kind, label: d.comparative.label },
      currencyUnits: `${d.level.currency} · ${STATEMENT_UNITS.find((u) => u.code === opts.unit)?.label ?? 'Actual'}`,
    },
    columns: cols.map((c) => ({ code: c.code, label: c.label, kind: c.kind })),
    balanceSheet: {
      title: `Consolidated ${statementTitle('BS', d.task.period.type, end).replace(/^B/, 'b')}`,
      rows: bs.rows,
      equity: {
        CONSOLIDATED: scaled(equity(d.consolidated)),
        COMPARATIVE: scaled(equity(d.comparative.consolidated)),
      },
    },
    profitAndLoss: {
      title: `Consolidated ${statementTitle('PL', d.task.period.type, end).replace(/^S/, 's')}`,
      rows: pl.rows,
      attribution: { CONSOLIDATED: scaled(cur), COMPARATIVE: scaled(comp) },
    },
    fctrMemo: {
      label:
        'Exchange differences on translation of foreign operations (FCTR movement) — for information',
      ...memo,
    },
    fslis: fsliRows,
    ticks: {
      bsBalances: new Decimal(bsDiff).isZero(),
      bsDifference: bsDiff,
      profitTies:
        pl.consolidated.profitDifference === null ||
        new Decimal(pl.consolidated.profitDifference).isZero(),
      crossFoots: fsliRows.every((r) => r.crossFoots),
      attributionTies: new Decimal(cur.owners).plus(cur.nci).equals(cur.total),
    },
    roundingNote: opts.unit === 'ACTUAL' ? null : ROUNDING_NOTE,
    warnings: [
      ...(d.stale ? ['The eliminations are out of date: regenerate them on step 3.'] : []),
      ...(d.membersChanged.length
        ? [`Member data changed – regenerate eliminations (${d.membersChanged.join(', ')}).`]
        : []),
      ...(d.generated
        ? []
        : ['Eliminations not generated yet: the consolidated column is the aggregate.']),
    ],
  };
}

/** The consolidated statements in the SFS shape, for the Word / PDF full set (reused exporter). */
export function asEntityStatements(s: CfsStatementsDto, legalName: string): EntityStatementsDto {
  const rows = (st: CfsStatementsDto['balanceSheet']['rows']) =>
    st.map((r) => ({
      key: r.key,
      type: r.type,
      label: r.label,
      indent: r.indent,
      role: r.role as EntityStatementsDto['balanceSheet']['rows'][number]['role'],
      note: r.note,
      current: r.values.CONSOLIDATED ?? null,
      comparative: r.values.COMPARATIVE ?? null,
      tie: null,
    }));
  const attribution = (label: string, a: CfsAttributionDto | null, b: CfsAttributionDto | null) => [
    {
      key: `${label}:h`,
      type: 'HEADING' as const,
      label,
      indent: 0,
      role: null,
      note: null,
      current: null,
      comparative: null,
      tie: null,
    },
    {
      key: `${label}:o`,
      type: 'LINE' as const,
      label: 'Owners of the parent',
      indent: 1,
      role: null,
      note: null,
      current: a?.owners ?? null,
      comparative: b?.owners ?? null,
      tie: null,
    },
    {
      key: `${label}:n`,
      type: 'LINE' as const,
      label: 'Non-controlling interests',
      indent: 1,
      role: null,
      note: null,
      current: a?.nci ?? null,
      comparative: b?.nci ?? null,
      tie: null,
    },
  ];
  return {
    entity: {
      code: s.level.taskNumber,
      legalName,
      shortName: s.level.name,
      functionalCurrency: s.currency,
      gaap: '',
      itemStatus: s.level.status,
      currentStep: s.level.currentStep,
    },
    canEdit: false,
    readOnlyReason: null,
    fromSnapshot: s.fromSnapshot,
    hasTb: true,
    options: {
      formats: s.options.formats,
      currencies: [{ code: s.currency, translatedFrom: null, status: 'OK' }],
      units: STATEMENT_UNITS,
    },
    selection: {
      format: s.selection.format,
      formatName: s.selection.formatName,
      formatVersion: 0,
      isTaskFormat: true,
      currency: s.currency,
      unit: s.selection.unit as StatementUnitCode,
      showNil: s.selection.showNil,
    },
    header: {
      legalName,
      formatName: s.selection.formatName,
      currencyUnits: s.header.currencyUnits,
      translatedFrom: null,
      periodLabel: s.header.periodLabel,
      comparativeLabel: s.header.comparativeLabel,
      comparativeSource: {
        kind:
          s.header.comparativeSource.kind === 'SNAPSHOT'
            ? 'FINALISED'
            : s.header.comparativeSource.kind === 'RECOMPUTED'
              ? 'DRAFT'
              : 'NONE',
        label: s.header.comparativeSource.label,
        taskNumber: null,
      },
      noComparative: s.header.comparativeLabel ? null : 'No comparative',
    },
    failures: [],
    balanceSheet: {
      title: s.balanceSheet.title,
      comparativeTitle: null,
      rows: rows(s.balanceSheet.rows),
    },
    profitAndLoss: {
      title: s.profitAndLoss.title,
      comparativeTitle: null,
      rows: [
        ...rows(s.profitAndLoss.rows),
        ...attribution(
          'Profit attributable to:',
          s.profitAndLoss.attribution.CONSOLIDATED ?? null,
          s.profitAndLoss.attribution.COMPARATIVE ?? null,
        ),
      ],
    },
    roundingNote: s.roundingNote,
    warnings: s.warnings,
    footer: `Consolidated financial statements · Level ${s.level.level} ${s.level.name} · ${s.currency}`,
    canContinue: false,
  };
}
