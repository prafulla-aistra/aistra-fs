import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { Decimal } from '@finance-close/engine';
import {
  AuditAction,
  Permission,
  SEGREGATION_OF_DUTIES,
  type ApprovalsDto,
  type ControlCheckDto,
} from '@finance-close/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { EditConfig, ViewConfig } from './access';

const checkSchema = z.object({
  severity: z.enum(['BLOCKING', 'WARNING', 'INFO']),
  threshold: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,4})?$/, 'The threshold must be a number (up to 4 decimals)')
    .nullable(),
  isActive: z.boolean(),
  toBeConfirmed: z.boolean(),
});
const ruleSchema = z.object({
  statementType: z.enum(['SFS', 'CFS']),
  entityCode: z.string().regex(/^[A-Z0-9]{1,10}$/).nullable(),
  reviewLevels: z.union([z.literal(1), z.literal(2)]),
  reviewerIds: z.array(z.string().uuid()).max(50),
  approverIds: z.array(z.string().uuid()).max(50),
});

/** Configuration → Control checks and Approvals (C3). Every change audited. */
@Controller('config')
export class ControlsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('control-checks')
  @ViewConfig()
  async checks(
    @Query(new ZodPipe(z.object({ statementType: z.enum(['SFS', 'CFS']).optional() })))
    q: { statementType?: 'SFS' | 'CFS' },
  ): Promise<ControlCheckDto[]> {
    const rows = await this.prisma.controlCheck.findMany({
      where: q.statementType ? { statementType: q.statementType } : {},
      orderBy: [{ statementType: 'asc' }, { sortOrder: 'asc' }],
    });
    return rows.map((c) => ({
      code: c.code,
      statementType: c.statementType,
      name: c.name,
      description: c.description,
      severity: c.severity,
      threshold: c.threshold?.toString() ?? null,
      thresholdUnit: (c.thresholdUnit ?? null) as ControlCheckDto['thresholdUnit'],
      isActive: c.isActive,
      toBeConfirmed: c.toBeConfirmed,
      sortOrder: c.sortOrder,
    }));
  }

  @Put('control-checks/:code')
  @EditConfig()
  async updateCheck(
    @CurrentUser() user: AuthUser,
    @Param('code', new ZodPipe(z.string().regex(/^[A-Z0-9_]{2,40}$/))) code: string,
    @Body(new ZodPipe(checkSchema)) body: z.output<typeof checkSchema>,
    @ClientIp() ip: string | null,
  ): Promise<ControlCheckDto[]> {
    const before = await this.prisma.controlCheck.findUnique({ where: { code } });
    if (!before) throw ApiError.notFound(`Check ${code} not found.`);
    if (before.thresholdUnit && body.threshold === null)
      throw ApiError.validation('This check needs a threshold.');
    await this.prisma.$transaction(async (tx) => {
      await tx.controlCheck.update({
        where: { code },
        data: {
          severity: body.severity,
          threshold: before.thresholdUnit ? new Decimal(body.threshold!).toFixed(4) : null,
          isActive: body.isActive,
          toBeConfirmed: body.toBeConfirmed,
        },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.ControlCheckUpdate,
          entityType: 'CONTROL_CHECK',
          entityId: code,
          oldValue: {
            severity: before.severity,
            threshold: before.threshold?.toString() ?? null,
            isActive: before.isActive,
            toBeConfirmed: before.toBeConfirmed,
          },
          newValue: body,
          ip,
        },
        tx,
      );
    });
    return this.checks({ statementType: before.statementType });
  }

  @Get('approvals')
  @ViewConfig()
  async approvals(@CurrentUser() user: AuthUser): Promise<ApprovalsDto> {
    const [rules, users, entities] = await Promise.all([
      this.prisma.approvalRule.findMany({ orderBy: [{ statementType: 'asc' }, { entityCode: 'asc' }] }),
      this.prisma.user.findMany({
        where: { status: 'ACTIVE' },
        include: { permissions: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.entity.findMany({ select: { code: true, legalName: true } }),
    ]);
    const name = new Map(users.map((u) => [u.id, u.name]));
    const entityName = new Map(entities.map((e) => [e.code, e.legalName]));
    const reviewPerms = new Set<string>([Permission.SfsReview, Permission.CfsReview]);
    return {
      rules: rules
        .sort((a, b) => (a.entityCode === null ? -1 : b.entityCode === null ? 1 : a.entityCode.localeCompare(b.entityCode)))
        .map((r) => ({
          id: r.id,
          statementType: r.statementType,
          entityCode: r.entityCode,
          entityName: r.entityCode ? (entityName.get(r.entityCode) ?? null) : null,
          reviewLevels: (r.reviewLevels === 2 ? 2 : 1) as 1 | 2,
          reviewers: r.reviewerIds.map((id) => ({ id, name: name.get(id) ?? 'Unknown user' })),
          approvers: r.approverIds.map((id) => ({ id, name: name.get(id) ?? 'Unknown user' })),
        })),
      candidates: users
        .filter((u) => u.isMaster || u.permissions.some((p) => reviewPerms.has(p.permissionCode)))
        .map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          permissions: u.isMaster ? [...reviewPerms] : u.permissions.map((p) => p.permissionCode),
        })),
      segregation: SEGREGATION_OF_DUTIES,
      canEdit: user.permissions.has(Permission.ConfigManage),
    };
  }

  @Put('approvals')
  @EditConfig()
  async saveRule(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(ruleSchema)) body: z.output<typeof ruleSchema>,
    @ClientIp() ip: string | null,
  ): Promise<ApprovalsDto> {
    if (body.entityCode && !(await this.prisma.entity.findUnique({ where: { code: body.entityCode } })))
      throw ApiError.notFound(`Entity ${body.entityCode} not found.`);
    if (body.reviewLevels === 2 && body.reviewerIds.some((id) => body.approverIds.includes(id)) && body.approverIds.length === 1 && body.reviewerIds.length === 1)
      throw ApiError.validation('With two review levels, the reviewer and the approver must be different people.');
    const before = await this.prisma.approvalRule.findFirst({
      where: { statementType: body.statementType, entityCode: body.entityCode },
    });
    const data = {
      reviewLevels: body.reviewLevels,
      reviewerIds: [...new Set(body.reviewerIds)],
      approverIds: body.reviewLevels === 2 ? [...new Set(body.approverIds)] : [],
    };
    await this.prisma.$transaction(async (tx) => {
      const row = before
        ? await tx.approvalRule.update({ where: { id: before.id }, data })
        : await tx.approvalRule.create({ data: { statementType: body.statementType, entityCode: body.entityCode, ...data } });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.ApprovalRuleChange,
          entityType: 'APPROVAL_RULE',
          entityId: row.id,
          oldValue: before
            ? { reviewLevels: before.reviewLevels, reviewerIds: before.reviewerIds, approverIds: before.approverIds }
            : null,
          newValue: { statementType: body.statementType, entityCode: body.entityCode, ...data },
          ip,
        },
        tx,
      );
    });
    return this.approvals(user);
  }

  @Delete('approvals/:id')
  @EditConfig()
  @HttpCode(204)
  async removeRule(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientIp() ip: string | null,
  ): Promise<void> {
    const before = await this.prisma.approvalRule.findUnique({ where: { id } });
    if (!before) throw ApiError.notFound('Approval rule not found.');
    if (before.entityCode === null) throw ApiError.validation('The default rule cannot be removed.');
    await this.prisma.$transaction(async (tx) => {
      await tx.approvalRule.delete({ where: { id } });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.ApprovalRuleChange,
          entityType: 'APPROVAL_RULE',
          entityId: id,
          oldValue: { entityCode: before.entityCode, reviewLevels: before.reviewLevels, reviewerIds: before.reviewerIds, approverIds: before.approverIds },
          newValue: null,
          ip,
        },
        tx,
      );
    });
  }
}
