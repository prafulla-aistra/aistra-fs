import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  defaultPeriodInClose,
  deriveTaskStatus,
  hasPeriodEnded,
  nextTaskNumber,
  periodChoiceLabel,
  taskNumberPrefix,
} from '@finance-close/engine';
import {
  ApiErrorCode,
  AuditAction,
  type CreateTaskRequest,
  type PeriodType,
  type StatementType,
  type TaskDetailDto,
  type TaskRefDto,
  type WizardEntityDto,
  type WizardLevelsDto,
  type WizardOptionsDto,
  type WizardPeriodDto,
} from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { ClockService } from '../common/clock';
import { fromDbDate, toDbDate } from '../common/db-dates';
import { CalendarService } from '../configuration/calendar/calendar.service';
import { EntitiesService } from '../configuration/entities.service';
import { PrismaService } from '../prisma/prisma.service';
import { canPrepare, inScope, TasksService } from './tasks.service';

/** Step 1 of every new task. */
export const FIRST_STEP = 'UPLOAD_DATA';

const PERIOD_TYPE_WORD: Record<PeriodType, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  ANNUAL: 'Annual',
};

type TaskWithStatuses = Prisma.TaskGetPayload<{ include: { entities: true; levels: true } }>;

function ref(t: TaskWithStatuses): TaskRefDto {
  const statuses =
    t.type === 'SFS' ? t.entities.map((e) => e.status) : t.levels.map((l) => l.status);
  return { id: t.id, number: t.number, status: deriveTaskStatus(statuses) };
}

/** Default task description, e.g. "Monthly SFS – Aug-2026 – Statutory FS". */
export function defaultDescription(
  type: StatementType,
  periodType: PeriodType,
  periodLabel: string,
  formatName: string,
): string {
  return `${PERIOD_TYPE_WORD[periodType]} ${type} – ${periodLabel} – ${formatName}`;
}

/**
 * Page 2: the new-task wizard. Every tag, count and due date is computed here, and every rule
 * is enforced again on create — the web app's choices are never trusted.
 */
