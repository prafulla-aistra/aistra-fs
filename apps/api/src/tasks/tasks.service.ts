import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { deriveTaskStatus, isOverdue, needsPreparation, type IsoDate } from '@finance-close/engine';
import {
  Permission,
  type ItemStatus,
  type StatementType,
  type TaskDetailDto,
  type TaskListPage,
  type TaskListQuery,
  type TaskRowDto,
  type TaskSort,
} from '@finance-close/shared';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { ClockService } from '../common/clock';
import { fromDbDate } from '../common/db-dates';
import { PrismaService } from '../prisma/prisma.service';

export const taskInclude = {
  period: { include: { financialYear: true } },
  createdBy: { select: { name: true } },
  format: { select: { name: true } },
  entities: { include: { entity: { select: { shortName: true, sortOrder: true } } } },
  levels: true,
} satisfies Prisma.TaskInclude;
export type TaskWithItems = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

/** null = all entities. */
export function inScope(scope: string[] | null, entityCode: string): boolean {
  return scope === null || scope.includes(entityCode);
}

/** A user sees a task if it contains an entity in their scope (CFS: a level member). */
export function taskVisibleTo(task: TaskWithItems, scope: string[] | null): boolean {
  return task.type === 'SFS'
    ? task.entities.some((e) => inScope(scope, e.entityCode))
    : task.levels.some((l) => l.members.some((m) => inScope(scope, m)));
}

export function canPrepare(user: AuthUser, type: StatementType): boolean {
  return user.permissions.has(type === 'SFS' ? Permission.SfsPrepare : Permission.CfsPrepare);
}

export function canReview(user: AuthUser, type: StatementType): boolean {
  return user.permissions.has(type === 'SFS' ? Permission.SfsReview : Permission.CfsReview);
}

/** SFS task with an entity in the user's scope that is Not started or In progress. */
export function hasEntitiesToPrepare(t: TaskRowDto): boolean {
  return t.type === 'SFS' && t.items.some((i) => needsPreparation(i.status));
}

/** SFS task with an entity in the user's scope in review, for a user with SFS_REVIEW. */
export function hasEntitiesAwaitingReview(t: TaskRowDto, user: AuthUser): boolean {
  return (
    t.type === 'SFS' && canReview(user, 'SFS') && t.items.some((i) => i.status === 'IN_REVIEW')
  );
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  /** Every task the user may see, as table rows, newest first. */
  async visible(
    user: AuthUser,
    where: Prisma.TaskWhereInput = {},
    sort?: TaskSort,
  ): Promise<TaskRowDto[]> {
    const today = this.clock.today();
    const tasks = await this.prisma.task.findMany({
      where,
      include: taskInclude,
      orderBy: sort
        ? [
            { period: { endDate: sort === 'PERIOD_ASC' ? 'asc' : 'desc' } },
            { period: { startDate: sort === 'PERIOD_ASC' ? 'asc' : 'desc' } },
            { createdAt: 'desc' },
            { number: 'desc' },
          ]
        : [{ createdAt: 'desc' }, { number: 'desc' }],
    });
    return tasks
      .filter((t) => taskVisibleTo(t, user.entityScope))
      .map((t) => toRow(t, user, today));
  }

  async list(
    user: AuthUser,
    q: Required<Pick<TaskListQuery, 'page' | 'pageSize'>> & TaskListQuery,
  ): Promise<TaskListPage> {
    const where: Prisma.TaskWhereInput = {
      ...(q.periodId ? { periodId: q.periodId } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.fyId || q.periodType
        ? {
            period: {
              ...(q.fyId ? { financialYearId: q.fyId } : {}),
              ...(q.periodType ? { type: q.periodType } : {}),
            },
          }
        : {}),
      ...(q.search?.trim()
        ? {
            OR: [
              { description: { contains: q.search.trim(), mode: 'insensitive' as const } },
              { number: { contains: q.search.trim(), mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    let rows = await this.visible(user, where, q.sort);
    // Status is derived, so it is filtered after deriving it.
    if (q.status) {
      rows = rows.filter((t) => {
        switch (q.status) {
          case 'OVERDUE':
            return t.overdue;
          case 'TO_PREPARE':
            return hasEntitiesToPrepare(t);
          case 'AWAITING_REVIEW':
            return hasEntitiesAwaitingReview(t, user);
          default:
            return t.status === q.status;
        }
      });
    }
    const start = (q.page - 1) * q.pageSize;
    return {
      items: rows.slice(start, start + q.pageSize),
      total: rows.length,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async get(user: AuthUser, id: string): Promise<TaskDetailDto> {
    const task = await this.prisma.task.findUnique({ where: { id }, include: taskInclude });
    // Not in scope is reported as not found, so task numbers outside the scope do not leak.
    if (!task || !taskVisibleTo(task, user.entityScope)) throw ApiError.notFound('Task not found.');
    const row = toRow(task, user, this.clock.today());
    return { ...row, readOnly: row.action === 'VIEW', reviewerNote: task.reviewerNote };
  }
}

export function toRow(t: TaskWithItems, user: AuthUser, today: IsoDate): TaskRowDto {
  const scope = user.entityScope;
  const allStatuses: ItemStatus[] =
    t.type === 'SFS' ? t.entities.map((e) => e.status) : t.levels.map((l) => l.status);
  const status = deriveTaskStatus(allStatuses);
  const dueDate = fromDbDate(t.dueDate);
  const items =
    t.type === 'SFS'
      ? [...t.entities]
          .filter((e) => inScope(scope, e.entityCode))
          .sort((a, b) => a.entity.sortOrder - b.entity.sortOrder)
          .map((e) => ({ code: e.entityCode, label: e.entity.shortName, status: e.status }))
      : [...t.levels]
          .filter((l) => l.members.some((m) => inScope(scope, m)))
          .sort((a, b) => a.level - b.level)
          .map((l) => ({ code: `L${l.level}`, label: l.name, status: l.status }));
  // Continue while any entity/level in the user's scope still needs preparing.
  const actionable = items.some((i) => needsPreparation(i.status));
  return {
    id: t.id,
    number: t.number,
    type: t.type,
    periodId: t.periodId,
    periodLabel: t.period.label,
    periodType: t.period.type,
    fyLabel: t.period.financialYear.label,
    description: t.description,
    format: t.format?.name ?? null,
    dueDate,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    createdBy: t.createdBy.name,
    currentStep: t.currentStep,
    status,
    overdue: isOverdue(status, dueDate, today),
    locked: status === 'DONE',
    action: actionable && canPrepare(user, t.type) ? 'CONTINUE' : 'VIEW',
    itemKind: t.type === 'SFS' ? 'ENTITY' : 'LEVEL',
    items,
    itemTotal: allStatuses.length,
  };
}
