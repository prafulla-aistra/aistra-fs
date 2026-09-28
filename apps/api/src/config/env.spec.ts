import { validateEnv } from './env';

const DB = 'postgresql://u:p@localhost:5432/db';

describe('validateEnv', () => {
  it('applies defaults and parses values', () => {
    expect(validateEnv({ DATABASE_URL: DB })).toEqual({
      PORT: 3000,
      DATABASE_URL: DB,
      CORS_ORIGINS: ['http://localhost:5173'],
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_DIR: './data/uploads',
    });
    expect(
      validateEnv({
        DATABASE_URL: DB,
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
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ DATABASE_URL: DB, PORT: '3000abc' })).toThrow(/PORT/);
    expect(() => validateEnv({ DATABASE_URL: DB, STORAGE_DRIVER: 'minio' })).toThrow(
      /STORAGE_DRIVER/,
    );
  });
});
