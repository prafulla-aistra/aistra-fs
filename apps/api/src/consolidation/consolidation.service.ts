import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  addAmounts,
  buildStatement,
  type ConsolMember,
  consolidatedAmounts,
  crossRate,
  Decimal,
  deriveTaskStatus,
  type EliminationEntry,
  eliminationChecks,
  eliminationSummary,
  type FormatFsli,
  type FormatLine,
  generateEliminations,
  type GenerateEliminationsInput,
  type ManualAdjustmentInput as EngineManual,
  memberAmounts,
  type MonthlyRate,
  periodUsdRate,
  type RateBasisCode,
  type TranslationLineInput,
  translateTB,
  validateManualAdjustment,
} from '@finance-close/engine';
import {
  ApiErrorCode,
  AuditAction,
  CFS_LEVEL_STEPS,
  ITEM_STATUS_LABELS,
  Permission,
  type AggregationDto,
  type AggregationRowDto,
  type CfsLevelDto,
  type CfsLevelHeaderDto,
  type CfsLevelStepCode,
  type CfsWorkspaceDto,
  type EliminationEntryDto,
  type EliminationsDto,
  type GroupTreeNode,
  type ItemStatus,
  type ManualAdjustmentInput,
  type ReadinessCheckDto,
  type ReadinessDto,
  type ReadinessMemberDto,
} from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { canonicalJson } from '../common/canonical-json';
import { fromDbDate } from '../common/db-dates';
import { EntitiesService } from '../configuration/entities.service';
import { PrismaService } from '../prisma/prisma.service';
import { inScope, taskInclude, taskVisibleTo } from '../tasks/tasks.service';
import { loadFormatLines, loadFslis } from '../uploads/format-lines';
import type { EntityFigures } from '../uploads/statement-figures';
import { aggregationWorkbook } from './consolidation-export';
import { finalisedSnapshot, monthlyRates } from '../uploads/translation-inputs';

const cfsInclude = { ...taskInclude, consolidationRuns: true } satisfies Prisma.TaskInclude;
export type CfsTask = Prisma.TaskGetPayload<{ include: typeof cfsInclude }>;
export type LevelRow = CfsTask['levels'][number];

const TYPE_LABEL: Record<EliminationEntry['type'], string> = {
  IC_BALANCE: 'Intercompany balances',
  IC_PNL: 'Intercompany revenue / charges',
  INVESTMENT: 'Investment in subsidiary',
  NCI: 'Non-controlling interests',
  MANUAL: 'Manual adjustment',
};

/** One member as the level sees it: its finalised SFS and its figures in the level currency. */
export interface MemberData {
  code: string;
  shortName: string;
  functionalCurrency: string;
  parentCode: string | null;
  heldByParentPct: string | null;
  effectiveGroupPct: string;
  sfs: { status: ItemStatus | 'NONE'; taskNumber: string | null; taskId: string | null };
  snapshotVersion: string | null;
  source: ReadinessMemberDto['source'];
  warnings: string[];
  member: ConsolMember | null;
  /** Account level, in the level currency (for the consolidation notes). */
  accounts: {
    code: string;
    name: string;
    fsliCode: string | null;
    counterpartyCode: string | null;
    amount: string;
  }[];
  /** The finalised SFS snapshot used (to detect a new version after generation). */
  identity: MemberIdentity | null;
}

export interface MemberIdentity {
  code: string;
  taskId: string;
  snapshotId: string;
  version: number | null;
  hash: string | null;
}

const flatten = (
  n: GroupTreeNode | null,
  parent: string | null = null,
): { node: GroupTreeNode; parent: string | null }[] =>
  n ? [{ node: n, parent }, ...n.children.flatMap((c) => flatten(c, n.code))] : [];

/**
 * CFS workspace (page 9): the level path, step 1 Readiness, step 2 Aggregation and step 3
 * Eliminations. Entity data comes only from finalised SFS snapshots; the engine does every
 * calculation (translateTB, generateEliminations, buildStatement).
 */
