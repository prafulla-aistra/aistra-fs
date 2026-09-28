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
 *   @RequirePermission('A', 'B')   signed-in user holding A or B (the master holds all)
 * An endpoint with no policy is refused (deny by default), so a forgotten decorator can
 * never expose data.
 *
 * Users who must change their password are refused everywhere except endpoints marked
 * @AllowPendingPasswordChange().
 */

const POLICY = 'fc:access-policy';
const ALLOW_PENDING = 'fc:allow-pending-password-change';

type Policy =
  { kind: 'public' } | { kind: 'authenticated' } | { kind: 'permission'; anyOf: PermissionCode[] };

export const Public = () => SetMetadata(POLICY, { kind: 'public' } satisfies Policy);
export const Authenticated = () => SetMetadata(POLICY, { kind: 'authenticated' } satisfies Policy);
/** Allows users holding at least one of the given permissions. */
export const RequirePermission = (...anyOf: [PermissionCode, ...PermissionCode[]]) =>
  SetMetadata(POLICY, { kind: 'permission', anyOf } satisfies Policy);
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

    if (policy.kind === 'permission' && !policy.anyOf.some((c) => user.permissions.has(c))) {
      const needed =
        policy.anyOf.length === 1
          ? `the ${policy.anyOf[0]} permission`
          : `one of these permissions: ${policy.anyOf.join(', ')}`;
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        ApiErrorCode.PermissionDenied,
        `You don't have access to this. It needs ${needed} — ask a user administrator.`,
        { requiredPermission: policy.anyOf.join(' or ') },
      );
    }
    return true;
  }
}

function notAuthenticated(message: string): ApiError {
  return new ApiError(HttpStatus.UNAUTHORIZED, ApiErrorCode.NotAuthenticated, message);
}
