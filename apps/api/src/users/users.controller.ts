import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  Permission,
  passwordProblems,
  type EntityOptionDto,
  type PermissionCode,
  type PermissionDto,
  type PermissionTemplateDto,
  type UserDto,
} from '@finance-close/shared';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { UsersService } from './users.service';

const password = z
  .string()
  .max(200)
  .superRefine((pw, ctx) => {
    const problems = passwordProblems(pw);
    if (problems.length > 0)
      ctx.addIssue({ code: 'custom', message: `Password ${problems.join(', ')}` });
  });
const name = z.string().trim().min(1, 'Enter a name').max(200);
const email = z.string().trim().email('Enter a valid email address').max(320);
const permissionCodes = z
  .array(z.string().max(40))
  .max(100)
  .transform((a) => a as PermissionCode[]);
/** null = all entities. */
const entityScope = z.array(z.string().max(10)).max(100).nullable();
const templateCode = z.string().max(40).nullable();

const createSchema = z.object({
  name,
  email,
  temporaryPassword: password,
  templateCode,
  permissions: permissionCodes,
  entityScope,
});

const updateSchema = z
  .object({
    name: name.optional(),
    email: email.optional(),
    templateCode: templateCode.optional(),
    permissions: permissionCodes.optional(),
    entityScope: entityScope.optional(),
  })
  .strict();

const resetSchema = z.object({ temporaryPassword: password });

/** User management — every endpoint requires USER_ADMIN (the master has it). */
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('users')
  @RequirePermission(Permission.UserAdmin)
  list(): Promise<UserDto[]> {
    return this.users.list();
  }

  @Get('users/:id')
  @RequirePermission(Permission.UserAdmin)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<UserDto> {
    return this.users.get(id);
  }

  @Post('users')
  @RequirePermission(Permission.UserAdmin)
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodPipe(createSchema)) body: z.output<typeof createSchema>,
    @ClientIp() ip: string | null,
  ): Promise<UserDto> {
    return this.users.create(actor, body, ip);
  }

  @Patch('users/:id')
  @RequirePermission(Permission.UserAdmin)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateSchema)) body: z.output<typeof updateSchema>,
    @ClientIp() ip: string | null,
  ): Promise<UserDto> {
    return this.users.update(actor, id, body, ip);
  }

  @Post('users/:id/reset-password')
  @HttpCode(200)
  @RequirePermission(Permission.UserAdmin)
  resetPassword(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(resetSchema)) body: z.output<typeof resetSchema>,
    @ClientIp() ip: string | null,
  ): Promise<UserDto> {
    return this.users.resetPassword(actor, id, body.temporaryPassword, ip);
  }

  @Post('users/:id/deactivate')
  @HttpCode(200)
  @RequirePermission(Permission.UserAdmin)
  deactivate(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientIp() ip: string | null,
  ): Promise<UserDto> {
    return this.users.setActive(actor, id, false, ip);
  }

  @Post('users/:id/reactivate')
  @HttpCode(200)
  @RequirePermission(Permission.UserAdmin)
  reactivate(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientIp() ip: string | null,
  ): Promise<UserDto> {
    return this.users.setActive(actor, id, true, ip);
  }

  // Reference data for the user form.

  @Get('permissions')
  @RequirePermission(Permission.UserAdmin)
  permissions(): Promise<PermissionDto[]> {
    return this.users.permissions();
  }

  @Get('permission-templates')
  @RequirePermission(Permission.UserAdmin)
  templates(): Promise<PermissionTemplateDto[]> {
    return this.users.templates();
  }

  /** Entity list for the entity-scope picker. (Entity maintenance comes with configuration.) */
  @Get('entities')
  @RequirePermission(Permission.UserAdmin)
  entities(): Promise<EntityOptionDto[]> {
    return this.users.entities();
  }
}
