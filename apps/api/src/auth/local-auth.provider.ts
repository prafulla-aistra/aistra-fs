import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Prisma, User } from '@prisma/client';
import { ApiErrorCode, AuditAction } from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { type AccessClaims, AuthProvider, type SessionTokens } from './auth-provider';
import { assertPasswordPolicy, hashPassword, normaliseEmail, verifyPassword } from './passwords';
import { SessionUserLoader } from './session-user';

/** Access tokens live 15 minutes (requirement). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** Lock the account for 15 minutes after 5 failed attempts in a row (requirement). */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;
/**
 * Two browser tabs can refresh with the same cookie at the same moment. A just-rotated
 * token is therefore only refused, not treated as stolen, within this grace window.
 */
const ROTATION_GRACE_MS = 30_000;

/** Email/password authentication against our own user table (bcrypt + JWT). */
@Injectable()
export class LocalAuthProvider extends AuthProvider {
  private readonly rounds: number;
  private readonly refreshTtlMs: number;
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly users: SessionUserLoader,
    config: ConfigService<Env, true>,
  ) {
    super();
    this.rounds = config.get('BCRYPT_ROUNDS', { infer: true });
    this.refreshTtlMs = config.get('REFRESH_TOKEN_TTL_HOURS', { infer: true }) * 3_600_000;
  }

  async signIn(emailInput: string, password: string, ip: string | null): Promise<SessionTokens> {
    const email = normaliseEmail(emailInput);
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Same work as a real check, so response time does not reveal which emails exist.
      await verifyPassword(password, await this.getDummyHash());
      await this.failure(null, { email, reason: 'UNKNOWN_EMAIL' }, ip);
      throw invalidCredentials();
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      await this.failure(user.id, { email, reason: 'ACCOUNT_LOCKED' }, ip);
      throw locked(user.lockedUntil);
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      await this.recordWrongPassword(user, now, ip);
    }

    if (user.status !== 'ACTIVE') {
      await this.failure(user.id, { email, reason: 'ACCOUNT_INACTIVE' }, ip);
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        ApiErrorCode.AccountInactive,
        'This account is deactivated. Contact your administrator.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.LoginSuccess,
          entityType: 'USER',
          entityId: user.id,
          ip,
        },
        tx,
      );
      return this.openSession(user.id, ip, tx);
    });
  }

  async signInAsDemoUser(userId: string, ip: string | null): Promise<SessionTokens> {
    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
      await this.audit.record(
        {
          userId,
          action: AuditAction.LoginSuccess,
          entityType: 'USER',
          entityId: userId,
          newValue: { method: 'DEMO_QUICK_LOGIN' },
          ip,
        },
        tx,
      );
      return this.openSession(userId, ip, tx);
    });
  }

  async refresh(refreshToken: string, ip: string | null): Promise<SessionTokens> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });
    const now = Date.now();
    if (!stored) throw sessionEnded();
    if (stored.revokedAt) {
      if (now - stored.revokedAt.getTime() > ROTATION_GRACE_MS) {
        // A long-revoked token is being replayed: assume it was stolen, end every session.
        await this.prisma.refreshToken.updateMany({
          where: { userId: stored.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw sessionEnded();
    }
    if (stored.expiresAt.getTime() <= now) throw sessionEnded();

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count === 0) throw sessionEnded(); // lost a race with another refresh
      const user = await tx.user.findUnique({ where: { id: stored.userId } });
      if (!user || user.status !== 'ACTIVE') throw sessionEnded();
      return this.openSession(user.id, ip, tx);
    });
  }

  async signOut(refreshToken: string | undefined, ip: string | null): Promise<void> {
    if (!refreshToken) return;
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });
    if (!stored || stored.revokedAt) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
      await this.audit.record(
        {
          userId: stored.userId,
          action: AuditAction.Logout,
          entityType: 'USER',
          entityId: stored.userId,
          ip,
        },
        tx,
      );
    });
  }

  async verifyAccessToken(token: string): Promise<AccessClaims | null> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: string; typ?: string; ver?: number }>(
        token,
      );
      if (payload.typ !== 'access' || !payload.sub || typeof payload.ver !== 'number') return null;
      return { userId: payload.sub, sessionVersion: payload.ver };
    } catch {
      return null;
    }
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ip: string | null,
  ): Promise<SessionTokens> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw ApiError.validation('Your current password is incorrect.');
    }
    assertPasswordPolicy(newPassword, 'New password');
    if (newPassword === currentPassword) {
      throw ApiError.validation('Your new password must be different from the current one.');
    }
    const hash = await hashPassword(newPassword, this.rounds);

    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: hash, mustChangePassword: false, passwordChangedAt: new Date() },
      });
      await this.revokeSessions(userId, tx);
      await this.audit.record(
        {
          userId,
          action: AuditAction.PasswordChange,
          entityType: 'USER',
          entityId: userId,
          newValue: { firstLogin: user.mustChangePassword },
          ip,
        },
        tx,
      );
      return this.openSession(userId, ip, tx);
    });
  }

  async setTemporaryPassword(
    userId: string,
    password: string,
    db: Prisma.TransactionClient,
  ): Promise<void> {
    assertPasswordPolicy(password, 'Temporary password');
    await db.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(password, this.rounds),
        mustChangePassword: true,
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.revokeSessions(userId, db);
  }

  async revokeSessions(userId: string, db: Prisma.TransactionClient): Promise<void> {
    await db.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
    await db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // -------------------------------------------------------------------------

  /** Counts a wrong password, locking the account at the limit. Always throws. */
  private async recordWrongPassword(user: User, now: Date, ip: string | null): Promise<never> {
    // An expired lock starts a fresh count.
    const previous = user.lockedUntil ? 0 : user.failedLoginCount;
    const attempts = previous + 1;
    const lockNow = attempts >= MAX_FAILED_ATTEMPTS;
    const lockedUntil = new Date(now.getTime() + LOCKOUT_MINUTES * 60_000);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: lockNow
          ? { failedLoginCount: 0, lockedUntil }
          : { failedLoginCount: attempts, lockedUntil: null },
      });
      await this.failure(
        user.id,
        { email: user.email, reason: 'WRONG_PASSWORD', failedAttempts: attempts },
        ip,
        tx,
      );
      if (lockNow) {
        await this.audit.record(
          {
            userId: user.id,
            action: AuditAction.AccountLocked,
            entityType: 'USER',
            entityId: user.id,
            newValue: { lockedUntil: lockedUntil.toISOString(), afterFailedAttempts: attempts },
            ip,
          },
          tx,
        );
      }
    });

    if (lockNow) throw locked(lockedUntil);
    const left = MAX_FAILED_ATTEMPTS - attempts;
    throw invalidCredentials(
      left <= 2
        ? ` ${left} more failed attempt${left === 1 ? '' : 's'} will lock the account for ${LOCKOUT_MINUTES} minutes.`
        : '',
    );
  }

  private failure(
    userId: string | null,
    details: Record<string, unknown>,
    ip: string | null,
    db?: Prisma.TransactionClient,
  ): Promise<void> {
    return this.audit.record(
      {
        userId,
        action: AuditAction.LoginFailure,
        entityType: 'USER',
        entityId: userId,
        newValue: details,
        ip,
      },
      db,
    );
  }

  private async openSession(
    userId: string,
    ip: string | null,
    db: Prisma.TransactionClient,
  ): Promise<SessionTokens> {
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + this.refreshTtlMs);
    await db.refreshToken.create({
      data: { userId, tokenHash: sha256(refreshToken), expiresAt: refreshExpiresAt, ip },
    });
    // Read through the transaction so the returned user reflects the changes just made.
    const user = await this.users.load(userId, db);
    if (!user) throw sessionEnded();
    const accessToken = await this.jwt.signAsync(
      { sub: userId, typ: 'access', ver: user.sessionVersion },
      { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );
    return {
      accessToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      refreshExpiresAt,
      user,
    };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword(randomBytes(16).toString('hex'), this.rounds);
    return this.dummyHash;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function invalidCredentials(suffix = ''): ApiError {
  return new ApiError(
    HttpStatus.UNAUTHORIZED,
    ApiErrorCode.InvalidCredentials,
    `Email or password is incorrect.${suffix}`,
  );
}

function locked(until: Date): ApiError {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  return new ApiError(
    HttpStatus.LOCKED,
    ApiErrorCode.AccountLocked,
    `This account is locked after ${MAX_FAILED_ATTEMPTS} failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask an administrator to reset your password.`,
    { lockedUntil: until.toISOString() },
  );
}

function sessionEnded(): ApiError {
  return new ApiError(
    HttpStatus.UNAUTHORIZED,
    ApiErrorCode.NotAuthenticated,
    'Your session has ended. Please sign in again.',
  );
}
