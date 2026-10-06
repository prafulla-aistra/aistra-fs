import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { calculateDueDate, fyLabel, isIsoDate, type IsoDate } from '@finance-close/engine';
import {
  AuditAction,
  FINANCIAL_YEAR_START_YEARS,
  type DueDateDto,
  type DueDateRuleDto,
  type FinancialYearDto,
  type FinancialYearOption,
  GROUP_CALENDAR,
  type HolidayCalendarsDto,
  type HolidayDto,
  type PeriodDto,
  type PeriodStatus,
  type PeriodType,
  type StatementType,
} from '@finance-close/shared';
import { AuditService } from '../../audit/audit.service';
import type { AuthUser } from '../../auth/session-user';
import { ApiError } from '../../common/api-error';
import { fromDbDate, toDbDate } from '../../common/db-dates';
import { PrismaService } from '../../prisma/prisma.service';
import { financialYearCreateData } from './financial-year-data';

const STATEMENT_TYPES: StatementType[] = ['SFS', 'CFS'];
const PERIOD_ORDER: Record<PeriodType, number> = { MONTHLY: 0, QUARTERLY: 1, ANNUAL: 2 };

const periodInclude = {
  statusChangedBy: { select: { name: true } },
  dueDateOverrides: { include: { createdBy: { select: { name: true } } } },
} satisfies Prisma.PeriodInclude;
type PeriodRow = Prisma.PeriodGetPayload<{ include: typeof periodInclude }>;

interface DueDateContext {
  rules: Map<string, number>;
  /** The group calendar (drives every due date). */
  holidays: IsoDate[];
  /** Per-entity calendars (only when switched on): entity → its calendar's holidays. */
  entityCalendars: { entityCode: string; calendar: string; holidays: IsoDate[] }[];
}

