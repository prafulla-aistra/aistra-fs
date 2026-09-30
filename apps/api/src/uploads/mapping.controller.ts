import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  Permission,
  type ChartOfAccountDto,
  type EntityMappingDto,
  type MappingStepDto,
} from '@finance-close/shared';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { ViewConfig } from '../configuration/access';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { MappingStepService } from './mapping-step.service';

const ViewTasks = () =>
  RequirePermission(
    Permission.SfsPrepare,
    Permission.SfsReview,
    Permission.CfsPrepare,
    Permission.CfsReview,
    Permission.ReportsView,
  );
const Prepare = () => RequirePermission(Permission.SfsPrepare);

const entityCode = z.string().regex(/^[A-Z0-9]{1,10}$/, 'Invalid entity code');
const saveSchema = z.object({
  mappings: z
    .array(
      z.object({
        accountCode: z.string().min(1).max(40),
        accountType: z.string().trim().max(60).nullable(),
        fsliCode: z.string().min(1, 'Choose an FSLI').max(30),
        counterpartyCode: z.string().max(10).nullable(),
        confirmWarnings: z.boolean().optional(),
        reason: z.string().trim().max(500).nullable().optional(),
      }),
    )
    .min(1, 'Choose an FSLI for at least one account')
    .max(1000),
});

@Controller()
export class MappingController {
  constructor(
    private readonly mapping: MappingStepService,
    private readonly coa: ChartOfAccountsService,
  ) {}

  @Get('tasks/:id/mapping-step')
  @ViewTasks()
  step(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MappingStepDto> {
    return this.mapping.step(user, id);
  }

  @Get('tasks/:id/entities/:code/mapping')
  @ViewTasks()
  entity(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
  ): Promise<EntityMappingDto> {
    return this.mapping.entity(user, id, code);
  }

  @Put('tasks/:id/entities/:code/mappings')
  @Prepare()
  save(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @Body(new ZodPipe(saveSchema)) body: z.output<typeof saveSchema>,
    @ClientIp() ip: string | null,
  ): Promise<EntityMappingDto> {
    return this.mapping.save(user, id, code, body.mappings, ip);
  }

  @Post('tasks/:id/entities/:code/mapping/continue')
  @Prepare()
  continue(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code', new ZodPipe(entityCode)) code: string,
    @ClientIp() ip: string | null,
  ): Promise<{ currentStep: string }> {
    return this.mapping.continue(user, id, code, ip);
  }

  /** Configuration → Chart of accounts (read-only list for now). */
  @Get('config/entities/:code/accounts')
  @ViewConfig()
  accounts(@Param('code', new ZodPipe(entityCode)) code: string): Promise<ChartOfAccountDto[]> {
    return this.coa.list(code);
  }
}
