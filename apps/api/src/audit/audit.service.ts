import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuditLogDto, AuditLogPage } from '@finance-close/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  /** Who did it (null when unknown, e.g. a failed login for a non-existent email). */
  userId: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string | null;
}

export interface AuditQuery {
  /** Rows performed by OR about this user. */
  userId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

/** Client that is either the root Prisma client or an interactive transaction. */
type Db = Prisma.TransactionClient | PrismaService;

/**
 * Append-only audit log, reused by every step. The table rejects UPDATE/DELETE at the
 * database level (trigger in the migration).
 *
 * Pass the transaction client when the change being audited runs in a transaction, so the
 * change and its audit row are committed — or rolled back — together.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, db: Db = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        oldValue: toJson(entry.oldValue),
        newValue: toJson(entry.newValue),
        ip: entry.ip ?? null,
      },
    });
  }

  async search(q: AuditQuery): Promise<AuditLogPage> {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.action ? { action: q.action } : {}),
      ...(q.from || q.to
        ? { timestamp: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } }
        : {}),
      ...(q.userId
        ? { OR: [{ userId: q.userId }, { entityType: 'USER', entityId: q.userId }] }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r): AuditLogDto => ({
        id: r.id.toString(),
        timestamp: r.timestamp.toISOString(),
        user: r.user,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        oldValue: r.oldValue,
        newValue: r.newValue,
        ip: r.ip,
      })),
    };
  }

  /** Distinct actions present in the log, for the filter drop-down. */
  async actions(): Promise<string[]> {
    const rows = await this.prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    });
    return rows.map((r) => r.action);
  }
}

function toJson(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (v === undefined || v === null) return Prisma.DbNull;
  // Round-trip drops undefined fields and turns Dates / Decimals into strings.
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}
