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

  if (errors.length > 0) {
    throw new Error(`Invalid API configuration:\n  - ${errors.join('\n  - ')}`);
  }

  return {
    PORT: port,
    DATABASE_URL: databaseUrl,
    CORS_ORIGINS: corsOrigins,
    STORAGE_DRIVER: storageDriver as StorageDriver,
    STORAGE_LOCAL_DIR: storageLocalDir,
  };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
