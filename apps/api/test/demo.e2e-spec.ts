import type { DemoAccountDto, SessionResponse } from '@finance-close/shared';
import { DEMO_USERS } from '../prisma/seed-demo';
import { createTestApp, login, MASTER, type TestContext } from './helpers';

describe('demo mode ON (DEMO_MODE=true)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    process.env.DEMO_MODE = 'true';
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx?.app.close();
  });

  it('lists the master and the three demo accounts with their roles', async () => {
    const res = await ctx.http().get('/api/auth/demo-accounts');
    expect(res.status).toBe(200);
    const accounts = res.body as DemoAccountDto[];
    expect(accounts.map((a) => [a.email, a.role])).toEqual([
      [MASTER.email, 'Master admin'],
      ['priya@financeclose.local', 'Preparer'],
      ['rahul@financeclose.local', 'Reviewer'],
      ['viewer@financeclose.local', 'Viewer'],
    ]);
  });

  it.each(DEMO_USERS.map((d) => [d.email, d.password, d.templateCode] as const))(
    'demo user %s signs in with one click and with the known password, without a forced password change',
    async (email, password, templateCode) => {
      const quick = await ctx.http().post('/api/auth/demo-login').send({ email });
      expect(quick.status).toBe(200);
      expect(String(quick.headers['set-cookie'])).toMatch(/fc_refresh=.*HttpOnly/i);
      const session = quick.body as SessionResponse;
      expect(session.user).toMatchObject({ email, mustChangePassword: false, isMaster: false });

      const expected = {
        PREPARER: ['CFS_PREPARE', 'REPORTS_VIEW', 'SFS_PREPARE'],
        REVIEWER: ['CFS_REVIEW', 'REPORTS_VIEW', 'SFS_REVIEW'],
        VIEWER: ['REPORTS_VIEW'],
      }[templateCode];
      expect(session.user.permissions).toEqual(expected);

      // The session works for real requests (a viewer can read configuration).
      const me = await ctx
        .http()
        .get('/api/config/entities')
        .set('Authorization', `Bearer ${session.accessToken}`);
      expect(me.status).toBe(200);

      const withPassword = await login(ctx, email, password);
      expect(withPassword.status).toBe(200);
      expect((withPassword.body as SessionResponse).user.mustChangePassword).toBe(false);

      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: {
          action: 'LOGIN_SUCCESS',
          userId: session.user.id,
          newValue: { equals: { method: 'DEMO_QUICK_LOGIN' } },
        },
      });
      expect(audit).toBeTruthy();
    },
  );

  it('the master can use one-click sign-in too', async () => {
    const res = await ctx.http().post('/api/auth/demo-login').send({ email: MASTER.email });
    expect(res.status).toBe(200);
    expect((res.body as SessionResponse).user.isMaster).toBe(true);
  });

  it('refuses one-click sign-in for ordinary (non-demo) users', async () => {
    const masterLogin = await login(ctx, MASTER.email, MASTER.password);
    const token = (masterLogin.body as SessionResponse).accessToken;
    const email = `normal.${Date.now()}@test.local`;
    await ctx.http().post('/api/users').set('Authorization', `Bearer ${token}`).send({
      name: 'Normal',
      email,
      temporaryPassword: 'Temporary123',
      templateCode: null,
      permissions: [],
      entityScope: null,
    });
    const res = await ctx.http().post('/api/auth/demo-login').send({ email });
    expect(res.status).toBe(404);
    expect(
      (await ctx.http().post('/api/auth/demo-login').send({ email: 'nobody@test.local' })).status,
    ).toBe(404);
  });
});
