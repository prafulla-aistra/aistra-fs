import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiErrorCode, type SessionResponse, type SessionUser } from '@finance-close/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiError } from '../common/api-error';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { AllowPendingPasswordChange, Authenticated, CurrentUser, Public } from './access-control';
import { AuthProvider } from './auth-provider';
import { SessionCookies } from './session-cookies';
import { type AuthUser, toSessionUser } from './session-user';

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
  constructor(
    private readonly auth: AuthProvider,
    private readonly cookies: SessionCookies,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Public()
  async login(
    @Body(new ZodPipe(loginSchema)) body: z.output<typeof loginSchema>,
    @ClientIp() ip: string | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    return this.cookies.respond(res, await this.auth.signIn(body.email, body.password, ip));
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
    const token = this.cookies.read(req);
    try {
      if (!token) {
        throw new ApiError(
          HttpStatus.UNAUTHORIZED,
          ApiErrorCode.NotAuthenticated,
          'Please sign in.',
        );
      }
      return this.cookies.respond(res, await this.auth.refresh(token, ip));
    } catch (err) {
      this.cookies.clear(res);
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
    await this.auth.signOut(this.cookies.read(req), ip);
    this.cookies.clear(res);
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
    return this.cookies.respond(res, session);
  }
}
