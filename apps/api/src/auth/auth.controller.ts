import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiErrorCode, type SessionResponse, type SessionUser } from '@finance-close/shared';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { ApiError } from '../common/api-error';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import type { Env } from '../config/env';
import { AllowPendingPasswordChange, Authenticated, CurrentUser, Public } from './access-control';
import { AuthProvider, type SessionTokens } from './auth-provider';
import { type AuthUser, toSessionUser } from './session-user';

/** httpOnly refresh-token cookie, sent only to /api/auth/*. */
export const REFRESH_COOKIE = 'fc_refresh';

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email').max(320),
  password: z.string().min(1, 'Enter your password').max(200),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(200),
  newPassword: z.string().min(1, 'Enter a new password').max(200),
});

@Controller('auth')
export class AuthController {
  private readonly cookie: CookieOptions;

  constructor(
    private readonly auth: AuthProvider,
    config: ConfigService<Env, true>,
  ) {
    this.cookie = {
      httpOnly: true,
      secure: config.get('COOKIE_SECURE', { infer: true }),
      sameSite: 'strict',
      path: '/api/auth',
    };
  }

  @Post('login')
  @HttpCode(200)
  @Public()
  async login(
    @Body(new ZodPipe(loginSchema)) body: z.output<typeof loginSchema>,
    @ClientIp() ip: string | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    return this.respond(res, await this.auth.signIn(body.email, body.password, ip));
  }

  /** Uses the refresh cookie; the web app calls this on page load and before tokens expire. */
  @Post('refresh')
  @HttpCode(200)
  @Public()
  async refresh(
    @Req() req: Request,
    @ClientIp() ip: string | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const token = readRefreshCookie(req);
    try {
      if (!token) {
        throw new ApiError(
          HttpStatus.UNAUTHORIZED,
          ApiErrorCode.NotAuthenticated,
          'Please sign in.',
        );
      }
      return this.respond(res, await this.auth.refresh(token, ip));
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, this.cookie);
      throw err;
    }
  }

  /** Public so it also works with an expired access token; the cookie identifies the session. */
  @Post('logout')
  @HttpCode(204)
  @Public()
  async logout(
    @Req() req: Request,
    @ClientIp() ip: string | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.signOut(readRefreshCookie(req), ip);
    res.clearCookie(REFRESH_COOKIE, this.cookie);
  }

  @Get('me')
  @Authenticated()
  @AllowPendingPasswordChange()
  me(@CurrentUser() user: AuthUser): SessionUser {
    return toSessionUser(user);
  }

  @Post('change-password')
  @HttpCode(200)
  @Authenticated()
  @AllowPendingPasswordChange()
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(changePasswordSchema)) body: z.output<typeof changePasswordSchema>,
    @ClientIp() ip: string | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const session = await this.auth.changePassword(
      user.id,
      body.currentPassword,
      body.newPassword,
      ip,
    );
    return this.respond(res, session);
  }

  private respond(res: Response, s: SessionTokens): SessionResponse {
    res.cookie(REFRESH_COOKIE, s.refreshToken, { ...this.cookie, expires: s.refreshExpiresAt });
    return { accessToken: s.accessToken, expiresIn: s.expiresIn, user: toSessionUser(s.user) };
  }
}

function readRefreshCookie(req: Request): string | undefined {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
