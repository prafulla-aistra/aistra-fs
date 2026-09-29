import type { TestContext } from './helpers';

/**
 * DEMO_MODE=false, as in production. Demo mode is decided once when the API process starts,
 * so this file sets it before loading any application code (a separate Jest module registry).
 */
describe('demo mode OFF (DEMO_MODE=false)', () => {
  let ctx: TestContext;
  let helpers: typeof import('./helpers');

  beforeAll(async () => {
    process.env.DEMO_MODE = 'false';
    helpers = await import('./helpers');
    ctx = await helpers.createTestApp();
  });
  afterAll(async () => {
    await ctx?.app.close();
  });

  it('the demo endpoints do not exist (404), even for real demo accounts', async () => {
    const list = await ctx.http().get('/api/auth/demo-accounts');
    expect(list.status).toBe(404);
    const quick = await ctx
      .http()
      .post('/api/auth/demo-login')
      .send({ email: 'priya@financeclose.local' });
    expect(quick.status).toBe(404);
    expect(quick.body.message).toMatch(/Cannot POST \/api\/auth\/demo-login/);
    expect(quick.headers['set-cookie']).toBeUndefined();
  });

  it('normal sign-in still works', async () => {
    const res = await helpers.login(ctx, helpers.MASTER.email, helpers.MASTER.password);
    expect(res.status).toBe(200);
  });
});
