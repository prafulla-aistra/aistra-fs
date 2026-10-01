import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  RateBasisCode,
  StatementAccount,
  TranslateTbResult,
  TranslationLineInput,
} from '@finance-close/engine';
import type { ComparativeSourceKind } from '@finance-close/shared';
import { canonicalJson } from '../common/canonical-json';
import { PrismaService } from '../prisma/prisma.service';
import { ComparativeSourceService } from './comparative-source.service';
import type { StepTask } from './step-access';
import { finalisedSnapshot, mappedLines, monthlyRates, translateLines } from './translation-inputs';
import { TranslationService } from './translation.service';

type TaskEntityRow = StepTask['entities'][number];

export interface RatesUsed {
  opening: string | null;
  closing: string | null;
  average: string | null;
  historical: string | null;
}

/** One period's figures in one currency, account level (signed, debit +). */
export interface PeriodFigures {
  status: 'OK' | 'FAIL';
  failures: string[];
  warnings: string[];
  accounts: StatementAccount[];
  /** Translation balancing figure (translated currencies only). */
  fctr: string | null;
  /** Translated currencies: the account's functional amount, basis and rate. */
  translation:
    | {
        code: string;
        functional: string;
        basisLabel: string;
        rate: string | null;
        translated: string;
      }[]
    | null;
  rates: RatesUsed | null;
}

export interface CurrencyFigures {
  currency: string;
  translatedFrom: string | null;
  current: PeriodFigures;
  comparative: PeriodFigures | null;
}

/**
 * Everything statements and notes need, for every currency of the entity. Stored as
 * statement_snapshot.figures when an entity is finalised, so finalised statements are read,
 * never recalculated.
 */
export interface EntityFigures {
  version: 1;
  functionalCurrency: string;
  comparative: {
    kind: ComparativeSourceKind;
    periodLabel: string;
    periodEndDate: string;
    taskNumber: string | null;
  };
  currencies: CurrencyFigures[];
}

const rateText = (r: TranslateTbResult['rates']): RatesUsed => ({
  opening: r.opening.value,
  closing: r.closing.value,
  average: r.average.value,
  historical: r.historical.value,
});

function fromTranslation(lines: TranslationLineInput[], r: TranslateTbResult): PeriodFigures {
  if (r.status !== 'OK')
    return {
      status: 'FAIL',
      failures: r.failures,
      warnings: r.warnings,
      accounts: [],
      fctr: null,
      translation: null,
      rates: rateText(r.rates),
    };
  const input = new Map(lines.map((l) => [l.code, l]));
  return {
    status: 'OK',
    failures: [],
    warnings: r.warnings,
    accounts: r.lines.map((l) => ({
      code: l.code,
      name: l.name,
      fsliCode: l.fsliCode,
      counterpartyCode: input.get(l.code)?.counterpartyCode ?? null,
      amount: l.translated,
    })),
    fctr: r.fctr,
    translation: r.lines.map((l) => ({
      code: l.code,
      functional: l.functional,
      basisLabel: l.basisLabel,
      rate: l.rate,
      translated: l.translated,
    })),
    rates: rateText(r.rates),
  };
}

const functionalFigures = (lines: TranslationLineInput[]): PeriodFigures => ({
  status: 'OK',
  failures: [],
  warnings: [],
  accounts: lines.map((l) => ({
    code: l.code,
    name: l.name,
    fsliCode: l.fsliCode,
    counterpartyCode: l.counterpartyCode,
    amount: l.amount,
  })),
  fctr: null,
  translation: null,
  rates: null,
});

