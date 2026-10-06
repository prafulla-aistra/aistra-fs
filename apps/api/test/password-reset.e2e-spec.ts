import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PasswordResetLinkResponse } from '@finance-close/shared';
import { resolveFromRepoRoot } from '../src/config/paths';
import { activeUserToken, createTestApp, MASTER, type TestContext, tokenFor } from './helpers';
import { TEST_ENV } from './test-env';

/** User menu → Change password: a one-time link emailed to the user (local outbox in tests). */
let ctx: TestContext;
let master: string;
const outbox = resolveFromRepoRoot(TEST_ENV.MAIL_OUTBOX_DIR);

beforeAll(async () => {
  ctx = await createTestApp();
  master = await tokenFor(ctx, MASTER.email, MASTER.password);
});
afterAll(async () => {
  await ctx?.app.close();
});

/** The link in the newest outbox email to this address. */
async function linkFor(email: string): Promise<string> {
  const files = (await readdir(outbox)).filter((f) => f.endsWith(`${email}.txt`)).sort();
  const text = await readFile(path.join(outbox, files.at(-1)!), 'utf8');
  expect(text).toContain(`To: ${email}`);
  return /\/reset-password\?token=(\S+)/.exec(text)![1]!;
}

describe('password reset by emailed link', () => {
  it('sends a link to the signed-in user, which sets a new password once', async () => {
    const { user, token, password } = await activeUserToken(ctx, master);
    const res = await ctx
      .http()
      .post('/api/auth/password-reset/request')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body as PasswordResetLinkResponse).toEqual({
      sentTo: user.email,
      delivery: 'OUTBOX',
      expiresInMinutes: 60,
    });
    const link = decodeURIComponent(await linkFor(user.email));

    const weak = await ctx
      .http()
      .post('/api/auth/password-reset/confirm')
      .send({ token: link, newPassword: 'short' });
    expect(weak.status).toBe(400);
    const ok = await ctx
      .http()
      .post('/api/auth/password-reset/confirm')
      .send({ token: link, newPassword: 'ResetPassword789' });
    expect(ok.status).toBe(204);

    // Sessions end; the old password no longer works, the new one does; the link is single-use.
    expect(
      (await ctx.http().get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status,
    ).toBe(401);
    expect(
      (await ctx.http().post('/api/auth/login').send({ email: user.email, password })).status,
    ).toBe(401);
    await tokenFor(ctx, user.email, 'ResetPassword789');
    const again = await ctx
      .http()
      .post('/api/auth/password-reset/confirm')
      .send({ token: link, newPassword: 'AnotherPass123' });
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/invalid or has expired/);
    expect(
      await ctx.prisma.auditLog.count({
        where: {
          entityId: user.id,
          action: { in: ['PASSWORD_RESET_LINK_SENT', 'PASSWORD_RESET_BY_LINK'] },
        },
      }),
    ).toBe(2);
  });

  it('a newer link replaces the older one; unknown tokens and anonymous requests fail', async () => {
    const { user, token } = await activeUserToken(ctx, master);
    const send = () =>
      ctx.http().post('/api/auth/password-reset/request').set('Authorization', `Bearer ${token}`);
    expect((await send()).status).toBe(200);
    const first = decodeURIComponent(await linkFor(user.email));
    await new Promise((r) => setTimeout(r, 5));
    expect((await send()).status).toBe(200);
    expect(
      (
        await ctx
          .http()
          .post('/api/auth/password-reset/confirm')
          .send({ token: first, newPassword: 'ResetPassword789' })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx
          .http()
          .post('/api/auth/password-reset/confirm')
          .send({ token: 'x'.repeat(43), newPassword: 'ResetPassword789' })
      ).status,
    ).toBe(400);
    expect((await ctx.http().post('/api/auth/password-reset/request')).status).toBe(401);
  });
});
