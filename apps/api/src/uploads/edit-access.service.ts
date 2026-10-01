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

/** What happens when edit access is granted (page 8 stores the working copy, etc.). */
export interface ReopenHook {
  reopen(tx: Tx, user: AuthUser, taskId: string, entityCode: string, ip: string | null): Promise<void>;
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

  setReopenHook(hook: ReopenHook) {
    this.hook = hook;
  }

  /** Why the entity cannot be reopened now (a finalised CFS level that includes it), or null. */
  async reopenBlocked(db: Tx | PrismaService, taskId: string, entityCode: string): Promise<string | null> {
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
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

  private async toDto(user: AuthUser, r: Prisma.EditAccessRequestGetPayload<{ include: typeof include }>): Promise<EditAccessRequestDto> {
    const entity = await this.prisma.entity.findUnique({ where: { code: r.entityCode } });
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
        r.status === 'PENDING' && user.permissions.has(Permission.EditAccessApprove) && r.requestedById !== user.id,
      blockedReason: r.status === 'PENDING' ? await this.reopenBlocked(this.prisma, r.taskId, r.entityCode) : null,
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

  async request(user: AuthUser, input: { taskId: string; entityCode: string; reason: string }, ip: string | null) {
    if (!inScope(user.entityScope, input.entityCode)) throw ApiError.notAllowed(`${input.entityCode} is outside your entity scope.`);
    const te = await this.prisma.taskEntity.findUnique({
      where: { taskId_entityCode: { taskId: input.taskId, entityCode: input.entityCode } },
      include: { task: true },
    });
    if (!te) throw ApiError.notFound('Task entity not found.');
    if (te.status !== 'FINALISED') throw ApiError.validation('Only a finalised entity needs edit access.');
    if (await this.prisma.editAccessRequest.findFirst({ where: { taskId: input.taskId, entityCode: input.entityCode, status: 'PENDING' } }))
      throw new ApiError(HttpStatus.CONFLICT, ApiErrorCode.Conflict, 'A request is already waiting for a decision.');
    const blocked = await this.reopenBlocked(this.prisma, input.taskId, input.entityCode);
    if (blocked) throw new ApiError(HttpStatus.CONFLICT, ApiErrorCode.Conflict, blocked);
    const created = await this.prisma.$transaction(async (tx) => {
      const r = await tx.editAccessRequest.create({
        data: { taskId: input.taskId, entityCode: input.entityCode, reason: input.reason.trim(), requestedById: user.id },
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
    return this.toDto(user, await this.prisma.editAccessRequest.findUniqueOrThrow({ where: { id: created.id }, include }));
  }

  /** Optional notifier (page 8 notifications). */
  notify?: (tx: Tx, kind: 'EDIT_ACCESS_REQUESTED' | 'EDIT_ACCESS_DECIDED', requestId: string) => Promise<void>;

  async decide(user: AuthUser, id: string, input: { approve: boolean; comment: string | null }, ip: string | null) {
    const r = await this.prisma.editAccessRequest.findUnique({ where: { id }, include });
    if (!r) throw ApiError.notFound('Request not found.');
    if (r.status !== 'PENDING') throw new ApiError(HttpStatus.CONFLICT, ApiErrorCode.Conflict, 'This request has already been decided.');
    if (r.requestedById === user.id) throw ApiError.notAllowed('You cannot decide your own request.');
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
          newValue: { status: input.approve ? 'APPROVED' : 'REJECTED', task: r.task.number, entity: r.entityCode, comment: input.comment },
          ip,
        },
        tx,
      );
      if (input.approve) {
        if (!this.hook) throw new Error('Reopen is not configured.');
        await this.hook.reopen(tx, user, r.taskId, r.entityCode, ip);
      }
      await this.notify?.(tx, 'EDIT_ACCESS_DECIDED', id);
    });
    return this.toDto(user, await this.prisma.editAccessRequest.findUniqueOrThrow({ where: { id }, include }));
  }

  async cancel(user: AuthUser, id: string, ip: string | null) {
    const r = await this.prisma.editAccessRequest.findUnique({ where: { id }, include });
    if (!r) throw ApiError.notFound('Request not found.');
    if (r.requestedById !== user.id) throw ApiError.notAllowed('Only the requester can cancel a request.');
    if (r.status !== 'PENDING') throw new ApiError(HttpStatus.CONFLICT, ApiErrorCode.Conflict, 'This request has already been decided.');
    await this.prisma.$transaction(async (tx) => {
      await tx.editAccessRequest.update({ where: { id }, data: { status: 'CANCELLED', decidedAt: new Date() } });
      await this.audit.record(
        { userId: user.id, action: AuditAction.EditAccessDecision, entityType: 'EDIT_ACCESS_REQUEST', entityId: id, oldValue: { status: 'PENDING' }, newValue: { status: 'CANCELLED' }, ip },
        tx,
      );
    });
  }

  async pendingCount(user: AuthUser): Promise<number> {
    if (!user.permissions.has(Permission.EditAccessApprove)) return 0;
    const rows = await this.prisma.editAccessRequest.findMany({ where: { status: 'PENDING', requestedById: { not: user.id } }, select: { entityCode: true } });
    return rows.filter((r) => inScope(user.entityScope, r.entityCode)).length;
  }
}
