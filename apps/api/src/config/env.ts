/** Storage back-ends. Only "local" exists today; "s3" is added for AWS. */
export const STORAGE_DRIVERS = ['local'] as const;
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];

/**
 * Environment variables the API needs, validated once at startup so a missing or
 * malformed setting fails fast instead of surfacing later as a confusing runtime error.
 *
 * apps/api/.env is created from .env.example automatically on the first `npm run dev`.
 */
export interface Env {
  PORT: number;
  /** postgresql:// connection string: the embedded local server by default, or AWS RDS. */
  DATABASE_URL: string;
  CORS_ORIGINS: string[];
  STORAGE_DRIVER: StorageDriver;
  /** Folder for uploaded files when STORAGE_DRIVER=local (relative to the repo root). */
  STORAGE_LOCAL_DIR: string;
  /** Secret for signing access tokens (HS256). At least 32 characters. */
  JWT_SECRET: string;
  /** Refresh-token (session) lifetime in hours. */
  REFRESH_TOKEN_TTL_HOURS: number;
  /** Send the refresh cookie only over HTTPS. true in any deployed environment. */
  COOKIE_SECURE: boolean;
  /** bcrypt cost factor (4–15). 12 in normal use; tests lower it for speed. */
  BCRYPT_ROUNDS: number;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const errors: string[] = [];

  const portRaw = String(raw.PORT ?? '3000');
  const port = Number.parseInt(portRaw, 10);
  if (!/^\d+$/.test(portRaw) || port < 1 || port > 65535) {
    errors.push(`PORT must be an integer between 1 and 65535 (got "${portRaw}")`);
  }

  const databaseUrl = str(raw.DATABASE_URL);
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    errors.push(
      'DATABASE_URL must be set to a postgresql:// connection string (see apps/api/.env.example)',
    );
  }

  const corsOrigins = String(raw.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const storageDriver = str(raw.STORAGE_DRIVER) || 'local';
  if (!(STORAGE_DRIVERS as readonly string[]).includes(storageDriver)) {
    errors.push(
      `STORAGE_DRIVER must be one of: ${STORAGE_DRIVERS.join(', ')} (got "${storageDriver}")`,
    );
  }

  const storageLocalDir = str(raw.STORAGE_LOCAL_DIR) || './data/uploads';

  const jwtSecret = str(raw.JWT_SECRET);
  if (jwtSecret.length < 32) {
    errors.push(
      'JWT_SECRET must be set to at least 32 random characters (see apps/api/.env.example)',
    );
  }

  const refreshHours = intIn(raw.REFRESH_TOKEN_TTL_HOURS, 12, 1, 24 * 30);
  if (refreshHours === undefined)
    errors.push('REFRESH_TOKEN_TTL_HOURS must be an integer from 1 to 720');

  const bcryptRounds = intIn(raw.BCRYPT_ROUNDS, 12, 4, 15);
  if (bcryptRounds === undefined) errors.push('BCRYPT_ROUNDS must be an integer from 4 to 15');

  const cookieSecureRaw = (str(raw.COOKIE_SECURE) || 'false').toLowerCase();
  if (!['true', 'false'].includes(cookieSecureRaw))
    errors.push('COOKIE_SECURE must be true or false');

  if (errors.length > 0) {
    throw new Error(`Invalid API configuration:\n  - ${errors.join('\n  - ')}`);
  }

  return {
    PORT: port,
    DATABASE_URL: databaseUrl,
    CORS_ORIGINS: corsOrigins,
    STORAGE_DRIVER: storageDriver as StorageDriver,
    STORAGE_LOCAL_DIR: storageLocalDir,
    JWT_SECRET: jwtSecret,
    REFRESH_TOKEN_TTL_HOURS: refreshHours ?? 12,
    COOKIE_SECURE: cookieSecureRaw === 'true',
    BCRYPT_ROUNDS: bcryptRounds ?? 12,
  };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Parses an optional integer setting; undefined = invalid. */
function intIn(v: unknown, fallback: number, min: number, max: number): number | undefined {
  const s = str(v);
  if (!s) return fallback;
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number.parseInt(s, 10);
  return n >= min && n <= max ? n : undefined;
}
