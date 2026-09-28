import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiErrorCode, type PermissionCode } from '@finance-close/shared';
import type { Request } from 'express';
import { ApiError } from '../common/api-error';
import { AuthProvider } from './auth-provider';
import { type AuthUser, SessionUserLoader } from './session-user';

/*
 * Every endpoint must declare exactly one access policy:
 *   @Public()                      no login needed (health, login, refresh, logout)
 *   @Authenticated()               any signed-in user (e.g. "who am I")
 *   @RequirePermission('CODE')     signed-in user holding CODE (the master holds all)
 * An endpoint with no policy is refused (deny by default), so a forgotten decorator can
 * never expose data.
 *
 * Users who must change their password are refused everywhere except endpoints marked
 * @AllowPendingPasswordChange().
 */

const POLICY = 'fc:access-policy';
const ALLOW_PENDING = 'fc:allow-pending-password-change';

type Policy =
  { kind: 'public' } | { kind: 'authenticated' } | { kind: 'permission'; code: PermissionCode };

export const Public = () => SetMetadata(POLICY, { kind: 'public' } satisfies Policy);
export const Authenticated = () => SetMetadata(POLICY, { kind: 'authenticated' } satisfies Policy);
export const RequirePermission = (code: PermissionCode) =>
  SetMetadata(POLICY, { kind: 'permission', code } satisfies Policy);
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING, true);

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

/** `@CurrentUser() user: AuthUser` — only on endpoints that are not @Public. */
export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new Error('CurrentUser used on an endpoint without authentication');
  return user;
});

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthProvider,
    private readonly users: SessionUserLoader,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const policy = this.reflector.getAllAndOverride<Policy | undefined>(POLICY, targets);
    if (!policy) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        ApiErrorCode.PermissionDenied,
        'This endpoint has no access policy and is blocked.',
      );
    }
    if (policy.kind === 'public') return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1];
    if (!token) throw notAuthenticated('Please sign in.');

    const claims = await this.auth.verifyAccessToken(token);
    if (!claims) throw notAuthenticated('Your session has expired. Please sign in again.');

    const user = await this.users.load(claims.userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        ApiErrorCode.AccountInactive,
        'This account is deactivated. Contact your administrator.',
      );
    }
    // Password changes, resets and deactivation bump the version, ending older tokens.
    if (claims.sessionVersion !== user.sessionVersion) {
      throw notAuthenticated('Your session has ended. Please sign in again.');
    }
    req.user = user;

    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING, targets);
    if (user.mustChangePassword && !allowPending) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        ApiErrorCode.PasswordChangeRequired,
        'You must change your temporary password before continuing.',
      );
    }

    if (policy.kind === 'permission' && !user.permissions.has(policy.code)) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        ApiErrorCode.PermissionDenied,
        `You don't have access to this. It needs the ${policy.code} permission — ask a user administrator.`,
        { requiredPermission: policy.code },
      );
    }
    return true;
  }
}

function notAuthenticated(message: string): ApiError {
  return new ApiError(HttpStatus.UNAUTHORIZED, ApiErrorCode.NotAuthenticated, message);
}
