import { Injectable } from '@nestjs/common';
import {
  type ClassifiedLine,
  deriveTaskStatus,
  type MonthlyRate,
  type TranslateTbResult,
  rollForwardCheck,
  type TranslationLineInput,
} from '@finance-close/engine';
import {
  AuditAction,
  type CurrencyTranslationDto,
  type EntityTranslationDto,
  TASK_STEPS,
  type TranslationStepDto,
} from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { fromDbDate } from '../common/db-dates';
import { PrismaService } from '../prisma/prisma.service';
import { inScope } from '../tasks/tasks.service';
import { ComparativeSourceService } from './comparative-source.service';
import {
  assertEditable,
  assertViewable,
  isTaskLocked,
  loadStepTask,
  readOnlyReason,
  type StepTask,
} from './step-access';
import {
  finalisedSnapshot,
  mappedLines,
  monthlyRates,
  ratesStamp,
  translateLines,
} from './translation-inputs';

type TaskEntityRow = StepTask['entities'][number];
const stepIndex = (code: string) => TASK_STEPS.findIndex((s) => s.code === code);
export const FCTR_MOVEMENT_NOTE = 'Exchange differences on translation (OCI) – for information';

/**
 * Task workspace step 4 "Currency translation" (page 6). Recalculated from the current TB,
 * mapping and rates every time (until the entity is finalised, when page 8 stores it).
 */