export const PER_ENTITY_HOLIDAYS = 'PER_ENTITY_HOLIDAYS';

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- financial years

  async financialYears(): Promise<FinancialYearDto[]> {
    const [years, ctx] = await Promise.all([
      this.prisma.financialYear.findMany({
        orderBy: { startYear: 'asc' },
        include: { periods: { include: periodInclude } },
      }),
      this.dueDateContext(),
    ]);
    return years.map((fy) => ({
      id: fy.id,
      startYear: fy.startYear,
      label: fy.label,
      startDate: fromDbDate(fy.startDate),
      endDate: fromDbDate(fy.endDate),
      periods: fy.periods
        .sort((a, b) => PERIOD_ORDER[a.type] - PERIOD_ORDER[b.type] || a.sequence - b.sequence)
        .map((p) => toPeriodDto(p, ctx)),
    }));
  }

  async financialYearOptions(): Promise<FinancialYearOption[]> {
    const existing = new Set(
      (await this.prisma.financialYear.findMany({ select: { startYear: true } })).map(
        (f) => f.startYear,
      ),
    );
    return FINANCIAL_YEAR_START_YEARS.map((startYear) => ({
      startYear,
      label: fyLabel(startYear),
      exists: existing.has(startYear),
    }));
  }

  async createFinancialYear(
    actor: AuthUser,
    startYear: number,
    ip: string | null,
  ): Promise<FinancialYearDto> {
    if (!(FINANCIAL_YEAR_START_YEARS as readonly number[]).includes(startYear)) {
      throw ApiError.validation(
        `Choose one of: ${FINANCIAL_YEAR_START_YEARS.map((y) => fyLabel(y)).join(', ')}.`,
      );
    }
    if (await this.prisma.financialYear.findUnique({ where: { startYear } })) {
      throw ApiError.conflict(`${fyLabel(startYear)} already exists.`);
    }
    const fy = await this.prisma.$transaction(async (tx) => {
      const created = await tx.financialYear.create({
        data: financialYearCreateData(startYear, actor.id),
        include: { periods: true },
      });
      await this.audit.record(
        {
          userId: actor.id,
          action: AuditAction.FinancialYearCreate,
          entityType: 'FINANCIAL_YEAR',
          entityId: created.label,
          newValue: {
            label: created.label,
            startDate: fromDbDate(created.startDate),
            endDate: fromDbDate(created.endDate),
            periods: created.periods.length,
          },
          ip,
        },
        tx,
      );
      return created;
    });
    return (await this.financialYears()).find((f) => f.id === fy.id)!;
  }

  async setPeriodStatus(
    actor: AuthUser,
    periodId: string,
    status: PeriodStatus,
    ip: string | null,
  ): Promise<PeriodDto> {
    const before = await this.findPeriod(periodId);
    if (before.status === status) return this.period(periodId);
    await this.prisma.$transaction(async (tx) => {
      await tx.period.update({
        where: { id: periodId },
        data: { status, statusChangedAt: new Date(), statusChangedById: actor.id },
      });
      await this.audit.record(
        {
          userId: actor.id,
          action: status === 'CLOSED' ? AuditAction.PeriodClose : AuditAction.PeriodReopen,
          entityType: 'PERIOD',
          entityId: before.label,
          oldValue: { status: before.status },
          newValue: { status },
          ip,
        },
        tx,
      );
    });
    return this.period(periodId);
  }

  // ---------------------------------------------------------------- due-date overrides

  async overrideDueDate(
    actor: AuthUser,
    periodId: string,
    statementType: StatementType,
    dueDate: IsoDate,
    reason: string,
    ip: string | null,
  ): Promise<PeriodDto> {
    const period = await this.findPeriod(periodId);
    if (!isIsoDate(dueDate)) throw ApiError.validation('Enter a valid due date.');
    if (dueDate <= fromDbDate(period.endDate)) {
      throw ApiError.validation(
        `The due date must be after the period end (${fromDbDate(period.endDate)}).`,
      );
    }
    const before = (await this.period(periodId)).dueDates.find(
      (d) => d.statementType === statementType,
    )!;

    await this.prisma.$transaction(async (tx) => {
      await tx.dueDateOverride.upsert({
        where: { periodId_statementType: { periodId, statementType } },
        create: {
          periodId,
          statementType,
          dueDate: toDbDate(dueDate),
          reason,
          createdById: actor.id,
        },
        update: {
          dueDate: toDbDate(dueDate),
          reason,
          createdById: actor.id,
          createdAt: new Date(),
        },
      });
      await this.audit.record(
        {
          userId: actor.id,
          action: AuditAction.DueDateOverrideSet,
          entityType: 'PERIOD',
          entityId: period.label,
          oldValue: {
            task: taskLabel(period.type, statementType),
            dueDate: before.effective,
            overridden: Boolean(before.override),
          },
          newValue: {
            task: taskLabel(period.type, statementType),
            dueDate,
            reason,
            calculated: before.calculated,
          },
          ip,
        },
        tx,
      );
    });
    return this.period(periodId);
  }

  async clearOverride(
    actor: AuthUser,
    periodId: string,
    statementType: StatementType,
    reason: string,
    ip: string | null,
  ): Promise<PeriodDto> {
    const period = await this.findPeriod(periodId);
    const before = (await this.period(periodId)).dueDates.find(
      (d) => d.statementType === statementType,
    )!;
    if (!before.override) throw ApiError.validation('This due date is not overridden.');

    await this.prisma.$transaction(async (tx) => {
      await tx.dueDateOverride.delete({
        where: { periodId_statementType: { periodId, statementType } },
      });
      await this.audit.record(
        {
          userId: actor.id,
          action: AuditAction.DueDateOverrideClear,
          entityType: 'PERIOD',
          entityId: period.label,
          oldValue: {
            task: taskLabel(period.type, statementType),
            dueDate: before.override!.dueDate,
            reason: before.override!.reason,
          },
          newValue: {
            task: taskLabel(period.type, statementType),
            dueDate: before.calculated,
            reason,
          },
          ip,
        },
        tx,
      );
    });
    return this.period(periodId);
  }

  // ---------------------------------------------------------------- rules and holidays

  async rules(): Promise<DueDateRuleDto[]> {
    const rows = await this.prisma.dueDateRule.findMany();
    return rows
      .map((r) => ({
        statementType: r.statementType,
        periodType: r.periodType,
        workingDays: r.workingDays,
      }))
      .sort(
        (a, b) =>
          a.statementType.localeCompare(b.statementType) ||
          PERIOD_ORDER[a.periodType] - PERIOD_ORDER[b.periodType],
      );
  }

  async updateRule(
    actor: AuthUser,
    statementType: StatementType,
    periodType: PeriodType,
    workingDays: number,
    ip: string | null,
  ): Promise<DueDateRuleDto> {
    const key = { statementType_periodType: { statementType, periodType } };
    const before = await this.prisma.dueDateRule.findUnique({ where: key });
    await this.prisma.$transaction(async (tx) => {
      await tx.dueDateRule.upsert({
        where: key,
        create: { statementType, periodType, workingDays },
        update: { workingDays },
      });
      if (before?.workingDays !== workingDays) {
        await this.audit.record(
          {
            userId: actor.id,
            action: AuditAction.DueDateRuleUpdate,
            entityType: 'DUE_DATE_RULE',
            entityId: taskLabel(periodType, statementType),
            oldValue: before ? { workingDays: before.workingDays } : null,
            newValue: { workingDays },
            ip,
          },
          tx,
        );
      }
    });
    return { statementType, periodType, workingDays };
  }

  async holidays(): Promise<HolidayDto[]> {
    const rows = await this.prisma.holiday.findMany({
      orderBy: [{ date: 'asc' }, { calendar: 'asc' }],
    });
    return rows.map((h) => ({
      id: h.id,
      date: fromDbDate(h.date),
      description: h.description,
      calendar: h.calendar,
    }));
  }

  async holidayCalendars(actor: AuthUser, canEdit: boolean): Promise<HolidayCalendarsDto> {
    void actor;
    const [setting, cals, entities] = await Promise.all([
      this.prisma.appSetting.findUnique({ where: { key: PER_ENTITY_HOLIDAYS } }),
      this.prisma.holiday.findMany({ distinct: ['calendar'], select: { calendar: true } }),
      this.prisma.entity.findMany({ orderBy: { sortOrder: 'asc' } }),
    ]);
    const names = [
      ...new Set([
        GROUP_CALENDAR,
        ...cals.map((c) => c.calendar),
        ...entities.flatMap((e) => (e.holidayCalendar ? [e.holidayCalendar] : [])),
      ]),
    ];
    return {
      perEntity: String(setting?.value ?? 'false') === 'true',
      calendars: [GROUP_CALENDAR, ...names.filter((n) => n !== GROUP_CALENDAR).sort()],
      entities: entities.map((e) => ({
        code: e.code,
        shortName: e.shortName,
        holidayCalendar: e.holidayCalendar,
      })),
      canEdit,
    };
  }

  async saveHolidayCalendars(
    actor: AuthUser,
    input: { perEntity: boolean; entities: { code: string; holidayCalendar: string | null }[] },
    ip: string | null,
  ): Promise<HolidayCalendarsDto> {
    const before = await this.holidayCalendars(actor, true);
    const known = new Set(before.entities.map((e) => e.code));
    const unknown = input.entities.filter((e) => !known.has(e.code));
    if (unknown.length) throw ApiError.notFound(`Entity ${unknown[0]!.code} not found.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.appSetting.upsert({
        where: { key: PER_ENTITY_HOLIDAYS },
        create: { key: PER_ENTITY_HOLIDAYS, value: String(input.perEntity) },
        update: { value: String(input.perEntity) },
      });
      for (const e of input.entities) {
        const cal =
          e.holidayCalendar && e.holidayCalendar !== GROUP_CALENDAR ? e.holidayCalendar : null;
        await tx.entity.update({ where: { code: e.code }, data: { holidayCalendar: cal } });
      }
      const after = {
        perEntity: input.perEntity,
        entities: Object.fromEntries(
          before.entities.map((e) => {
            const x = input.entities.find((y) => y.code === e.code);
            const cal = x
              ? x.holidayCalendar && x.holidayCalendar !== GROUP_CALENDAR
                ? x.holidayCalendar
                : null
              : e.holidayCalendar;
            return [e.code, cal];
          }),
        ),
      };
      await this.audit.record(
        {
          userId: actor.id,
          action: AuditAction.HolidayCalendarsUpdate,
          entityType: 'SETTING',
          entityId: PER_ENTITY_HOLIDAYS,
          oldValue: {
            perEntity: before.perEntity,
            entities: Object.fromEntries(before.entities.map((e) => [e.code, e.holidayCalendar])),
          },
          newValue: after,
          ip,
        },
        tx,
      );
    });
    return this.holidayCalendars(actor, true);
  }

  async createHoliday(
    actor: AuthUser,
    date: IsoDate,
    description: string,
    ip: string | null,
    calendar: string = GROUP_CALENDAR,
  ): Promise<HolidayDto> {
    const h = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.holiday.create({
          data: { date: toDbDate(date), description, calendar },
        });
        await this.audit.record(
          {
            userId: actor.id,
            action: AuditAction.HolidayCreate,
            entityType: 'HOLIDAY',
            entityId: date,
            newValue: { date, description, calendar },
            ip,
          },
          tx,
        );
        return created;
      })
      .catch(duplicateHoliday(date, calendar));
    return { id: h.id, date, description, calendar };
  }

  async updateHoliday(
    actor: AuthUser,
    id: string,
    date: IsoDate,
    description: string,
    ip: string | null,
    calendarIn?: string,
  ): Promise<HolidayDto> {
    const before = await this.findHoliday(id);
    const calendar = calendarIn ?? before.calendar;
    const old = {
      date: fromDbDate(before.date),
      description: before.description,
      calendar: before.calendar,
    };
    await this.prisma
      .$transaction(async (tx) => {
        await tx.holiday.update({
          where: { id },
          data: { date: toDbDate(date), description, calendar },
        });
        if (old.date !== date || old.description !== description || old.calendar !== calendar) {
          await this.audit.record(
            {
              userId: actor.id,
              action: AuditAction.HolidayUpdate,
              entityType: 'HOLIDAY',
              entityId: date,
              oldValue: old,
              newValue: { date, description, calendar },
              ip,
            },
            tx,
          );
        }
      })
      .catch(duplicateHoliday(date, calendar));
    return { id, date, description, calendar };
  }

  async deleteHoliday(actor: AuthUser, id: string, ip: string | null): Promise<void> {
    const before = await this.findHoliday(id);
    const date = fromDbDate(before.date);
    await this.prisma.$transaction(async (tx) => {
      await tx.holiday.delete({ where: { id } });
      await this.audit.record(
        {
          userId: actor.id,
          action: AuditAction.HolidayDelete,
          entityType: 'HOLIDAY',
          entityId: date,
          oldValue: { date, description: before.description, calendar: before.calendar },
          ip,
        },
        tx,
      );
    });
  }

  // ---------------------------------------------------------------- helpers

  /** One period with its SFS and CFS due dates (calculated or overridden). */
  async period(id: string): Promise<PeriodDto> {
    const [row, ctx] = await Promise.all([
      this.prisma.period.findUniqueOrThrow({ where: { id }, include: periodInclude }),
      this.dueDateContext(),
    ]);
    return toPeriodDto(row, ctx);
  }

  private async findPeriod(id: string) {
    const p = await this.prisma.period.findUnique({ where: { id } });
    if (!p) throw ApiError.notFound('Period not found.');
    return p;
  }

  private async findHoliday(id: string) {
    const h = await this.prisma.holiday.findUnique({ where: { id } });
    if (!h) throw ApiError.notFound('Holiday not found.');
    return h;
  }

  private async dueDateContext(): Promise<DueDateContext> {
    const [rules, holidays, setting, entities] = await Promise.all([
      this.prisma.dueDateRule.findMany(),
      this.holidays(),
      this.prisma.appSetting.findUnique({ where: { key: PER_ENTITY_HOLIDAYS } }),
      this.prisma.entity.findMany({
        where: { holidayCalendar: { not: null }, isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);
    const on = String(setting?.value ?? 'false') === 'true';
    return {
      rules: new Map(rules.map((r) => [`${r.statementType}:${r.periodType}`, r.workingDays])),
      holidays: holidays.filter((h) => h.calendar === GROUP_CALENDAR).map((h) => h.date),
      entityCalendars: on
        ? entities.map((e) => ({
            entityCode: e.code,
            calendar: e.holidayCalendar!,
            holidays: holidays.filter((h) => h.calendar === e.holidayCalendar).map((h) => h.date),
          }))
        : [],
    };
  }
}

function toPeriodDto(p: PeriodRow, ctx: DueDateContext): PeriodDto {
  const end = fromDbDate(p.endDate);
  const dueDates = STATEMENT_TYPES.map((statementType): DueDateDto => {
    const workingDays = ctx.rules.get(`${statementType}:${p.type}`) ?? 0;
    const calculated = calculateDueDate(end, workingDays, ctx.holidays);
    const o = p.dueDateOverrides.find((x) => x.statementType === statementType);
    const override = o
      ? {
          dueDate: fromDbDate(o.dueDate),
          reason: o.reason,
          by: o.createdBy.name,
          at: o.createdAt.toISOString(),
        }
      : null;
    return {
      statementType,
      workingDays,
      calculated,
      override,
      effective: override?.dueDate ?? calculated,
    };
  });
  return {
    id: p.id,
    type: p.type,
    sequence: p.sequence,
    label: p.label,
    startDate: fromDbDate(p.startDate),
    endDate: end,
    status: p.status,
    statusChangedAt: p.statusChangedAt?.toISOString() ?? null,
    statusChangedBy: p.statusChangedBy?.name ?? null,
    dueDates,
    entityDueDates: ctx.entityCalendars.map((c) => ({
      entityCode: c.entityCode,
      calendar: c.calendar,
      calculated: calculateDueDate(end, ctx.rules.get(`SFS:${p.type}`) ?? 0, c.holidays),
    })),
  };
}

/** "Monthly SFS" etc. */
function taskLabel(periodType: PeriodType, statementType: StatementType): string {
  const p = { MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', ANNUAL: 'Annual' }[periodType];
  return `${p} ${statementType}`;
}

function duplicateHoliday(date: IsoDate, calendar: string) {
  return (err: unknown): never => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw ApiError.conflict(
        `There is already a holiday on ${date}${calendar === GROUP_CALENDAR ? '' : ` in the ${calendar} calendar`}.`,
      );
    }
    throw err;
  };
}
