import type { Prisma } from '@prisma/client';
import type { AuthUser } from './session-user';

export interface SessionTokens {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: AuthUser;
}

export interface AccessClaims {
  userId: string;
  /** Must equal the user's current sessionVersion, or the token is stale. */
  sessionVersion: number;
}

/**
 * Everything about credentials and sessions, behind one interface (CLAUDE.md), so AWS
 * Cognito can replace LocalAuthProvider later without changing business code.
 *
 * Users, permissions and entity scope stay in our database whichever provider is used.
 */
export abstract class AuthProvider {
  /** Checks email + password, applies lockout rules, audits the attempt, opens a session. */
  abstract signIn(email: string, password: string, ip: string | null): Promise<SessionTokens>;
  /** Exchanges a refresh token for a new session (the old refresh token is revoked). */
  abstract refresh(refreshToken: string, ip: string | null): Promise<SessionTokens>;
  /** Ends the session belonging to this refresh token (no-op if unknown). */
  abstract signOut(refreshToken: string | undefined, ip: string | null): Promise<void>;
  /** Returns the claims of a valid access token, or null if invalid/expired. */
  abstract verifyAccessToken(token: string): Promise<AccessClaims | null>;
  /** The user changes their own password; ends other sessions and returns a fresh one. */
  abstract changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ip: string | null,
  ): Promise<SessionTokens>;
  /** Admin sets a temporary password; the user must change it at next sign-in. */
  abstract setTemporaryPassword(
    userId: string,
    password: string,
    db: Prisma.TransactionClient,
  ): Promise<void>;
  /**
   * DEMO MODE ONLY: opens a session for a seeded demo account without a password. Callers
   * must have checked that demo mode is on and the user is a demo account.
   */
  abstract signInAsDemoUser(userId: string, ip: string | null): Promise<SessionTokens>;
  /** Ends every session of a user, including unexpired access tokens (e.g. on deactivation). */
  abstract revokeSessions(userId: string, db: Prisma.TransactionClient): Promise<void>;
}
