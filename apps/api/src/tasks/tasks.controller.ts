import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  Permission,
  type DashboardDto,
  type TaskDetailDto,
  type TaskListPage,
} from '@finance-close/shared';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ZodPipe } from '../common/zod.pipe';
import { DashboardService } from './dashboard.service';
import { TasksService } from './tasks.service';

/** Close work is visible to preparers, reviewers and report viewers. */
const ViewTasks = () =>
  RequirePermission(
    Permission.SfsPrepare,
    Permission.SfsReview,
    Permission.CfsPrepare,
    Permission.CfsReview,
    Permission.ReportsView,
  );

const dashboardSchema = z.object({ period: z.string().uuid().optional() });

const listSchema = z.object({
  periodId: z.string().uuid().optional(),
  fyId: z.string().uuid().optional(),
  periodType: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL']).optional(),
  type: z.enum(['SFS', 'CFS']).optional(),
  status: z
    .enum([
      'NOT_STARTED',
      'IN_PROGRESS',
      'IN_REVIEW',
      'DONE',
      'OVERDUE',
      'TO_CONTINUE',
      'AWAITING_REVIEW',
    ])
    .optional(),
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

@Controller()
export class TasksController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly tasks: TasksService,
  ) {}

  /** GET /api/dashboard?period=<month id> — every dashboard count, from one place. */
  @Get('dashboard')
  @ViewTasks()
  getDashboard(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(dashboardSchema)) q: z.output<typeof dashboardSchema>,
  ): Promise<DashboardDto> {
    return this.dashboard.get(user, q.period);
  }

  @Get('tasks')
  @ViewTasks()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(listSchema)) q: z.output<typeof listSchema>,
  ): Promise<TaskListPage> {
    return this.tasks.list(user, q);
  }

  @Get('tasks/:id')
  @ViewTasks()
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaskDetailDto> {
    return this.tasks.get(user, id);
  }
}
