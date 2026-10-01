import { Injectable } from '@nestjs/common';
import { monthsBetween } from '@finance-close/engine';
import { AuditAction, Permission } from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session-user';
import { fromDbDate } from '../common/db-dates';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

/**
 * Keeps submissions honest: any change to a submitted entity's data (TB replaced, mapping,
 * explanation, note, rate) withdraws the submission automatically, sets the entity back to In
 * progress and tells the reviewers what changed. Also records who last edited the entity
 * (segregation of duties).
 */
@Injectable()
export class SubmissionGuard {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The entity's data changed in this task. */
  async changed(user: AuthUser, taskId: string, entityCode: string, what: string, ip: string | null = null): Promise<void> {
    await this.prisma.taskEntity.updateMany({ where: { taskId, entityCode }, data: { lastEditedById: user.id } });
    await this.withdraw(user, taskId, entityCode, what, ip);
  }

  /** Accounts of an entity changed (chart of accounts): every open task of the entity. */
  async accountsChanged(user: AuthUser, entityCode: string, what: string, ip: string | null = null): Promise<void> {
    const open = await this.prisma.reviewSubmission.findMany({ where: { entityCode, status: 'ACTIVE' }, select: { taskId: true } });
    for (const s of open) await this.withdraw(user, s.taskId, entityCode, what, ip);
  }

  /** Rates of these months changed: every submission whose period uses them. */
  async ratesChanged(user: AuthUser, months: string[], currencies: string[], ip: string | null = null): Promise<void> {
    if (months.length === 0) return;
    const open = await this.prisma.reviewSubmission.findMany({
      where: { status: 'ACTIVE' },
      include: { task: { include: { period: true, entities: { include: { entity: { include: { translatedCurrencies: true } } } } } } },
    });
    for (const s of open) {
      const used = new Set(monthsBetween(fromDbDate(s.task.period.startDate), fromDbDate(s.task.period.endDate)));
      const te = s.task.entities.find((e) => e.entityCode === s.entityCode);
      const ccys = new Set([te?.entity.functionalCurrency, ...(te?.entity.translatedCurrencies.map((t) => t.currencyCode) ?? [])]);
      if (months.some((m) => used.has(m)) && currencies.some((c) => ccys.has(c)))
        await this.withdraw(user, s.taskId, s.entityCode, `Exchange rates changed (${currencies.join(', ')} ${months.map((m) => m.slice(0, 7)).join(', ')})`, ip);
    }
  }

  private async withdraw(user: AuthUser, taskId: string, entityCode: string, what: string, ip: string | null) {
    const s = await this.prisma.reviewSubmission.findFirst({
      where: { taskId, entityCode, status: 'ACTIVE' },
      include: { task: true, signOffs: true },
    });
    if (!s) return;
    const reviewers = await this.notifications.usersWith(this.prisma, [Permission.SfsReview], entityCode);
    await this.prisma.$transaction(async (tx) => {
      await tx.reviewSubmission.update({
        where: { id: s.id },
        data: { status: 'WITHDRAWN', closedAt: new Date(), closedReason: `Withdrawn automatically: ${what}` },
      });
      await tx.taskEntity.update({
        where: { taskId_entityCode: { taskId, entityCode } },
        data: { status: 'IN_PROGRESS' },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.ReviewWithdraw,
          entityType: 'TASK_ENTITY',
          entityId: `${taskId}:${entityCode}`,
          oldValue: { status: 'IN_REVIEW', submission: s.number },
          newValue: { status: 'IN_PROGRESS', task: s.task.number, entity: entityCode, reason: what },
          ip,
        },
        tx,
      );
      await this.notifications.notify(tx, reviewers.filter((id) => id !== user.id), {
        kind: 'SUBMISSION_WITHDRAWN',
        title: `${entityCode} ${s.task.number}: submission withdrawn`,
        body: `${what} (by ${user.name}). The entity is back In progress.`,
        link: `/tasks/${taskId}?step=REVIEW&entity=${entityCode}`,
      });
    });
  }
}
