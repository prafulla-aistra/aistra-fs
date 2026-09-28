import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { validateEnv } from './config/env';
import { ConfigurationModule } from './configuration/configuration.module';
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
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