@Injectable()
export class ConsolidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entities: EntitiesService,
  ) {}

  // ---------------------------------------------------------------------- loading

  private async load(user: AuthUser, taskId: string): Promise<CfsTask> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, include: cfsInclude });
    if (!task || !taskVisibleTo(task, user.entityScope)) throw ApiError.notFound('Task not found.');
    if (task.type !== 'CFS')
      throw ApiError.validation('This step is part of consolidation (CFS) tasks.');
    return task;
  }

  private levelRow(task: CfsTask, level: number): LevelRow {
    const l = task.levels.find((x) => x.level === level);
    if (!l) throw ApiError.notFound(`Level ${level} is not in this task.`);
    return l;
  }

  private period(task: CfsTask) {
    return {
      startDate: fromDbDate(task.period.startDate),
      endDate: fromDbDate(task.period.endDate),
      label: task.period.label,
    };
  }

  /** Newest SFS task entity for the period, per entity. */
  private async sfsStatus(periodId: string, codes: string[]) {
    const rows = await this.prisma.taskEntity.findMany({
      where: { entityCode: { in: codes }, task: { type: 'SFS', periodId } },
      include: { task: { select: { id: true, number: true, createdAt: true } } },
      orderBy: { task: { createdAt: 'desc' } },
    });
    const out = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const cur = out.get(r.entityCode);
      // Prefer a finalised one; otherwise the newest.
      if (!cur || (cur.status !== 'FINALISED' && r.status === 'FINALISED'))
        out.set(r.entityCode, r);
    }
    return out;
  }

  private async previousPeriod(task: CfsTask) {
    const start = task.period.startDate;
    const dayBefore = new Date(start.getTime() - 24 * 3600 * 1000);
    return this.prisma.period.findFirst({ where: { type: task.period.type, endDate: dayBefore } });
  }

  /** Availability of each level: members' SFS finalised and every lower level finalised. */
  private async availability(task: CfsTask) {
    const codes = [...new Set(task.levels.flatMap((l) => l.members))];
    const sfs = await this.sfsStatus(task.periodId, codes);
    const names = new Map(
      (await this.prisma.entity.findMany({ where: { code: { in: codes } } })).map((e) => [
        e.code,
        e.shortName,
      ]),
    );
    const out = new Map<number, string[]>();
    for (const l of [...task.levels].sort((a, b) => a.level - b.level)) {
      const waiting: string[] = [];
      for (const m of l.members) {
        const s = sfs.get(m);
        if (!s) waiting.push(`${m} ${names.get(m) ?? ''}: no SFS task for ${task.period.label}.`);
        else if (s.status !== 'FINALISED')
          waiting.push(
            `${m} ${names.get(m) ?? ''}: SFS ${ITEM_STATUS_LABELS[s.status].toLowerCase()} in ${s.task.number} (must be finalised).`,
          );
      }
      for (const lower of task.levels.filter((x) => x.level < l.level && x.status !== 'FINALISED'))
        waiting.push(`Level ${lower.level} ${lower.name} must be finalised first.`);
      out.set(l.level, waiting);
    }
    return { waiting: out, sfs };
  }

  private header(user: AuthUser, task: CfsTask, l: LevelRow, waiting: string[]): CfsLevelHeaderDto {
    const reason =
      deriveTaskStatus(task.levels.map((x) => x.status)) === 'DONE'
        ? 'This task is done and locked.'
        : l.status === 'FINALISED'
          ? 'This level is finalised — read-only.'
          : l.status === 'IN_REVIEW'
            ? 'This level is submitted for review — read-only.'
            : !user.permissions.has(Permission.CfsPrepare)
              ? 'You do not have permission to prepare consolidation (CFS_PREPARE).'
              : l.members.some((m) => !inScope(user.entityScope, m))
                ? 'Consolidation covers entities outside your scope.'
                : waiting.length > 0
                  ? 'The level is not available yet.'
                  : null;
    return {
      taskId: task.id,
      taskNumber: task.number,
      periodLabel: task.period.label,
      level: l.level,
      name: l.name,
      currency: l.currency,
      status: l.status,
      currentStep: l.currentStep,
      available: waiting.length === 0,
      waitingFor: waiting,
      editable: reason === null,
      readOnlyReason: reason,
    };
  }

  private assertEditable(h: CfsLevelHeaderDto) {
    if (!h.available)
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.Conflict,
        `Level ${h.level} ${h.name} is not available yet: ${h.waitingFor.join(' ')}`,
      );
    if (!h.editable) {
      if (h.readOnlyReason?.startsWith('You do not have'))
        throw ApiError.notAllowed(h.readOnlyReason);
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.Conflict,
        h.readOnlyReason ?? 'Read-only.',
      );
    }
  }

  // ---------------------------------------------------------------------- workspace

  async workspace(user: AuthUser, taskId: string): Promise<CfsWorkspaceDto> {
    const task = await this.load(user, taskId);
    const { waiting } = await this.availability(task);
    const names = new Map((await this.prisma.entity.findMany()).map((e) => [e.code, e.shortName]));
    const status = deriveTaskStatus(task.levels.map((l) => l.status));
    const levels: CfsLevelDto[] = [...task.levels]
      .sort((a, b) => a.level - b.level)
      .map((l) => ({
        level: l.level,
        name: l.name,
        parentCode: l.parentEntityCode,
        currency: l.currency,
        memberCount: l.members.length,
        members: l.members.map((code) => ({ code, shortName: names.get(code) ?? code })),
        status: l.status,
        currentStep: l.currentStep,
        available: (waiting.get(l.level) ?? []).length === 0,
        waitingFor: waiting.get(l.level) ?? [],
      }));
    return {
      task: {
        id: task.id,
        number: task.number,
        type: task.type,
        periodLabel: task.period.label,
        description: task.description,
        dueDate: fromDbDate(task.dueDate),
        status,
        currentStep: task.currentStep,
        locked: status === 'DONE',
      },
      levels,
      canPrepare: user.permissions.has(Permission.CfsPrepare),
    };
  }

  // ---------------------------------------------------------------------- members

  private async members(
    task: CfsTask,
    l: LevelRow,
    sfs: Awaited<ReturnType<ConsolidationService['sfsStatus']>>,
  ): Promise<MemberData[]> {
    const period = this.period(task);
    const structure = await this.entities.groupStructure(period.startDate);
    const tree = new Map(flatten(structure.tree).map((x) => [x.node.code, x]));
    const entities = await this.prisma.entity.findMany({
      where: { code: { in: l.members } },
      include: { historicalRates: true },
    });
    const byCode = new Map(entities.map((e) => [e.code, e]));
    const fslis = await this.prisma.fsli.findMany();
    const fsli = new Map(fslis.map((f) => [f.code, f]));
    const previous = await this.previousPeriod(task);
    const out: MemberData[] = [];
    for (const code of l.members) {
      const e = byCode.get(code)!;
      const t = tree.get(code);
      const s = sfs.get(code);
      const base = {
        code,
        shortName: e.shortName,
        functionalCurrency: e.functionalCurrency,
        parentCode: t?.parent ?? e.parentCode,
        heldByParentPct: t?.node.heldByParentPct ?? e.heldByParentPct?.toString() ?? null,
        effectiveGroupPct: t?.node.effectiveGroupPct ?? '100',
        sfs: {
          status: s?.status ?? ('NONE' as const),
          taskNumber: s?.task.number ?? null,
          taskId: s?.task.id ?? null,
        },
      };
      const snap =
        s?.status === 'FINALISED'
          ? await this.prisma.statementSnapshot.findUnique({
              where: { taskId_entityCode: { taskId: s.taskId, entityCode: code } },
            })
          : null;
      const final =
        s?.status === 'FINALISED'
          ? await this.prisma.finalSnapshot.findFirst({
              where: { taskId: s.taskId, entityCode: code, state: 'FINAL' },
              orderBy: { version: 'desc' },
            })
          : null;
      const snapshotVersion = final
        ? `v${final.version}`
        : snap
          ? snap.source === 'SEED'
            ? 'Seeded (demo)'
            : 'Finalised'
          : null;
      if (!snap) {
        out.push({
          ...base,
          snapshotVersion,
          source: {
            kind: 'MISSING',
            text: 'No finalised SFS snapshot for the period.',
            warning: null,
          },
          warnings: [],
          member: null,
          accounts: [],
          identity: null,
        });
        continue;
      }
      const identity: MemberIdentity = {
        code,
        taskId: snap.taskId,
        snapshotId: snap.id,
        version: final?.version ?? null,
        hash: final?.hash ?? null,
      };
      const figures = snap.figures as unknown as EntityFigures;
      const functional =
        figures.currencies.find((c) => c.currency === e.functionalCurrency) ??
        figures.currencies[0]!;
      const inLevel = figures.currencies.find((c) => c.currency === l.currency);
      const toMember = (
        accounts: {
          code: string;
          name: string;
          fsliCode: string | null;
          counterpartyCode: string | null;
          amount: string;
        }[],
        fctr: string | null,
      ): ConsolMember & { all: MemberData['accounts'] } => ({
        all: accounts.map((a) => ({
          code: a.code,
          name: a.name,
          fsliCode: a.fsliCode,
          counterpartyCode: a.counterpartyCode,
          amount: a.amount,
        })),
        code,
        parentCode: base.parentCode,
        heldByParentPct: base.heldByParentPct,
        functionalCurrency: e.functionalCurrency,
        accounts: accounts
          .filter((a) => a.fsliCode)
          .map((a) => ({
            fsliCode: a.fsliCode!,
            counterpartyCode: a.counterpartyCode,
            amount: a.amount,
          })),
        fctr,
      });
      if (e.functionalCurrency === l.currency) {
        out.push({
          ...base,
          snapshotVersion,
          source: {
            kind: 'SAME_CURRENCY',
            text: `In ${l.currency} (the entity's functional currency).`,
            warning: null,
          },
          warnings: [],
          ...this.split(toMember(functional.current.accounts, null)),
          identity,
        });
        continue;
      }
      if (inLevel && inLevel.current.status === 'OK') {
        out.push({
          ...base,
          snapshotVersion,
          source: { kind: 'SNAPSHOT', text: 'From finalised SFS', warning: null },
          warnings: inLevel.current.warnings,
          ...this.split(toMember(inLevel.current.accounts, inLevel.current.fctr)),
          identity,
        });
        continue;
      }
      // Computed: the snapshot's mapped TB translated into the level currency (same rules).
      const overrides = new Map<string, string | null>(
        (
          (final?.data as { mapping?: { code: string; rateBasisOverride: string | null }[] } | null)
            ?.mapping ?? []
        ).map((m) => [m.code, m.rateBasisOverride]),
      );
      const lines: TranslationLineInput[] = functional.current.accounts.map((a) => {
        const f = a.fsliCode ? fsli.get(a.fsliCode) : undefined;
        return {
          code: a.code,
          name: a.name,
          fsliCode: f?.code ?? null,
          fsliClass: f?.class ?? null,
          statement: f?.statement ?? null,
          fsliRateBasis: (f?.rateBasis ?? null) as RateBasisCode | null,
          rateBasisOverride: (overrides.get(a.code) ?? null) as RateBasisCode | null,
          counterpartyCode: a.counterpartyCode,
          amount: a.amount,
        };
      });
      const rates = await monthlyRates(this.prisma, [e.functionalCurrency, l.currency], period);
      const prior = await finalisedSnapshot(this.prisma, code, l.currency, previous?.id ?? null);
      const rf = (s?.rollForward as { status?: string } | null)?.status === 'PASS';
      const r = translateTB({
        functionalCurrency: e.functionalCurrency,
        targetCurrency: l.currency,
        period,
        rates,
        historicalRate:
          e.historicalRates.find((h) => h.targetCurrency === l.currency)?.rate.toString() ?? null,
        lines,
        prior: prior
          ? {
              periodLabel: previous!.label,
              retained: prior.retained.toFixed(2),
              profit: prior.profit.toFixed(2),
            }
          : null,
        priorPeriodLabel: previous?.label ?? 'the previous period',
        rollForwardPassed: rf,
      });
      const warning = `Computed from snapshot (${l.currency} is not one of ${code}'s translated currencies).`;
      if (r.status !== 'OK') {
        out.push({
          ...base,
          snapshotVersion,
          source: {
            kind: 'MISSING',
            text: `Cannot translate into ${l.currency}: ${r.failures.join(' ')}`,
            warning,
          },
          warnings: [],
          member: null,
          accounts: [],
          identity,
        });
        continue;
      }
      out.push({
        ...base,
        snapshotVersion,
        source: {
          kind: 'COMPUTED',
          text: "Computed from snapshot (level currency not in the entity's translated currencies)",
          warning,
        },
        identity,
        warnings: r.warnings,
        ...this.split(
          toMember(
            r.lines.map((x) => ({
              code: x.code,
              name: x.name,
              fsliCode: x.fsliCode,
              counterpartyCode: lines.find((y) => y.code === x.code)?.counterpartyCode ?? null,
              amount: x.translated,
            })),
            r.fctr,
          ),
        ),
      });
    }
    return out;
  }

  private split(
    m: ConsolMember & { all: MemberData['accounts'] },
  ): Pick<MemberData, 'member' | 'accounts'> {
    const { all, ...member } = m;
    return { member, accounts: all };
  }

  /** Period rates into the level currency, full precision (engine), per functional currency. */
  private async levelRates(task: CfsTask, l: LevelRow, currencies: string[]) {
    const period = this.period(task);
    const all = [...new Set([...currencies, l.currency])];
    const monthly: MonthlyRate[] = await monthlyRates(this.prisma, all, period);
    const full = (from: string, kind: 'closing' | 'average') => {
      if (from === l.currency) return '1';
      const a = periodUsdRate(monthly, period, from, kind).value;
      const b = periodUsdRate(monthly, period, l.currency, kind).value;
      return a && b ? b.dividedBy(a).toString() : undefined;
    };
    const closing: Record<string, string> = {};
    const average: Record<string, string> = {};
    for (const c of all) {
      const x = full(c, 'closing');
      const y = full(c, 'average');
      if (x) closing[c] = x;
      if (y) average[c] = y;
    }
    return { monthly, closing, average, period };
  }

  // ---------------------------------------------------------------------- step 1

  async readiness(user: AuthUser, taskId: string, level: number): Promise<ReadinessDto> {
    const task = await this.load(user, taskId);
    const l = this.levelRow(task, level);
    const { waiting, sfs } = await this.availability(task);
    const h = this.header(user, task, l, waiting.get(level) ?? []);
    const members = await this.members(task, l, sfs);
    const previous = await this.previousPeriod(task);
    const prevSfs = previous ? await this.sfsStatus(previous.id, l.members) : new Map();
    const functionals = [...new Set(members.map((m) => m.functionalCurrency))].filter(
      (c) => c !== l.currency,
    );
    const { monthly, period } = await this.levelRates(task, l, functionals);
    const rates = functionals.map((c) => {
      const o = crossRate(monthly, period, c, l.currency, 'opening');
      const cl = crossRate(monthly, period, c, l.currency, 'closing');
      const a = crossRate(monthly, period, c, l.currency, 'average');
      return {
        currency: c,
        opening: o.value,
        closing: cl.value,
        average: a.value,
        formula: cl.formula,
        missing: [...new Set([...o.missing, ...cl.missing, ...a.missing])],
      };
    });

    const checks: ReadinessCheckDto[] = [];
    // Intercompany pairs within the level.
    const pairs = await this.prisma.intercompanyPair.findMany();
    const marked = new Map(pairs.map((p) => [`${p.entityA}|${p.entityB}`, p]));
    const icDetails: string[] = [];
    let icStatus: ReadinessCheckDto['status'] = 'OK';
    const seen = new Set<string>();
    for (const m of members)
      for (const a of m.member?.accounts ?? []) {
        if (
          !a.counterpartyCode ||
          !l.members.includes(a.counterpartyCode) ||
          !['IC_REC', 'IC_PAY', 'IC_REV', 'IC_EXP'].includes(a.fsliCode)
        )
          continue;
        const [x, y] = [m.code, a.counterpartyCode].sort() as [string, string];
        const k = `${x}|${y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const p = marked.get(k);
        if (!p) {
          icStatus = 'MISSING';
          icDetails.push(
            `${x} ↔ ${y} has intercompany balances but is not marked (Configuration → Intercompany pairs).`,
          );
        } else {
          if (p.toBeConfirmed && icStatus === 'OK') icStatus = 'WARNING';
          icDetails.push(
            `${x} ↔ ${y} marked, tolerance ${p.tolerance.toFixed(2)}${p.toBeConfirmed ? ' (to be confirmed)' : ''}.`,
          );
        }
      }
    if (icDetails.length === 0) icDetails.push('No intercompany balances between members.');
    checks.push({
      code: 'IC_PAIRS',
      label: 'Intercompany pairs marked',
      status: icStatus,
      details: icDetails,
    });

    // Acquisitions register and acquisition-date rates.
    const levelGaap =
      (
        await this.prisma.entity.findUnique({
          where: { code: l.parentEntityCode },
          select: { gaap: true },
        })
      )?.gaap ?? null;
    const subs = members.filter(
      (m) => m.code !== l.parentEntityCode && m.parentCode && l.members.includes(m.parentCode),
    );
    const acqs = await this.prisma.acquisition.findMany({
      where: { subsidiaryCode: { in: subs.map((s) => s.code) } },
      include: { rates: true },
    });
    const acqDetails: string[] = [];
    const rateDetails: string[] = [];
    let acqStatus: ReadinessCheckDto['status'] = 'OK';
    let rateStatus: ReadinessCheckDto['status'] = 'OK';
    const worse = (a: ReadinessCheckDto['status'], b: ReadinessCheckDto['status']) =>
      a === 'MISSING' || b === 'MISSING'
        ? 'MISSING'
        : a === 'WARNING' || b === 'WARNING'
          ? 'WARNING'
          : 'OK';
    for (const s of subs) {
      const rows = acqs.filter((a) => a.subsidiaryCode === s.code && a.parentCode === s.parentCode);
      const parent = members.find((m) => m.code === s.parentCode)!;
      if (rows.length === 0) {
        acqStatus = 'MISSING';
        acqDetails.push(`${s.code} (held by ${s.parentCode}): no acquisitions register row.`);
        continue;
      }
      const tbc = rows.some((r) => r.toBeConfirmed);
      if (tbc) acqStatus = worse(acqStatus, 'WARNING');
      const pct = rows.reduce((t, r) => t.plus(r.pctAcquired.toString()), new Decimal('0'));
      if (pct.lessThan(100)) {
        const nci = nciMethod(rows, levelGaap);
        if (nci.nciMeasurement === 'FAIR_VALUE' && nci.nciFairValue === null) {
          acqStatus = 'MISSING';
          acqDetails.push(
            `${s.code}: NCI is measured at fair value${nci.byDefault ? ` (default for ${levelGaap === 'US_GAAP' ? 'US GAAP' : levelGaap})` : ''} but no NCI fair value at the acquisition date is entered.`,
          );
        } else
          acqDetails.push(
            `${s.code}: NCI ${nci.nciMeasurement === 'FAIR_VALUE' ? 'at fair value (full goodwill)' : 'at the proportionate share of net assets'}${nci.byDefault ? ' — default by the level parent’s GAAP, to be confirmed' : ''}.`,
          );
      }
      acqDetails.push(
        `${s.code} (held by ${s.parentCode}): ${rows.length} step(s), ${rows.reduce((t, r) => t.plus(r.pctAcquired.toString()), new Decimal('0')).toFixed()}% acquired${tbc ? ' — to be confirmed' : ''}.`,
      );
      for (const [cur, why] of [
        [parent.functionalCurrency, `parent ${parent.code}'s currency`],
        [l.currency, `level currency`],
      ] as const) {
        if (cur === s.functionalCurrency) continue;
        for (const r of rows) {
          const rate = r.rates.find((x) => x.currency === cur);
          if (!rate) {
            rateStatus = 'MISSING';
            rateDetails.push(
              `${s.code} ${fromDbDate(r.acquiredOn)}: no acquisition-date rate ${s.functionalCurrency} → ${cur} (${why}).`,
            );
          } else {
            if (rate.toBeConfirmed) rateStatus = worse(rateStatus, 'WARNING');
            rateDetails.push(
              `${s.code} ${fromDbDate(r.acquiredOn)}: ${s.functionalCurrency} → ${cur} ${rate.rate.toFixed(10)}${rate.toBeConfirmed ? ' (to be confirmed)' : ''}.`,
            );
          }
        }
      }
    }
    if (subs.length === 0) acqDetails.push('No subsidiaries held within this level.');
    checks.push({
      code: 'ACQUISITIONS',
      label: 'Acquisitions register rows for each subsidiary',
      status: acqStatus,
      details: acqDetails,
    });
    checks.push({
      code: 'ACQUISITION_RATES',
      label: `Acquisition-date rates into ${l.currency}`,
      status: rateStatus,
      details: rateDetails.length ? rateDetails : ['None needed.'],
    });

    // Historical rates for members translated here (computed).
    const hist = await this.prisma.entityHistoricalRate.findMany({
      where: { entityCode: { in: l.members }, targetCurrency: l.currency },
    });
    const histDetails: string[] = [];
    let histStatus: ReadinessCheckDto['status'] = 'OK';
    for (const m of members.filter((x) => x.functionalCurrency !== l.currency)) {
      const r = hist.find((x) => x.entityCode === m.code);
      if (!r) {
        histStatus = worse(histStatus, m.source.kind === 'COMPUTED' ? 'WARNING' : 'OK');
        histDetails.push(
          `${m.code}: no historical rate ${m.functionalCurrency} → ${l.currency}${m.source.kind === 'COMPUTED' ? ' (share capital at the opening rate)' : ''}.`,
        );
      } else {
        if (r.toBeConfirmed) histStatus = worse(histStatus, 'WARNING');
        histDetails.push(
          `${m.code}: ${m.functionalCurrency} → ${l.currency} ${r.rate.toFixed(10)}${r.toBeConfirmed ? ' (to be confirmed)' : ''}.`,
        );
      }
    }
    checks.push({
      code: 'HISTORICAL_RATES',
      label: `Historical rates into ${l.currency}`,
      status: histStatus,
      details: histDetails.length ? histDetails : ['Every member reports in the level currency.'],
    });
    const missingRates = rates.flatMap((r) => r.missing);
    checks.push({
      code: 'RATES',
      label: `Exchange rates into ${l.currency} for ${task.period.label}`,
      status: missingRates.length ? 'MISSING' : 'OK',
      details: missingRates.length
        ? missingRates.map((m) => `Missing: ${m}.`)
        : [`${rates.length} currenc${rates.length === 1 ? 'y' : 'ies'} complete.`],
    });

    const options = (
      await this.prisma.currency.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } })
    ).map((c) => c.code);
    const parent = await this.prisma.entity.findUniqueOrThrow({
      where: { code: l.parentEntityCode },
      include: { levelCurrency: true },
    });
    const run = task.consolidationRuns.find((r) => r.level === level);
    const manualCount = await this.prisma.consolidationAdjustment.count({
      where: { taskId, level },
    });
    const blocked = [
      ...h.waitingFor,
      ...members
        .filter((m) => m.source.kind === 'MISSING')
        .map((m) => `${m.code}: ${m.source.text}`),
      ...missingRates.map((m) => `Missing rate: ${m}.`),
    ];
    return {
      level: h,
      currency: {
        current: l.currency,
        configured: parent.levelCurrency?.currency ?? parent.reportingCurrency,
        options,
        eliminationsGenerated: Boolean(run),
        canChange: h.editable && manualCount === 0,
      },
      members: members.map((m) => ({
        code: m.code,
        shortName: m.shortName,
        role: m.code === l.parentEntityCode ? 'Level parent' : `Subsidiary of ${m.parentCode}`,
        heldByParentPct: m.code === l.parentEntityCode ? null : m.heldByParentPct,
        effectiveGroupPct: m.effectiveGroupPct,
        functionalCurrency: m.functionalCurrency,
        sfs: { ...m.sfs, snapshotVersion: m.snapshotVersion },
        source: m.source,
        translationWarnings: m.warnings,
        comparative: {
          periodLabel: previous?.label ?? '—',
          status: prevSfs.get(m.code)?.status ?? 'NONE',
          taskNumber: prevSfs.get(m.code)?.task.number ?? null,
        },
      })),
      rates,
      checks,
      canContinue: blocked.length === 0 && h.editable,
      continueBlockedBy: blocked,
    };
  }

  async setCurrency(
    user: AuthUser,
    taskId: string,
    level: number,
    currency: string,
    ip: string | null,
  ): Promise<ReadinessDto> {
    const task = await this.load(user, taskId);
    const l = this.levelRow(task, level);
    const { waiting } = await this.availability(task);
    this.assertEditable(this.header(user, task, l, waiting.get(level) ?? []));
    if (!(await this.prisma.currency.findFirst({ where: { code: currency, isActive: true } })))
      throw ApiError.validation(`Currency ${currency} is not active.`);
    if (currency === l.currency) return this.readiness(user, taskId, level);
    if ((await this.prisma.consolidationAdjustment.count({ where: { taskId, level } })) > 0)
      throw ApiError.conflict(
        'Manual adjustments are entered in the level currency: delete them before changing the currency.',
      );
    const hadRun = task.consolidationRuns.some((r) => r.level === level);
    await this.prisma.$transaction(async (tx) => {
      await tx.taskLevel.update({
        where: { taskId_level: { taskId, level } },
        data: {
          currency,
          status: l.status === 'NOT_STARTED' ? 'IN_PROGRESS' : l.status,
          lastEditedById: user.id,
        },
      });
      await tx.consolidationRun.deleteMany({ where: { taskId, level } });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.CfsLevelCurrency,
          entityType: 'TASK_LEVEL',
          entityId: `${taskId}:${level}`,
          oldValue: { currency: l.currency },
          newValue: {
            currency,
            task: task.number,
            level: `${level} ${l.name}`,
            eliminationsCleared: hadRun,
          },
          ip,
        },
        tx,
      );
    });
    return this.readiness(user, taskId, level);
  }

  async continue(
    user: AuthUser,
    taskId: string,
    level: number,
    from: CfsLevelStepCode,
    ip: string | null,
  ): Promise<{ currentStep: string }> {
    const task = await this.load(user, taskId);
    const l = this.levelRow(task, level);
    const { waiting } = await this.availability(task);
    this.assertEditable(this.header(user, task, l, waiting.get(level) ?? []));
    if (from === 'READINESS') {
      const r = await this.readiness(user, taskId, level);
      if (!r.canContinue) throw ApiError.validation(`Not ready: ${r.continueBlockedBy.join(' ')}`);
    } else if (from === 'AGGREGATION') {
      const a = await this.aggregation(user, taskId, level);
      const bad = a.balances.filter((b) => !b.balanced || !b.profitTies);
      if (bad.length)
        throw ApiError.validation(`Columns do not balance: ${bad.map((b) => b.code).join(', ')}.`);
    } else if (from === 'ELIMINATIONS') {
      const e = await this.eliminations(user, taskId, level);
      if (!e.generated) throw ApiError.validation('Generate the eliminations first.');
      if (e.stale)
        throw ApiError.validation('The eliminations are out of date: regenerate them first.');
      const failed = e.checks.filter((c) => !c.passed);
      if (failed.length)
        throw ApiError.validation(`Checks fail: ${failed.map((c) => c.label).join('; ')}.`);
    } else throw ApiError.validation('This step comes on the next page.');
    const i = CFS_LEVEL_STEPS.findIndex((s) => s.code === from);
    const next = CFS_LEVEL_STEPS[i + 1]!.code;
    const order = (c: string) => CFS_LEVEL_STEPS.findIndex((s) => s.code === c);
    const step = order(l.currentStep) > order(next) ? l.currentStep : next;
    await this.prisma.$transaction(async (tx) => {
      await tx.taskLevel.update({
        where: { taskId_level: { taskId, level } },
        data: { currentStep: step, status: l.status === 'NOT_STARTED' ? 'IN_PROGRESS' : l.status },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.CfsLevelStep,
          entityType: 'TASK_LEVEL',
          entityId: `${taskId}:${level}`,
          oldValue: { step: l.currentStep, status: l.status },
          newValue: { step, task: task.number, level: `${level} ${l.name}`, completed: from },
          ip,
        },
        tx,
      );
    });
    return { currentStep: step };
  }

  // ---------------------------------------------------------------------- step 2

  private async format(
    task: CfsTask,
  ): Promise<{ name: string; lines: FormatLine[]; fslis: FormatFsli[] }> {
    const { format, lines } = await loadFormatLines(
      this.prisma,
      task.formatCode ?? 'STATUTORY',
      task.formatVersion,
    );
    return { name: format.name, lines, fslis: await loadFslis(this.prisma) };
  }

  private rows(
    lines: FormatLine[],
    statement: 'BS' | 'PL',
    columns: { code: string; amounts: Record<string, string> }[],
    aggregate: Record<string, string>,
    fslis: FormatFsli[],
  ): AggregationRowDto[] {
    const built = columns.map((c) => ({
      code: c.code,
      s: buildStatement(lines, statement, c.amounts, fslis),
    }));
    const agg = buildStatement(lines, statement, aggregate, fslis);
    return agg.rows.map((r, i) => ({
      key: r.key,
      type: r.type,
      label: r.label,
      indent: r.indent,
      role: r.role,
      values: Object.fromEntries(built.map((b) => [b.code, b.s.rows[i]!.value])),
      aggregate: r.value,
    }));
  }

  async aggregation(user: AuthUser, taskId: string, level: number): Promise<AggregationDto> {
    const task = await this.load(user, taskId);
    const l = this.levelRow(task, level);
    const { waiting, sfs } = await this.availability(task);
    const h = this.header(user, task, l, waiting.get(level) ?? []);
    const members = await this.members(task, l, sfs);
    const { name, lines, fslis } = await this.format(task);
    const ok = members.filter((m) => m.member);
    const columns = ok.map((m) => ({ code: m.code, amounts: memberAmounts(m.member!, fslis) }));
    const aggregate = addAmounts(columns.map((c) => c.amounts));
    const balances = [...columns, { code: 'AGGREGATE', amounts: aggregate }].map((c) => {
      const bs = buildStatement(lines, 'BS', c.amounts, fslis);
      const pl = buildStatement(lines, 'PL', c.amounts, fslis);
      return {
        code: c.code,
        balanced: bs.balanceDifference === null || new Decimal(bs.balanceDifference).isZero(),
        difference: bs.balanceDifference ?? '0.00',
        profitTies: pl.profitDifference === null || new Decimal(pl.profitDifference).isZero(),
      };
    });
    const used = new Set(Object.keys(aggregate));
    return {
      level: h,
      currency: l.currency,
      formatName: name,
      entities: ok.map((m) => ({ code: m.code, shortName: m.shortName })),
      balanceSheet: this.rows(lines, 'BS', columns, aggregate, fslis),
      profitAndLoss: this.rows(lines, 'PL', columns, aggregate, fslis),
      fslis: fslis
        .filter((f) => used.has(f.code))
        .map((f) => ({
          code: f.code,
          name: f.name,
          statement: f.statement,
          values: Object.fromEntries(columns.map((c) => [c.code, c.amounts[f.code] ?? '0.00'])),
          aggregate: aggregate[f.code] ?? '0.00',
        })),
      balances,
      missing: members.filter((m) => !m.member).map((m) => `${m.code}: ${m.source.text}`),
    };
  }

  async aggregationWorkbook(user: AuthUser, taskId: string, level: number) {
    const a = await this.aggregation(user, taskId, level);
    const task = await this.load(user, taskId);
    const { lines } = await this.format(task);
    return { a, body: await aggregationWorkbook(a, lines) };
  }

  // ---------------------------------------------------------------------- step 3

  private async engineInput(
    task: CfsTask,
    l: LevelRow,
    members: MemberData[],
  ): Promise<GenerateEliminationsInput> {
    const fslis = await loadFslis(this.prisma);
    const consol = members.map((m) => m.member!).filter(Boolean);
    const { closing, average } = await this.levelRates(task, l, [
      ...new Set([
        ...members.map((m) => m.functionalCurrency),
        ...task.levels.filter((x) => x.level < l.level).map((x) => x.currency),
      ]),
    ]);
    const pairs = await this.prisma.intercompanyPair.findMany();
    const subs = members.filter(
      (m) => m.code !== l.parentEntityCode && m.parentCode && l.members.includes(m.parentCode),
    );
    const acqs = await this.prisma.acquisition.findMany({
      where: { subsidiaryCode: { in: subs.map((s) => s.code) } },
      include: { rates: true },
      orderBy: { acquiredOn: 'asc' },
    });
    const currencyOf = new Map(members.map((m) => [m.code, m.functionalCurrency]));
    const levelParent = await this.prisma.entity.findUnique({
      where: { code: l.parentEntityCode },
      select: { gaap: true },
    });
    const manual = await this.prisma.consolidationAdjustment.findMany({
      where: { taskId: task.id, level: { lte: l.level } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      level: l.level,
      levelCurrency: l.currency,
      levelParentCode: l.parentEntityCode,
      members: consol,
      levels: task.levels.map((x) => ({
        level: x.level,
        parentCode: x.parentEntityCode,
        members: x.members,
      })),
      icPairs: pairs.map((p) => ({
        a: p.entityA,
        b: p.entityB,
        tolerance: p.tolerance.toString(),
      })),
      acquisitions: subs
        .map((s) => ({
          subsidiaryCode: s.code,
          parentCode: s.parentCode!,
          ...nciMethod(
            acqs.filter((a) => a.subsidiaryCode === s.code && a.parentCode === s.parentCode),
            levelParent?.gaap ?? null,
          ),
          steps: acqs
            .filter((a) => a.subsidiaryCode === s.code && a.parentCode === s.parentCode)
            .map((a) => {
              const rateTo = (c: string) =>
                c === s.functionalCurrency
                  ? '1'
                  : (a.rates.find((x) => x.currency === c)?.rate.toString() ?? null);
              return {
                acquiredOn: fromDbDate(a.acquiredOn),
                pct: a.pctAcquired.toString(),
                cost: a.cost.toString(),
                shareCapital: a.shareCapital.toString(),
                premium: a.premium.toString(),
                preAcquisitionReserves: a.preAcquisitionReserves.toString(),
                rateToParent: rateTo(currencyOf.get(s.parentCode!) ?? ''),
                rateToLevel: rateTo(l.currency),
              };
            }),
        }))
        .filter((a) => a.steps.length > 0),
      closingToLevel: closing,
      averageToLevel: average,
      manual: manual
        // Lower levels' adjustments only when their members are all in this level.
        .filter(
          (m) =>
            m.level === l.level ||
            (task.levels.find((x) => x.level === m.level)?.members ?? []).every((c) =>
              l.members.includes(c),
            ),
        )
        .map((m): EngineManual => ({
          id: m.id,
          level: m.level,
          currency: m.currency,
          narration: m.narration,
          reason: m.reason,
          lines: m.lines as unknown as EngineManual['lines'],
          replaces: m.replacesEntryId,
          thisLevelOnly: m.thisLevelOnly,
          sourceRef: m.sourceRef,
        })),
      fslis,
    };
  }

  private async compute(task: CfsTask, l: LevelRow, members: MemberData[]) {
    const input = await this.engineInput(task, l, members);
    const r = generateEliminations(input);
    // Subsidiaries with no register row at all are reported by the engine; keep that issue.
    const subsWithout = members
      .filter(
        (m) => m.code !== l.parentEntityCode && m.parentCode && l.members.includes(m.parentCode),
      )
      .filter((m) => !input.acquisitions.some((a) => a.subsidiaryCode === m.code))
      .map(
        (m) =>
          `Investment in ${m.code} (held by ${m.parentCode}) not eliminated: no acquisitions register row.`,
      );
    return { input, entries: r.entries, issues: [...new Set([...r.issues, ...subsWithout])] };
  }

  async eliminations(user: AuthUser, taskId: string, level: number): Promise<EliminationsDto> {
    const task = await this.load(user, taskId);
    const l = this.levelRow(task, level);
    const { waiting, sfs } = await this.availability(task);
    const h = this.header(user, task, l, waiting.get(level) ?? []);
    const members = await this.members(task, l, sfs);
    const fslis = await loadFslis(this.prisma);
    const fsliName = new Map(fslis.map((f) => [f.code, f.name]));
    const run = await this.prisma.consolidationRun.findUnique({
      where: { taskId_level: { taskId, level } },
    });
    const missing = members.filter((m) => !m.member);
    const consol = members.filter((m) => m.member).map((m) => m.member!);
    let stale = false;
    if (run && missing.length === 0) {
      const fresh = await this.compute(task, l, members);
      stale =
        canonicalJson(fresh.entries) !== canonicalJson(run.entries) || run.currency !== l.currency;
    }
    const entries = (run?.entries as unknown as EliminationEntry[] | undefined) ?? [];
    const membersChanged = run ? this.membersChanged(run.members, members) : [];
    const explanations = await this.prisma.eliminationExplanation.findMany({
      where: { taskId, level },
    });
    const manual = await this.prisma.consolidationAdjustment.findMany({
      where: { taskId, level: { lte: level } },
      include: {},
    });
    // Generated entries a manual entry of this level can replace (as generated, without manual).
    const generatedOnly =
      missing.length === 0
        ? generateEliminations({ ...(await this.engineInput(task, l, members)), manual: [] }).entries
        : entries.filter((e) => e.type !== 'MANUAL');
    const titleOf = new Map(generatedOnly.map((e) => [e.id, e.title]));
    const bfIds = manual.map((m) => m.broughtForwardFromId).filter((x): x is string => !!x);
    const bfTasks = new Map(
      (
        await this.prisma.consolidationAdjustment.findMany({
          where: { id: { in: bfIds } },
          select: { id: true, task: { select: { number: true } } },
        })
      ).map((x) => [x.id, x.task.number]),
    );
    const users = new Map(
      (await this.prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [
        u.id,
        u.name,
      ]),
    );
    const levelName = new Map(task.levels.map((x) => [x.level, x.name]));
    const dto = (e: EliminationEntry): EliminationEntryDto => {
      const m = e.manualId ? manual.find((x) => x.id === e.manualId) : undefined;
      return {
        id: e.id,
        type: e.type,
        typeLabel: TYPE_LABEL[e.type],
        title: e.title,
        originLevel: e.originLevel,
        originText:
          e.originLevel === level
            ? 'This level'
            : `Brought forward from Level ${e.originLevel} ${levelName.get(e.originLevel) ?? ''}`.trim(),
        entities: e.entities,
        lines: e.lines.map((x) => ({
          entityCode: x.entityCode,
          fsliCode: x.fsliCode,
          fsliName: fsliName.get(x.fsliCode) ?? x.fsliCode,
          counterpartyCode: x.counterpartyCode,
          amount: x.amount,
          debit: new Decimal(x.amount).isPositive() ? x.amount : null,
          credit: new Decimal(x.amount).isNegative()
            ? new Decimal(x.amount).negated().toFixed(2)
            : null,
          note: x.note,
        })),
        totalDebit: e.lines
          .filter((x) => new Decimal(x.amount).isPositive())
          .reduce((t, x) => t.plus(x.amount), new Decimal('0'))
          .toFixed(2),
        totalCredit: e.lines
          .filter((x) => new Decimal(x.amount).isNegative())
          .reduce((t, x) => t.minus(x.amount), new Decimal('0'))
          .toFixed(2),
        balanced: e.balanced,
        flagged: e.flagged,
        flags: e.flags,
        calculation: e.calculation,
        difference: e.difference ?? null,
        goodwill: e.goodwill ?? null,
        nciProfit: e.nciProfit ?? null,
        explanation: (() => {
          const x = explanations.find((y) => y.entryId === e.id);
          return x
            ? {
                text: x.text,
                by: users.get(x.updatedById) ?? 'Unknown user',
                at: x.updatedAt.toISOString(),
              }
            : null;
        })(),
        canExplain: e.flagged && (e.type === 'IC_BALANCE' || e.type === 'IC_PNL') && h.editable,
        manual: m
          ? {
              id: m.id,
              reason: m.reason,
              createdBy: users.get(m.createdById) ?? 'Unknown user',
              createdAt: m.createdAt.toISOString(),
              canDelete: m.level === level && h.editable,
              sourceRef: m.sourceRef,
              replaces:
                m.replacesEntryId && m.level === level
                  ? { id: m.replacesEntryId, title: titleOf.get(m.replacesEntryId) ?? m.replacesEntryId }
                  : null,
              thisLevelOnly: m.thisLevelOnly,
              broughtForwardFrom: m.broughtForwardFromId
                ? (bfTasks.get(m.broughtForwardFromId) ?? 'previous month')
                : null,
              ownLevel: m.level === level,
            }
          : null,
      };
    };
    const generateBlockedBy = [
      ...(h.editable ? [] : [h.readOnlyReason ?? 'Read-only.']),
      ...missing.map((m) => `${m.code}: ${m.source.text}`),
    ];
    return {
      level: h,
      currency: l.currency,
      generated: run
        ? { at: run.generatedAt.toISOString(), by: users.get(run.generatedById) ?? 'Unknown user' }
        : null,
      stale,
      membersChanged,
      entries: entries.map(dto),
      issues: (run?.issues as string[] | undefined) ?? [],
      summary: run ? eliminationSummary(entries) : null,
      checks: run && missing.length === 0 ? eliminationChecks(consol, entries, fslis) : [],
      canGenerate: generateBlockedBy.length === 0,
      generateBlockedBy,
      manualOptions: {
        entities: members.map((m) => ({ code: m.code, shortName: m.shortName })),
        fslis: fslis
          .filter((f) => !['PROFIT'].includes(f.code))
          .map((f) => ({ code: f.code, name: f.name, statement: f.statement })),
        replaceable: generatedOnly
          .filter((e) => e.type !== 'NCI')
          .map((e) => ({ id: e.id, title: e.title })),
      },
      bringForward: await this.bringForwardInfo(task, l),
    };
  }

  /** The same level (same parent entity) in the previous month's CFS task, if there is one. */
  private async previousLevel(task: CfsTask, l: LevelRow) {
    if (task.period.type !== 'MONTHLY') return null;
    const prevEnd = new Date(task.period.startDate.getTime() - 86_400_000);
    const prev = await this.prisma.task.findFirst({
      where: { type: 'CFS', period: { type: 'MONTHLY', endDate: prevEnd } },
      include: { levels: true, period: true },
      orderBy: { createdAt: 'desc' },
    });
    const pl = prev?.levels.find((x) => x.parentEntityCode === l.parentEntityCode);
    return prev && pl ? { task: prev, level: pl } : null;
  }

  private async bringForwardInfo(task: CfsTask, l: LevelRow): Promise<EliminationsDto['bringForward']> {
    const p = await this.previousLevel(task, l);
    if (!p) return null;
    const rows = await this.prisma.consolidationAdjustment.findMany({
      where: { taskId: p.task.id, level: p.level.level },
      select: { id: true },
    });
    const brought = await this.prisma.consolidationAdjustment.count({
      where: { taskId: task.id, level: l.level, broughtForwardFromId: { in: rows.map((r) => r.id) } },
    });
    return {
      taskNumber: p.task.number,
      period: p.task.period.label,
      levelStatus: p.level.status,
      available: rows.length,
      alreadyBrought: brought,
    };
  }

  /**
   * Copies the previous month's manual entries of this level (same parent entity) into this
   * task — the starting point the preparer then edits (delete / add). Entries already brought
   * forward are skipped; a different level currency blocks the copy.
   */
  async bringForward(
    user: AuthUser,
    taskId: string,
    level: number,
    ip: string | null,
  ): Promise<EliminationsDto> {
    const task = await this.load(user, taskId);
    const l = this.levelRow(task, level);
    const { waiting, sfs } = await this.availability(task);
    this.assertEditable(this.header(user, task, l, waiting.get(level) ?? []));
    const p = await this.previousLevel(task, l);
    if (!p) throw ApiError.validation('There is no previous month consolidation for this level.');
    if (p.level.currency !== l.currency)
      throw ApiError.validation(
        `The previous month's level is in ${p.level.currency}, this level in ${l.currency}: enter the entries again.`,
      );
    const rows = await this.prisma.consolidationAdjustment.findMany({
      where: { taskId: p.task.id, level: p.level.level },
      orderBy: { createdAt: 'asc' },
    });
    const done = new Set(
      (
        await this.prisma.consolidationAdjustment.findMany({
          where: { taskId, level, broughtForwardFromId: { not: null } },
          select: { broughtForwardFromId: true },
        })
      ).map((x) => x.broughtForwardFromId),
    );
    const todo = rows.filter((r) => !done.has(r.id));
    if (todo.length === 0)
      throw ApiError.validation(`Nothing to bring forward from ${p.task.number}.`);
    const notMembers = todo.filter((r) =>
      (r.lines as unknown as { entityCode: string | null }[]).some(
        (x) => x.entityCode && !l.members.includes(x.entityCode),
      ),
    );
    if (notMembers.length)
      throw ApiError.validation(
        `Not brought forward: ${notMembers.map((r) => `"${r.narration}"`).join(', ')} name entities that are not members of this level.`,
      );
    const members = await this.members(task, l, sfs);
    await this.prisma.$transaction(async (tx) => {
      for (const r of todo) {
        const row = await tx.consolidationAdjustment.create({
          data: {
            taskId,
            level,
            currency: l.currency,
            narration: r.narration,
            reason: r.reason,
            lines: r.lines as Prisma.InputJsonValue,
            sourceRef: r.sourceRef,
            replacesEntryId: r.replacesEntryId,
            thisLevelOnly: r.thisLevelOnly,
            broughtForwardFromId: r.id,
            createdById: user.id,
          },
        });
        await this.audit.record(
          {
            userId: user.id,
            action: AuditAction.ConsolidationAdjustmentBringForward,
            entityType: 'CONSOLIDATION_ADJUSTMENT',
            entityId: row.id,
            oldValue: null,
            newValue: {
              task: task.number,
              level: `${level} ${l.name}`,
              from: `${p.task.number} level ${p.level.level}`,
              fromAdjustment: r.id,
              narration: r.narration,
              lines: r.lines,
            },
            ip,
          },
          tx,
        );
      }
    });
    await this.refreshRun(user, task, l, members);
    return this.eliminations(user, taskId, level);
  }

  private async saveRun(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    task: CfsTask,
    l: LevelRow,
    members: MemberData[],
  ) {
    const r = await this.compute(task, l, members);
    const nciProfit = Object.fromEntries(
      r.entries.filter((e) => e.type === 'NCI').map((e) => [e.entities[0]!, e.nciProfit!]),
    );
    const data = {
      currency: l.currency,
      entries: JSON.parse(JSON.stringify(r.entries)) as Prisma.InputJsonValue,
      issues: r.issues,
      nciProfit,
      members: JSON.parse(
        JSON.stringify(members.map((m) => m.identity).filter(Boolean)),
      ) as Prisma.InputJsonValue,
      generatedById: user.id,
      generatedAt: new Date(),
    };
    await tx.consolidationRun.upsert({
      where: { taskId_level: { taskId: task.id, level: l.level } },
      create: { taskId: task.id, level: l.level, ...data },
      update: data,
    });
    await tx.taskLevel.update({
      where: { taskId_level: { taskId: task.id, level: l.level } },
      data: { lastEditedById: user.id },
    });
    return r;
  }

  async generate(
    user: AuthUser,
    taskId: string,
    level: number,
    ip: string | null,
  ): Promise<EliminationsDto> {
    const task = await this.load(user, taskId);
    const l = this.levelRow(task, level);
    const { waiting, sfs } = await this.availability(task);
    this.assertEditable(this.header(user, task, l, waiting.get(level) ?? []));
    const members = await this.members(task, l, sfs);
    const missing = members.filter((m) => !m.member);
    if (missing.length)
      throw ApiError.validation(
        `Cannot generate: ${missing.map((m) => `${m.code}: ${m.source.text}`).join(' ')}`,
      );
    const before = task.consolidationRuns.find((r) => r.level === level);
    await this.prisma.$transaction(async (tx) => {
      const r = await this.saveRun(tx, user, task, l, members);
      const s = eliminationSummary(r.entries);
      await tx.taskLevel.update({
        where: { taskId_level: { taskId, level } },
        data: { status: l.status === 'NOT_STARTED' ? 'IN_PROGRESS' : l.status },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.EliminationsGenerate,
          entityType: 'TASK_LEVEL',
          entityId: `${taskId}:${level}`,
          oldValue: before
            ? {
                entries: (before.entries as unknown[]).length,
                generatedAt: before.generatedAt.toISOString(),
              }
            : null,
          newValue: {
            task: task.number,
            level: `${level} ${l.name}`,
            currency: l.currency,
            entries: s.entries,
            totalDebit: s.totalDebit,
            totalCredit: s.totalCredit,
            icDifferencesFlagged: s.icDifferencesFlagged,
            goodwill: s.goodwill,
            capitalReserve: s.capitalReserve,
            issues: r.issues,
          },
          ip,
        },
        tx,
      );
    });
    return this.eliminations(user, taskId, level);
  }

  async addManual(
    user: AuthUser,
    taskId: string,
    level: number,
    input: ManualAdjustmentInput,
    ip: string | null,
  ): Promise<EliminationsDto> {
    const task = await this.load(user, taskId);
    const l = this.levelRow(task, level);
    const { waiting, sfs } = await this.availability(task);
    this.assertEditable(this.header(user, task, l, waiting.get(level) ?? []));
    const fslis = new Set((await this.prisma.fsli.findMany()).map((f) => f.code));
    const lines = input.lines.map((x, i) => {
      const dr = x.debit?.trim() ? new Decimal(x.debit) : new Decimal('0');
      const cr = x.credit?.trim() ? new Decimal(x.credit) : new Decimal('0');
      if (!dr.isZero() && !cr.isZero())
        throw ApiError.validation(`Line ${i + 1}: enter a debit or a credit, not both.`);
      if (dr.isNegative() || cr.isNegative())
        throw ApiError.validation(`Line ${i + 1}: amounts are positive (choose debit or credit).`);
      if (!fslis.has(x.fsliCode) || x.fsliCode === 'PROFIT')
        throw ApiError.validation(`Line ${i + 1}: choose an FSLI.`);
      if (x.entityCode && !l.members.includes(x.entityCode))
        throw ApiError.validation(`Line ${i + 1}: ${x.entityCode} is not a member of this level.`);
      if (x.counterpartyCode && !l.members.includes(x.counterpartyCode))
        throw ApiError.validation(
          `Line ${i + 1}: counterparty ${x.counterpartyCode} is not a member of this level.`,
        );
      return {
        entityCode: x.entityCode,
        fsliCode: x.fsliCode,
        ...(x.counterpartyCode ? { counterpartyCode: x.counterpartyCode } : {}),
        amount: dr.minus(cr).toDecimalPlaces(2).toFixed(2),
        ...(x.ref?.trim() ? { ref: x.ref.trim() } : {}),
      };
    });
    const replaces = input.replacesEntryId?.trim() || null;
    if (replaces) {
      const generated = generateEliminations({
        ...(await this.engineInput(task, l, await this.members(task, l, sfs))),
        manual: [],
      }).entries;
      if (!generated.some((e) => e.id === replaces && e.type !== 'NCI'))
        throw ApiError.validation('The entry to replace is not a generated entry of this level.');
    }
    const problems = validateManualAdjustment(lines);
    if (problems.length) throw ApiError.validation(problems.join(' '));
    const members = await this.members(task, l, sfs);
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.consolidationAdjustment.create({
        data: {
          taskId,
          level,
          currency: l.currency,
          narration: input.narration.trim(),
          reason: input.reason.trim(),
          lines,
          sourceRef: input.sourceRef?.trim() || null,
          replacesEntryId: replaces,
          thisLevelOnly: input.thisLevelOnly ?? false,
          createdById: user.id,
        },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.ConsolidationAdjustmentCreate,
          entityType: 'CONSOLIDATION_ADJUSTMENT',
          entityId: row.id,
          oldValue: null,
          newValue: {
            task: task.number,
            level: `${level} ${l.name}`,
            currency: l.currency,
            narration: row.narration,
            reason: row.reason,
            sourceRef: row.sourceRef,
            replaces: row.replacesEntryId,
            thisLevelOnly: row.thisLevelOnly,
            lines,
          },
          ip,
        },
        tx,
      );
    });
    await this.refreshRun(user, task, l, members);
    return this.eliminations(user, taskId, level);
  }

  /** The generated set includes manual adjustments: refresh it (if generated) after a change. */
  private async refreshRun(user: AuthUser, task: CfsTask, l: LevelRow, members: MemberData[]) {
    if (
      !(await this.prisma.consolidationRun.findUnique({
        where: { taskId_level: { taskId: task.id, level: l.level } },
      }))
    )
      return;
    await this.prisma.$transaction((tx) => this.saveRun(tx, user, task, l, members));
  }

  async deleteManual(
    user: AuthUser,
    taskId: string,
    level: number,
    id: string,
    ip: string | null,
  ): Promise<EliminationsDto> {
    const task = await this.load(user, taskId);
    const l = this.levelRow(task, level);
    const { waiting, sfs } = await this.availability(task);
    this.assertEditable(this.header(user, task, l, waiting.get(level) ?? []));
    const row = await this.prisma.consolidationAdjustment.findFirst({
      where: { id, taskId, level },
    });
    if (!row) throw ApiError.notFound('Adjustment not found.');
    const members = await this.members(task, l, sfs);
    await this.prisma.$transaction(async (tx) => {
      await tx.consolidationAdjustment.delete({ where: { id } });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.ConsolidationAdjustmentDelete,
          entityType: 'CONSOLIDATION_ADJUSTMENT',
          entityId: id,
          oldValue: {
            task: task.number,
            level: `${level} ${l.name}`,
            narration: row.narration,
            reason: row.reason,
            sourceRef: row.sourceRef,
            replaces: row.replacesEntryId,
            broughtForwardFrom: row.broughtForwardFromId,
            lines: row.lines,
          },
          newValue: null,
          ip,
        },
        tx,
      );
    });
    await this.refreshRun(user, task, l, members);
    return this.eliminations(user, taskId, level);
  }

  // ---------------------------------------------------------------------- page 10: level data

  /** Members whose SFS snapshot is not the one the eliminations were generated from. */
  membersChanged(stored: Prisma.JsonValue, members: MemberData[]): string[] {
    const ids = Array.isArray(stored) ? (stored as unknown as MemberIdentity[]) : [];
    if (ids.length === 0) return [];
    return members
      .filter((m) => {
        const was = ids.find((x) => x.code === m.code);
        if (!was || !m.identity) return true;
        return (
          was.snapshotId !== m.identity.snapshotId ||
          was.version !== m.identity.version ||
          was.hash !== m.identity.hash
        );
      })
      .map((m) => m.code);
  }

  /** Explain a flagged IC difference (kept across regenerations; required before review). */
  async explain(
    user: AuthUser,
    taskId: string,
    level: number,
    entryId: string,
    text: string,
    ip: string | null,
  ): Promise<EliminationsDto> {
    const task = await this.load(user, taskId);
    const l = this.levelRow(task, level);
    const { waiting } = await this.availability(task);
    this.assertEditable(this.header(user, task, l, waiting.get(level) ?? []));
    const run = await this.prisma.consolidationRun.findUnique({
      where: { taskId_level: { taskId, level } },
    });
    const entry = ((run?.entries as unknown as EliminationEntry[] | undefined) ?? []).find(
      (e) => e.id === entryId,
    );
    if (!entry || !entry.flagged || (entry.type !== 'IC_BALANCE' && entry.type !== 'IC_PNL'))
      throw ApiError.notFound('Flagged intercompany entry not found.');
    const before = await this.prisma.eliminationExplanation.findUnique({
      where: { taskId_level_entryId: { taskId, level, entryId } },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.eliminationExplanation.upsert({
        where: { taskId_level_entryId: { taskId, level, entryId } },
        create: { taskId, level, entryId, text: text.trim(), updatedById: user.id },
        update: { text: text.trim(), updatedById: user.id },
      });
      await tx.taskLevel.update({
        where: { taskId_level: { taskId, level } },
        data: { lastEditedById: user.id },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.EliminationExplain,
          entityType: 'TASK_LEVEL',
          entityId: `${taskId}:${level}`,
          oldValue: before ? { entry: entryId, text: before.text } : null,
          newValue: {
            task: task.number,
            level: `${level} ${l.name}`,
            entry: entryId,
            title: entry.title,
            difference: entry.difference,
            text: text.trim(),
          },
          ip,
        },
        tx,
      );
    });
    return this.eliminations(user, taskId, level);
  }

  private async comparativePeriod(task: CfsTask) {
    if (task.comparativeBasis === 'SAME_PERIOD_LAST_YEAR') {
      const start = new Date(task.period.startDate);
      start.setUTCFullYear(start.getUTCFullYear() - 1);
      return this.prisma.period.findFirst({ where: { type: task.period.type, startDate: start } });
    }
    return this.previousPeriod(task);
  }

  /**
   * The comparative of a level: the finalised snapshot of the same level (same parent) for the
   * comparative period in the same currency; else recomputed from that period's finalised SFS
   * snapshots of all members; else none.
   */
  private async comparativeFor(task: CfsTask, l: LevelRow): Promise<LevelComparative> {
    const prev = await this.comparativePeriod(task);
    const immediatelyPreceding = task.comparativeBasis !== 'SAME_PERIOD_LAST_YEAR';
    const none = (label: string): LevelComparative => ({
      kind: 'NONE',
      label,
      periodLabel: prev?.label ?? '',
      consolidated: null,
      entries: [],
      immediatelyPreceding,
    });
    if (!prev) return none('No comparative period.');
    const cfsPrev = await this.prisma.task.findFirst({
      where: { type: 'CFS', periodId: prev.id },
      include: { levels: true },
      orderBy: { createdAt: 'desc' },
    });
    const lvlPrev = cfsPrev?.levels.find((x) => x.parentEntityCode === l.parentEntityCode);
    if (cfsPrev && lvlPrev?.status === 'FINALISED') {
      const snap = await this.prisma.finalSnapshot.findFirst({
        where: { taskId: cfsPrev.id, entityCode: `L${lvlPrev.level}`, state: 'FINAL' },
        orderBy: { version: 'desc' },
      });
      const d = snap?.data as unknown as LevelSnapshotData | undefined;
      if (snap && d && d.currency === l.currency)
        return {
          kind: 'SNAPSHOT',
          label: `Finalised ${cfsPrev.number} Level ${lvlPrev.level} (v${snap.version})`,
          periodLabel: prev.label,
          consolidated: d.consolidated,
          entries: d.entries,
          immediatelyPreceding,
        };
    }
    const synth = {
      ...task,
      id: cfsPrev?.id ?? '00000000-0000-0000-0000-000000000000',
      period: { ...prev, financialYear: task.period.financialYear },
      periodId: prev.id,
      consolidationRuns: [],
    } as unknown as CfsTask;
    const sfs = await this.sfsStatus(prev.id, l.members);
    const members = await this.members(synth, l, sfs);
    const missing = members.filter((m) => !m.member);
    if (missing.length)
      return none(
        `No comparative: ${missing.map((m) => m.code).join(', ')} not finalised for ${prev.label}.`,
      );
    const { entries } = await this.compute(synth, l, members);
    const fslis = await loadFslis(this.prisma);
    return {
      kind: 'RECOMPUTED',
      label:
        lvlPrev?.status === 'FINALISED'
          ? `Recomputed – no stored ${l.currency} snapshot of the level for ${prev.label}`
          : `Recomputed – level not finalised for ${prev.label}`,
      periodLabel: prev.label,
      consolidated: consolidatedAmounts(
        members.map((m) => m.member!),
        entries,
        fslis,
      ),
      entries,
      immediatelyPreceding,
    };
  }

  /**
   * Everything the level's statements, notes, review and finalisation need. A finalised level is
   * read from its snapshot (immutable); otherwise from the members' finalised SFS snapshots and the
   * generated eliminations.
   */
  async levelData(user: AuthUser, taskId: string, level: number): Promise<LevelData> {
    const task = await this.load(user, taskId);
    const l = this.levelRow(task, level);
    const { waiting, sfs } = await this.availability(task);
    const header = this.header(user, task, l, waiting.get(level) ?? []);
    const fslis = await loadFslis(this.prisma);
    if (l.status === 'FINALISED') {
      const snap = await this.prisma.finalSnapshot.findFirst({
        where: { taskId, entityCode: `L${level}`, state: 'FINAL' },
        orderBy: { version: 'desc' },
      });
      const d = snap?.data as unknown as LevelSnapshotData | undefined;
      if (snap && d)
        return {
          task,
          level: l,
          header,
          fromSnapshot: true,
          snapshot: {
            version: snap.version,
            hash: snap.hash,
            finalisedAt: (snap.finalisedAt ?? snap.createdAt).toISOString(),
          },
          members: d.members,
          entries: d.entries,
          issues: d.issues,
          generated: true,
          generatedAt: d.generatedAt,
          stale: false,
          membersChanged: [],
          consolidated: d.consolidated,
          comparative: d.comparative,
          fslis,
          explanations: d.explanations,
          manual: d.manual,
        };
    }
    const members = await this.members(task, l, sfs);
    const run = await this.prisma.consolidationRun.findUnique({
      where: { taskId_level: { taskId, level } },
    });
    const entries = (run?.entries as unknown as EliminationEntry[] | undefined) ?? [];
    const ok = members.filter((m) => m.member);
    let stale = false;
    if (run && ok.length === members.length) {
      const fresh = await this.compute(task, l, members);
      stale =
        canonicalJson(fresh.entries) !== canonicalJson(run.entries) || run.currency !== l.currency;
    }
    const manual = await this.prisma.consolidationAdjustment.findMany({
      where: { taskId, level: { lte: level } },
      orderBy: { createdAt: 'asc' },
    });
    const explanations = await this.prisma.eliminationExplanation.findMany({
      where: { taskId, level },
    });
    return {
      task,
      level: l,
      header,
      fromSnapshot: false,
      snapshot: null,
      members,
      entries,
      issues: (run?.issues as string[] | undefined) ?? [],
      generated: Boolean(run),
      generatedAt: run?.generatedAt.toISOString() ?? null,
      stale,
      membersChanged: run ? this.membersChanged(run.members, members) : [],
      consolidated: consolidatedAmounts(
        ok.map((m) => m.member!),
        entries,
        fslis,
      ),
      comparative: await this.comparativeFor(task, l),
      fslis,
      explanations: explanations.map((x) => ({ entryId: x.entryId, text: x.text })),
      manual: manual.map((m) => ({
        id: m.id,
        level: m.level,
        currency: m.currency,
        narration: m.narration,
        reason: m.reason,
        createdById: m.createdById,
        createdAt: m.createdAt.toISOString(),
        lines: m.lines as unknown as LevelSnapshotData['manual'][number]['lines'],
        sourceRef: m.sourceRef,
        replaces: m.replacesEntryId,
        thisLevelOnly: m.thisLevelOnly,
      })),
    };
  }

  /** Rates into the level currency, per functional currency of the members (10 dp). */
  async levelRatesFor(d: LevelData) {
    const fns = [...new Set(d.members.map((m) => m.functionalCurrency))].filter(
      (c) => c !== d.level.currency,
    );
    const { monthly, period } = await this.levelRates(d.task, d.level, fns);
    return fns.map((c) => ({
      currency: c,
      opening: crossRate(monthly, period, c, d.level.currency, 'opening').value,
      closing: crossRate(monthly, period, c, d.level.currency, 'closing').value,
      average: crossRate(monthly, period, c, d.level.currency, 'average').value,
      formula: crossRate(monthly, period, c, d.level.currency, 'closing').formula,
    }));
  }

  /** The level's format lines (task format, or another chosen one). */
  async formatLines(task: CfsTask, code?: string) {
    const isTask = !code || code === (task.formatCode ?? 'STATUTORY');
    const { format, version, lines } = await loadFormatLines(
      this.prisma,
      isTask ? (task.formatCode ?? 'STATUTORY') : code,
      isTask ? task.formatVersion : null,
    );
    return { format, version, lines, isTask };
  }

  /** For the level review: the level row, header and the rule key (approvals by level parent). */
  async levelContext(user: AuthUser, taskId: string, level: number) {
    const task = await this.load(user, taskId);
    const l = this.levelRow(task, level);
    const { waiting } = await this.availability(task);
    return { task, level: l, header: this.header(user, task, l, waiting.get(level) ?? []) };
  }
}

