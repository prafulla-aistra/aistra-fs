import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ClockModule } from './common/clock';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { validateEnv } from './config/env';
import { ConfigurationModule } from './configuration/configuration.module';
import { DemoModule, demoModeEnabled } from './demo/demo.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { StorageModule } from './storage/storage.module';
import { TasksModule } from './tasks/tasks.module';
import { UploadsModule } from './uploads/uploads.module';
import { ConsolidationModule } from './consolidation/consolidation.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    PrismaModule,
    ClockModule,
    StorageModule,
    MailModule,
    AuditModule,
    AuthModule,
    HealthModule,
    UsersModule,
    ConfigurationModule,
    TasksModule,
    UploadsModule,
    ConsolidationModule,
    // Demo accounts + quick login exist only when DEMO_MODE=true (never in production).
    ConditionalModule.registerWhen(DemoModule, demoModeEnabled),
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
