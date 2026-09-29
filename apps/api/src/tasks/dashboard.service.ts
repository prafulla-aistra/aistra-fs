import { Injectable } from '@nestjs/common';
import {
  closeDeadline,
  countItemStatuses,
  defaultPeriodInClose,
  previousMonth,
  type IsoDate,
  type ItemStatus,
} from '@finance-close/engine';
import {
  Permission,
  type ConsolidationLevelDto,
  type DashboardDto,
  type PeriodOptionDto,
} from '@finance-close/shared';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { ClockService } from '../common/clock';
import { fromDbDate } from '../common/db-dates';
import { CalendarService } from '../configuration/calendar/calendar.service';
import { EntitiesService } from '../configuration/entities.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  inScope,
  isToContinue,
  itemsAwaitingReview,
  taskInclude,
  TasksService,
  type TaskWithItems,
} from './tasks.service';

interface Month extends PeriodOptionDto {
  startDate: IsoDate;
}

/**
 * Every number on the dashboard, from one place, so the cards always agree with each other
 * and with the task table. Counts respect the user's entity scope.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly tasks: TasksService,
    private readonly entities: EntitiesService,
    private readonly calendar: CalendarService,
  ) {}

  async get(user: AuthUser, periodId?: string): Promise<DashboardDto> {
    const today = this.clock.today();
    const months = await this.months();
    const selected = periodId
      ? months.find((m) => m.id === periodId)
      : (defaultPeriodInClose(months, today) ?? months[0]);
    if (periodId && !selected) throw ApiError.notFound('That month does not exist.');

    const scope = user.entityScope;
    const scopedEntities = (
      await this.prisma.entity.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      })
    ).filter((e) => inScope(scope, e.code));
    // Levels containing at least one entity in scope (all levels for an unscoped user).
    const scopedLevels = (await this.entities.groupStructure()).levels.filter((l) =>
      l.members.some((m) => inScope(scope, m.code)),
    );

    const visibleRows = await this.tasks.visible(user);
    const attention: DashboardDto['attention'] = {
      overdue: visibleRows.filter((t) => t.overdue).length,
    };
    if (
      user.permissions.has(Permission.SfsPrepare) ||
      user.permissions.has(Permission.CfsPrepare)
    ) {
      attention.toContinue = visibleRows.filter(isToContinue).length;
    }
    if (user.permissions.has(Permission.SfsReview) || user.permissions.has(Permission.CfsReview)) {
      attention.awaitingReview = visibleRows.reduce((n, t) => n + itemsAwaitingReview(t, user), 0);
    }
    if (user.permissions.has(Permission.EditAccessApprove)) attention.editAccessRequests = 0; // page not built yet

    const empty = { finalised: 0, total: 0, counts: countItemStatuses([]) };
    if (!selected) {
      return {
        today,
        periods: months.map(toOption),
        period: null,
        standalone: empty,
        consolidation: { ...empty, next: null },
        lastPeriod: null,
        attention,
      };
    }

    const last = previousMonth(months, selected);
    const tasks = await this.prisma.task.findMany({
      where: { periodId: { in: [selected.id, ...(last ? [last.id] : [])] } },
      include: taskInclude,
      orderBy: { createdAt: 'desc' },
    });

    const standaloneFor = (pid: string) => {
      const sfs = tasks.filter((t) => t.periodId === pid && t.type === 'SFS');
      const statuses = scopedEntities.map((e) => entityStatus(sfs, e.code));
      return summary(statuses);
    };
    const consolidationFor = (pid: string) => {
      const cfs = tasks.filter((t) => t.periodId === pid && t.type === 'CFS');
      const statuses = scopedLevels.map((l) => levelStatus(cfs, l));
      const nextIndex = statuses.findIndex((s) => s !== 'FINALISED');
      const nextLevel = nextIndex >= 0 ? scopedLevels[nextIndex]! : null;
      return {
        ...summary(statuses),
        next: nextLevel ? { level: nextLevel.level, name: nextLevel.name } : null,
      };
    };

    const standalone = standaloneFor(selected.id);
    const consolidation = consolidationFor(selected.id);
    const due = (await this.calendar.period(selected.id)).dueDates;
    const sfsDueDate = due.find((d) => d.statementType === 'SFS')!.effective;
    const cfsDueDate = due.find((d) => d.statementType === 'CFS')!.effective;
    const holidays = (await this.calendar.holidays()).map((h) => h.date);

    let lastPeriod: DashboardDto['lastPeriod'] = null;
    if (last) {
      const s = standaloneFor(last.id);
      const c = consolidationFor(last.id);
      const openItems = s.total - s.finalised + (c.total - c.finalised);
      lastPeriod = { id: last.id, label: last.label, done: openItems === 0, openItems };
    }

    return {
      today,
      periods: months.map(toOption),
      period: {
        id: selected.id,
        label: selected.label,
        fyLabel: selected.fyLabel,
        sfsDueDate,
        cfsDueDate,
        deadline: closeDeadline({
          today,
          sfsDue: sfsDueDate,
          cfsDue: cfsDueDate,
          sfsDone: standalone.finalised === standalone.total,
          cfsDone: consolidation.finalised === consolidation.total,
          holidays,
        }),
      },
      standalone,
      consolidation,
      lastPeriod,
      attention,
    };
  }

  private async months(): Promise<Month[]> {
    const rows = await this.prisma.period.findMany({
      where: { type: 'MONTHLY' },
      include: { financialYear: true },
      orderBy: { startDate: 'asc' },
    });
    return rows.map((p) => ({
      id: p.id,
      label: p.label,
      fyId: p.financialYearId,
      fyLabel: p.financialYear.label,
      status: p.status,
      startDate: fromDbDate(p.startDate),
      endDate: fromDbDate(p.endDate),
    }));
  }
}

function toOption(m: Month): PeriodOptionDto {
  return {
    id: m.id,
    label: m.label,
    fyId: m.fyId,
    fyLabel: m.fyLabel,
    status: m.status,
    endDate: m.endDate,
  };
}

function summary(statuses: ItemStatus[]) {
  const counts = countItemStatuses(statuses);
  return { finalised: counts.FINALISED, total: statuses.length, counts };
}

/** Status of an entity in a period: from the newest SFS task containing it; none = not started. */
function entityStatus(sfsNewestFirst: TaskWithItems[], entityCode: string): ItemStatus {
  for (const t of sfsNewestFirst) {
    const e = t.entities.find((x) => x.entityCode === entityCode);
    if (e) return e.status;
  }
  return 'NOT_STARTED';
}

/** Status of a derived level in a period: matched by its parent entity (level numbers can shift). */
function levelStatus(cfsNewestFirst: TaskWithItems[], level: ConsolidationLevelDto): ItemStatus {
  for (const t of cfsNewestFirst) {
    const l = t.levels.find((x) => x.parentEntityCode === level.parentCode);
    if (l) return l.status;
  }
  return 'NOT_STARTED';
}
