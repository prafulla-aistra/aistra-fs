import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Permission, type EditAccessRequestDto } from '@finance-close/shared';
import { z } from 'zod';
import { Authenticated, CurrentUser, RequirePermission } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { EditAccessService } from './edit-access.service';

const requestSchema = z.object({
  taskId: z.string().uuid(),
  entityCode: z.string().regex(/^[A-Z0-9]{1,10}$/),
  reason: z.string().trim().min(10, 'Explain why edit access is needed (at least 10 characters)').max(1000),
});
const decideSchema = z.object({
  approve: z.boolean(),
  comment: z.string().trim().max(1000).nullable(),
});

@Controller('edit-access-requests')
export class EditAccessController {
  constructor(private readonly editAccess: EditAccessService) {}

  @Get()
  @Authenticated()
  list(@CurrentUser() user: AuthUser): Promise<EditAccessRequestDto[]> {
    return this.editAccess.list(user);
  }

  @Post()
  @RequirePermission(Permission.SfsPrepare)
  request(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(requestSchema)) body: z.output<typeof requestSchema>,
    @ClientIp() ip: string | null,
  ): Promise<EditAccessRequestDto> {
    return this.editAccess.request(user, body, ip);
  }

  @Post(':id/decide')
  @RequirePermission(Permission.EditAccessApprove)
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(decideSchema)) body: z.output<typeof decideSchema>,
    @ClientIp() ip: string | null,
  ): Promise<EditAccessRequestDto> {
    return this.editAccess.decide(user, id, body, ip);
  }

  @Post(':id/cancel')
  @RequirePermission(Permission.SfsPrepare)
  @HttpCode(204)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ClientIp() ip: string | null): Promise<void> {
    return this.editAccess.cancel(user, id, ip);
  }
}
