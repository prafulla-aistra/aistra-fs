import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  Permission,
  type CreateUserRequest,
  type EntityOptionDto,
  type PermissionCode,
  type PermissionDto,
  type PermissionTemplateDto,
  type UpdateUserRequest,
  type UserDto,
} from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import { AuthProvider } from '../auth/auth-provider';
import { normaliseEmail } from '../auth/passwords';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';

const userInclude = {
  permissions: { select: { permissionCode: true } },
  entityScopes: { select: { entityCode: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.UserInclude;
type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;

/** Snapshot of the fields an admin can change, for audit old/new values. */
interface UserSnapshot {
  name: string;
  email: string;
  templateCode: string | null;
  permissions: string[];
  entityScope: string[] | null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthProvider,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- reference data

  async permissions(): Promise<PermissionDto[]> {
    const rows = await this.prisma.permission.findMany({ orderBy: { sortOrder: 'asc' } });
    return rows.map((p) => ({
      code: p.code as PermissionCode,
      description: p.description,
      area: p.area,
    }));
  }

  async templates(): Promise<PermissionTemplateDto[]> {
    const rows = await this.prisma.permissionTemplate.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { permissions: { select: { permissionCode: true } } },
    });
    return rows.map((t) => ({
      code: t.code,
      name: t.name,
      description: t.description,
      permissions: t.permissions.map((p) => p.permissionCode as PermissionCode).sort(),
    }));
  }

  async entities(): Promise<EntityOptionDto[]> {
    const rows = await this.prisma.entity.findMany({
      where: { isActive: true },
      select: { code: true, legalName: true },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((e) => ({ code: e.code, name: e.legalName }));
  }

  // ---------------------------------------------------------------- queries

  async list(): Promise<UserDto[]> {
    const [rows, templates] = await Promise.all([
      this.prisma.user.findMany({
        include: userInclude,
        orderBy: [{ isMaster: 'desc' }, { name: 'asc' }],
      }),
      this.templates(),
    ]);
    return rows.map((u) => toDto(u, templates));
  }

  async get(id: string): Promise<UserDto> {
    return toDto(await this.find(id), await this.templates());
  }

  // ---------------------------------------------------------------- commands

  async create(actor: AuthUser, req: CreateUserRequest, ip: string | null): Promise<UserDto> {
    const email = normaliseEmail(req.email);
    await this.assertValidAccess(req.templateCode, req.permissions, req.entityScope);

    const id = await this.prisma
      .$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: req.name.trim(),
            email,
            passwordHash: '!', // never matches; replaced by setTemporaryPassword below
            templateCode: req.templateCode,
            allEntities: req.entityScope === null,
            createdById: actor.id,
            permissions: {
              create: dedupe(req.permissions).map((permissionCode) => ({ permissionCode })),
            },
            entityScopes: {
              create: (req.entityScope ?? []).map((entityCode) => ({ entityCode })),
            },
          },
        });
        await this.auth.setTemporaryPassword(user.id, req.temporaryPassword, tx);
        await this.audit.record(
          {
            userId: actor.id,
            action: AuditAction.UserCreate,
            entityType: 'USER',
            entityId: user.id,
            newValue: {
              ...snapshot(
                await tx.user.findUniqueOrThrow({ where: { id: user.id }, include: userInclude }),
              ),
              status: 'ACTIVE',
              mustChangePassword: true,
            },
            ip,
          },
          tx,
        );
        return user.id;
      })
      .catch(rethrowUniqueEmail);
    return this.get(id);
  }

  async update(
    actor: AuthUser,
    id: string,
    req: UpdateUserRequest,
    ip: string | null,
  ): Promise<UserDto> {
    const before = await this.find(id);
    const changesAccess =
      req.permissions !== undefined ||
      req.entityScope !== undefined ||
      req.templateCode !== undefined;

    if (before.isMaster) {
      if (!actor.isMaster)
        throw ApiError.notAllowed('Only the master admin can change the master account.');
      if (changesAccess) {
        throw ApiError.notAllowed('The master admin always has every permission and all entities.');
      }
    }
    if (
      actor.id === id &&
      req.permissions !== undefined &&
      !req.permissions.includes(Permission.UserAdmin) &&
      !actor.isMaster
    ) {
      throw ApiError.notAllowed('You cannot remove your own user admin permission.');
    }

    const old = snapshot(before);
    const permissions = req.permissions !== undefined ? dedupe(req.permissions) : old.permissions;
    const entityScope = req.entityScope !== undefined ? req.entityScope : old.entityScope;
    const templateCode = req.templateCode !== undefined ? req.templateCode : old.templateCode;
    if (changesAccess) await this.assertValidAccess(templateCode, permissions, entityScope);

    await this.prisma
      .$transaction(async (tx) => {
        await tx.user.update({
          where: { id },
          data: {
            ...(req.name !== undefined ? { name: req.name.trim() } : {}),
            ...(req.email !== undefined ? { email: normaliseEmail(req.email) } : {}),
            templateCode,
            allEntities: entityScope === null,
          },
        });
        if (req.permissions !== undefined) {
          await tx.userPermission.deleteMany({ where: { userId: id } });
          await tx.userPermission.createMany({
            data: permissions.map((permissionCode) => ({ userId: id, permissionCode })),
          });
        }
        if (req.entityScope !== undefined) {
          await tx.userEntityScope.deleteMany({ where: { userId: id } });
          await tx.userEntityScope.createMany({
            data: (entityScope ?? []).map((entityCode) => ({ userId: id, entityCode })),
          });
        }

        const now = snapshot(
          await tx.user.findUniqueOrThrow({ where: { id }, include: userInclude }),
        );
        const accessDiff = diff(old, now, ['templateCode', 'permissions']);
        const detailDiff = diff(old, now, ['name', 'email', 'entityScope']);
        if (detailDiff) {
          await this.audit.record(
            {
              userId: actor.id,
              action: AuditAction.UserUpdate,
              entityType: 'USER',
              entityId: id,
              ...detailDiff,
              ip,
            },
            tx,
          );
        }
        if (accessDiff) {
          await this.audit.record(
            {
              userId: actor.id,
              action: AuditAction.PermissionChange,
              entityType: 'USER',
              entityId: id,
              ...accessDiff,
              ip,
            },
            tx,
          );
        }
      })
      .catch(rethrowUniqueEmail);
    return this.get(id);
  }

  async resetPassword(
    actor: AuthUser,
    id: string,
    temporaryPassword: string,
    ip: string | null,
  ): Promise<UserDto> {
    const target = await this.find(id);
    if (target.isMaster && !actor.isMaster) {
      throw ApiError.notAllowed('Only the master admin can reset the master password.');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.auth.setTemporaryPassword(id, temporaryPassword, tx);
      await this.audit.record(
        {
          userId: actor.id,
          action: AuditAction.PasswordReset,
          entityType: 'USER',
          entityId: id,
          newValue: { mustChangePassword: true, unlocked: Boolean(target.lockedUntil) },
          ip,
        },
        tx,
      );
    });
    return this.get(id);
  }

  async setActive(
    actor: AuthUser,
    id: string,
    active: boolean,
    ip: string | null,
  ): Promise<UserDto> {
    const target = await this.find(id);
    if (!active) {
      if (target.isMaster) throw ApiError.notAllowed('The master admin cannot be deactivated.');
      if (target.id === actor.id)
        throw ApiError.notAllowed('You cannot deactivate your own account.');
    }
    const status = active ? 'ACTIVE' : 'INACTIVE';
    if (target.status === status) return this.get(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: active ? { status, failedLoginCount: 0, lockedUntil: null } : { status },
      });
      if (!active) await this.auth.revokeSessions(id, tx);
      await this.audit.record(
        {
          userId: actor.id,
          action: active ? AuditAction.UserReactivate : AuditAction.UserDeactivate,
          entityType: 'USER',
          entityId: id,
          oldValue: { status: target.status },
          newValue: { status },
          ip,
        },
        tx,
      );
    });
    return this.get(id);
  }

  // ---------------------------------------------------------------- helpers

  private async find(id: string): Promise<UserRow> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: userInclude });
    if (!user) throw ApiError.notFound('User not found.');
    return user;
  }

  private async assertValidAccess(
    templateCode: string | null,
    permissions: string[],
    entityScope: string[] | null,
  ): Promise<void> {
    const known = new Set(
      (await this.prisma.permission.findMany({ select: { code: true } })).map((p) => p.code),
    );
    const unknown = permissions.filter((p) => !known.has(p));
    if (unknown.length > 0) throw ApiError.validation(`Unknown permission: ${unknown.join(', ')}.`);

    if (templateCode !== null) {
      const t = await this.prisma.permissionTemplate.findUnique({ where: { code: templateCode } });
      if (!t) throw ApiError.validation(`Unknown permission template: ${templateCode}.`);
    }

    if (entityScope !== null) {
      if (entityScope.length === 0) {
        throw ApiError.validation('Choose at least one entity, or give access to all entities.');
      }
      const active = new Set((await this.entities()).map((e) => e.code));
      const bad = entityScope.filter((c) => !active.has(c));
      if (bad.length > 0)
        throw ApiError.validation(`Unknown or inactive entity: ${bad.join(', ')}.`);
    }
  }
}

