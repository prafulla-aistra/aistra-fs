import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { SessionResponse, UserDto } from '@finance-close/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { TEST_ENV } from './test-env';

export const MASTER = { email: TEST_ENV.MASTER_EMAIL, password: TEST_ENV.MASTER_PASSWORD };
export const TEMP_PASSWORD = 'Temporary123';

export interface TestContext {
  app: NestExpressApplication;
  prisma: PrismaService;
  http: () => ReturnType<typeof request>;
}

export async function createTestApp(): Promise<TestContext> {
  Logger.overrideLogger(['error']);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService), http: () => request(app.getHttpServer()) };
}

export async function login(ctx: TestContext, email: string, password: string) {
  return ctx.http().post('/api/auth/login').send({ email, password });
}

export async function tokenFor(ctx: TestContext, email: string, password: string): Promise<string> {
  const res = await login(ctx, email, password);
  if (res.status !== 200)
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return (res.body as SessionResponse).accessToken;
}

let counter = 0;
/** A unique email per call so tests never collide (users cannot be deleted). */
export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}.${Date.now()}.${counter}@test.local`;
}

/** Creates a user as the master via the API (Preparer template by default). */
export async function createUser(
  ctx: TestContext,
  masterToken: string,
  overrides: Partial<{
    email: string;
    name: string;
    permissions: string[];
    templateCode: string | null;
  }> = {},
): Promise<UserDto> {
  const res = await ctx
    .http()
    .post('/api/users')
    .set('Authorization', `Bearer ${masterToken}`)
    .send({
      name: overrides.name ?? 'Test user',
      email: overrides.email ?? uniqueEmail(),
      temporaryPassword: TEMP_PASSWORD,
      templateCode: overrides.templateCode === undefined ? 'PREPARER' : overrides.templateCode,
      permissions: overrides.permissions ?? ['SFS_PREPARE', 'CFS_PREPARE', 'REPORTS_VIEW'],
      entityScope: null,
    });
  if (res.status !== 201)
    throw new Error(`create user failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as UserDto;
}

/** Creates a user and completes the first-login password change; returns a usable token. */
export async function activeUserToken(
  ctx: TestContext,
  masterToken: string,
  overrides: Parameters<typeof createUser>[2] = {},
): Promise<{ user: UserDto; token: string; password: string }> {
  const user = await createUser(ctx, masterToken, overrides);
  const temp = await tokenFor(ctx, user.email, TEMP_PASSWORD);
  const password = 'NewPassword456';
  const res = await ctx
    .http()
    .post('/api/auth/change-password')
    .set('Authorization', `Bearer ${temp}`)
    .send({ currentPassword: TEMP_PASSWORD, newPassword: password });
  if (res.status !== 200) throw new Error(`change password failed: ${JSON.stringify(res.body)}`);
  return { user, token: (res.body as SessionResponse).accessToken, password };
}

/**
 * Deletes tasks created by tests (never demo tasks), so the persistent test database starts
 * each run with only the seeded demo tasks. Refuses to run outside a *_test database.
 */
export async function deleteNonDemoTasks(ctx: TestContext): Promise<void> {
  const rows = await ctx.prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!rows[0]?.db.endsWith('_test')) throw new Error('deleteNonDemoTasks: not a test database');
  await ctx.prisma.task.deleteMany({ where: { isDemo: false } });
}
