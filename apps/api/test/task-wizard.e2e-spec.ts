import type {
  TaskDetailDto,
  TaskListPage,
  WizardEntityDto,
  WizardLevelsDto,
  WizardOptionsDto,
  WizardPeriodDto,
} from '@finance-close/shared';
import { DEMO_USERS } from '../prisma/seed-demo';
import {
  activeUserToken,
  createTestApp,
  deleteNonDemoTasks,
  MASTER,
  type TestContext,
  tokenFor,
} from './helpers';

/**
 * New-task wizard (page 2) and POST /api/tasks, with today fixed at 29-Sep-2026 and the demo
 * tasks seeded (Jul-2026 SFS/CFS done, Aug-2026 SFS with all 7 entities).
 */
let ctx: TestContext;
let priya: string;
let master: string;
let options: WizardOptionsDto;
const pw = (email: string) => DEMO_USERS.find((d) => d.email === email)!.password;
const as = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  process.env.DEMO_MODE = 'true';
  ctx = await createTestApp();
  await deleteNonDemoTasks(ctx);
  priya = await tokenFor(ctx, 'priya@financeclose.local', pw('priya@financeclose.local'));
  master = await tokenFor(ctx, MASTER.email, MASTER.password);
  options = (await ctx.http().get('/api/task-wizard/options').set(as(priya)))
    .body as WizardOptionsDto;
});
afterAll(async () => {
  if (ctx) await deleteNonDemoTasks(ctx);
  await ctx?.app.close();
});

const fy2627 = () => options.financialYears.find((f) => f.label === 'FY 2026-27')!.id;
async function periods(
  token: string,
  type: 'SFS' | 'CFS',
  periodType: string,
): Promise<WizardPeriodDto[]> {
  const res = await ctx
    .http()
    .get('/api/task-wizard/periods')
    .query({ type, fyId: fy2627(), periodType })
    .set(as(token));
  expect(res.status).toBe(200);
  return res.body as WizardPeriodDto[];
}
const periodId = async (label: string, periodType = 'MONTHLY', type: 'SFS' | 'CFS' = 'SFS') =>
  (await periods(priya, type, periodType)).find((p) => p.label === label)!.id;
const create = (token: string, body: Record<string, unknown>) =>
  ctx
    .http()
    .post('/api/tasks')
    .set(as(token))
    .send({ formatCode: 'STATUTORY', description: '', ...body });
const entities = async (id: string) =>
  (await ctx.http().get('/api/task-wizard/entities').query({ periodId: id }).set(as(priya)))
    .body as WizardEntityDto[];

describe('options', () => {
  it('offers SFS and CFS to a preparer (MIS shown disabled), FY 2026-27, formats and the period in close', async () => {
    expect(options.types.map((t) => [t.type, t.enabled])).toEqual([
      ['SFS', true],
      ['CFS', true],
      ['MIS', false],
    ]);
    expect(options.financialYears.find((f) => f.id === options.defaultFyId)?.label).toBe(
      'FY 2026-27',
    );
    expect(options.formats.map((f) => f.name)).toEqual(['Statutory FS', 'Management FS']);
    expect(options.periodInCloseId).toBe(await periodId('Aug-2026'));
  });

  it('is closed to users who cannot prepare', async () => {
    const rahul = await tokenFor(ctx, 'rahul@financeclose.local', pw('rahul@financeclose.local'));
    expect((await ctx.http().get('/api/task-wizard/options').set(as(rahul))).status).toBe(403);
    expect(
      (
        await create(rahul, {
          type: 'SFS',
          periodId: await periodId('Jun-2026'),
          entityCodes: ['IN'],
        })
      ).status,
    ).toBe(403);
  });
});

