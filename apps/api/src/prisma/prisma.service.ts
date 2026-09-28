import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import type { Env } from '../config/env';

/**
 * Single shared Prisma client for the API.
 *
 * Connects lazily on first query (no eager $connect), so the API still starts — and
 * /api/health can report the problem — when the database is unavailable.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    // Use the validated setting, so the client and the rest of the API agree on the database.
    super({ datasourceUrl: config.get('DATABASE_URL', { infer: true }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
