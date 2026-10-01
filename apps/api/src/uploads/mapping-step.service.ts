import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  accountsToMap,
  crossRate,
  deriveTaskStatus,
  fsliTotals,
  intercompanySummary,
  MAP_REASON_TEXT,
  mappableFslis,
  type MappedAccount,
  type MappingFsli,
  type MonthlyRate,
  suggestFsli,
  type TbLineInput,
  validateMapping,
} from '@finance-close/engine';
import {
  ApiErrorCode,
  AuditAction,
  type AccountToMapDto,
  type EntityMappingDto,
  type MappingInputDto,
  type MappingRowIssuesDto,
  type MappingStepDto,
  PERIOD_AVERAGE_ASSUMPTION,
  RATE_APPLIED_TO,
  type RateValueDto,
  TASK_STEPS,
  type TranslationRateRowDto,
  ZOHO_ACCOUNT_TYPES,
} from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { fromDbDate, toDbDate } from '../common/db-dates';
import { PrismaService } from '../prisma/prisma.service';
import { SubmissionGuard } from './submission-guard.service';
import { rateSourceLabel } from '../common/settings';
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

type TaskEntityRow = StepTask['entities'][number];

interface EntityData {
  version: Prisma.TbVersionGetPayload<{ include: { lines: true; file: true } }> | null;
  lines: TbLineInput[];
  coa: MappedAccount[];
  toMap: ReturnType<typeof accountsToMap>;
}

const IC_FSLIS = new Set(['IC_REC', 'IC_PAY', 'IC_REV', 'IC_EXP', 'INV_SUB']);
const stepIndex = (code: string) => TASK_STEPS.findIndex((s) => s.code === code);

export function toMappingFsli(f: Prisma.FsliGetPayload<object>): MappingFsli {
  return {
    code: f.code,
    name: f.name,
    statement: f.statement,
    class: f.class,
    needsCounterparty: f.needsCounterparty,
    computed: f.computed,
    consolidationOnly: f.consolidationOnly,
    sortOrder: f.sortOrder,
  };
}

/**
 * Task workspace step 2 "Review and map" (page 4): translation rates, accounts to map,
 * the TB with its mapping, FSLI and intercompany summaries, and step completion.
 */
