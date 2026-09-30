import { HttpStatus } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { deriveTaskStatus } from '@finance-close/engine';
import { ApiErrorCode, Permission } from '@finance-close/shared';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import type { PrismaService } from '../prisma/prisma.service';
import { inScope, taskInclude, taskVisibleTo } from '../tasks/tasks.service';

/**
 * Access rules shared by the SFS workspace steps: the task must be visible to the user (else
 * 404); preparing needs SFS_PREPARE and the entity in scope (403); a Done task or a finalised
 * entity is read-only (409).
 */
export const stepInclude = {
  ...taskInclude,
  entities: {
    include: {
      entity: { include: { translatedCurrencies: true, historicalRates: true } },
    },
  },
} satisfies Prisma.TaskInclude;
export type StepTask = Prisma.TaskGetPayload<{ include: typeof stepInclude }>;

export async function loadStepTask(
  prisma: PrismaService,
  user: AuthUser,
  taskId: string,
): Promise<StepTask> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: stepInclude });
  if (!task || !taskVisibleTo(task, user.entityScope)) throw ApiError.notFound('Task not found.');
  if (task.type !== 'SFS')
    throw ApiError.validation('This step is part of standalone (SFS) tasks.');
  return task;
}

export function isTaskLocked(task: StepTask): boolean {
  return deriveTaskStatus(task.entities.map((e) => e.status)) === 'DONE';
}

/** Why this user cannot change the entity's data now, or null if they can. */
export function readOnlyReason(user: AuthUser, task: StepTask, entityCode: string): string | null {
  const te = task.entities.find((e) => e.entityCode === entityCode);
  if (isTaskLocked(task)) return 'This task is done and locked.';
  if (te?.status === 'FINALISED') return 'Finalised — read-only.';
  if (!user.permissions.has(Permission.SfsPrepare))
    return 'You do not have permission to prepare statements.';
  if (!inScope(user.entityScope, entityCode)) return 'Outside your entity scope.';
  return null;
}

/** The task entity, if the user may change its data (403 / 404 / 409 otherwise). */
export function assertEditable(user: AuthUser, task: StepTask, entityCode: string) {
  const te = task.entities.find((e) => e.entityCode === entityCode);
  if (!te) throw ApiError.notFound(`Entity ${entityCode} is not in this task.`);
  if (!inScope(user.entityScope, entityCode))
    throw ApiError.notAllowed(`${entityCode} is outside your entity scope.`);
  if (isTaskLocked(task))
    throw new ApiError(
      HttpStatus.CONFLICT,
      ApiErrorCode.TaskLocked,
      'This task is done and locked. Its data cannot change.',
    );
  if (te.status === 'FINALISED')
    throw new ApiError(
      HttpStatus.CONFLICT,
      ApiErrorCode.EntityFinalised,
      `${te.entity.shortName} is finalised in this task. Its data is read-only; changes need an approved edit-access request.`,
    );
  return te;
}

/** The task entity, if the user may see it (404 otherwise). */
export function assertViewable(user: AuthUser, task: StepTask, entityCode: string) {
  const te = task.entities.find((e) => e.entityCode === entityCode);
  if (!te || !inScope(user.entityScope, entityCode))
    throw ApiError.notFound(`Entity ${entityCode} is not in this task.`);
  return te;
}
