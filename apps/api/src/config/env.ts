/** Storage back-ends. Only "local" exists today; "s3" is added for AWS. */
export const STORAGE_DRIVERS = ['local'] as const;
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];

/** Email back-ends: "outbox" writes each email to a local folder (no mail server needed);
 * "smtp" sends through an SMTP server (e.g. Office 365, Gmail, AWS SES SMTP). */
export const MAIL_DRIVERS = ['outbox', 'smtp'] as const;
export type MailDriver = (typeof MAIL_DRIVERS)[number];

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
  /** Demo accounts + one-click sign-in. Off unless explicitly "true"; never in production. */
  DEMO_MODE: boolean;
  /** The web app's address, used in links sent by email. */
  APP_URL: string;
  MAIL_DRIVER: MailDriver;
  /** Folder for emails when MAIL_DRIVER=outbox (relative to the repo root). */
  MAIL_OUTBOX_DIR: string;
  MAIL_FROM: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  /** true = TLS from the start (port 465); false = STARTTLS when offered (587). */
  SMTP_SECURE: boolean;
  SMTP_USER: string;
  SMTP_PASSWORD: string;
  /** Zoho Books API client (Zoho API Console, "Server-based Applications"). Empty = not set up. */
  ZOHO_CLIENT_ID: string;
  ZOHO_CLIENT_SECRET: string;
  /** Where sign-in starts; Zoho sends the account's own data centre back with the code. */
  ZOHO_ACCOUNTS_URL: string;
  /** Registered redirect URI; default APP_URL + /api/integrations/zoho/callback. */
  ZOHO_REDIRECT_URI: string;
  ZOHO_SCOPE: string;
  /**
   * Optional refresh token generated in the Zoho API Console (Self Client). "Connect with
   * server token" stores it as the connection instead of the OAuth sign-in. Empty = not used.
   */
  ZOHO_REFRESH_TOKEN: string;
}

/** Zoho accounts servers (one per data centre). */
export const ZOHO_ACCOUNTS_SERVER =
  /^https:\/\/accounts\.zoho\.(com|in|eu|com\.au|jp|ca|sa|uk|com\.cn)$/;
export const ZOHO_DEFAULT_SCOPE =
  'ZohoBooks.reports.READ,ZohoBooks.settings.READ,ZohoBooks.accountants.READ';

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

  const demoModeRaw = (str(raw.DEMO_MODE) || 'false').toLowerCase();
  if (!['true', 'false'].includes(demoModeRaw)) errors.push('DEMO_MODE must be true or false');

  const appUrl = (str(raw.APP_URL) || 'http://localhost:5173').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(appUrl)) errors.push('APP_URL must start with http:// or https://');

  const mailDriver = str(raw.MAIL_DRIVER) || 'outbox';
  if (!(MAIL_DRIVERS as readonly string[]).includes(mailDriver))
    errors.push(`MAIL_DRIVER must be one of: ${MAIL_DRIVERS.join(', ')} (got "${mailDriver}")`);
  const smtpHost = str(raw.SMTP_HOST);
  if (mailDriver === 'smtp' && !smtpHost)
    errors.push('SMTP_HOST must be set when MAIL_DRIVER=smtp');
  const smtpPort = intIn(raw.SMTP_PORT, 587, 1, 65535);
  if (smtpPort === undefined) errors.push('SMTP_PORT must be an integer from 1 to 65535');
  const smtpSecureRaw = (str(raw.SMTP_SECURE) || 'false').toLowerCase();
  if (!['true', 'false'].includes(smtpSecureRaw)) errors.push('SMTP_SECURE must be true or false');

  const zohoAccountsUrl = (str(raw.ZOHO_ACCOUNTS_URL) || 'https://accounts.zoho.com').replace(
    /\/+$/,
    '',
  );
  if (!ZOHO_ACCOUNTS_SERVER.test(zohoAccountsUrl))
    errors.push('ZOHO_ACCOUNTS_URL must be a Zoho accounts server, e.g. https://accounts.zoho.in');
  const zohoRedirect = str(raw.ZOHO_REDIRECT_URI) || `${appUrl}/api/integrations/zoho/callback`;
  if (!/^https?:\/\//.test(zohoRedirect))
    errors.push('ZOHO_REDIRECT_URI must start with http:// or https://');

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
    DEMO_MODE: demoModeRaw === 'true',
    APP_URL: appUrl,
    MAIL_DRIVER: mailDriver as MailDriver,
    MAIL_OUTBOX_DIR: str(raw.MAIL_OUTBOX_DIR) || './data/outbox',
    MAIL_FROM: str(raw.MAIL_FROM) || 'Finance Close <no-reply@financeclose.local>',
    SMTP_HOST: smtpHost,
    SMTP_PORT: smtpPort ?? 587,
    SMTP_SECURE: smtpSecureRaw === 'true',
    SMTP_USER: str(raw.SMTP_USER),
    SMTP_PASSWORD: str(raw.SMTP_PASSWORD),
    ZOHO_CLIENT_ID: str(raw.ZOHO_CLIENT_ID),
    ZOHO_CLIENT_SECRET: str(raw.ZOHO_CLIENT_SECRET),
    ZOHO_ACCOUNTS_URL: zohoAccountsUrl,
    ZOHO_REDIRECT_URI: zohoRedirect,
    ZOHO_SCOPE: str(raw.ZOHO_SCOPE) || ZOHO_DEFAULT_SCOPE,
    ZOHO_REFRESH_TOKEN: str(raw.ZOHO_REFRESH_TOKEN),
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
