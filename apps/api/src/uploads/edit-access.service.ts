import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ApiErrorCode,
  AuditAction,
  Permission,
  type EditAccessRequestDto,
} from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { inScope } from '../tasks/tasks.service';

type Tx = Prisma.TransactionClient;

/** "L1" … : a consolidation level of a CFS task (page 10). */
export const isLevelKey = (code: string) => /^L\d+$/.test(code);

/** What happens when edit access is granted (page 8 stores the working copy, etc.). */
export interface ReopenHook {
  reopen(
    tx: Tx,
    user: AuthUser,
    taskId: string,
    entityCode: string,
    ip: string | null,
  ): Promise<void>;
}

const include = {
  task: { include: { period: true } },
  requestedBy: { select: { name: true } },
  decidedBy: { select: { name: true } },
} satisfies Prisma.EditAccessRequestInclude;

/**
 * Edit-access requests: a preparer asks to reopen a finalised entity; a user with
 * EDIT_ACCESS_APPROVE (not the requester) approves or rejects. Approval reopens the entity.
 */
@Injectable()
export class EditAccessService {
  private hook: ReopenHook | null = null;
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private levelHook: ReopenHook | null = null;

  setReopenHook(hook: ReopenHook) {
    this.hook = hook;
  }

  /** CFS levels (page 10): requests keyed "L<n>" reopen the level. */
  setLevelReopenHook(hook: ReopenHook) {
    this.levelHook = hook;
  }

  /** Why the entity cannot be reopened now (a finalised CFS level that includes it), or null. */
  async reopenBlocked(
    db: Tx | PrismaService,
    taskId: string,
    entityCode: string,
  ): Promise<string | null> {
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    if (isLevelKey(entityCode)) {
      // A level reopens only while no higher finalised level of the task includes it.
      const levels = await db.taskLevel.findMany({ where: { taskId } });
      const me = levels.find((l) => `L${l.level}` === entityCode);
      const higher = levels
        .filter(
          (l) =>
            me &&
            l.level > me.level &&
            l.status === 'FINALISED' &&
            me.members.every((m) => l.members.includes(m)),
        )
        .sort((a, b) => b.level - a.level)[0];
      return higher
        ? `Reopen Level ${higher.level} ${higher.name} first: it is finalised and includes Level ${me!.level} ${me!.name}.`
        : null;
    }
    const level = await db.taskLevel.findFirst({
      where: {
        status: 'FINALISED',
        members: { has: entityCode },
        task: { type: 'CFS', periodId: task.periodId },
      },
      include: { task: true },
      orderBy: { level: 'desc' },
    });
    return level
      ? `Reopen the consolidation first: ${level.task.number} level L${level.level} ${level.name} is finalised and includes ${entityCode}.`
      : null;
  }

  /**
   * Segregation of duties (decision round 1, Q6): nobody decides their own request, nor one for
   * an entity or level they prepared (submitted for review) or last edited in that task.
   */
  async decideConflict(
    userId: string,
    r: { taskId: string; entityCode: string; requestedById: string },
  ): Promise<string | null> {
    if (r.requestedById === userId) return 'You cannot decide your own request.';
    const what = isLevelKey(r.entityCode) ? `Level ${r.entityCode.slice(1)}` : r.entityCode;
    const submitted = await this.prisma.reviewSubmission.findFirst({
      where: { taskId: r.taskId, entityCode: r.entityCode, submittedById: userId },
      select: { id: true },
    });
    if (submitted)
      return `You prepared ${what} in this task, so you cannot decide its edit-access request.`;
    const row = isLevelKey(r.entityCode)
      ? await this.prisma.taskLevel.findFirst({
          where: { taskId: r.taskId, level: Number(r.entityCode.slice(1)) },
          select: { lastEditedById: true },
        })
      : await this.prisma.taskEntity.findFirst({
          where: { taskId: r.taskId, entityCode: r.entityCode },
          select: { lastEditedById: true },
        });
    if (row?.lastEditedById === userId)
      return `You last edited ${what} in this task, so you cannot decide its edit-access request.`;
    return null;
  }

