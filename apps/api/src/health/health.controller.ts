import { Controller, Get, HttpStatus, Logger, Res } from '@nestjs/common';
import type { HealthResponse } from '@finance-close/shared';
import type { Response } from 'express';
import { Public } from '../auth/access-control';
import { PrismaService } from '../prisma/prisma.service';

const DB_TIMEOUT_MS = 3000;

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /api/health — 200 {status:"ok", db:"ok"} when healthy, 503 otherwise. */
  @Get()
  @Public()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const dbOk = await this.pingDatabase();
    if (!dbOk) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: dbOk ? 'ok' : 'error', db: dbOk ? 'ok' : 'error' };
  }

  private async pingDatabase(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${DB_TIMEOUT_MS} ms`)),
          DB_TIMEOUT_MS,
        );
      });
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
      return true;
    } catch (err) {
      this.logger.warn(
        `Database health check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