@Injectable()
export class MappingStepService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly comparatives: ComparativeSourceService,
    private readonly guard: SubmissionGuard,
  ) {}

  async fslis(): Promise<MappingFsli[]> {
    return (
      await this.prisma.fsli.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } })
    ).map(toMappingFsli);
  }

  /** Latest validated TB of the entity in the task, its lines and the entity's COA. */
  private async entityData(
    taskId: string,
    entityCode: string,
    fslis: MappingFsli[],
  ): Promise<EntityData> {
    const latest = await this.prisma.tbVersion.findFirst({
      where: { taskId, entityCode, purpose: 'CURRENT' },
      orderBy: { version: 'desc' },
      include: { lines: { orderBy: { accountCode: 'asc' } }, file: true },
    });
    const version = latest && latest.status !== 'ERROR' ? latest : null;
    const coaRows = await this.prisma.entityAccount.findMany({ where: { entityCode } });
    const coa: MappedAccount[] = coaRows.map((a) => ({
      entityCode: a.entityCode,
      accountCode: a.accountCode,
      accountName: a.accountName,
      accountType: a.accountType,
      fsliCode: a.fsliCode,
      counterpartyCode: a.counterpartyCode,
    }));
    const byCode = new Map(coa.map((a) => [a.accountCode, a]));
    const lines: TbLineInput[] = (version?.lines ?? []).map((l) => ({
      accountCode: l.accountCode,
      accountName: l.accountName,
      accountType: byCode.get(l.accountCode)?.accountType ?? l.accountType,
      amount: l.amount.toFixed(2),
    }));
    return { version, lines, coa, toMap: version ? accountsToMap(lines, coa, fslis) : [] };
  }

  // ---------------------------------------------------------------------------------------
  // Step overview (entity tabs)
  // ---------------------------------------------------------------------------------------

  async step(user: AuthUser, taskId: string): Promise<MappingStepDto> {
    const task = await loadStepTask(this.prisma, user, taskId);
    const fslis = await this.fslis();
    const entities = [...task.entities]
      .filter((e) => inScope(user.entityScope, e.entityCode))
      .sort((a, b) => a.entity.sortOrder - b.entity.sortOrder);
    const tabs = await Promise.all(
      entities.map(async (te) => {
        const d = await this.entityData(taskId, te.entityCode, fslis);
        return {
          code: te.entityCode,
          shortName: te.entity.shortName,
          itemStatus: te.status,
          currentStep: te.currentStep,
          hasValidatedTb: d.version !== null,
          toMap: d.version ? d.toMap.length : null,
        };
      }),
    );
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

  // ---------------------------------------------------------------------------------------
  // One entity
  // ---------------------------------------------------------------------------------------

  async entity(user: AuthUser, taskId: string, entityCode: string): Promise<EntityMappingDto> {
    const task = await loadStepTask(this.prisma, user, taskId);
    const te = assertViewable(user, task, entityCode);
    return this.build(user, task, te);
  }

  private async build(
    user: AuthUser,
    task: StepTask,
    te: TaskEntityRow,
  ): Promise<EntityMappingDto> {
    const fslis = await this.fslis();
    const fsliBy = new Map(fslis.map((f) => [f.code, f]));
    const d = await this.entityData(task.id, te.entityCode, fslis);
    const allEntities = await this.prisma.entity.findMany({ orderBy: { sortOrder: 'asc' } });
    const entityName = new Map(allEntities.map((e) => [e.code, e.legalName]));
    const reason = readOnlyReason(user, task, te.entityCode);
    const rates = await this.rates(task, te);

    const byCode = new Map(d.coa.map((a) => [a.accountCode, a]));
    const toMap = await this.toMapRows(te, d.toMap, allEntities);

    const mappedLines = d.lines.map((l) => {
      const a = byCode.get(l.accountCode);
      const fsli = a?.fsliCode ? fsliBy.get(a.fsliCode) : undefined;
      return {
        code: l.accountCode,
        name: l.accountName,
        accountType: l.accountType,
        fsliCode: fsli?.code ?? null,
        fsliName: fsli?.name ?? null,
        counterpartyCode: a?.counterpartyCode ?? null,
        amount: l.amount,
        mapped: Boolean(fsli) && !(fsli!.needsCounterparty && !a?.counterpartyCode),
        intercompany: fsli ? IC_FSLIS.has(fsli.code) : false,
        inCoa: Boolean(a),
      };
    });
    const withMapping = mappedLines.map((l) => ({
      amount: l.amount,
      fsliCode: l.fsliCode,
      counterpartyCode: l.counterpartyCode,
    }));
    const balanced = d.version ? d.version.difference.abs().lessThanOrEqualTo('0.01') : false;
    const counterpartiesComplete = mappedLines.every(
      (l) =>
        !l.fsliCode || !fsliBy.get(l.fsliCode)!.needsCounterparty || Boolean(l.counterpartyCode),
    );
    const missingRates = rates.rows.flatMap((r) => [
      ...r.opening.missing,
      ...r.closing.missing,
      ...r.average.missing,
      ...r.historical.missing,
    ]);

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
      canEdit: reason === null && d.version !== null,
      readOnlyReason: reason,
      tb: d.version
        ? {
            version: d.version.version,
            fileName: d.version.file.originalName,
            createdAt: d.version.createdAt.toISOString(),
          }
        : null,
      rates,
      toMap,
      lines: mappedLines,
      totals: {
        debits: d.version?.debits.toFixed(2) ?? '0.00',
        credits: d.version?.credits.toFixed(2) ?? '0.00',
        balanced,
      },
      fsliSummary: d.version ? fsliTotals(withMapping, fslis) : null,
      intercompany: intercompanySummary(withMapping).map((r) => ({
        ...r,
        counterpartyName: entityName.get(r.counterpartyCode) ?? r.counterpartyCode,
      })),
      completion: {
        balanced,
        toMap: toMap.length,
        counterpartiesComplete,
        missingRates,
        canContinue:
          reason === null &&
          d.version !== null &&
          balanced &&
          toMap.length === 0 &&
          counterpartiesComplete,
      },
      options: this.mappingOptions(te, fslis, allEntities),
    };
  }

  /** Rows of the "Accounts to map" panel, with suggestions (also used by the comparatives step). */
  async toMapRows(
    te: TaskEntityRow,
    items: ReturnType<typeof accountsToMap>,
    allEntities: { code: string; shortName: string; legalName: string }[],
  ): Promise<AccountToMapDto[]> {
    const others = items.length
      ? (
          await this.prisma.entityAccount.findMany({
            where: { entityCode: { not: te.entityCode }, fsliCode: { not: null } },
          })
        ).map((a): MappedAccount => ({
          entityCode: a.entityCode,
          accountCode: a.accountCode,
          accountName: a.accountName,
          accountType: a.accountType,
          fsliCode: a.fsliCode,
          counterpartyCode: a.counterpartyCode,
        }))
      : [];
    const defaults = await this.prisma.accountTypeDefault.findMany({
      where: { erp: { in: [te.entity.erp, 'ZOHO'] } },
    });
    const typeDefaults: Record<string, string> = {};
    // Zoho defaults, overridden by the entity's own ERP list where one exists.
    for (const dft of defaults.filter((x) => x.erp === 'ZOHO'))
      typeDefaults[dft.accountType] = dft.fsliCode;
    for (const dft of defaults.filter((x) => x.erp === te.entity.erp))
      typeDefaults[dft.accountType] = dft.fsliCode;

    return items.map(({ line, account, reasons }) => {
      const type = account?.accountType ?? line.accountType;
      let suggestion = suggestFsli(
        { code: line.accountCode, name: line.accountName, type },
        {
          entityCode: te.entityCode,
          otherAccounts: others,
          entities: allEntities.map((e) => ({
            code: e.code,
            shortName: e.shortName,
            legalName: e.legalName,
          })),
          typeDefaults,
          intercompanyFslis: IC_FSLIS,
        },
      );
      // Account already has an FSLI but lacks a counterparty: keep the FSLI.
      if (account?.fsliCode && suggestion?.fsliCode !== account.fsliCode)
        suggestion = {
          fsliCode: account.fsliCode,
          counterpartyCode: null,
          source: 'Current mapping',
        };
      return {
        code: line.accountCode,
        name: line.accountName,
        amount: line.amount,
        accountType: type,
        inCoa: account !== null,
        reasons,
        reasonText: reasons.map((r) => MAP_REASON_TEXT[r]).join('; '),
        current: {
          fsliCode: account?.fsliCode ?? null,
          counterpartyCode: account?.counterpartyCode ?? null,
        },
        suggestion,
      };
    });
  }

  /** Select options for mapping (FSLIs, account types, counterparties). */
  mappingOptions(
    te: TaskEntityRow,
    fslis: MappingFsli[],
    allEntities: {
      code: string;
      legalName: string;
      isActive: boolean;
      parentCode: string | null;
    }[],
  ): EntityMappingDto['options'] {
    return {
      fslis: mappableFslis(fslis).map((f) => ({
        code: f.code,
        name: f.name,
        statement: f.statement,
        class: f.class,
        needsCounterparty: f.needsCounterparty,
      })),
      accountTypes: ZOHO_ACCOUNT_TYPES,
      counterparties: allEntities
        .filter((e) => e.isActive && e.code !== te.entityCode)
        .map((e) => ({
          code: e.code,
          name: e.legalName,
          directSubsidiary: e.parentCode === te.entityCode,
        })),
    };
  }

  /** "1 <functional> = X <target>" for each translated currency, and the historical rate. */
  private async rates(task: StepTask, te: TaskEntityRow): Promise<EntityMappingDto['rates']> {
    const functional = te.entity.functionalCurrency;
    const targets = te.entity.translatedCurrencies
      .map((t) => t.currencyCode)
      .filter((c) => c !== functional)
      .sort();
    const period = {
      startDate: fromDbDate(task.period.startDate),
      endDate: fromDbDate(task.period.endDate),
    };
    const base = {
      periodLabel: task.period.label,
      functionalCurrency: functional,
      assumption: task.period.type === 'MONTHLY' ? null : PERIOD_AVERAGE_ASSUMPTION,
      sourceLabel: await rateSourceLabel(this.prisma),
      appliedTo: RATE_APPLIED_TO.map((a) => ({ ...a })),
    };
    if (targets.length === 0)
      return {
        ...base,
        rows: [],
        noTranslation: `No translation needed: reports in ${functional}.`,
      };

    const rows = await this.prisma.exchangeRate.findMany({
      where: {
        currencyCode: { in: [functional, ...targets] },
        month: { gte: toDbDate(period.startDate), lte: toDbDate(period.endDate) },
      },
    });
    const monthly: MonthlyRate[] = rows.map((r) => ({
      month: fromDbDate(r.month),
      currency: r.currencyCode,
      opening: r.opening?.toString() ?? null,
      closing: r.closing?.toString() ?? null,
      average: r.average?.toString() ?? null,
    }));
    const value = (kind: 'opening' | 'closing' | 'average', target: string): RateValueDto =>
      crossRate(monthly, period, functional, target, kind);
    const out: TranslationRateRowDto[] = targets.map((target) => {
      const h = te.entity.historicalRates.find((r) => r.targetCurrency === target);
      return {
        target,
        opening: value('opening', target),
        closing: value('closing', target),
        average: value('average', target),
        historical: h
          ? { value: h.rate.toFixed(10), formula: 'From the entity master', missing: [] }
          : {
              value: null,
              formula: null,
              missing: [`${functional} → ${target} historical rate (entity master)`],
            },
      };
    });
    return { ...base, rows: out, noTranslation: null };
  }

  // ---------------------------------------------------------------------------------------
  // Saving mappings
  // ---------------------------------------------------------------------------------------

  async save(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    inputs: MappingInputDto[],
    ip: string | null,
  ): Promise<EntityMappingDto> {
    const task = await loadStepTask(this.prisma, user, taskId);
    const te = assertEditable(user, task, entityCode);
    const fslis = await this.fslis();
    const d = await this.entityData(taskId, entityCode, fslis);
    if (!d.version) throw ApiError.validation('Upload and validate a trial balance first.');
    const entities = await this.prisma.entity.findMany({
      select: { code: true, isActive: true, parentCode: true },
    });
    // Accounts of the current TB, and of the comparative TB (mapped from the comparatives step).
    const comparative = await this.comparatives.resolve(task, entityCode);
    const lineBy = new Map(
      [...this.comparatives.lines(comparative.version), ...d.lines].map((l) => [l.accountCode, l]),
    );
    const coaBy = new Map(d.coa.map((a) => [a.accountCode, a]));

    const errors: MappingRowIssuesDto[] = [];
    const unconfirmed: MappingRowIssuesDto[] = [];
    const changes: {
      input: MappingInputDto;
      before: MappedAccount | null;
      line: TbLineInput;
      counterparty: string | null;
    }[] = [];
    for (const input of inputs) {
      const line = lineBy.get(input.accountCode);
      if (!line) {
        errors.push({
          accountCode: input.accountCode,
          errors: [
            {
              code: 'NOT_IN_TB',
              message: `${input.accountCode} is not in this trial balance or its comparative.`,
            },
          ],
          warnings: [],
        });
        continue;
      }
      const fsli = fslis.find((f) => f.code === input.fsliCode);
      const counterparty = fsli?.needsCounterparty ? input.counterpartyCode : null;
      const check = validateMapping(
        {
          accountType: input.accountType,
          fsliCode: input.fsliCode,
          counterpartyCode: counterparty,
        },
        { entityCode, fslis, entities },
      );
      const before = coaBy.get(input.accountCode) ?? null;
      const rowErrors = [...check.errors];
      const changesExisting =
        before?.fsliCode != null &&
        (before.fsliCode !== input.fsliCode ||
          (before.counterpartyCode !== null && before.counterpartyCode !== counterparty));
      if (changesExisting && !(input.reason && input.reason.trim().length >= 3))
        rowErrors.push({
          code: 'REASON_REQUIRED',
          message: 'Give a reason for changing an existing mapping.',
        });
      if (rowErrors.length > 0)
        errors.push({
          accountCode: input.accountCode,
          errors: rowErrors,
          warnings: check.warnings,
        });
      else if (check.warnings.length > 0 && !input.confirmWarnings)
        unconfirmed.push({ accountCode: input.accountCode, errors: [], warnings: check.warnings });
      const unchanged =
        before &&
        before.fsliCode === input.fsliCode &&
        before.counterpartyCode === counterparty &&
        (before.accountType ?? null) === (input.accountType ?? null);
      if (!unchanged) changes.push({ input, before, line, counterparty });
    }
    if (errors.length > 0) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        ApiErrorCode.ValidationFailed,
        errors
          .map((e) => `${e.accountCode}: ${e.errors.map((x) => x.message).join(' ')}`)
          .join(' '),
        { rows: errors },
      );
    }
    if (unconfirmed.length > 0) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        ApiErrorCode.ConfirmationRequired,
        `Confirm the warning${unconfirmed.length === 1 ? '' : 's'} for ${unconfirmed.map((u) => u.accountCode).join(', ')} before saving.`,
        { rows: unconfirmed },
      );
    }

    await this.prisma.$transaction(async (tx) => {
      for (const c of changes) {
        const data = {
          accountType: c.input.accountType?.slice(0, 60) ?? null,
          fsliCode: c.input.fsliCode,
          counterpartyCode: c.counterparty,
          source: 'TASK_MAPPING' as const,
          suggested: false,
          mappedInTaskId: taskId,
          updatedById: user.id,
        };
        await tx.entityAccount.upsert({
          where: { entityCode_accountCode: { entityCode, accountCode: c.input.accountCode } },
          create: {
            entityCode,
            accountCode: c.input.accountCode,
            accountName: c.line.accountName.slice(0, 200),
            ...data,
          },
          update: data,
        });
        await this.audit.record(
          {
            userId: user.id,
            action: AuditAction.AccountMap,
            entityType: 'ENTITY_ACCOUNT',
            entityId: `${entityCode}:${c.input.accountCode}`,
            oldValue: c.before
              ? {
                  accountType: c.before.accountType,
                  fsli: c.before.fsliCode,
                  counterparty: c.before.counterpartyCode,
                }
              : null,
            newValue: {
              task: task.number,
              account: `${c.input.accountCode} ${c.line.accountName}`,
              accountType: data.accountType,
              fsli: data.fsliCode,
              counterparty: data.counterpartyCode,
              source: `Mapped in task ${task.number}`,
              ...(c.input.reason ? { reason: c.input.reason.trim() } : {}),
              ...(c.input.confirmWarnings ? { warningsConfirmed: true } : {}),
            },
            ip,
          },
          tx,
        );
      }
      if (changes.length > 0)
        await tx.task.update({ where: { id: taskId }, data: { updatedAt: new Date() } });
    });
    if (changes.length > 0)
      await this.guard.accountsChanged(user, entityCode, `Mapping changed (${changes.map((c) => c.input.accountCode).join(', ')})`, ip);
    await this.guard.changed(user, taskId, entityCode, 'Mapping changed', ip);
    return this.build(user, task, te);
  }

  // ---------------------------------------------------------------------------------------
  // Step completion
  // ---------------------------------------------------------------------------------------

  async continue(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    ip: string | null,
  ): Promise<{ currentStep: string }> {
    const task = await loadStepTask(this.prisma, user, taskId);
    const te = assertEditable(user, task, entityCode);
    const dto = await this.build(user, task, te);
    const c = dto.completion;
    if (!c.canContinue) {
      const why = [
        !dto.tb && 'the trial balance is not validated',
        dto.tb && !c.balanced && 'the trial balance does not balance',
        c.toMap > 0 && `${c.toMap} account(s) still to map`,
        !c.counterpartiesComplete && 'an intercompany or investment line has no counterparty',
      ].filter(Boolean);
      throw ApiError.validation(`Cannot continue yet: ${why.join('; ')}.`);
    }
    // Never move an entity backwards (e.g. one already in review).
    const next =
      stepIndex(te.currentStep) < stepIndex('COMPARATIVES') ? 'COMPARATIVES' : te.currentStep;
    await this.prisma.$transaction(async (tx) => {
      if (next !== te.currentStep) {
        await tx.taskEntity.update({
          where: { taskId_entityCode: { taskId, entityCode } },
          data: { currentStep: next },
        });
      }
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
            missingRates: c.missingRates,
          },
          ip,
        },
        tx,
      );
    });
    return { currentStep: next };
  }
}
