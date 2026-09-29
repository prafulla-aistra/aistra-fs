import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { validateEnv } from './config/env';
import { ConfigurationModule } from './configuration/configuration.module';
import { DemoModule, demoModeEnabled } from './demo/demo.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    PrismaModule,
    StorageModule,
    AuditModule,
    AuthModule,
    HealthModule,
    UsersModule,
    ConfigurationModule,
    // Demo accounts + quick login exist only when DEMO_MODE=true (never in production).
    ConditionalModule.registerWhen(DemoModule, demoModeEnabled),
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
