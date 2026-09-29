import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  Permission,
  type TaskDetailDto,
  type WizardEntityDto,
  type WizardLevelsDto,
  type WizardOptionsDto,
  type WizardPeriodDto,
} from '@finance-close/shared';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { TaskWizardService } from './task-wizard.service';

/** Preparers only; the service also checks the permission for the specific task type. */
const Prepare = () => RequirePermission(Permission.SfsPrepare, Permission.CfsPrepare);

const type = z.enum(['SFS', 'CFS']);
const periodsSchema = z.object({
  type,
  fyId: z.string().uuid(),
  periodType: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL']),
});
const periodSchema = z.object({ periodId: z.string().uuid() });
const createSchema = z.object({
  type,
  periodId: z.string().uuid('Choose a period'),
  formatCode: z.string().min(1, 'Choose a format').max(40),
  entityCodes: z.array(z.string().max(10)).max(100).optional(),
  description: z.string().trim().max(300, 'Description: at most 300 characters'),
  reviewerNote: z
    .string()
    .trim()
    .max(1000, 'Note to reviewer: at most 1000 characters')
    .nullable()
    .optional(),
});

@Controller()
export class TaskWizardController {
  constructor(private readonly wizard: TaskWizardService) {}

  @Get('task-wizard/options')
  @Prepare()
  options(@CurrentUser() user: AuthUser): Promise<WizardOptionsDto> {
    return this.wizard.options(user);
  }

  @Get('task-wizard/periods')
  @Prepare()
  periods(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(periodsSchema)) q: z.output<typeof periodsSchema>,
  ): Promise<WizardPeriodDto[]> {
    return this.wizard.periods(user, q.type, q.fyId, q.periodType);
  }

  @Get('task-wizard/entities')
  @Prepare()
  entities(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(periodSchema)) q: z.output<typeof periodSchema>,
  ): Promise<WizardEntityDto[]> {
    return this.wizard.entityChoices(user, q.periodId);
  }

  @Get('task-wizard/levels')
  @Prepare()
  levels(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(periodSchema)) q: z.output<typeof periodSchema>,
  ): Promise<WizardLevelsDto> {
    return this.wizard.levelChoices(user, q.periodId);
  }

  /** POST /api/tasks — create a task. All rules are enforced here, whatever the web app sent. */
  @Post('tasks')
  @Prepare()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createSchema)) body: z.output<typeof createSchema>,
    @ClientIp() ip: string | null,
  ): Promise<TaskDetailDto> {
    return this.wizard.create(user, body, ip);
  }
}
