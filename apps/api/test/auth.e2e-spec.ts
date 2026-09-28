import type { SessionResponse, UserDto } from '@finance-close/shared';
import {
  activeUserToken,
  createTestApp,
  createUser,
  login,
  MASTER,
  TEMP_PASSWORD,
  type TestContext,
  tokenFor,
  uniqueEmail,
} from './helpers';

let ctx: TestContext;
let masterToken: string;
let masterId: string;

beforeAll(async () => {
  ctx = await createTestApp();
  // Safety net: never run these tests against the development database.
  const rows = await ctx.prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  expect(rows[0]?.db).toMatch(/_test$/);
  masterToken = await tokenFor(ctx, MASTER.email, MASTER.password);
  masterId = (await ctx.prisma.user.findFirstOrThrow({ where: { isMaster: true } })).id;
});

afterAll(async () => {
  await ctx?.app.close();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function auditActions(userId: string): Promise<string[]> {
  const rows = await ctx.prisma.auditLog.findMany({
    where: { OR: [{ userId }, { entityType: 'USER', entityId: userId }] },
    orderBy: { id: 'asc' },
  });
  return rows.map((r) => r.action);
}

describe('login', () => {
  it('succeeds with the right password: access token, httpOnly refresh cookie, audit entry', async () => {
    const res = await login(ctx, MASTER.email.toUpperCase(), MASTER.password); // email is case-insensitive
    expect(res.status).toBe(200);
    const body = res.body as SessionResponse;
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.expiresIn).toBe(900); // 15 minutes
    expect(body.user).toMatchObject({
      email: MASTER.email,
      isMaster: true,
      mustChangePassword: false,
    });
    expect(body.user.permissions).toHaveLength(8);

    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/fc_refresh=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);

    const me = await ctx.http().get('/api/auth/me').set(auth(body.accessToken));
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: MASTER.email });
    expect(await auditActions(masterId)).toContain('LOGIN_SUCCESS');
  });

  it('fails with a wrong password or unknown email, with a clear message and an audit entry', async () => {
    const wrong = await login(ctx, MASTER.email, 'not-the-password1');
    expect(wrong.status).toBe(401);
    expect(wrong.body).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: expect.stringMatching(/incorrect/),
    });

    const unknown = await login(ctx, 'nobody@test.local', 'whatever12345');
    expect(unknown.status).toBe(401);
    expect(unknown.body.code).toBe('INVALID_CREDENTIALS');

    const failure = await ctx.prisma.auditLog.findFirst({
      where: { action: 'LOGIN_FAILURE', userId: null },
      orderBy: { id: 'desc' },
    });
    expect(failure?.newValue).toMatchObject({
      email: 'nobody@test.local',
      reason: 'UNKNOWN_EMAIL',
    });

    // A successful login resets the failure counter.
    await tokenFor(ctx, MASTER.email, MASTER.password);
    expect(
      (await ctx.prisma.user.findUniqueOrThrow({ where: { id: masterId } })).failedLoginCount,
    ).toBe(0);
  });

  it('rejects requests without a valid token', async () => {
    expect((await ctx.http().get('/api/auth/me')).status).toBe(401);
    const bad = await ctx.http().get('/api/auth/me').set(auth('not-a-jwt'));
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('NOT_AUTHENTICATED');
  });
});

describe('lockout', () => {
  it('locks the account for 15 minutes after 5 failed attempts, even for the right password', async () => {
    const { user, password } = await activeUserToken(ctx, masterToken);

    for (let i = 1; i <= 4; i++) {
      expect((await login(ctx, user.email, 'WrongPassword1')).status).toBe(401);
    }
    const fifth = await login(ctx, user.email, 'WrongPassword1');
    expect(fifth.status).toBe(423);
    expect(fifth.body).toMatchObject({
      code: 'ACCOUNT_LOCKED',
      message: expect.stringMatching(/locked/),
    });

    const lockedUntil = new Date(fifth.body.lockedUntil as string).getTime();
    expect(lockedUntil - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(lockedUntil - Date.now()).toBeLessThanOrEqual(15 * 60_000);

    const right = await login(ctx, user.email, password);
    expect(right.status).toBe(423);

    expect(await auditActions(user.id)).toEqual(
      expect.arrayContaining(['LOGIN_FAILURE', 'ACCOUNT_LOCKED']),
    );

    // Once the 15 minutes have passed, the right password works again.
    await ctx.prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    expect((await login(ctx, user.email, password)).status).toBe(200);
  });

  it('an admin password reset unlocks the account', async () => {
    const { user } = await activeUserToken(ctx, masterToken);
    for (let i = 0; i < 5; i++) await login(ctx, user.email, 'WrongPassword1');
    expect((await login(ctx, user.email, TEMP_PASSWORD)).status).toBe(423);

    const reset = await ctx
      .http()
      .post(`/api/users/${user.id}/reset-password`)
      .set(auth(masterToken))
      .send({ temporaryPassword: 'ResetTemp789' });
    expect(reset.status).toBe(200);
    const again = await login(ctx, user.email, 'ResetTemp789');
    expect(again.status).toBe(200);
    expect((again.body as SessionResponse).user.mustChangePassword).toBe(true);
  });
});

describe('permission guard', () => {
  it('blocks an endpoint when the user lacks the permission, with a clear 403', async () => {
    const { token } = await activeUserToken(ctx, masterToken); // Preparer: no USER_ADMIN
    const res = await ctx.http().get('/api/users').set(auth(token));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      code: 'PERMISSION_DENIED',
      requiredPermission: 'USER_ADMIN',
      message: expect.stringMatching(/USER_ADMIN/),
    });
    expect((await ctx.http().get('/api/audit-logs').set(auth(token))).status).toBe(403);
  });

  it('allows it once the permission is granted, and immediately after it is removed blocks again', async () => {
    const { user, token } = await activeUserToken(ctx, masterToken);
    const grant = await ctx
      .http()
      .patch(`/api/users/${user.id}`)
      .set(auth(masterToken))
      .send({ permissions: ['USER_ADMIN', 'REPORTS_VIEW'] });
    expect(grant.status).toBe(200);
    expect((grant.body as UserDto).templateLabel).toBe('Preparer (adjusted)');
    expect((await ctx.http().get('/api/users').set(auth(token))).status).toBe(200);

    await ctx
      .http()
      .patch(`/api/users/${user.id}`)
      .set(auth(masterToken))
      .send({ permissions: ['REPORTS_VIEW'] });
    // Same token, no re-login: permissions are read on every request.
    expect((await ctx.http().get('/api/users').set(auth(token))).status).toBe(403);
    expect(await auditActions(user.id)).toContain('PERMISSION_CHANGE');
  });
});

