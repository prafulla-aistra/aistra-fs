import type {
  DashboardDto,
  SessionResponse,
  TaskDetailDto,
  TaskListPage,
} from '@finance-close/shared';
import { DEMO_USERS } from '../prisma/seed-demo';
import {
  activeUserToken,
  deleteNonDemoTasks,
  createTestApp,
  login,
  MASTER,
  type TestContext,
  tokenFor,
} from './helpers';

/**
 * Dashboard counts against the demo data, with today fixed at 29-Sep-2026 (FIXED_TODAY):
 *   Jul-2026 SFS: all 7 Finalised (Done)   Jul-2026 CFS: all 4 levels Finalised (Done)
 *   Aug-2026 SFS: US, UK, UC Finalised; IN, AE In progress; VS, VM Not started
 * (India was seeded In review until page 8; a review now needs a real submission.)
 */
let ctx: TestContext;
let priya: string;
let rahul: string;
let master: string;
let india: string; // Preparer permissions, scoped to IN only

const password = (email: string) => DEMO_USERS.find((d) => d.email === email)!.password;

beforeAll(async () => {
  process.env.DEMO_MODE = 'true';
  ctx = await createTestApp();
  await deleteNonDemoTasks(ctx); // counts below assume only the demo tasks
  priya = await tokenFor(ctx, 'priya@financeclose.local', password('priya@financeclose.local'));
  rahul = await tokenFor(ctx, 'rahul@financeclose.local', password('rahul@financeclose.local'));
  master = await tokenFor(ctx, MASTER.email, MASTER.password);
  india = (await activeUserToken(ctx, master, { name: 'India only' })).token;
  const indiaUser = await ctx.http().get('/api/auth/me').set('Authorization', `Bearer ${india}`);
  await ctx
    .http()
    .patch(`/api/users/${(indiaUser.body as { id: string }).id}`)
    .set('Authorization', `Bearer ${master}`)
    .send({ entityScope: ['IN'] });
});
afterAll(async () => {
  await ctx?.app.close();
});

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const dashboard = async (token: string, period?: string) =>
  (
    await ctx
      .http()
      .get('/api/dashboard')
      .query(period ? { period } : {})
      .set(as(token))
  ).body as DashboardDto;
const tasks = async (token: string, query: Record<string, string> = {}) =>
  (await ctx.http().get('/api/tasks').query(query).set(as(token))).body as TaskListPage;

describe('dashboard for Priya (Preparer, all entities)', () => {
  it('defaults to Aug-2026 with its due dates and an overdue SFS deadline', async () => {
    const d = await dashboard(priya);
    expect(d.today).toBe('2026-09-29');
    expect(d.period).toMatchObject({
      label: 'Aug-2026',
      fyLabel: 'FY 2026-27',
      sfsDueDate: '2026-09-09',
      cfsDueDate: '2026-09-16',
      deadline: { kind: 'SFS', status: 'OVERDUE', overdueDays: 20, dueDate: '2026-09-09' },
    });
  });

  it('counts standalone 3 of 7, consolidation 0 of 4 (next: Level 1 Veracity Services), last period Jul-2026 Done', async () => {
    const d = await dashboard(priya);
    expect(d.standalone).toEqual({
      finalised: 3,
      total: 7,
      counts: { NOT_STARTED: 2, IN_PROGRESS: 2, IN_REVIEW: 0, FINALISED: 3 },
    });
    expect(d.consolidation).toMatchObject({
      finalised: 0,
      total: 4,
      next: { level: 1, name: 'Veracity Services' },
    });
    expect(d.lastPeriod).toMatchObject({ label: 'Jul-2026', done: true, openItems: 0 });
  });

  it('shows the lines that apply to a preparer: 4 entities to prepare (IN, AE, VS, VM) and overdue', async () => {
    const d = await dashboard(priya);
    expect(d.attention).toEqual({ entitiesToPrepare: 4, openQueries: 0, overdue: 1 });
  });

  it('lists the 3 demo tasks newest first, with derived statuses, overdue and lock', async () => {
    const page = await tasks(priya);
    expect(page.total).toBe(3);
    expect(page.items.map((t) => [t.number, t.status, t.overdue, t.locked, t.action])).toEqual([
      // Work remains (IN, AE in progress; VS, VM not started) → In progress.
      ['SFS-2026-08-001', 'IN_PROGRESS', true, false, 'CONTINUE'],
      ['CFS-2026-07-001', 'DONE', false, true, 'VIEW'],
      ['SFS-2026-07-001', 'DONE', false, true, 'VIEW'],
    ]);
    const aug = page.items[0]!;
    expect(aug.items.map((i) => `${i.code}:${i.status}`)).toEqual([
      'US:FINALISED',
      'IN:IN_PROGRESS',
      'AE:IN_PROGRESS',
      'UK:FINALISED',
      'UC:FINALISED',
      'VS:NOT_STARTED',
      'VM:NOT_STARTED',
    ]);
    expect(page.items[1]!.items.map((i) => i.code)).toEqual(['L1', 'L2', 'L3', 'L4']);
  });

  it('filters the table like the cards do', async () => {
    const d = await dashboard(priya);
    expect((await tasks(priya, { periodId: d.period!.id })).total).toBe(1);
    expect((await tasks(priya, { periodId: d.period!.id, type: 'CFS' })).total).toBe(0);
    expect((await tasks(priya, { periodId: d.lastPeriod!.id })).total).toBe(2);
    expect((await tasks(priya, { status: 'OVERDUE' })).items.map((t) => t.number)).toEqual([
      'SFS-2026-08-001',
    ]);
    expect((await tasks(priya, { status: 'DONE' })).total).toBe(2);
    expect((await tasks(priya, { status: 'TO_PREPARE' })).items.map((t) => t.number)).toEqual([
      'SFS-2026-08-001',
    ]);
    expect((await tasks(priya, { status: 'IN_PROGRESS' })).total).toBe(1);
    expect((await tasks(priya, { status: 'IN_REVIEW' })).total).toBe(0);
    expect((await tasks(priya, { search: 'consolidated' })).items.map((t) => t.number)).toEqual([
      'CFS-2026-07-001',
    ]);
    expect((await tasks(priya, { periodType: 'QUARTERLY' })).total).toBe(0);
  });

  it('the period switcher changes every card (Jul-2026 is fully closed; Jun-2026 has nothing)', async () => {
    const aug = await dashboard(priya);
    const julId = aug.periods.find((p) => p.label === 'Jul-2026')!.id;
    const jul = await dashboard(priya, julId);
    expect(jul.standalone.finalised).toBe(7);
    expect(jul.consolidation).toMatchObject({ finalised: 4, total: 4, next: null });
    expect(jul.period!.deadline).toEqual({ kind: 'COMPLETE' });
    expect(jul.lastPeriod).toMatchObject({ label: 'Jun-2026', done: false, openItems: 11 });
    expect(jul.attention).toEqual({ entitiesToPrepare: 0, openQueries: 0, overdue: 1 });
  });

  it('opens a Done task read-only', async () => {
    const done = (await tasks(priya, { status: 'DONE' })).items[0]!;
    const detail = (await ctx.http().get(`/api/tasks/${done.id}`).set(as(priya)))
      .body as TaskDetailDto;
    expect(detail).toMatchObject({ readOnly: true, locked: true, currentStep: 'FINALISED' });
  });
});