describe('period tiles', () => {
  it('tags monthly periods: Aug has a task, Sep not ended, Jun available', async () => {
    const months = await periods(priya, 'SFS', 'MONTHLY');
    const tag = (label: string) => months.find((p) => p.label === label)!;
    expect(months.map((p) => p.label)[0]).toBe('Apr-2026');
    expect(tag('Aug-2026')).toMatchObject({
      availability: 'TASK_EXISTS',
      selectable: true,
      remaining: 0,
      dueDate: '2026-09-09',
      isPeriodInClose: true,
      existingTasks: [{ number: 'SFS-2026-08-001', status: 'IN_PROGRESS' }],
    });
    expect(tag('Sep-2026')).toMatchObject({
      availability: 'NOT_ENDED',
      selectable: false,
      endDate: '2026-09-30',
    });
    expect(tag('Jun-2026')).toMatchObject({
      availability: 'AVAILABLE',
      selectable: true,
      remaining: 7,
    });
  });

  it('labels quarters and the year; Q2 has not ended', async () => {
    const quarters = await periods(priya, 'SFS', 'QUARTERLY');
    expect(quarters.map((q) => [q.label, q.availability])).toEqual([
      ['Q1 (Apr–Jun 2026)', 'AVAILABLE'],
      ['Q2 (Jul–Sep 2026)', 'NOT_ENDED'],
      ['Q3 (Oct–Dec 2026)', 'NOT_ENDED'],
      ['Q4 (Jan–Mar 2027)', 'NOT_ENDED'],
    ]);
    expect(quarters[0]!.dueDate).toBe('2026-07-14'); // 30 Jun + 10 working days
    const annual = await periods(priya, 'SFS', 'ANNUAL');
    expect(annual.map((a) => [a.label, a.availability])).toEqual([
      ['FY 2026-27 (Apr-2026 to Mar-2027)', 'NOT_ENDED'],
    ]);
  });
});

describe('demo check 1: SFS Monthly Aug-2026', () => {
  it('shows all 7 entities already in SFS-2026-08-001, and creating is refused with 409', async () => {
    const aug = await periodId('Aug-2026');
    const list = await entities(aug);
    expect(list).toHaveLength(7);
    expect(list.every((e) => e.inTask?.number === 'SFS-2026-08-001')).toBe(true);
    expect(list.find((e) => e.code === 'VS')).toMatchObject({ toBeConfirmed: true });
    const res = await create(priya, { type: 'SFS', periodId: aug, entityCodes: ['VS'] });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT', existingTasks: ['SFS-2026-08-001'] });
    expect(res.body.message).toMatch(/VS \(SFS-2026-08-001\)/);
  });
});

describe('demo check 2: SFS Monthly Sep-2026', () => {
  it('has not ended, so the API refuses to create it', async () => {
    const res = await create(priya, {
      type: 'SFS',
      periodId: await periodId('Sep-2026'),
      entityCodes: ['IN'],
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/has not ended yet/);
  });
});

describe('demo check 3: SFS Quarterly Q1', () => {
  it('creates SFS-FY27-Q1-001 with all 7 entities, not started, at step 1 "Upload data"', async () => {
    const q1 = await periodId('Q1 (Apr–Jun 2026)', 'QUARTERLY');
    const all = (await entities(q1)).map((e) => e.code);
    const res = await create(priya, {
      type: 'SFS',
      periodId: q1,
      entityCodes: all,
      description: 'Quarterly SFS – Q1 FY 2026-27 – Statutory FS',
      reviewerNote: 'First quarterly close in the system.',
    });
    expect(res.status).toBe(201);
    const task = res.body as TaskDetailDto;
    expect(task).toMatchObject({
      number: 'SFS-FY27-Q1-001',
      type: 'SFS',
      periodType: 'QUARTERLY',
      status: 'NOT_STARTED',
      currentStep: 'UPLOAD_DATA',
      dueDate: '2026-07-14',
      format: 'Statutory FS',
      reviewerNote: 'First quarterly close in the system.',
      action: 'CONTINUE',
      itemTotal: 7,
    });
    expect(task.items.every((i) => i.status === 'NOT_STARTED')).toBe(true);
    const log = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'TASK_CREATE', entityId: 'SFS-FY27-Q1-001' },
    });
    expect(log.newValue).toMatchObject({
      period: 'Q1 FY 2026-27',
      entities: all,
      format: 'Statutory FS',
    });
  });
});

