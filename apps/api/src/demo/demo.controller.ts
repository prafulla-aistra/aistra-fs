import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { DemoAccountDto, SessionResponse } from '@finance-close/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { Public } from '../auth/access-control';
import { AuthProvider } from '../auth/auth-provider';
import { normaliseEmail } from '../auth/passwords';
import { SessionCookies } from '../auth/session-cookies';
import { ApiError } from '../common/api-error';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const demoLoginSchema = z.object({ email: z.string().trim().min(1).max(320) });

/**
 * DEMO MODE ONLY. This controller is registered only when DEMO_MODE=true (see DemoModule);
 * otherwise these routes do not exist and answer 404 like any unknown URL.
 */
@Controller('auth')
export class DemoController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthProvider,
    private readonly cookies: SessionCookies,
  ) {}

  /** The one-click accounts shown on the sign-in page: the master and the seeded demo users. */
  @Get('demo-accounts')
  @Public()
  async accounts(): Promise<DemoAccountDto[]> {
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', OR: [{ isMaster: true }, { isDemo: true }] },
      include: { template: { select: { name: true, sortOrder: true } } },
    });
    return users
      .sort(
        (a, b) =>
          Number(b.isMaster) - Number(a.isMaster) ||
          (a.template?.sortOrder ?? 99) - (b.template?.sortOrder ?? 99) ||
          a.name.localeCompare(b.name),
      )
      .map((u) => ({
        name: u.name,
        email: u.email,
        role: u.isMaster ? 'Master admin' : (u.template?.name ?? 'Custom'),
        isMaster: u.isMaster,
      }));
  }

  /** Signs in as a demo account (or the master) without a password. */
  @Post('demo-login')
  @HttpCode(200)
  @Public()
  async login(
    @Body(new ZodPipe(demoLoginSchema)) body: z.output<typeof demoLoginSchema>,
    @ClientIp() ip: string | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: normaliseEmail(body.email) },
    });
    if (!user || !(user.isDemo || user.isMaster) || user.status !== 'ACTIVE') {
      throw ApiError.notFound('That is not an active demo account.');
    }
    return this.cookies.respond(res, await this.auth.signInAsDemoUser(user.id, ip));
  }
}
