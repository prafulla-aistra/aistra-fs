import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../configuration/configuration.module';
import { DashboardService } from './dashboard.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

/** Page 1: dashboard and the task list. Task creation and the workspace come next. */
@Module({
  imports: [ConfigurationModule],
  controllers: [TasksController],
  providers: [TasksService, DashboardService],
})
export class TasksModule {}