@Injectable()
export class TranslationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sources: ComparativeSourceService,
  ) {}

  async step(user: AuthUser, taskId: string): Promise<TranslationStepDto> {
    const task = await loadStepTask(this.prisma, user, taskId);
    const entities = [...task.entities]
      .filter((e) => inScope(user.entityScope, e.entityCode))
      .sort((a, b) => a.entity.sortOrder - b.entity.sortOrder);
    const tabs = [];
    for (const te of entities) {
      const d = await this.build(user, task, te);
      tabs.push({
        code: te.entityCode,
        shortName: te.entity.shortName,
        itemStatus: te.status,
        currentStep: te.currentStep,
        hasValidatedTb: d.tb !== null,
        toMap: null,
        currencies: d.currencies.length,
        failed: d.tb ? d.currencies.filter((c) => c.status === 'FAIL').length : null,
      });
    }
    return {
      task: {
        id: task.id,
        number: task.number,
        type: task.type,
        periodLabel: task.period.label,
        description: task.description,
        dueDate: fromDbDate(task.dueDate),
        status: deriveTaskStatus(task.entities.map((e) => e.status)),
        currentStep: task.currentStep,
        locked: isTaskLocked(task),
      },
      entities: tabs,
    };
  }

  async entity(user: AuthUser, taskId: string, entityCode: string): Promise<EntityTranslationDto> {
    const task = await loadStepTask(this.prisma, user, taskId);
    return this.build(user, task, assertViewable(user, task, entityCode));
  }

  /** Roll-forward check against the immediately preceding period (whatever the basis). */
  private async rollForwardPassed(
    task: StepTask,
    te: TaskEntityRow,
    lines: TranslationLineInput[],
  ): Promise<boolean> {
    const previous = await this.sources.resolve(task, te.entityCode, 'PREVIOUS_PERIOD');
    if (!previous.version) return false;
    const [coa, fslis] = await Promise.all([
      this.prisma.entityAccount.findMany({ where: { entityCode: te.entityCode } }),
      this.prisma.fsli.findMany(),
    ]);
    const acct = new Map(coa.map((a) => [a.accountCode, a.fsliCode]));
    const statement = new Map(fslis.map((f) => [f.code, f.statement]));
    const classify = (code: string, name: string, amount: string): ClassifiedLine => {
      const f = acct.get(code) ?? null;
      return { code, name, amount, fsliCode: f, statement: f ? (statement.get(f) ?? null) : null };
    };
    const comparative = previous.version.lines.map((l) =>
      classify(l.accountCode, l.accountName, l.amount.toFixed(2)),
    );
    if (comparative.some((l) => !l.fsliCode)) return false;
    const current = lines.map((l) => classify(l.code, l.name, l.amount));
    return rollForwardCheck({ basis: 'PREVIOUS_PERIOD', current, comparative }).status === 'PASS';
  }

  /**
   * The task entity's translation into each translated currency, exactly as this step shows
   * it (retained earnings rolled forward from the finalised prior period when the check
   * passes). Used by this step and by statements and notes.
   */
  async translate(
    task: StepTask,
    te: TaskEntityRow,
    lines: TranslationLineInput[],
    rates?: MonthlyRate[],
  ): Promise<{ target: string; result: TranslateTbResult }[]> {
    const functional = te.entity.functionalCurrency;
    const targets = te.entity.translatedCurrencies
      .map((t) => t.currencyCode)
      .filter((c) => c !== functional)
      .sort();
    if (targets.length === 0) return [];
    const period = {
      startDate: fromDbDate(task.period.startDate),
      endDate: fromDbDate(task.period.endDate),
      label: task.period.label,
    };
    const monthly = rates ?? (await monthlyRates(this.prisma, [functional, ...targets], period));
    const previous = await this.sources.period(task, 'PREVIOUS_PERIOD');
    const passed = await this.rollForwardPassed(task, te, lines);
    const out: { target: string; result: TranslateTbResult }[] = [];
    for (const target of targets) {
      const prior = await finalisedSnapshot(this.prisma, te.entityCode, target, previous.id);
      const h = te.entity.historicalRates.find((r) => r.targetCurrency === target);
      out.push({
        target,
        result: translateLines({
          lines,
          functionalCurrency: functional,
          target,
          period,
          rates: monthly,
          historicalRate: h ? h.rate.toString() : null,
          prior: prior
            ? {
                periodLabel: previous.label,
                retained: prior.retained.toFixed(2),
                profit: prior.profit.toFixed(2),
              }
            : null,
          priorPeriodLabel: previous.label,
          rollForwardPassed: passed,
        }),
      });
    }
    return out;
  }

  private async build(
    user: AuthUser,
    task: StepTask,
    te: TaskEntityRow,
  ): Promise<EntityTranslationDto> {
    const functional = te.entity.functionalCurrency;
    const targets = te.entity.translatedCurrencies
      .map((t) => t.currencyCode)
      .filter((c) => c !== functional)
      .sort();
    const period = {
      startDate: fromDbDate(task.period.startDate),
      endDate: fromDbDate(task.period.endDate),
      label: task.period.label,
    };
    const lines = await mappedLines(this.prisma, task.id, te.entityCode);
    const version = lines
      ? await this.prisma.tbVersion.findFirst({
          where: { taskId: task.id, entityCode: te.entityCode, purpose: 'CURRENT' },
          orderBy: { version: 'desc' },
          include: { file: true },
        })
      : null;
    const rates = await monthlyRates(this.prisma, [functional, ...targets], period);
    const historical = te.entity.historicalRates;
    const reason = readOnlyReason(user, task, te.entityCode);
    const fsliNames = new Map((await this.prisma.fsli.findMany()).map((f) => [f.code, f.name]));

    const currencies: CurrencyTranslationDto[] = [];
    if (lines) {
      const comparative = await this.sources.period(task);
      for (const { target, result: r } of await this.translate(task, te, lines, rates)) {
        const comp =
          r.fctr !== null
            ? await finalisedSnapshot(this.prisma, te.entityCode, target, comparative.id)
            : null;
        currencies.push({
          target,
          label: `${functional} → ${target}`,
          status: r.status,
          failures: r.failures,
          rates: r.rates,
          lines: r.lines.map((l) => ({
            ...l,
            fsliName: l.fsliCode ? (fsliNames.get(l.fsliCode) ?? null) : null,
          })),
          profit: r.profit,
          fctr: r.fctr,
          totals: r.totals,
          summary: r.summary,
          reMethod: r.reMethod,
          warnings: r.warnings,
          fctrMovement:
            comp && r.fctr !== null
              ? {
                  current: r.fctr,
                  comparative: comp.fctr.toFixed(2),
                  movement: comp.fctr.negated().plus(r.fctr).toFixed(2),
                  comparativeLabel: comparative.label,
                }
              : null,
          fctrMovementNote: FCTR_MOVEMENT_NOTE,
        });
      }
    }

    return {
      entity: {
        code: te.entityCode,
        legalName: te.entity.legalName,
        shortName: te.entity.shortName,
        functionalCurrency: functional,
        erp: te.entity.erp,
        itemStatus: te.status,
        currentStep: te.currentStep,
      },
      canEdit: reason === null && lines !== null,
      readOnlyReason: reason,
      tb: version ? { version: version.version, fileName: version.file.originalName } : null,
      periodLabel: task.period.label,
      periodType: task.period.type,
      noTranslation:
        targets.length === 0
          ? `No translation needed: ${te.entity.shortName} presents in ${functional}.`
          : null,
      currencies,
      ratesStamp: ratesStamp(
        rates,
        historical.map((h) => `${h.targetCurrency}:${h.rate.toString()}`).sort(),
      ),
      canContinue: reason === null && lines !== null && currencies.every((c) => c.status === 'OK'),
    };
  }

  async continue(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    ip: string | null,
  ): Promise<{ currentStep: string }> {
    const task = await loadStepTask(this.prisma, user, taskId);
    const te = assertEditable(user, task, entityCode);
    const dto = await this.build(user, task, te);
    if (!dto.tb) throw ApiError.validation('Upload and validate a trial balance first.');
    const failed = dto.currencies.filter((c) => c.status === 'FAIL');
    if (failed.length > 0)
      throw ApiError.validation(
        `Cannot continue: ${failed.map((c) => `${c.label} — ${c.failures.join(' ')}`).join(' ')}`,
      );
    const next =
      stepIndex(te.currentStep) < stepIndex('STATEMENTS') ? 'STATEMENTS' : te.currentStep;
    await this.prisma.$transaction(async (tx) => {
      if (next !== te.currentStep)
        await tx.taskEntity.update({
          where: { taskId_entityCode: { taskId, entityCode } },
          data: { currentStep: next },
        });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.TaskStepContinue,
          entityType: 'TASK_ENTITY',
          entityId: `${taskId}:${entityCode}`,
          oldValue: { step: te.currentStep },
          newValue: {
            step: next,
            task: task.number,
            entity: entityCode,
            translations: dto.currencies.map((c) => ({
              currency: c.target,
              fctr: c.fctr,
              reMethod: c.reMethod.kind,
              warnings: c.warnings.length,
            })),
          },
          ip,
        },
        tx,
      );
    });
    return { currentStep: next };
  }
}
