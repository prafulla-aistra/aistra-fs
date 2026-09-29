import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SessionResponse } from '@finance-close/shared';
import type { CookieOptions, Request, Response } from 'express';
import type { Env } from '../config/env';
import type { SessionTokens } from './auth-provider';
import { toSessionUser } from './session-user';

/** httpOnly refresh-token cookie, sent only to /api/auth/*. */
export const REFRESH_COOKIE = 'fc_refresh';

/** Sets and clears the refresh cookie the same way for every sign-in route. */
@Injectable()
export class SessionCookies {
  private readonly options: CookieOptions;

  constructor(config: ConfigService<Env, true>) {
    this.options = {
      httpOnly: true,
      secure: config.get('COOKIE_SECURE', { infer: true }),
      sameSite: 'strict',
      path: '/api/auth',
    };
  }

  /** Sets the refresh cookie and returns the body for the browser (access token + user). */
  respond(res: Response, s: SessionTokens): SessionResponse {
    res.cookie(REFRESH_COOKIE, s.refreshToken, { ...this.options, expires: s.refreshExpiresAt });
    return { accessToken: s.accessToken, expiresIn: s.expiresIn, user: toSessionUser(s.user) };
  }

  clear(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, this.options);
  }

  read(req: Request): string | undefined {
    const value = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}