describe('dashboard for a user scoped to India only', () => {
  it('counts only India: standalone 0 of 1 (in progress), levels containing India (L3, L4)', async () => {
    const d = await dashboard(india);
    expect(d.standalone).toEqual({
      finalised: 0,
      total: 1,
      counts: { NOT_STARTED: 0, IN_PROGRESS: 1, IN_REVIEW: 0, FINALISED: 0 },
    });
    expect(d.consolidation).toMatchObject({
      finalised: 0,
      total: 2,
      next: { level: 3, name: 'India' },
    });
    expect(d.lastPeriod).toMatchObject({ label: 'Jul-2026', done: true });
    // India is in progress: one entity for this user to prepare.
    expect(d.attention).toEqual({ entitiesToPrepare: 1, openQueries: 0, overdue: 1 });
  });

  it('sees only India in the entity breakdown, but the task status covers the whole task', async () => {
    const page = await tasks(india);
    expect(page.total).toBe(3);
    const aug = page.items.find((t) => t.number === 'SFS-2026-08-001')!;
    expect(aug.items).toEqual([{ code: 'IN', label: 'India', status: 'IN_PROGRESS' }]);
    expect(aug.itemTotal).toBe(7);
    // Task status covers the whole task; the action looks only at the user's scope.
    expect(aug.status).toBe('IN_PROGRESS');
    expect(aug.action).toBe('CONTINUE');
    expect((await tasks(india, { status: 'TO_PREPARE' })).total).toBe(1);
    const cfs = page.items.find((t) => t.number === 'CFS-2026-07-001')!;
    expect(cfs.items.map((i) => i.code)).toEqual(['L3', 'L4']);
  });
});

describe('attention lines by permission', () => {
  it('a reviewer sees nothing awaiting review (no submissions) and cannot continue preparing', async () => {
    expect((await dashboard(rahul)).attention).toEqual({ awaitingReview: 0, awaitingYourReview: 0, openQueries: 0, overdue: 1 });
    const aug = (await tasks(rahul)).items.find((t) => t.number === 'SFS-2026-08-001')!;
    expect(aug.action).toBe('VIEW');
    expect((await tasks(rahul, { status: 'AWAITING_REVIEW' })).total).toBe(0);
  });

  it('the master sees every line, including edit-access requests and review items', async () => {
    expect((await dashboard(master)).attention).toEqual({
      entitiesToPrepare: 4,
      awaitingReview: 0,
      editAccessRequests: 0,
      awaitingYourReview: 0,
      openQueries: 0,
      overdue: 1,
    });
  });

  it('a user without any close permission cannot open the dashboard data', async () => {
    const admin = (
      await activeUserToken(ctx, master, { permissions: ['USER_ADMIN'], templateCode: null })
    ).token;
    const res = await ctx.http().get('/api/dashboard').set(as(admin));
    expect(res.status).toBe(403);
    expect((await ctx.http().get('/api/tasks').set(as(admin))).status).toBe(403);
  });

  it('rejects an unknown period', async () => {
    const res = await ctx
      .http()
      .get('/api/dashboard')
      .query({ period: '00000000-0000-4000-8000-000000000000' })
      .set(as(priya));
    expect(res.status).toBe(404);
  });
});

it('demo users sign in with their seeded passwords (sanity)', async () => {
  const res = await login(ctx, 'viewer@financeclose.local', password('viewer@financeclose.local'));
  expect((res.body as SessionResponse).user.permissions).toEqual(['REPORTS_VIEW']);
});
