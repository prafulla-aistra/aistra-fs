import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

/**
 * Regression test for "Logging in shows Request failed (500 Internal Server Error)".
 *
 * Login must never answer with a bare 500 when a part of the system is not running. When
 * the database is down, the API answers 503 DATABASE_UNAVAILABLE with a readable message
 * (the web app shows it). The API-process-down case is covered by apps/web/dev-proxy.test.ts.
 */
describe('login when the database is not running', () => {
  let app: NestExpressApplication;
  const savedUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    // Port 1 on localhost: nothing listens there, so every connection is refused.
    process.env.DATABASE_URL = 'postgresql://finance:x@127.0.0.1:1/finance_close';
    Logger.overrideLogger(false);
    // Import after changing the environment so configuration picks up the unreachable URL.
    const { AppModule } = await import('../src/app.module');
    const { configureApp } = await import('../src/configure-app');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    process.env.DATABASE_URL = savedUrl;
  });

  it('answers 503 DATABASE_UNAVAILABLE with a clear message, not 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'master@test.local', password: 'MasterPass123' });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: expect.stringMatching(/can't reach its database/),
    });
  });

  it('reports the database as down on /api/health', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', db: 'error' });
  });
});