/** A level's comparative figures. */
export interface LevelComparative {
  kind: 'SNAPSHOT' | 'RECOMPUTED' | 'NONE';
  label: string;
  periodLabel: string;
  consolidated: Record<string, string> | null;
  entries: EliminationEntry[];
  immediatelyPreceding: boolean;
}

/** What a finalised level stores (final_snapshot.data, key "L<n>"); part of the hash. */
export interface LevelSnapshotData {
  schema: 1;
  level: number;
  name: string;
  currency: string;
  parentCode: string;
  generatedAt: string | null;
  members: MemberData[];
  entries: EliminationEntry[];
  issues: string[];
  aggregate: Record<string, string>;
  consolidated: Record<string, string>;
  comparative: LevelComparative;
  explanations: { entryId: string; text: string }[];
  manual: {
    id: string;
    level: number;
    currency: string;
    narration: string;
    reason: string;
    createdById: string;
    createdAt: string;
    lines: {
      entityCode: string | null;
      fsliCode: string;
      counterpartyCode?: string | null;
      amount: string;
      ref?: string | null;
    }[];
    sourceRef?: string | null;
    replaces?: string | null;
    thisLevelOnly?: boolean;
  }[];
  nci: { entityCode: string; nciProfit: string }[];
  [extra: string]: unknown;
}

