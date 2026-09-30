import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  Permission,
  type EntityTranslationDto,
  type TranslationStepDto,
} from '@finance-close/shared';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { TranslationService } from './translation.service';

const ViewTasks = () =>
  RequirePermission(
    Permission.SfsPrepare,
    Permission.SfsReview,
    Permission.CfsPrepare,
    Permission.CfsReview,
    Permission.ReportsView,
  );
const entityCode = z.string().regex(/^[A-Z0-9]{1,10}$/, 'Invalid entity code');

@Controller()
export class TranslationController {
  constructor(private readonly translation: TranslationService) {}

  @Get('tasks/:id/translation-step')
  @ViewTasks()
  step(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TranslationStepDto> {
    return this.translation.step(user, id);
  }

  @Get('tasks/:id/entities/:code/translation')
  @ViewTasks()
  entity(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
  ): Promise<EntityTranslationDto> {
    return this.translation.entity(user, id, code);
  }

  @Post('tasks/:id/entities/:code/translation/continue')
  @RequirePermission(Permission.SfsPrepare)
  continue(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @ClientIp() ip: string | null,
  ): Promise<{ currentStep: string }> {
    return this.translation.continue(user, id, code, ip);
  }
}