@Injectable()
export class StatementFiguresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: ComparativeSourceService,
    private readonly translation: TranslationService,
  ) {}

  /** The stored figures of a task entity, if any. */
  async snapshot(taskId: string, entityCode: string): Promise<EntityFigures | null> {
    const s = await this.prisma.statementSnapshot.findUnique({
      where: { taskId_entityCode: { taskId, entityCode } },
    });
    return s ? (s.figures as unknown as EntityFigures) : null;
  }

  /** Comparative TB lines mapped with the entity's current chart of accounts. */
  private async mapVersion(
    entityCode: string,
    lines: { accountCode: string; accountName: string; amount: Prisma.Decimal }[],
  ): Promise<TranslationLineInput[]> {
    const [coa, fslis] = await Promise.all([
      this.prisma.entityAccount.findMany({ where: { entityCode } }),
      this.prisma.fsli.findMany(),
    ]);
    const acct = new Map(coa.map((a) => [a.accountCode, a]));
    const fsli = new Map(fslis.map((f) => [f.code, f]));
    return lines.map((l) => {
      const a = acct.get(l.accountCode);
      const f = a?.fsliCode ? fsli.get(a.fsliCode) : undefined;
      return {
        code: l.accountCode,
        name: l.accountName,
        fsliCode: f?.code ?? null,
        fsliClass: f?.class ?? null,
        statement: f?.statement ?? null,
        fsliRateBasis: (f?.rateBasis ?? null) as RateBasisCode | null,
        rateBasisOverride: (a?.rateBasisOverride ?? null) as RateBasisCode | null,
        counterpartyCode: a?.counterpartyCode ?? null,
        amount: l.amount.toFixed(2),
      };
    });
  }

  /** Builds the figures from the TBs, mapping, rates and finalised translations (null: no TB). */
  async build(task: StepTask, te: TaskEntityRow): Promise<EntityFigures | null> {
    const lines = await mappedLines(this.prisma, task.id, te.entityCode);
    if (!lines) return null;
    const functional = te.entity.functionalCurrency;

    // Current period: functional, and each translated currency as the translation step has it
    // (the stored translation when this task entity's translation was finalised).
    const current = new Map<string, PeriodFigures>([[functional, functionalFigures(lines)]]);
    for (const { target, result } of await this.translation.translate(task, te, lines)) {
      const stored = await this.prisma.translationSnapshot.findUnique({
        where: {
          taskId_entityCode_targetCurrency: {
            taskId: task.id,
            entityCode: te.entityCode,
            targetCurrency: target,
          },
        },
      });
      current.set(
        target,
        fromTranslation(lines, stored ? (stored.result as unknown as TranslateTbResult) : result),
      );
    }

    // Comparative: page 5's source. A finalised comparative is read from its own snapshot
    // (statements, else its finalised translation); otherwise it is mapped with the current
    // chart of accounts and translated with its own period's rates.
    const resolved = await this.sources.resolve(task, te.entityCode);
    const comparative = new Map<string, PeriodFigures>();
    if (resolved.version) {
      const compLines = await this.mapVersion(te.entityCode, resolved.version.lines);
      const stored =
        resolved.kind === 'FINALISED'
          ? await this.snapshot(resolved.version.taskId, te.entityCode)
          : null;
      comparative.set(
        functional,
        stored?.currencies.find((c) => c.currency === functional)?.current ??
          functionalFigures(compLines),
      );
      const period = { ...resolved.period };
      const targets = [...current.keys()].filter((c) => c !== functional);
      const rates = targets.length
        ? await monthlyRates(this.prisma, [functional, ...targets], period)
        : [];
      for (const target of targets) {
        const fromSnapshot = stored?.currencies.find((c) => c.currency === target)?.current;
        if (fromSnapshot) {
          comparative.set(target, fromSnapshot);
          continue;
        }
        const tr =
          resolved.kind === 'FINALISED'
            ? await finalisedSnapshot(this.prisma, te.entityCode, target, resolved.period.id)
            : null;
        if (tr) {
          comparative.set(
            target,
            fromTranslation(compLines, tr.result as unknown as TranslateTbResult),
          );
          continue;
        }
        const h = te.entity.historicalRates.find((r) => r.targetCurrency === target);
        const r = translateLines({
          lines: compLines,
          functionalCurrency: functional,
          target,
          period,
          rates,
          historicalRate: h ? h.rate.toString() : null,
          prior: null,
          priorPeriodLabel: resolved.period.label,
          rollForwardPassed: false,
        });
        const f = fromTranslation(compLines, r);
        f.warnings = [
          `Comparative ${resolved.period.label} is not finalised: translated with its own period's rates; retained earnings at the opening rate.`,
          ...f.warnings,
        ];
        comparative.set(target, f);
      }
    }

    return {
      version: 1,
      functionalCurrency: functional,
      comparative: {
        kind: resolved.kind,
        periodLabel: resolved.period.label,
        periodEndDate: resolved.period.endDate,
        taskNumber: resolved.version?.task.number ?? null,
      },
      currencies: [...current.entries()].map(([currency, cur]) => ({
        currency,
        translatedFrom: currency === functional ? null : functional,
        current: cur,
        comparative: comparative.get(currency) ?? null,
      })),
    };
  }

  /** Stored figures for finalised entities and done tasks; otherwise built now. */
  async figures(
    task: StepTask,
    te: TaskEntityRow,
    readOnly: boolean,
  ): Promise<{ figures: EntityFigures | null; fromSnapshot: boolean }> {
    if (readOnly) {
      const stored = await this.snapshot(task.id, te.entityCode);
      if (stored) return { figures: stored, fromSnapshot: true };
    }
    return { figures: await this.build(task, te), fromSnapshot: false };
  }

  /**
   * Stores the figures of a finalised task entity. FINALISE snapshots are create-only
   * (finalised data is immutable); SEED (demo) snapshots follow revisions of the demo data.
   */
  async store(task: StepTask, te: TaskEntityRow, source: 'SEED' | 'FINALISE'): Promise<boolean> {
    const existing = await this.prisma.statementSnapshot.findUnique({
      where: { taskId_entityCode: { taskId: task.id, entityCode: te.entityCode } },
    });
    if (existing && existing.source !== 'SEED') return false;
    const figures = await this.build(task, te);
    if (!figures) return false;
    if (existing) {
      if (canonicalJson(existing.figures) === canonicalJson(figures)) return false;
      await this.prisma.statementSnapshot.update({
        where: { id: existing.id },
        data: { figures: JSON.parse(JSON.stringify(figures)) as Prisma.InputJsonValue },
      });
      return true;
    }
    await this.prisma.statementSnapshot.create({
      data: {
        taskId: task.id,
        entityCode: te.entityCode,
        figures: JSON.parse(JSON.stringify(figures)) as Prisma.InputJsonValue,
        source,
      },
    });
    return true;
  }
}
