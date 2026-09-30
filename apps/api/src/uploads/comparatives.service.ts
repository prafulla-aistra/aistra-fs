import { HttpStatus, Injectable } from '@nestjs/common';
import {
  accountsToMap,
  type ClassifiedLine,
  columnTotal,
  compareAccounts,
  compareFslis,
  type ComparisonRow,
  deriveTaskStatus,
  type MappedAccount,
  type MappingFsli,
  rollForwardCheck,
  type RollForwardResult,
  type TbLineInput,
} from '@finance-close/engine';
import {
  ApiErrorCode,
  AuditAction,
  COMPARATIVE_SOURCE_LABELS,
  type ComparativeBasis,
  type ComparativesStepDto,
  type ComparisonRowDto,
  DRAFT_COMPARATIVE_WARNING,
  type EntityComparativesDto,
  ROLL_FORWARD_FAIL_TEXT,
  type RollForwardDto,
  TASK_STEPS,
} from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { fromDbDate } from '../common/db-dates';
import { PrismaService } from '../prisma/prisma.service';
import { inScope } from '../tasks/tasks.service';
import { ComparativeSourceService } from './comparative-source.service';
import { MappingStepService } from './mapping-step.service';
import {
  assertEditable,
  assertViewable,
  isTaskLocked,
  loadStepTask,
  readOnlyReason,
  type StepTask,
} from './step-access';
import type { TbTarget } from './upload-step.service';

type TaskEntityRow = StepTask['entities'][number];
export const VARIANCE_PCT_SETTING = 'VARIANCE_PCT_THRESHOLD';
const stepIndex = (code: string) => TASK_STEPS.findIndex((s) => s.code === code);