export interface LevelData {
  task: CfsTask;
  level: LevelRow;
  header: CfsLevelHeaderDto;
  fromSnapshot: boolean;
  snapshot: { version: number; hash: string | null; finalisedAt: string } | null;
  members: MemberData[];
  entries: EliminationEntry[];
  issues: string[];
  generated: boolean;
  generatedAt: string | null;
  stale: boolean;
  membersChanged: string[];
  consolidated: Record<string, string>;
  comparative: LevelComparative;
  fslis: FormatFsli[];
  explanations: { entryId: string; text: string }[];
  manual: LevelSnapshotData['manual'];
}

/**
 * NCI measurement of a subsidiary (decision round 1, Q8): the register's setting (the first step
 * that has one), else the default by the consolidating level parent's GAAP — fair value (full
 * goodwill) under US GAAP, proportionate otherwise (to be confirmed).
 */
export function nciMethod(
  steps: readonly { nciMeasurement: string | null; nciFairValue: { toString(): string } | null }[],
  levelParentGaap: string | null,
): {
  nciMeasurement: 'PROPORTIONATE' | 'FAIR_VALUE';
  nciFairValue: string | null;
  byDefault: boolean;
} {
  const set = steps.find((x) => x.nciMeasurement);
  const fv = steps.find((x) => x.nciFairValue !== null)?.nciFairValue?.toString() ?? null;
  if (set)
    return {
      nciMeasurement: set.nciMeasurement === 'FAIR_VALUE' ? 'FAIR_VALUE' : 'PROPORTIONATE',
      nciFairValue: fv,
      byDefault: false,
    };
  return {
    nciMeasurement: levelParentGaap === 'US_GAAP' ? 'FAIR_VALUE' : 'PROPORTIONATE',
    nciFairValue: fv,
    byDefault: true,
  };
}
