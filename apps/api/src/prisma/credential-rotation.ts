import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * On AWS the database password comes from an RDS-managed secret that RDS rotates (every 7
 * days). The API reads it once at start-up (scripts/with-aws-secrets.mjs), so after a rotation
 * new connections are refused. When that happens the process exits; systemd restarts it and the
 * wrapper reads the current password. Only active when DB_SECRET_ARN is set, so a wrong local
 * password never stops the development server.
 */
const logger = new Logger('DatabaseCredentials');
const RESTART_DELAY_MS = 1000;
let exiting = false;

/** Prisma / PostgreSQL error meaning "user name or password rejected". */
export function isDatabaseAuthFailure(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError && err.errorCode === 'P1000')
    return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P1000') return true;
  const message = err instanceof Error ? err.message : '';
  return /Authentication failed against database server|password authentication failed/i.test(
    message,
  );
}

/** Exits (once) after a short delay, so the current response is still sent. */
export function restartIfDatabaseCredentialsRotated(
  err: unknown,
  env: NodeJS.ProcessEnv = process.env,
  exit: (code: number) => void = (code) => process.exit(code),
): boolean {
  if (exiting || !env.DB_SECRET_ARN?.trim() || !isDatabaseAuthFailure(err)) return false;
  exiting = true;
  logger.error(
    'Database rejected the password (rotated secret?). Exiting so the service restarts with the current one.',
  );
  setTimeout(() => exit(1), RESTART_DELAY_MS).unref();
  return true;
}

/** Tests only. */
export function resetCredentialRotationState(): void {
  exiting = false;
}
