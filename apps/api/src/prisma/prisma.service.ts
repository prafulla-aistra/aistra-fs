import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import type { Env } from '../config/env';
import { withConnectionDefaults } from './database-url';

/**
 * Single shared Prisma client for the API.
 *
 * Starts connecting in the background at startup (connections are slow to open on the local
 * embedded server), but never blocks or fails startup: if the database is down the API still
 * starts, /api/health reports it, and requests get a clear 503.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<Env, true>) {
    // Use the validated setting, so the client and the rest of the API agree on the database.
    super({ datasourceUrl: withConnectionDefaults(config.get('DATABASE_URL', { infer: true })) });
  }

  private warmUp: Promise<void> = Promise.resolve();

  onModuleInit(): void {
    this.warmUp = this.$connect().catch((err: unknown) =>
      this.logger.warn(
        `Database not reachable yet: ${err instanceof Error ? err.message.trim().split('\n').at(-1) : String(err)}`,
      ),
    );
  }

  async onModuleDestroy(): Promise<void> {
    // Never disconnect while the warm-up connect is still in flight: on Windows the query
    // engine can then call back into a closing handle and crash Node (libuv assertion).
    await this.warmUp;
    await this.$disconnect();
  }
}
