import { validateEnv } from './env';

const DB = 'postgresql://u:p@localhost:5432/db';
const SECRET = 'x'.repeat(32);
const BASE = { DATABASE_URL: DB, JWT_SECRET: SECRET };

describe('validateEnv', () => {
  it('applies defaults and parses values', () => {
    expect(validateEnv(BASE)).toEqual({
      PORT: 3000,
      DATABASE_URL: DB,
      CORS_ORIGINS: ['http://localhost:5173'],
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_DIR: './data/uploads',
      JWT_SECRET: SECRET,
      REFRESH_TOKEN_TTL_HOURS: 12,
      COOKIE_SECURE: false,
      BCRYPT_ROUNDS: 12,
      DEMO_MODE: false,
      APP_URL: 'http://localhost:5173',
      MAIL_DRIVER: 'outbox',
      MAIL_OUTBOX_DIR: './data/outbox',
      MAIL_FROM: 'Finance Close <no-reply@financeclose.local>',
      SMTP_HOST: '',
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      SMTP_USER: '',
      SMTP_PASSWORD: '',
    });
    expect(() => validateEnv({ ...BASE, MAIL_DRIVER: 'smtp' })).toThrow(/SMTP_HOST must be set/);
    expect(
      validateEnv({
        ...BASE,
        PORT: '4000',
        CORS_ORIGINS: 'http://a, http://b',
        STORAGE_LOCAL_DIR: '/srv/uploads',
      }),
    ).toMatchObject({
      PORT: 4000,
      CORS_ORIGINS: ['http://a', 'http://b'],
      STORAGE_LOCAL_DIR: '/srv/uploads',
    });
  });

  it('fails fast on a missing DATABASE_URL, bad PORT or unknown STORAGE_DRIVER', () => {
    expect(() => validateEnv({ JWT_SECRET: SECRET })).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ DATABASE_URL: DB, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => validateEnv({ ...BASE, BCRYPT_ROUNDS: '3' })).toThrow(/BCRYPT_ROUNDS/);
    expect(() => validateEnv({ ...BASE, DEMO_MODE: 'yes' })).toThrow(/DEMO_MODE/);
    expect(validateEnv({ ...BASE, DEMO_MODE: 'TRUE' }).DEMO_MODE).toBe(true);
    expect(() => validateEnv({ ...BASE, PORT: '3000abc' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...BASE, STORAGE_DRIVER: 'minio' })).toThrow(/STORAGE_DRIVER/);
  });
});