describe('demo check 4: SFS Monthly Jun-2026, India first, then the rest', () => {
  it('creates a task for India, then disables India and allows a second task for the others', async () => {
    const jun = await periodId('Jun-2026');
    const first = await create(priya, {
      type: 'SFS',
      periodId: jun,
      entityCodes: ['IN'],
      formatCode: 'MANAGEMENT',
    });
    expect(first.status).toBe(201);
    expect((first.body as TaskDetailDto).number).toBe('SFS-2026-06-001');
    expect((first.body as TaskDetailDto).format).toBe('Management FS');

    const list = await entities(jun);
    expect(list.find((e) => e.code === 'IN')!.inTask).toMatchObject({
      number: 'SFS-2026-06-001',
      status: 'NOT_STARTED',
    });
    expect(list.filter((e) => e.inTask === null).map((e) => e.code)).toEqual([
      'US',
      'AE',
      'UK',
      'UC',
      'VS',
      'VM',
    ]);
    const tile = (await periods(priya, 'SFS', 'MONTHLY')).find((p) => p.label === 'Jun-2026')!;
    expect(tile).toMatchObject({ availability: 'TASK_EXISTS', selectable: true, remaining: 6 });

    const again = await create(priya, { type: 'SFS', periodId: jun, entityCodes: ['IN', 'UK'] });
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/IN \(SFS-2026-06-001\)/);

    const rest = await create(priya, {
      type: 'SFS',
      periodId: jun,
      entityCodes: ['US', 'AE', 'UK', 'UC', 'VS', 'VM'],
    });
    expect(rest.status).toBe(201);
    expect((rest.body as TaskDetailDto).number).toBe('SFS-2026-06-002');

    // The dashboard lists both tasks for Jun-2026.
    const table = (await ctx.http().get('/api/tasks').query({ periodId: jun }).set(as(priya)))
      .body as TaskListPage;
    expect(table.items.map((t) => t.number)).toEqual(['SFS-2026-06-002', 'SFS-2026-06-001']);
    // The wizard remembers the last format per user.
    const again2 = (await ctx.http().get('/api/task-wizard/options').set(as(priya)))
      .body as WizardOptionsDto;
    expect(again2.defaultFormatCode).toBe('STATUTORY');
  });
});

describe('demo check 5: CFS Monthly Aug-2026', () => {
  it('shows the 4 levels with SFS readiness, creates CFS-2026-08-001, and allows only one', async () => {
    const aug = await periodId('Aug-2026', 'MONTHLY', 'CFS');
    const before = (
      await ctx.http().get('/api/task-wizard/levels').query({ periodId: aug }).set(as(priya))
    ).body as WizardLevelsDto;
    expect(before.canCreate).toBe(true);
    expect(
      before.levels.map((l) => `L${l.level} ${l.name} ${l.sfsFinalised}/${l.sfsTotal}`),
    ).toEqual(['L1 Veracity Services 0/2', 'L2 Unconstrained 1/3', 'L3 India 2/6', 'L4 US 3/7']);
    const res = await create(priya, { type: 'CFS', periodId: aug });
    expect(res.status).toBe(201);
    const task = res.body as TaskDetailDto;
    expect(task).toMatchObject({
      number: 'CFS-2026-08-001',
      status: 'NOT_STARTED',
      itemKind: 'LEVEL',
      itemTotal: 4,
    });
    expect(task.dueDate).toBe('2026-09-16');

    const after = (
      await ctx.http().get('/api/task-wizard/levels').query({ periodId: aug }).set(as(priya))
    ).body as WizardLevelsDto;
    expect(after).toMatchObject({ canCreate: false, existingTask: { number: 'CFS-2026-08-001' } });
    const dup = await create(priya, { type: 'CFS', periodId: aug });
    expect(dup.status).toBe(409);
    expect(dup.body.existingTasks).toEqual(['CFS-2026-08-001']);
  });
});