  private async toDto(
    user: AuthUser,
    r: Prisma.EditAccessRequestGetPayload<{ include: typeof include }>,
  ): Promise<EditAccessRequestDto> {
    const level = isLevelKey(r.entityCode)
      ? await this.prisma.taskLevel.findFirst({
          where: { taskId: r.taskId, level: Number(r.entityCode.slice(1)) },
        })
      : null;
    const entity = level
      ? { legalName: `Level ${level.level} ${level.name} (consolidation)` }
      : await this.prisma.entity.findUnique({ where: { code: r.entityCode } });
    const conflict = r.status === 'PENDING' ? await this.decideConflict(user.id, r) : null;
    return {
      id: r.id,
      taskId: r.taskId,
      taskNumber: r.task.number,
      periodLabel: r.task.period.label,
      entityCode: r.entityCode,
      entityName: entity?.legalName ?? r.entityCode,
      reason: r.reason,
      status: r.status,
      requestedBy: r.requestedBy.name,
      requestedAt: r.createdAt.toISOString(),
      decidedBy: r.decidedBy?.name ?? null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionComment: r.decisionComment,
      canDecide:
        r.status === 'PENDING' && user.permissions.has(Permission.EditAccessApprove) && !conflict,
      cannotDecideReason: r.status === 'PENDING' ? conflict : null,
      blockedReason:
        r.status === 'PENDING'
          ? await this.reopenBlocked(this.prisma, r.taskId, r.entityCode)
          : null,
    };
  }

  async list(user: AuthUser): Promise<EditAccessRequestDto[]> {
    const approver = user.permissions.has(Permission.EditAccessApprove);
    const rows = await this.prisma.editAccessRequest.findMany({
      where: approver ? {} : { requestedById: user.id },
      include,
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });
    const visible = rows.filter((r) => inScope(user.entityScope, r.entityCode));
    const out = [];
    for (const r of visible) out.push(await this.toDto(user, r));
    return out.sort((a, b) => Number(b.status === 'PENDING') - Number(a.status === 'PENDING'));
  }

