import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PermissionCode, SessionUser, UserStatus } from '@finance-close/shared';
import { PrismaService } from '../prisma/prisma.service';

/** The signed-in user as seen by guards and controllers. Loaded fresh on every request. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  isMaster: boolean;
  mustChangePassword: boolean;
  sessionVersion: number;
  /** Effective permissions; the master holds every permission in the table. */
  permissions: ReadonlySet<PermissionCode>;
  /** null = all entities. */
  entityScope: string[] | null;
}

@Injectable()
export class SessionUserLoader {
  constructor(private readonly prisma: PrismaService) {}

  /** Pass a transaction client to see changes made earlier in that transaction. */
  async load(
    userId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<AuthUser | null> {
    const u = await db.user.findUnique({
      where: { id: userId },
      include: { permissions: true, entityScopes: true },
    });
    if (!u) return null;
    const codes = u.isMaster
      ? (await db.permission.findMany({ select: { code: true } })).map((p) => p.code)
      : u.permissions.map((p) => p.permissionCode);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      status: u.status,
      isMaster: u.isMaster,
      mustChangePassword: u.mustChangePassword,
      sessionVersion: u.sessionVersion,
      permissions: new Set(codes as PermissionCode[]),
      entityScope:
        u.isMaster || u.allEntities ? null : u.entityScopes.map((s) => s.entityCode).sort(),
    };
  }
}

export function toSessionUser(u: AuthUser): SessionUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    isMaster: u.isMaster,
    mustChangePassword: u.mustChangePassword,
    permissions: [...u.permissions].sort(),
    entityScope: u.entityScope,
  };
}
