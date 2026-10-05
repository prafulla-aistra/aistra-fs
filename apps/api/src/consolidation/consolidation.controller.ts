import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  CFS_LEVEL_STEPS,
  Permission,
  type AggregationDto,
  type CfsWorkspaceDto,
  type EliminationsDto,
  type ReadinessDto,
} from '@finance-close/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { ConsolidationService } from './consolidation.service';

const ViewTasks = () =>
  RequirePermission(
    Permission.SfsPrepare,
    Permission.SfsReview,
    Permission.CfsPrepare,
    Permission.CfsReview,
    Permission.ReportsView,
  );
const Prepare = () => RequirePermission(Permission.CfsPrepare);

const amount = z
  .string()
  .trim()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, 'Amounts: positive numbers with up to 2 decimals')
  .nullable();
const manualSchema = z.object({
  narration: z.string().trim().min(3, 'Narration: at least 3 characters').max(300),
  reason: z.string().trim().min(10, 'Reason: at least 10 characters').max(1000),
  lines: z
    .array(
      z.object({
        entityCode: z
          .string()
          .regex(/^[A-Z0-9]{1,10}$/)
          .nullable(),
        fsliCode: z.string().regex(/^[A-Z0-9_]{1,30}$/, 'Choose an FSLI'),
        debit: amount,
        credit: amount,
      }),
    )
    .min(2, 'Enter at least two lines')
    .max(50),
});
const currencySchema = z.object({ currency: z.string().regex(/^[A-Z]{3}$/, 'Choose a currency') });
const continueSchema = z.object({
  from: z.enum(CFS_LEVEL_STEPS.map((s) => s.code) as [string, ...string[]]),
});

/** CFS workspace (page 9): level path, readiness, aggregation and eliminations. */
@Controller('tasks/:id/cfs')
export class ConsolidationController {
  constructor(private readonly cfs: ConsolidationService) {}

  @Get()
  @ViewTasks()
  workspace(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CfsWorkspaceDto> {
    return this.cfs.workspace(user, id);
  }

  @Get('levels/:level/readiness')
  @ViewTasks()
  readiness(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
  ): Promise<ReadinessDto> {
    return this.cfs.readiness(user, id, level);
  }

  @Put('levels/:level/currency')
  @Prepare()
  currency(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Body(new ZodPipe(currencySchema)) body: z.output<typeof currencySchema>,
    @ClientIp() ip: string | null,
  ): Promise<ReadinessDto> {
    return this.cfs.setCurrency(user, id, level, body.currency, ip);
  }

  @Post('levels/:level/continue')
  @Prepare()
  continue(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Body(new ZodPipe(continueSchema)) body: z.output<typeof continueSchema>,
    @ClientIp() ip: string | null,
  ): Promise<{ currentStep: string }> {
    return this.cfs.continue(
      user,
      id,
      level,
      body.from as (typeof CFS_LEVEL_STEPS)[number]['code'],
      ip,
    );
  }

  @Get('levels/:level/aggregation')
  @ViewTasks()
  aggregation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
  ): Promise<AggregationDto> {
    return this.cfs.aggregation(user, id, level);
  }

  @Get('levels/:level/aggregation/export')
  @ViewTasks()
  async export(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { a, body } = await this.cfs.aggregationWorkbook(user, id, level);
    const name = `${a.level.taskNumber}-L${level}-${a.level.name.replace(/\s+/g, '-')}-entity-wise-${a.currency}.xlsx`;
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

  @Get('levels/:level/eliminations')
  @ViewTasks()
  eliminations(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
  ): Promise<EliminationsDto> {
    return this.cfs.eliminations(user, id, level);
  }

  @Post('levels/:level/eliminations/generate')
  @Prepare()
  generate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @ClientIp() ip: string | null,
  ): Promise<EliminationsDto> {
    return this.cfs.generate(user, id, level, ip);
  }

  @Post('levels/:level/adjustments')
  @Prepare()
  addManual(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Body(new ZodPipe(manualSchema)) body: z.output<typeof manualSchema>,
    @ClientIp() ip: string | null,
  ): Promise<EliminationsDto> {
    return this.cfs.addManual(user, id, level, body, ip);
  }

  @Delete('levels/:level/adjustments/:adjustmentId')
  @Prepare()
  deleteManual(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('level', ParseIntPipe) level: number,
    @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string,
    @ClientIp() ip: string | null,
  ): Promise<EliminationsDto> {
    return this.cfs.deleteManual(user, id, level, adjustmentId, ip);
  }
}