describe('master admin', () => {
  it('cannot be deactivated (API rule and database trigger)', async () => {
    const res = await ctx.http().post(`/api/users/${masterId}/deactivate`).set(auth(masterToken));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      code: 'NOT_ALLOWED',
      message: 'The master admin cannot be deactivated.',
    });

    await expect(
      ctx.prisma.user.update({ where: { id: masterId }, data: { status: 'INACTIVE' } }),
    ).rejects.toThrow(/master admin cannot be deactivated/);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: masterId } })).status).toBe(
      'ACTIVE',
    );
  });

  it('cannot have its permissions changed, and another admin cannot edit it', async () => {
    const change = await ctx
      .http()
      .patch(`/api/users/${masterId}`)
      .set(auth(masterToken))
      .send({ permissions: ['REPORTS_VIEW'] });
    expect(change.status).toBe(403);

    const { token: adminToken } = await activeUserToken(ctx, masterToken, {
      permissions: ['USER_ADMIN'],
      templateCode: null,
    });
    const edit = await ctx
      .http()
      .patch(`/api/users/${masterId}`)
      .set(auth(adminToken))
      .send({ name: 'Hacked' });
    expect(edit.status).toBe(403);
    expect(
      (await ctx.http().post(`/api/users/${masterId}/deactivate`).set(auth(adminToken))).status,
    ).toBe(403);
  });

  it('users are never hard-deleted and the audit log is append-only (database triggers)', async () => {
    const user = await createUser(ctx, masterToken);
    await expect(ctx.prisma.user.delete({ where: { id: user.id } })).rejects.toThrow(
      /cannot be deleted/,
    );
    const row = await ctx.prisma.auditLog.findFirstOrThrow();
    await expect(ctx.prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(
      /append-only/,
    );
    await expect(
      ctx.prisma.auditLog.update({ where: { id: row.id }, data: { action: 'X' } }),
    ).rejects.toThrow(/append-only/);
  });
});

describe('first-login password change', () => {
  it('is enforced before anything else, then the new password works', async () => {
    const user = await createUser(ctx, masterToken, {
      permissions: ['USER_ADMIN', 'REPORTS_VIEW'],
      templateCode: null,
    });
    const first = await login(ctx, user.email, TEMP_PASSWORD);
    expect(first.status).toBe(200);
    const temp = first.body as SessionResponse;
    expect(temp.user.mustChangePassword).toBe(true);

    // Even an endpoint the user has permission for is blocked until the password changes.
    const blocked = await ctx.http().get('/api/users').set(auth(temp.accessToken));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await ctx.http().get('/api/auth/me').set(auth(temp.accessToken))).status).toBe(200);

    // Password rules: 10+ characters with a letter and a number.
    for (const weak of ['short1', 'onlyletterspassword', '1234567890123']) {
      const res = await ctx
        .http()
        .post('/api/auth/change-password')
        .set(auth(temp.accessToken))
        .send({ currentPassword: TEMP_PASSWORD, newPassword: weak });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
    const same = await ctx
      .http()
      .post('/api/auth/change-password')
      .set(auth(temp.accessToken))
      .send({ currentPassword: TEMP_PASSWORD, newPassword: TEMP_PASSWORD });
    expect(same.status).toBe(400);

    const changed = await ctx
      .http()
      .post('/api/auth/change-password')
      .set(auth(temp.accessToken))
      .send({ currentPassword: TEMP_PASSWORD, newPassword: 'MyOwnPassword1' });
    expect(changed.status).toBe(200);
    const fresh = changed.body as SessionResponse;
    expect(fresh.user.mustChangePassword).toBe(false);

    expect((await ctx.http().get('/api/users').set(auth(fresh.accessToken))).status).toBe(200);
    // The temporary-password session is over.
    expect((await ctx.http().get('/api/auth/me').set(auth(temp.accessToken))).status).toBe(401);
    expect((await login(ctx, user.email, TEMP_PASSWORD)).status).toBe(401);
    expect((await login(ctx, user.email, 'MyOwnPassword1')).status).toBe(200);
    expect(await auditActions(user.id)).toContain('PASSWORD_CHANGE');
  });
});

