import { HttpStatus, Injectable } from '@nestjs/common';
import { deriveTaskStatus } from '@finance-close/engine';
import {
  ApiErrorCode,
  AuditAction,
  Permission,
  type SigningDetailsDto,
  type StatutoryDetailsDto,
  type StatutoryDetailsInput,
} from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { fromDbDate, toDbDate } from '../common/db-dates';
import { PrismaService } from '../prisma/prisma.service';
import { inScope, taskVisibleTo } from '../tasks/tasks.service';

const levelKey = (key: string) => /^L\d+$/.test(key);
const DEFAULT_LINES = ['Director', 'Director', 'Chief Financial Officer'];

/** A signature block for the Word / PDF full set. */
export interface SignatureBlock {
  entityName: string;
  lines: { role: string; name: string | null; identifier: string | null }[];
  date: string | null;
  place: string | null;
}

/**
 * Decision round 1 (Q9): statutory details of an entity (a record of its own, not the entity
 * master) with directors and officers effective for a date range; the board approval date and
 * place of signing are entered on the task at finalisation. Exports sign with the officers
 * effective at the board approval date.
 */
@Injectable()
export class StatutoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async details(user: AuthUser, code: string): Promise<StatutoryDetailsDto> {
    const entity = await this.prisma.entity.findUnique({ where: { code } });
    if (!entity) throw ApiError.notFound(`Entity ${code} not found.`);
    const d = await this.prisma.statutoryDetails.findUnique({
      where: { entityCode: code },
      include: { officers: { orderBy: [{ sortOrder: 'asc' }, { effectiveFrom: 'asc' }] } },
    });
    return {
      entityCode: code,
      legalName: entity.legalName,
      registeredOffice: d?.registeredOffice ?? null,
      registrationNo: d?.registrationNo ?? null,
      officers: (d?.officers ?? []).map((o) => ({
        id: o.id,
        name: o.name,
        designation: o.designation,
        identifier: o.identifier,
        effectiveFrom: fromDbDate(o.effectiveFrom),
        effectiveTo: o.effectiveTo ? fromDbDate(o.effectiveTo) : null,
      })),
      canEdit: user.permissions.has(Permission.ConfigManage),
    };
  }

  async saveDetails(
    user: AuthUser,
    code: string,
    input: StatutoryDetailsInput,
    ip: string | null,
  ): Promise<StatutoryDetailsDto> {
    const before = await this.details(user, code);
    for (const o of input.officers)
      if (o.effectiveTo && o.effectiveTo < o.effectiveFrom)
        throw ApiError.validation(`${o.name}: the end date is before the start date.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.statutoryDetails.upsert({
        where: { entityCode: code },
        create: {
          entityCode: code,
          registeredOffice: input.registeredOffice,
          registrationNo: input.registrationNo,
          updatedById: user.id,
        },
        update: {
          registeredOffice: input.registeredOffice,
          registrationNo: input.registrationNo,
          updatedById: user.id,
        },
      });
      await tx.statutoryOfficer.deleteMany({ where: { entityCode: code } });
      if (input.officers.length)
        await tx.statutoryOfficer.createMany({
          data: input.officers.map((o, i) => ({
            entityCode: code,
            name: o.name,
            designation: o.designation,
            identifier: o.identifier,
            effectiveFrom: toDbDate(o.effectiveFrom),
            effectiveTo: o.effectiveTo ? toDbDate(o.effectiveTo) : null,
            sortOrder: i,
          })),
        });
      const strip = (
        x: Pick<StatutoryDetailsDto, 'registeredOffice' | 'registrationNo' | 'officers'>,
      ) => ({
        registeredOffice: x.registeredOffice,
        registrationNo: x.registrationNo,
        officers: x.officers.map(
          (o) =>
            `${o.name}, ${o.designation}${o.identifier ? ` (${o.identifier})` : ''}, ${o.effectiveFrom} – ${o.effectiveTo ?? 'current'}`,
        ),
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.StatutoryDetailsUpdate,
          entityType: 'STATUTORY_DETAILS',
          entityId: code,
          oldValue: strip(before),
          newValue: strip({ ...input, officers: input.officers.map((o) => ({ ...o, id: '' })) }),
          ip,
        },
        tx,
      );
    });
    return this.details(user, code);
  }

  /** The task and the item (entity or level) a signing key names, checked for this user. */
  private async item(user: AuthUser, taskId: string, key: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        period: { include: { financialYear: true } },
        createdBy: { select: { name: true } },
        format: { select: { name: true } },
        entities: { include: { entity: { select: { shortName: true, sortOrder: true } } } },
        levels: true,
      },
    });
    if (!task || !taskVisibleTo(task, user.entityScope)) throw ApiError.notFound('Task not found.');
    if (levelKey(key)) {
      const level = task.levels.find((l) => l.level === Number(key.slice(1)));
      if (!level) throw ApiError.notFound(`Level ${key.slice(1)} is not in this task.`);
      return {
        task,
        entityCode: level.parentEntityCode,
        members: level.members,
        done: deriveTaskStatus(task.levels.map((l) => l.status)) === 'DONE',
        prepare: [Permission.CfsPrepare, Permission.CfsReview],
      };
    }
    const te = task.entities.find((e) => e.entityCode === key);
    if (!te) throw ApiError.notFound(`Entity ${key} is not in this task.`);
    return {
      task,
      entityCode: key,
      members: [key],
      done: deriveTaskStatus(task.entities.map((e) => e.status)) === 'DONE',
      prepare: [Permission.SfsPrepare, Permission.SfsReview],
    };
  }

  async signing(user: AuthUser, taskId: string, key: string): Promise<SigningDetailsDto> {
    const it = await this.item(user, taskId, key);
    const row = await this.prisma.signingDetails.findUnique({
      where: { taskId_key: { taskId, key } },
    });
    const date = row ? fromDbDate(row.boardApprovalDate) : null;
    const sig = await this.signature(taskId, key);
    const why = it.done
      ? 'This task is done and locked.'
      : !it.prepare.some((p) => user.permissions.has(p))
        ? 'You need the prepare or review permission to enter signing details.'
        : it.members.some((m) => !inScope(user.entityScope, m))
          ? 'Outside your entity scope.'
          : null;
    return {
      key,
      entityCode: it.entityCode,
      boardApprovalDate: date,
      place: row?.place ?? null,
      signatories: sig.lines.map((l) => ({
        designation: l.role,
        name: l.name,
        identifier: l.identifier,
      })),
      officersConfigured: sig.configured,
      canEdit: why === null,
      readOnlyReason: why,
    };
  }

  async saveSigning(
    user: AuthUser,
    taskId: string,
    key: string,
    input: { boardApprovalDate: string; place: string },
    ip: string | null,
  ): Promise<SigningDetailsDto> {
    const view = await this.signing(user, taskId, key);
    if (!view.canEdit)
      throw view.readOnlyReason === 'This task is done and locked.'
        ? new ApiError(HttpStatus.CONFLICT, ApiErrorCode.Conflict, view.readOnlyReason)
        : ApiError.notAllowed(view.readOnlyReason ?? 'Not allowed.');
    await this.prisma.$transaction(async (tx) => {
      await tx.signingDetails.upsert({
        where: { taskId_key: { taskId, key } },
        create: {
          taskId,
          key,
          boardApprovalDate: toDbDate(input.boardApprovalDate),
          place: input.place,
          updatedById: user.id,
        },
        update: {
          boardApprovalDate: toDbDate(input.boardApprovalDate),
          place: input.place,
          updatedById: user.id,
        },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.SigningDetailsUpdate,
          entityType: 'SIGNING_DETAILS',
          entityId: `${taskId}:${key}`,
          oldValue: view.boardApprovalDate
            ? { boardApprovalDate: view.boardApprovalDate, place: view.place }
            : null,
          newValue: input,
          ip,
        },
        tx,
      );
    });
    return this.signing(user, taskId, key);
  }

  /**
   * The signature block: officers effective at the board approval date (or, before one is
   * entered, today's officers with no date); without officers, the default captions.
   */
  async signature(taskId: string, key: string): Promise<SignatureBlock & { configured: boolean }> {
    const [row, task] = await Promise.all([
      this.prisma.signingDetails.findUnique({ where: { taskId_key: { taskId, key } } }),
      this.prisma.task.findUnique({ where: { id: taskId }, include: { levels: true } }),
    ]);
    const code = levelKey(key)
      ? (task?.levels.find((l) => l.level === Number(key.slice(1)))?.parentEntityCode ?? key)
      : key;
    const entity = await this.prisma.entity.findUnique({ where: { code } });
    const at = row?.boardApprovalDate ?? toDbDate(new Date().toISOString().slice(0, 10));
    const officers = await this.prisma.statutoryOfficer.findMany({
      where: {
        entityCode: code,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
      },
      orderBy: [{ sortOrder: 'asc' }, { effectiveFrom: 'asc' }],
    });
    return {
      entityName: entity?.legalName ?? code,
      lines: officers.length
        ? officers.map((o) => ({ role: o.designation, name: o.name, identifier: o.identifier }))
        : DEFAULT_LINES.map((role) => ({ role, name: null, identifier: null })),
      date: row ? fromDbDate(row.boardApprovalDate) : null,
      place: row?.place ?? null,
      configured: officers.length > 0,
    };
  }
}