  async request(
    user: AuthUser,
    input: { taskId: string; entityCode: string; reason: string },
    ip: string | null,
  ) {
    let te: { status: string; task: { number: string } } | null;
    if (isLevelKey(input.entityCode)) {
      if (!user.permissions.has(Permission.CfsPrepare))
        throw ApiError.notAllowed('Reopening a consolidation level needs CFS_PREPARE.');
      const l = await this.prisma.taskLevel.findFirst({
        where: { taskId: input.taskId, level: Number(input.entityCode.slice(1)) },
        include: { task: true },
      });
      if (l && l.members.some((m) => !inScope(user.entityScope, m)))
        throw ApiError.notAllowed('The level covers entities outside your scope.');
      te = l;
    } else {
      if (!user.permissions.has(Permission.SfsPrepare))
        throw ApiError.notAllowed('Reopening an entity needs SFS_PREPARE.');
      if (!inScope(user.entityScope, input.entityCode))
        throw ApiError.notAllowed(`${input.entityCode} is outside your entity scope.`);
      te = await this.prisma.taskEntity.findUnique({
        where: { taskId_entityCode: { taskId: input.taskId, entityCode: input.entityCode } },
        include: { task: true },
      });
    }
    if (!te) throw ApiError.notFound('Task entity not found.');
    if (te.status !== 'FINALISED')
      throw ApiError.validation('Only a finalised entity or level needs edit access.');
    if (
      await this.prisma.editAccessRequest.findFirst({
        where: { taskId: input.taskId, entityCode: input.entityCode, status: 'PENDING' },
      })
    )
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.Conflict,
        'A request is already waiting for a decision.',
      );
    const blocked = await this.reopenBlocked(this.prisma, input.taskId, input.entityCode);
    if (blocked) throw new ApiError(HttpStatus.CONFLICT, ApiErrorCode.Conflict, blocked);
    const created = await this.prisma.$transaction(async (tx) => {
      const r = await tx.editAccessRequest.create({
        data: {
          taskId: input.taskId,
          entityCode: input.entityCode,
          reason: input.reason.trim(),
          requestedById: user.id,
        },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.EditAccessRequest,
          entityType: 'EDIT_ACCESS_REQUEST',
          entityId: r.id,
          oldValue: null,
          newValue: { task: te.task.number, entity: input.entityCode, reason: input.reason.trim() },
          ip,
        },
        tx,
      );
      await this.notify?.(tx, 'EDIT_ACCESS_REQUESTED', r.id);
      return r;
    });
    return this.toDto(
      user,
      await this.prisma.editAccessRequest.findUniqueOrThrow({ where: { id: created.id }, include }),
    );
  }

  /** Optional notifier (page 8 notifications). */
  notify?: (
    tx: Tx,
    kind: 'EDIT_ACCESS_REQUESTED' | 'EDIT_ACCESS_DECIDED',
    requestId: string,
  ) => Promise<void>;

  async decide(
    user: AuthUser,
    id: string,
    input: { approve: boolean; comment: string | null },
    ip: string | null,
  ) {
    const r = await this.prisma.editAccessRequest.findUnique({ where: { id }, include });
    if (!r) throw ApiError.notFound('Request not found.');
    if (r.status !== 'PENDING')
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.Conflict,
        'This request has already been decided.',
      );
    const conflict = await this.decideConflict(user.id, r);
    if (conflict) throw ApiError.notAllowed(conflict);
    if (!input.approve && !(input.comment && input.comment.trim().length >= 3))
      throw ApiError.validation('Give a reason for rejecting the request.');
    if (input.approve) {
      const blocked = await this.reopenBlocked(this.prisma, r.taskId, r.entityCode);
      if (blocked) throw new ApiError(HttpStatus.CONFLICT, ApiErrorCode.Conflict, blocked);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.editAccessRequest.update({
        where: { id },
        data: {
          status: input.approve ? 'APPROVED' : 'REJECTED',
          decidedById: user.id,
          decidedAt: new Date(),
          decisionComment: input.comment?.trim() || null,
        },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.EditAccessDecision,
          entityType: 'EDIT_ACCESS_REQUEST',
          entityId: id,
          oldValue: { status: 'PENDING' },
          newValue: {
            status: input.approve ? 'APPROVED' : 'REJECTED',
            task: r.task.number,
            entity: r.entityCode,
            comment: input.comment,
          },
          ip,
        },
        tx,
      );
      if (input.approve) {
        const hook = isLevelKey(r.entityCode) ? this.levelHook : this.hook;
        if (!hook) throw new Error('Reopen is not configured.');
        await hook.reopen(tx, user, r.taskId, r.entityCode, ip);
      }
      await this.notify?.(tx, 'EDIT_ACCESS_DECIDED', id);
    });
    return this.toDto(
      user,
      await this.prisma.editAccessRequest.findUniqueOrThrow({ where: { id }, include }),
    );
  }

  async cancel(user: AuthUser, id: string, ip: string | null) {
    const r = await this.prisma.editAccessRequest.findUnique({ where: { id }, include });
    if (!r) throw ApiError.notFound('Request not found.');
    if (r.requestedById !== user.id)
      throw ApiError.notAllowed('Only the requester can cancel a request.');
    if (r.status !== 'PENDING')
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.Conflict,
        'This request has already been decided.',
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.editAccessRequest.update({
        where: { id },
        data: { status: 'CANCELLED', decidedAt: new Date() },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.EditAccessDecision,
          entityType: 'EDIT_ACCESS_REQUEST',
          entityId: id,
          oldValue: { status: 'PENDING' },
          newValue: { status: 'CANCELLED' },
          ip,
        },
        tx,
      );
    });
  }

  async pendingCount(user: AuthUser): Promise<number> {
    if (!user.permissions.has(Permission.EditAccessApprove)) return 0;
    const rows = await this.prisma.editAccessRequest.findMany({
      where: { status: 'PENDING', requestedById: { not: user.id } },
      select: { taskId: true, entityCode: true, requestedById: true },
    });
    let n = 0;
    for (const r of rows)
      if (inScope(user.entityScope, r.entityCode) && !(await this.decideConflict(user.id, r))) n++;
    return n;
  }
}
