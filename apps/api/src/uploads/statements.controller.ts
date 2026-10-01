import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  Permission,
  type EntityStatementsDto,
  type StatementsStepDto,
} from '@finance-close/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { StatementsService } from './statements.service';

const ViewTasks = () =>
  RequirePermission(
    Permission.SfsPrepare,
    Permission.SfsReview,
    Permission.CfsPrepare,
    Permission.CfsReview,
    Permission.ReportsView,
  );
const entityCode = z.string().regex(/^[A-Z0-9]{1,10}$/, 'Invalid entity code');
const flag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');
const viewQuery = z.object({
  format: z
    .string()
    .regex(/^[A-Z0-9_]{2,40}$/)
    .optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  unit: z.enum(['ACTUAL', 'THOUSANDS', 'LAKHS', 'CRORES', 'MILLIONS']).optional(),
  showNil: flag,
});
const exportQuery = z.object({
  format: z
    .string()
    .regex(/^[A-Z0-9_]{2,40}$/)
    .optional(),
  currency: z
    .string()
    .regex(/^([A-Z]{3}|ALL)$/)
    .optional(),
  showNil: flag,
});

@Controller()
export class StatementsController {
  constructor(private readonly statements: StatementsService) {}

  @Get('tasks/:id/statements-step')
  @ViewTasks()
  step(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StatementsStepDto> {
    return this.statements.step(user, id);
  }

  @Get('tasks/:id/entities/:code/statements')
  @ViewTasks()
  entity(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Query(new ZodPipe(viewQuery)) q: z.output<typeof viewQuery>,
  ): Promise<EntityStatementsDto> {
    return this.statements.entity(user, id, code, q);
  }

  @Get('tasks/:id/entities/:code/statements/export')
  @ViewTasks()
  async export(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Query(new ZodPipe(exportQuery)) q: z.output<typeof exportQuery>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { name, body } = await this.statements.exportWorkbook(user, id, code, q);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(body);
  }

  @Post('tasks/:id/entities/:code/statements/continue')
  @RequirePermission(Permission.SfsPrepare)
  continue(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @ClientIp() ip: string | null,
  ): Promise<{ currentStep: string }> {
    return this.statements.continue(user, id, code, ip);
  }
}
