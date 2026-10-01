import { Controller, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { NotificationsDto } from '@finance-close/shared';
import { Authenticated, CurrentUser } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

export interface NotificationInput {
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

/** In-app notifications (the bell). Written inside the transaction of the change they report. */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async notify(db: Db, userIds: readonly string[], n: NotificationInput): Promise<void> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return;
    await db.notification.createMany({
      data: ids.map((userId) => ({ userId, kind: n.kind, title: n.title.slice(0, 300), body: n.body?.slice(0, 1000) ?? null, link: n.link ?? null })),
    });
  }

  /** Active users holding any of the permissions with the entity in scope (master included). */
  async usersWith(db: Db, permissions: string[], entityCode: string | null): Promise<string[]> {
    const users = await db.user.findMany({
      where: { status: 'ACTIVE' },
      include: { permissions: true, entityScopes: true },
    });
    return users
      .filter((u) => u.isMaster || u.permissions.some((p) => permissions.includes(p.permissionCode)))
      .filter((u) => u.isMaster || u.allEntities || entityCode === null || u.entityScopes.some((s) => s.entityCode === entityCode))
      .map((u) => u.id);
  }

  async list(user: AuthUser): Promise<NotificationsDto> {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return {
      unread,
      items: items.map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        link: n.link,
        read: n.readAt !== null,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  }

  async read(user: AuthUser, id: string | null): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null, ...(id ? { id } : {}) },
      data: { readAt: new Date() },
    });
  }
}


@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Authenticated()
  list(@CurrentUser() user: AuthUser): Promise<NotificationsDto> {
    return this.notifications.list(user);
  }

  @Post('read-all')
  @Authenticated()
  @HttpCode(204)
  readAll(@CurrentUser() user: AuthUser): Promise<void> {
    return this.notifications.read(user, null);
  }

  @Post(':id/read')
  @Authenticated()
  @HttpCode(204)
  readOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.notifications.read(user, id);
  }
}
