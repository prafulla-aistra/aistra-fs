import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../configuration/configuration.module';
import { DashboardService } from './dashboard.service';
import { TaskWizardController } from './task-wizard.controller';
import { TaskWizardService } from './task-wizard.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

/** Page 1 (dashboard, task list) and page 2 (new-task wizard). The workspace comes next. */
@Module({
  imports: [ConfigurationModule],
  controllers: [TasksController, TaskWizardController],
  providers: [TasksService, DashboardService, TaskWizardService],
})
export class TasksModule {}