/** "165,000,000.00 Cr" */
function drCrText(amount: string): string {
  const neg = amount.startsWith('-');
  const [int = '0', dec = '00'] = (neg ? amount.slice(1) : amount).split('.');
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec} ${neg ? 'Cr' : 'Dr'}`;
}

function rollForwardMessage(r: RollForwardResult, periodLabel: string): string {
  switch (r.status) {
    case 'PASS':
      return `${periodLabel} RE ${drCrText(r.priorRe!)} + ${periodLabel} profit ${drCrText(r.priorPl!)} = ${drCrText(r.expected!)} = opening retained earnings.`;
    case 'FAIL':
      return `${ROLL_FORWARD_FAIL_TEXT} Opening RE ${drCrText(r.openingRe!)}; ${periodLabel} RE + profit ${drCrText(r.expected!)}; difference ${drCrText(r.difference!)}.`;
    case 'NOT_APPLICABLE':
      return 'Not applicable: the roll-forward is checked only against the immediately preceding period.';
    default:
      return 'No comparative trial balance, so the roll-forward cannot be checked.';
  }
}

/**
 * Task workspace step 3 "Comparatives" (page 5): the comparative period and source, the
 * retained-earnings roll-forward check, and the comparison table with variance flags.
 */
@Injectable()
export class ComparativesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sources: ComparativeSourceService,
    private readonly mapping: MappingStepService,
  ) {}

  private async pctThreshold(): Promise<string> {
    return (
      (await this.prisma.appSetting.findUnique({ where: { key: VARIANCE_PCT_SETTING } }))?.value ??
      '0.20'
    );
  }

  /** TB lines with the FSLI from the entity's current chart of accounts. */
  private classify(
    lines: TbLineInput[],
    coa: MappedAccount[],
    fslis: MappingFsli[],
  ): ClassifiedLine[] {
    const by = new Map(coa.map((a) => [a.accountCode, a]));
    const fsliBy = new Map(fslis.map((f) => [f.code, f]));
    return lines.map((l) => {
      const f = by.get(l.accountCode)?.fsliCode ?? null;
      return {
        code: l.accountCode,
        name: l.accountName,
        amount: l.amount,
        fsliCode: f,
        statement: f ? (fsliBy.get(f)?.statement ?? null) : null,
      };
    });
  }

  async step(user: AuthUser, taskId: string): Promise<ComparativesStepDto> {
    const task = await loadStepTask(this.prisma, user, taskId);
    const period = await this.sources.period(task);
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
        toMap: d.tb ? d.toMap.length : null,
        flagged: d.tb ? d.flagged : null,
        explained: d.tb ? d.explained : null,
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
      basis: task.comparativeBasis,
      canChangeBasis: !isTaskLocked(task) && user.permissions.has('SFS_PREPARE'),
      currentPeriodLabel: task.period.label,
      comparativePeriodLabel: period.label,
      entities: tabs,
    };
  }

  async entity(user: AuthUser, taskId: string, entityCode: string): Promise<EntityComparativesDto> {
    const task = await loadStepTask(this.prisma, user, taskId);
    return this.build(user, task, assertViewable(user, task, entityCode));
  }

  private async build(
    user: AuthUser,
    task: StepTask,
    te: TaskEntityRow,
  ): Promise<EntityComparativesDto> {
    const fslis = await this.mapping.fslis();
    const fsliName = new Map(fslis.map((f) => [f.code, f.name]));
    const [currentVersion, coaRows, resolved, pct, explanations, allEntities] = await Promise.all([
      this.prisma.tbVersion.findFirst({
        where: { taskId: task.id, entityCode: te.entityCode, purpose: 'CURRENT' },
        orderBy: { version: 'desc' },
        include: { lines: true, file: true },
      }),
      this.prisma.entityAccount.findMany({ where: { entityCode: te.entityCode } }),
      this.sources.resolve(task, te.entityCode),
      this.pctThreshold(),
      this.prisma.varianceExplanation.findMany({
        where: { taskId: task.id, entityCode: te.entityCode },
        include: { updatedBy: { select: { name: true } } },
      }),
      this.prisma.entity.findMany({ orderBy: { sortOrder: 'asc' } }),
    ]);
    const current = currentVersion && currentVersion.status !== 'ERROR' ? currentVersion : null;
    const coa: MappedAccount[] = coaRows.map((a) => ({
      entityCode: a.entityCode,
      accountCode: a.accountCode,
      accountName: a.accountName,
      accountType: a.accountType,
      fsliCode: a.fsliCode,
      counterpartyCode: a.counterpartyCode,
    }));
    const currentLines = this.classify(
      (current?.lines ?? []).map((l) => ({
        accountCode: l.accountCode,
        accountName: l.accountName,
        accountType: l.accountType,
        amount: l.amount.toFixed(2),
      })),
      coa,
      fslis,
    );
    const compTb = this.sources.lines(resolved.version);
    const unmapped = accountsToMap(compTb, coa, fslis);
    const toMap = await this.mapping.toMapRows(te, unmapped, allEntities);
    const compLines =
      resolved.version && unmapped.length === 0 ? this.classify(compTb, coa, fslis) : null;

    const rule = { pctThreshold: pct, materiality: te.entity.materiality?.toFixed(2) ?? '0' };
    const explained = new Map(explanations.map((x) => [x.accountCode, x]));
    const toDto = (r: ComparisonRow, withExplanation: boolean): ComparisonRowDto => {
      const x = withExplanation ? explained.get(r.code) : undefined;
      return {
        ...r,
        fsliName: r.fsliCode ? (fsliName.get(r.fsliCode) ?? null) : null,
        explanation: x
          ? { text: x.text, by: x.updatedBy.name, at: x.updatedAt.toISOString() }
          : null,
      };
    };
    const accountRows = current
      ? compareAccounts(currentLines, compLines, rule).map((r) => toDto(r, true))
      : [];
    const fsliRows = current
      ? compareFslis(currentLines, compLines, fslis, rule).map((r) => toDto(r, false))
      : [];
    const roll = rollForwardCheck({
      basis: task.comparativeBasis,
      current: currentLines,
      comparative: compLines,
    });
    const rollForward: RollForwardDto = {
      ...roll,
      message: rollForwardMessage(roll, resolved.period.label),
    };
    const flaggedRows = accountRows.filter((r) => r.flagged);
    const reason = readOnlyReason(user, task, te.entityCode);

    const v = resolved.version;
    const blankReason =
      resolved.kind === 'NONE'
        ? `No trial balance for ${resolved.period.label}. Upload one to show comparatives, or continue without.`
        : unmapped.length > 0
          ? `${unmapped.length} account${unmapped.length === 1 ? '' : 's'} in the ${resolved.period.label} trial balance ${unmapped.length === 1 ? 'is' : 'are'} not mapped. Comparatives show once ${unmapped.length === 1 ? 'it is' : 'they are'} mapped below.`
          : null;
    const compTotal = compLines ? columnTotal(compLines.map((l) => l.amount)) : null;
    const curTotal = columnTotal(currentLines.map((l) => l.amount));

    return {
      entity: {
        code: te.entityCode,
        legalName: te.entity.legalName,
        shortName: te.entity.shortName,
        functionalCurrency: te.entity.functionalCurrency,
        erp: te.entity.erp,
        itemStatus: te.status,
        currentStep: te.currentStep,
      },
      canEdit: reason === null && current !== null,
      readOnlyReason: reason,
      tb: current ? { version: current.version, fileName: current.file.originalName } : null,
      basis: task.comparativeBasis,
      comparativePeriod: { id: resolved.period.id, label: resolved.period.label },
      source: {
        kind: resolved.kind,
        label: COMPARATIVE_SOURCE_LABELS[resolved.kind],
        taskNumber: v && resolved.kind !== 'UPLOADED' ? v.task.number : null,
        fileName: v?.file.originalName ?? null,
        version: v?.version ?? null,
        debits: v?.debits.toFixed(2) ?? null,
        credits: v?.credits.toFixed(2) ?? null,
        lineCount: v?.lineCount ?? null,
      },
      warning: resolved.kind === 'DRAFT' ? DRAFT_COMPARATIVE_WARNING : null,
      blankReason,
      canUpload: reason === null && !resolved.finalisedExists && resolved.period.id !== null,
      toMap,
      options: this.mapping.mappingOptions(te, fslis, allEntities),
      rollForward,
      accountRows,
      fsliRows,
      totals: {
        current: curTotal,
        currentNil: curTotal === '0.00',
        comparative: compTotal,
        comparativeNil: compTotal === null ? null : compTotal === '0.00',
      },
      materiality: te.entity.materiality?.toFixed(2) ?? null,
      pctThreshold: pct,
      flagged: flaggedRows.length,
      explained: flaggedRows.filter((r) => r.explanation).length,
    };
  }

  /** The comparative TB target for uploads on this step (403 / 404 / 409 as for step 1). */
  async uploadTarget(user: AuthUser, taskId: string, entityCode: string): Promise<TbTarget> {
    const task = await loadStepTask(this.prisma, user, taskId);
    assertEditable(user, task, entityCode);
    const resolved = await this.sources.resolve(task, entityCode);
    if (!resolved.period.id)
      throw ApiError.validation(
        `${resolved.period.label} is not in the calendar. Create its financial year first.`,
      );
    if (resolved.finalisedExists)
      throw ApiError.validation(
        `A finalised trial balance for ${resolved.period.label} exists; it is used as the comparative.`,
      );
    return {
      purpose: 'COMPARATIVE',
      period: {
        id: resolved.period.id,
        label: resolved.period.label,
        startDate: resolved.period.startDate,
        endDate: resolved.period.endDate,
      },
    };
  }

  async setBasis(
    user: AuthUser,
    taskId: string,
    basis: ComparativeBasis,
    ip: string | null,
  ): Promise<ComparativesStepDto> {
    const task = await loadStepTask(this.prisma, user, taskId);
    if (isTaskLocked(task))
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.TaskLocked,
        'This task is done and locked.',
      );
    if (task.comparativeBasis !== basis) {
      await this.prisma.$transaction(async (tx) => {
        await tx.task.update({ where: { id: taskId }, data: { comparativeBasis: basis } });
        await this.audit.record(
          {
            userId: user.id,
            action: AuditAction.ComparativeBasisChange,
            entityType: 'TASK',
            entityId: taskId,
            oldValue: { basis: task.comparativeBasis },
            newValue: { basis, task: task.number },
            ip,
          },
          tx,
        );
      });
    }
    return this.step(user, taskId);
  }

  async explain(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    accountCode: string,
    text: string,
    ip: string | null,
  ): Promise<EntityComparativesDto> {
    const task = await loadStepTask(this.prisma, user, taskId);
    const te = assertEditable(user, task, entityCode);
    const dto = await this.build(user, task, te);
    const row = dto.accountRows.find((r) => r.code === accountCode);
    if (!row) throw ApiError.notFound(`Account ${accountCode} is not in this comparison.`);
    const key = { taskId_entityCode_accountCode: { taskId, entityCode, accountCode } };
    const before = await this.prisma.varianceExplanation.findUnique({ where: key });
    const clean = text.trim();
    if ((before?.text ?? '') === clean) return dto;
    await this.prisma.$transaction(async (tx) => {
      if (clean) {
        await tx.varianceExplanation.upsert({
          where: key,
          create: { taskId, entityCode, accountCode, text: clean, updatedById: user.id },
          update: { text: clean, updatedById: user.id },
        });
      } else {
        await tx.varianceExplanation.delete({ where: key });
      }
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.VarianceExplain,
          entityType: 'VARIANCE_EXPLANATION',
          entityId: `${taskId}:${entityCode}:${accountCode}`,
          oldValue: before ? { text: before.text } : null,
          newValue: {
            task: task.number,
            entity: entityCode,
            account: `${accountCode} ${row.name}`,
            text: clean || null,
            current: row.current,
            comparative: row.comparative,
            variance: row.variance,
          },
          ip,
        },
        tx,
      );
    });
    return this.build(user, task, te);
  }

  /** Saves the step: stores the roll-forward result and moves the entity on (never back). */
  async continue(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    ip: string | null,
  ): Promise<{ currentStep: string; unexplained: number }> {
    const task = await loadStepTask(this.prisma, user, taskId);
    const te = assertEditable(user, task, entityCode);
    const dto = await this.build(user, task, te);
    if (!dto.tb) throw ApiError.validation('Upload and validate a trial balance first.');
    const next =
      stepIndex(te.currentStep) < stepIndex('TRANSLATION') ? 'TRANSLATION' : te.currentStep;
    const stored = {
      ...dto.rollForward,
      basis: dto.basis,
      comparativePeriod: dto.comparativePeriod.label,
      source: dto.source.kind,
      checkedAt: new Date().toISOString(),
    };
    const unexplained = dto.flagged - dto.explained;
    await this.prisma.$transaction(async (tx) => {
      await tx.taskEntity.update({
        where: { taskId_entityCode: { taskId, entityCode } },
        data: { currentStep: next, rollForward: stored },
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
            rollForward: dto.rollForward.status,
            unexplainedVariances: unexplained,
          },
          ip,
        },
        tx,
      );
    });
    return { currentStep: next, unexplained };
  }
}