describe('server-side rules', () => {
  it('needs at least one entity, a known active format and a valid type', async () => {
    const jul = await periodId('May-2026');
    expect((await create(priya, { type: 'SFS', periodId: jul, entityCodes: [] })).status).toBe(400);
    expect(
      (await create(priya, { type: 'SFS', periodId: jul, entityCodes: ['IN'], formatCode: 'NOPE' }))
        .status,
    ).toBe(400);
    await ctx.prisma.format.update({ where: { code: 'MANAGEMENT' }, data: { isActive: false } });
    try {
      expect(
        (
          await create(priya, {
            type: 'SFS',
            periodId: jul,
            entityCodes: ['IN'],
            formatCode: 'MANAGEMENT',
          })
        ).status,
      ).toBe(400);
    } finally {
      await ctx.prisma.format.update({ where: { code: 'MANAGEMENT' }, data: { isActive: true } });
    }
    expect((await create(priya, { type: 'MIS', periodId: jul })).status).toBe(400);
    expect((await create(priya, { type: 'SFS', periodId: jul, entityCodes: ['XX'] })).status).toBe(
      400,
    );
  });

  it('refuses closed periods and closed financial years', async () => {
    const may = await periodId('May-2026');
    await ctx
      .http()
      .patch(`/api/config/periods/${may}/status`)
      .set(as(master))
      .send({ status: 'CLOSED' });
    try {
      const res = await create(priya, { type: 'SFS', periodId: may, entityCodes: ['IN'] });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/closed/);
      expect(
        (await periods(priya, 'SFS', 'MONTHLY')).find((p) => p.label === 'May-2026'),
      ).toMatchObject({
        availability: 'CLOSED',
        selectable: false,
      });
    } finally {
      await ctx
        .http()
        .patch(`/api/config/periods/${may}/status`)
        .set(as(master))
        .send({ status: 'OPEN' });
    }
    await ctx.prisma.financialYear.update({ where: { id: fy2627() }, data: { status: 'CLOSED' } });
    try {
      const res = await create(priya, { type: 'SFS', periodId: may, entityCodes: ['IN'] });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/FY 2026-27 is closed/);
    } finally {
      await ctx.prisma.financialYear.update({ where: { id: fy2627() }, data: { status: 'OPEN' } });
    }
  });

  it('keeps entities within the user scope, and CFS needs every entity in scope', async () => {
    const india = (await activeUserToken(ctx, master, { name: 'India preparer' })).token;
    const me = (await ctx.http().get('/api/auth/me').set(as(india))).body as { id: string };
    await ctx
      .http()
      .patch(`/api/users/${me.id}`)
      .set(as(master))
      .send({ entityScope: ['IN'] });
    const may = await periodId('May-2026');
    const list = (
      await ctx.http().get('/api/task-wizard/entities').query({ periodId: may }).set(as(india))
    ).body as WizardEntityDto[];
    expect(list.map((e) => e.code)).toEqual(['IN']);
    const outside = await create(india, { type: 'SFS', periodId: may, entityCodes: ['UK'] });
    expect(outside.status).toBe(403);
    expect(outside.body.message).toMatch(/UK/);
    const levels = (
      await ctx.http().get('/api/task-wizard/levels').query({ periodId: may }).set(as(india))
    ).body as WizardLevelsDto;
    expect(levels.canCreate).toBe(false);
    expect((await create(india, { type: 'CFS', periodId: may })).status).toBe(403);
  });

  it('needs the permission for the specific task type', async () => {
    const sfsOnly = (
      await activeUserToken(ctx, master, { permissions: ['SFS_PREPARE'], templateCode: null })
    ).token;
    const o = (await ctx.http().get('/api/task-wizard/options').set(as(sfsOnly)))
      .body as WizardOptionsDto;
    expect(o.types.filter((t) => t.enabled).map((t) => t.type)).toEqual(['SFS']);
    const res = await create(sfsOnly, { type: 'CFS', periodId: await periodId('May-2026') });
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe('CFS_PREPARE');
  });
});