@Injectable()
export class TaskWizardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly calendar: CalendarService,
    private readonly entities: EntitiesService,
    private readonly tasks: TasksService,
  ) {}

  // ---------------------------------------------------------------- options

  async options(user: AuthUser): Promise<WizardOptionsDto> {
    const today = this.clock.today();
    const [years, formats, me, months] = await Promise.all([
      this.prisma.financialYear.findMany({
        where: { status: 'OPEN' },
        orderBy: { startYear: 'asc' },
      }),
      this.prisma.format.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { lastFormatCode: true },
      }),
      this.prisma.period.findMany({ where: { type: 'MONTHLY' } }),
    ]);
    const fyContainingToday = years.find(
      (y) => fromDbDate(y.startDate) <= today && today <= fromDbDate(y.endDate),
    );
    const inClose = defaultPeriodInClose(
      months.map((m) => ({
        id: m.id,
        startDate: fromDbDate(m.startDate),
        endDate: fromDbDate(m.endDate),
      })),
      today,
    );
    const types: WizardOptionsDto['types'] = [];
    if (canPrepare(user, 'SFS')) {
      types.push({
        type: 'SFS',
        label: 'Standalone financial statements (SFS)',
        description: 'Statements for one or more entities, each in its own functional currency.',
        enabled: true,
      });
    }
    if (canPrepare(user, 'CFS')) {
      types.push({
        type: 'CFS',
        label: 'Consolidated financial statements (CFS)',
        description: 'Group statements, level by level, from the entities’ finalised SFS.',
        enabled: true,
      });
    }
    types.push({
      type: 'MIS',
      label: 'MIS report',
      description: 'Management information reporting.',
      enabled: false,
      reason: 'Coming later',
    });
    return {
      types,
      financialYears: years.map((y) => ({
        id: y.id,
        label: y.label,
        startDate: fromDbDate(y.startDate),
        endDate: fromDbDate(y.endDate),
      })),
      defaultFyId: fyContainingToday?.id ?? years.at(-1)?.id ?? null,
      formats: formats.map((f) => ({ code: f.code, name: f.name, description: f.description })),
      defaultFormatCode: formats.some((f) => f.code === me.lastFormatCode)
        ? me.lastFormatCode
        : (formats[0]?.code ?? null),
      periodInCloseId: inClose?.id ?? null,
      preparer: { id: user.id, name: user.name },
    };
  }

  // ---------------------------------------------------------------- periods

  async periods(
    user: AuthUser,
    type: StatementType,
    fyId: string,
    periodType: PeriodType,
  ): Promise<WizardPeriodDto[]> {
    this.assertCanPrepare(user, type);
    const fy = await this.prisma.financialYear.findUnique({ where: { id: fyId } });
    if (!fy) throw ApiError.notFound('Financial year not found.');
    const today = this.clock.today();
    const periods = await this.prisma.period.findMany({
      where: { financialYearId: fyId, type: periodType },
      orderBy: { sequence: 'asc' },
    });
    const tasks = await this.prisma.task.findMany({
      where: { type, periodId: { in: periods.map((p) => p.id) } },
      include: { entities: true, levels: true },
      orderBy: { createdAt: 'asc' },
    });
    const scoped = await this.scopedEntityCodes(user);
    const inCloseId = (await this.options(user)).periodInCloseId;

    return Promise.all(
      periods.map(async (p): Promise<WizardPeriodDto> => {
        const periodTasks = tasks.filter((t) => t.periodId === p.id);
        const relevant =
          type === 'SFS'
            ? periodTasks.filter((t) => t.entities.some((e) => scoped.includes(e.entityCode)))
            : periodTasks;
        const covered = new Set(periodTasks.flatMap((t) => t.entities.map((e) => e.entityCode)));
        const remaining =
          type === 'SFS' ? scoped.filter((c) => !covered.has(c)).length : relevant.length ? 0 : 1;
        const endDate = fromDbDate(p.endDate);
        const availability =
          p.status === 'CLOSED' || fy.status === 'CLOSED'
            ? 'CLOSED'
            : !hasPeriodEnded(endDate, today)
              ? 'NOT_ENDED'
              : relevant.length > 0
                ? 'TASK_EXISTS'
                : 'AVAILABLE';
        const due = (await this.calendar.period(p.id)).dueDates.find(
          (d) => d.statementType === type,
        )!;
        return {
          id: p.id,
          label: periodChoiceLabel({
            type: p.type,
            sequence: p.sequence,
            startDate: fromDbDate(p.startDate),
            endDate,
            fyStartYear: fy.startYear,
          }),
          type: p.type,
          startDate: fromDbDate(p.startDate),
          endDate,
          availability,
          selectable: availability === 'AVAILABLE' || availability === 'TASK_EXISTS',
          existingTasks: relevant.map(ref),
          remaining,
          dueDate: due.effective,
          isPeriodInClose: p.id === inCloseId,
        };
      }),
    );
  }

  // ---------------------------------------------------------------- entities / levels

  async entityChoices(user: AuthUser, periodId: string): Promise<WizardEntityDto[]> {
    this.assertCanPrepare(user, 'SFS');
    await this.findPeriod(periodId);
    const [entities, tasks] = await Promise.all([
      this.prisma.entity.findMany({
        where: { isActive: true },
        include: { translatedCurrencies: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.task.findMany({
        where: { type: 'SFS', periodId },
        include: { entities: true, levels: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return entities
      .filter((e) => inScope(user.entityScope, e.code))
      .map((e) => {
        const task = tasks.find((t) => t.entities.some((x) => x.entityCode === e.code));
        return {
          code: e.code,
          shortName: e.shortName,
          legalName: e.legalName,
          functionalCurrency: e.functionalCurrency,
          translatedCurrencies: e.translatedCurrencies.map((t) => t.currencyCode).sort(),
          gaap: e.gaap,
          erp: e.erp,
          toBeConfirmed: e.toBeConfirmed,
          toBeConfirmedNote: e.toBeConfirmedNote,
          inTask: task ? ref(task) : null,
        };
      });
  }

  async levelChoices(user: AuthUser, periodId: string): Promise<WizardLevelsDto> {
    this.assertCanPrepare(user, 'CFS');
    const levelPeriod = await this.findPeriod(periodId);
    // Consolidation uses the ownership in force for the period.
    const structure = await this.entities.groupStructure(fromDbDate(levelPeriod.endDate));
    const [sfsTasks, cfsTask] = await Promise.all([
      this.prisma.task.findMany({
        where: { type: 'SFS', periodId },
        include: { entities: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.task.findFirst({
        where: { type: 'CFS', periodId },
        include: { entities: true, levels: true },
      }),
    ]);
    const statusOf = (code: string) =>
      sfsTasks
        .find((t) => t.entities.some((e) => e.entityCode === code))
        ?.entities.find((e) => e.entityCode === code)?.status;
    const levels = structure.levels.map((l) => ({
      level: l.level,
      name: l.name,
      currency: l.currency,
      members: l.members,
      sfsFinalised: l.members.filter((m) => statusOf(m.code) === 'FINALISED').length,
      sfsTotal: l.members.length,
    }));
    const blockedReason =
      structure.issues.length > 0
        ? 'The group structure is invalid, so consolidation levels cannot be derived. Fix it under Configuration → Entities.'
        : levels.length === 0
          ? 'The group has no consolidation levels (no entity has subsidiaries).'
          : !this.scopeCoversAll(
                user,
                levels.flatMap((l) => l.members.map((m) => m.code)),
              )
            ? 'Consolidation covers every entity in its levels; your access is limited to some entities, so you cannot create it.'
            : null;
    return {
      levels,
      existingTask: cfsTask ? ref(cfsTask) : null,
      canCreate: !cfsTask && blockedReason === null,
      blockedReason,
    };
  }

  // ---------------------------------------------------------------- create

  async create(user: AuthUser, req: CreateTaskRequest, ip: string | null): Promise<TaskDetailDto> {
    this.assertCanPrepare(user, req.type);
    const today = this.clock.today();
    const period = await this.prisma.period.findUnique({
      where: { id: req.periodId },
      include: { financialYear: true },
    });
    if (!period) throw ApiError.validation('Choose a valid period.');
    if (period.financialYear.status !== 'OPEN') {
      throw ApiError.notAllowed(
        `${period.financialYear.label} is closed; no new tasks can be created in it.`,
      );
    }
    if (period.status !== 'OPEN')
      throw ApiError.notAllowed(`${period.label} is closed; no new tasks can be created for it.`);
    if (!hasPeriodEnded(fromDbDate(period.endDate), today)) {
      throw ApiError.notAllowed(
        `${period.label} has not ended yet (it ends ${fromDbDate(period.endDate)}). A period can be prepared only after its end date.`,
      );
    }
    const format = await this.prisma.format.findUnique({ where: { code: req.formatCode } });
    if (!format || !format.isActive) throw ApiError.validation('Choose an active format.');

    let entityCodes: string[] = [];
    let levels: Awaited<ReturnType<EntitiesService['groupStructure']>>['levels'] = [];
    if (req.type === 'SFS') {
      entityCodes = [...new Set(req.entityCodes ?? [])];
      if (entityCodes.length === 0) throw ApiError.validation('Choose at least one entity.');
      const active = new Set(
        (
          await this.prisma.entity.findMany({ where: { isActive: true }, select: { code: true } })
        ).map((e) => e.code),
      );
      const unknown = entityCodes.filter((c) => !active.has(c));
      if (unknown.length > 0)
        throw ApiError.validation(`Unknown or inactive entity: ${unknown.join(', ')}.`);
      const outside = entityCodes.filter((c) => !inScope(user.entityScope, c));
      if (outside.length > 0)
        throw ApiError.notAllowed(`Your access does not include: ${outside.join(', ')}.`);
    } else {
      const structure = await this.entities.groupStructure(fromDbDate(period.endDate));
      if (structure.issues.length > 0 || structure.levels.length === 0) {
        throw ApiError.notAllowed(
          'Consolidation levels cannot be derived from the group structure.',
        );
      }
      levels = structure.levels;
      if (
        !this.scopeCoversAll(
          user,
          levels.flatMap((l) => l.members.map((m) => m.code)),
        )
      ) {
        throw ApiError.notAllowed(
          'Consolidation covers every entity in its levels; your access is limited to some entities.',
        );
      }
    }

    const due = (await this.calendar.period(period.id)).dueDates.find(
      (d) => d.statementType === req.type,
    )!;
    const prefix = taskNumberPrefix(req.type, {
      type: period.type,
      sequence: period.sequence,
      startDate: fromDbDate(period.startDate),
      fyStartYear: period.financialYear.startYear,
    });

    const id = await this.prisma.$transaction(async (tx) => {
      // One creation at a time per period, so duplicate checks and numbering cannot race.
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`task-create:${period.id}`}))`;

      const existing = await tx.task.findMany({
        where: { type: req.type, periodId: period.id },
        include: { entities: true },
      });
      if (req.type === 'CFS' && existing.length > 0) {
        throw conflict(
          `A CFS task already exists for ${period.label}: ${existing[0]!.number}.`,
          existing.map((t) => t.number),
        );
      }
      const clashes = existing.flatMap((t) =>
        t.entities
          .filter((e) => entityCodes.includes(e.entityCode))
          .map((e) => ({ code: e.entityCode, number: t.number })),
      );
      if (clashes.length > 0) {
        throw conflict(
          `Already in a task for ${period.label}: ${clashes.map((c) => `${c.code} (${c.number})`).join(', ')}.`,
          [...new Set(clashes.map((c) => c.number))],
        );
      }

      const used = await tx.task.findMany({
        where: { number: { startsWith: `${prefix}-` } },
        select: { number: true },
      });
      const number = nextTaskNumber(
        prefix,
        used.map((u) => u.number),
      );
      const description =
        req.description.trim() ||
        defaultDescription(req.type, period.type, period.label, format.name);
      const task = await tx.task.create({
        data: {
          number,
          type: req.type,
          periodId: period.id,
          formatCode: format.code,
          formatVersion: format.currentVersion,
          description,
          reviewerNote: req.reviewerNote?.trim() || null,
          dueDate: toDbDate(due.effective),
          currentStep: FIRST_STEP,
          createdById: user.id,
          entities:
            req.type === 'SFS'
              ? {
                  create: entityCodes.map((entityCode) => ({
                    entityCode,
                    status: 'NOT_STARTED',
                    currentStep: FIRST_STEP,
                  })),
                }
              : undefined,
          levels:
            req.type === 'CFS'
              ? {
                  create: levels.map((l) => ({
                    level: l.level,
                    name: l.name,
                    parentEntityCode: l.parentCode,
                    currency: l.currency,
                    members: l.members.map((m) => m.code),
                    status: 'NOT_STARTED',
                    currentStep: FIRST_STEP,
                  })),
                }
              : undefined,
        },
      });
      await tx.user.update({ where: { id: user.id }, data: { lastFormatCode: format.code } });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.TaskCreate,
          entityType: 'TASK',
          entityId: number,
          newValue: {
            number,
            type: req.type,
            period: period.label,
            periodType: period.type,
            format: format.name,
            dueDate: due.effective,
            description,
            ...(req.type === 'SFS'
              ? { entities: entityCodes }
              : { levels: levels.map((l) => `L${l.level} ${l.name}`) }),
          },
          ip,
        },
        tx,
      );
      return task.id;
    });
    return this.tasks.get(user, id);
  }

  // ---------------------------------------------------------------- helpers

  private assertCanPrepare(user: AuthUser, type: StatementType): void {
    if (!canPrepare(user, type)) {
      const code = type === 'SFS' ? 'SFS_PREPARE' : 'CFS_PREPARE';
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        ApiErrorCode.PermissionDenied,
        `You don't have access to create ${type} tasks. It needs the ${code} permission — ask a user administrator.`,
        { requiredPermission: code },
      );
    }
  }

  private async findPeriod(id: string) {
    const p = await this.prisma.period.findUnique({ where: { id } });
    if (!p) throw ApiError.notFound('Period not found.');
    return p;
  }

  private async scopedEntityCodes(user: AuthUser): Promise<string[]> {
    const rows = await this.prisma.entity.findMany({
      where: { isActive: true },
      select: { code: true },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((r) => r.code).filter((c) => inScope(user.entityScope, c));
  }

  private scopeCoversAll(user: AuthUser, codes: string[]): boolean {
    return codes.every((c) => inScope(user.entityScope, c));
  }
}

function conflict(message: string, existingTasks: string[]): ApiError {
  return new ApiError(HttpStatus.CONFLICT, ApiErrorCode.Conflict, message, { existingTasks });
}