describe('sessions', () => {
  it('refresh rotates the cookie; logout ends the session', async () => {
    const res = await login(ctx, MASTER.email, MASTER.password);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;

    const refreshed = await ctx.http().post('/api/auth/refresh').set('Cookie', cookie);
    expect(refreshed.status).toBe(200);
    const newCookie = (refreshed.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    expect(newCookie).not.toBe(cookie);

    expect((await ctx.http().post('/api/auth/logout').set('Cookie', newCookie)).status).toBe(204);
    expect((await ctx.http().post('/api/auth/refresh').set('Cookie', newCookie)).status).toBe(401);
    expect((await ctx.http().post('/api/auth/refresh')).status).toBe(401);
  });

  it('deactivating a user blocks their existing token and login at once', async () => {
    const { user, token, password } = await activeUserToken(ctx, masterToken);
    const res = await ctx.http().post(`/api/users/${user.id}/deactivate`).set(auth(masterToken));
    expect(res.status).toBe(200);
    expect((res.body as UserDto).status).toBe('INACTIVE');

    expect((await ctx.http().get('/api/auth/me').set(auth(token))).status).toBe(401);
    const again = await login(ctx, user.email, password);
    expect(again.status).toBe(401);
    expect(again.body.code).toBe('ACCOUNT_INACTIVE');

    await ctx.http().post(`/api/users/${user.id}/reactivate`).set(auth(masterToken));
    expect((await login(ctx, user.email, password)).status).toBe(200);
    expect(await auditActions(user.id)).toEqual(
      expect.arrayContaining(['USER_DEACTIVATE', 'USER_REACTIVATE']),
    );
  });
});

describe('user management rules', () => {
  it('rejects duplicate emails (case-insensitive) and weak temporary passwords', async () => {
    const email = uniqueEmail('dup');
    await createUser(ctx, masterToken, { email });
    const dup = await ctx.http().post('/api/users').set(auth(masterToken)).send({
      name: 'X',
      email: email.toUpperCase(),
      temporaryPassword: TEMP_PASSWORD,
      templateCode: null,
      permissions: [],
      entityScope: null,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe('A user with this email already exists.');

    const weak = await ctx.http().post('/api/users').set(auth(masterToken)).send({
      name: 'X',
      email: uniqueEmail(),
      temporaryPassword: 'abc',
      templateCode: null,
      permissions: [],
      entityScope: null,
    });
    expect(weak.status).toBe(400);
  });

  it('stores an entity scope and audits create/edit with old and new values', async () => {
    const user = await createUser(ctx, masterToken);
    const res = await ctx
      .http()
      .patch(`/api/users/${user.id}`)
      .set(auth(masterToken))
      .send({ name: 'Renamed user', entityScope: ['IN', 'UK'] });
    expect(res.status).toBe(200);
    expect((res.body as UserDto).entityScope).toEqual(['IN', 'UK']);

    const update = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'USER_UPDATE', entityId: user.id },
    });
    expect(update.userId).toBe(masterId);
    expect(update.oldValue).toMatchObject({ name: 'Test user', entityScope: null });
    expect(update.newValue).toMatchObject({ name: 'Renamed user', entityScope: ['IN', 'UK'] });

    const bad = await ctx
      .http()
      .patch(`/api/users/${user.id}`)
      .set(auth(masterToken))
      .send({ entityScope: ['XX'] });
    expect(bad.status).toBe(400);
  });

  it('audit trail can be filtered by user and action', async () => {
    const user = await createUser(ctx, masterToken);
    await login(ctx, user.email, TEMP_PASSWORD);
    const res = await ctx
      .http()
      .get('/api/audit-logs')
      .query({ userId: user.id })
      .set(auth(masterToken));
    expect(res.status).toBe(200);
    const actions = (res.body.items as { action: string }[]).map((i) => i.action);
    expect(actions).toEqual(expect.arrayContaining(['USER_CREATE', 'LOGIN_SUCCESS']));

    const onlyCreates = await ctx
      .http()
      .get('/api/audit-logs')
      .query({ userId: user.id, action: 'USER_CREATE' })
      .set(auth(masterToken));
    expect(onlyCreates.body.total).toBe(1);
  });
});