function snapshot(u: UserRow): UserSnapshot {
  return {
    name: u.name,
    email: u.email,
    templateCode: u.templateCode,
    permissions: u.permissions.map((p) => p.permissionCode).sort(),
    entityScope: u.allEntities ? null : u.entityScopes.map((s) => s.entityCode).sort(),
  };
}

/** Old/new values restricted to the fields that actually changed; undefined if none did. */
function diff(
  a: UserSnapshot,
  b: UserSnapshot,
  keys: (keyof UserSnapshot)[],
): { oldValue: Partial<UserSnapshot>; newValue: Partial<UserSnapshot> } | undefined {
  const changed = keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  if (changed.length === 0) return undefined;
  const pick = (s: UserSnapshot) =>
    Object.fromEntries(changed.map((k) => [k, s[k]])) as Partial<UserSnapshot>;
  return { oldValue: pick(a), newValue: pick(b) };
}

function toDto(u: UserRow, templates: PermissionTemplateDto[]): UserDto {
  const permissions = u.permissions.map((p) => p.permissionCode as PermissionCode).sort();
  const template = templates.find((t) => t.code === u.templateCode);
  let templateLabel: string | null = null;
  if (u.isMaster) templateLabel = 'Master admin (all permissions)';
  else if (template) {
    const same = JSON.stringify(template.permissions) === JSON.stringify(permissions);
    templateLabel = same ? template.name : `${template.name} (adjusted)`;
  } else if (permissions.length > 0) templateLabel = 'Custom';

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    status: u.status,
    isMaster: u.isMaster,
    mustChangePassword: u.mustChangePassword,
    permissions,
    entityScope:
      u.isMaster || u.allEntities ? null : u.entityScopes.map((s) => s.entityCode).sort(),
    templateCode: u.templateCode,
    templateLabel,
    lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil.toISOString() : null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    createdBy: u.createdBy,
  };
}

function dedupe(codes: string[]): string[] {
  return [...new Set(codes)].sort();
}

function rethrowUniqueEmail(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw ApiError.conflict('A user with this email already exists.');
  }
  throw err;
}
