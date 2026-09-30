import type {
  CurrencyTranslationDto,
  EntityTranslationDto,
  TranslationStepDto,
} from '@finance-close/shared';
import { DEMO_USERS } from '../prisma/seed-demo';
import { createTestApp, deleteNonDemoTasks, MASTER, type TestContext, tokenFor } from './helpers';

/**
 * Page 6 — step 4 "Currency translation": the Aug-2026 demo task, rolled forward from the
 * seeded (finalised) Jul-2026 translation snapshots. Anything changed is put back.
 */
let ctx: TestContext;
let priya: string;
let master: string;
let augTaskId: string;
let julTaskId: string;
const pw = (email: string) => DEMO_USERS.find((d) => d.email === email)!.password;
const as = (token: string) => ({ Authorization: `Bearer ${token}` });

const get = async (taskId: string, code: string) => {
  const res = await ctx
    .http()
    .get(`/api/tasks/${taskId}/entities/${code}/translation`)
    .set(as(priya));
  expect(res.status).toBe(200);
  return res.body as EntityTranslationDto;
};
const currency = async (taskId: string, code: string, target: string) =>
  (await get(taskId, code)).currencies.find((c) => c.target === target)!;
const line = (c: CurrencyTranslationDto, code: string) => c.lines.find((l) => l.code === code)!;

async function reset() {
  const rows = await ctx.prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!rows[0]?.db.endsWith('_test')) throw new Error('not a test database');
  await ctx.prisma.entityHistoricalRate.upsert({
    where: { entityCode_targetCurrency: { entityCode: 'IN', targetCurrency: 'USD' } },
    create: {
      entityCode: 'IN',
      targetCurrency: 'USD',
      rate: '0.0133333333',
      toBeConfirmed: true,
      note: 'Illustrative seed value',
    },
    update: { rate: '0.0133333333' },
  });
  await ctx.prisma.entityAccount.deleteMany({
    where: { source: 'TASK_MAPPING', accountCode: { in: ['1455', '6120', '6390'] } },
  });
  await ctx.prisma.entityAccount.updateMany({
    where: { entityCode: 'IN', accountCode: '1010' },
    data: { rateBasisOverride: null },
  });
  await ctx.prisma.taskEntity.update({
    where: { taskId_entityCode: { taskId: augTaskId, entityCode: 'AE' } },
    data: { currentStep: 'MAPPING' },
  });
}

/** Maps the Aug-only accounts (as the preparer would on step 2) so the TBs translate. */
async function mapNewAccounts() {
  await ctx.prisma.entityAccount.createMany({
    data: [
      {
        entityCode: 'IN',
        accountCode: '1455',
        accountName: 'Advance to Suppliers',
        accountType: 'Other Current Asset',
        fsliCode: 'CUR_OTH',
        source: 'TASK_MAPPING',
        suggested: false,
      },
      {
        entityCode: 'IN',
        accountCode: '6120',
        accountName: 'Staff Welfare Expenses',
        accountType: 'Expense',
        fsliCode: 'EMP',
        source: 'TASK_MAPPING',
        suggested: false,
      },
      {
        entityCode: 'UK',
        accountCode: '6390',
        accountName: 'Bank Charges',
        accountType: 'Expense',
        fsliCode: 'OTH_EXP',
        source: 'TASK_MAPPING',
        suggested: false,
      },
    ],
    skipDuplicates: true,
  });
}

beforeAll(async () => {
  process.env.DEMO_MODE = 'true';
  ctx = await createTestApp();
  await deleteNonDemoTasks(ctx);
  priya = await tokenFor(ctx, 'priya@financeclose.local', pw('priya@financeclose.local'));
  master = await tokenFor(ctx, MASTER.email, MASTER.password);
  augTaskId = (await ctx.prisma.task.findUniqueOrThrow({ where: { number: 'SFS-2026-08-001' } }))
    .id;
  julTaskId = (await ctx.prisma.task.findUniqueOrThrow({ where: { number: 'SFS-2026-07-001' } }))
    .id;
  await reset();
  await mapNewAccounts();
});
afterAll(async () => {
  if (ctx) await reset();
  await ctx?.app.close();
});

describe('India INR → USD', () => {
  it('Jul-2026 (seeded snapshot, RE at the Jul opening rate 1/85.80)', async () => {
    const snap = await ctx.prisma.translationSnapshot.findUniqueOrThrow({
      where: {
        taskId_entityCode_targetCurrency: {
          taskId: julTaskId,
          entityCode: 'IN',
          targetCurrency: 'USD',
        },
      },
    });
    expect([snap.retained.toFixed(2), snap.profit.toFixed(2), snap.fctr.toFixed(2)]).toEqual([
      '-1923076.92',
      '-189971.96',
      '893643.96',
    ]);
    const jul = await currency(julTaskId, 'IN', 'USD');
    expect(jul.reMethod.kind).toBe('OPENING_RATE');
    expect(jul.summary).toMatchObject({
      totalAssets: '8420793.78',
      retainedEarnings: '1923076.92',
      profit: '189971.96',
      fctr: '-893643.96',
      balanced: true,
    });
    expect(jul.totals.translated).toBe('0.00');
  });

  it('Aug-2026: RE rolled forward from Jul, and the figures to the cent', async () => {
    const c = await currency(augTaskId, 'IN', 'USD');
    expect(c.status).toBe('OK');
    expect(c.reMethod).toMatchObject({ kind: 'ROLL_FORWARD' });
    expect(c.reMethod.text).toMatch(/^Rolled forward from finalised Jul-2026/);
    expect([
      c.rates.opening.value,
      c.rates.closing.value,
      c.rates.average.value,
      c.rates.historical.value,
    ]).toEqual(['0.0115740741', '0.0115074799', '0.0115473441', '0.0133333333']);
    expect(c.summary).toMatchObject({
      retainedEarnings: '2113048.88',
      profit: '205089.66',
      fctr: '-939726.38', // a debit balance in equity
      totalAssets: '8576724.39',
      balanced: true,
    });
    expect(c.fctr).toBe('939726.38');
    expect(line(c, '3001').translated).toBe('-1333333.33');
    expect(line(c, '3100').translated).toBe('-5333333.32');
    expect(line(c, '3001').basisLabel).toBe('historical');
    expect(line(c, '1010')).toMatchObject({
      name: 'Operating Bank',
      translated: '4151592.29',
      basisLabel: 'closing',
    });
    expect(line(c, '4000')).toMatchObject({
      name: 'Sales',
      translated: '-356812.93',
      basisLabel: 'average',
    });
    expect(line(c, '3200')).toMatchObject({ basis: 'ROLL_FORWARD', translated: '-2113048.88' });
    expect(c.totals).toEqual({ functional: '0.00', translated: '0.00' });
    expect(c.fctrMovement).toEqual({
      current: '939726.38',
      comparative: '893643.96',
      movement: '46082.42',
      comparativeLabel: 'Jul-2026',
    });
    expect(c.fctrMovementNote).toBe('Exchange differences on translation (OCI) – for information');
  });
});

describe('UK Aug-2026', () => {
  it('GBP → USD', async () => {
    const c = await currency(augTaskId, 'UK', 'USD');
    expect(c.summary).toMatchObject({
      retainedEarnings: '165212.77',
      profit: '39597.32',
      fctr: '11738.76',
      totalAssets: '652610.43',
      balanced: true,
    });
    expect(line(c, '3001')).toMatchObject({ translated: '-254000.00', rate: '1.2700000000' });
    expect(c.fctrMovement!.movement).toBe('3010.74');
    expect(c.totals.translated).toBe('0.00');
  });

  it('GBP → INR', async () => {
    const c = await currency(augTaskId, 'UK', 'INR');
    expect(c.summary).toMatchObject({
      retainedEarnings: '14186201.93',
      profit: '3429127.52',
      fctr: '3275366.67',
      totalAssets: '56711847.39',
      balanced: true,
    });
    expect(line(c, '3001').translated).toBe('-20000000.00');
    expect(c.fctrMovement!.movement).toBe('32771.03');
    expect(c.totals.translated).toBe('0.00');
  });
});

describe('other cases', () => {
  it('US: no translation needed', async () => {
    const us = await get(augTaskId, 'US');
    expect(us.noTranslation).toBe('No translation needed: US presents in USD.');
    expect(us.currencies).toEqual([]);
  });

  it('every translated TB in the Aug task nets to exactly 0.00', async () => {
    const step = (await ctx.http().get(`/api/tasks/${augTaskId}/translation-step`).set(as(priya)))
      .body as TranslationStepDto;
    for (const e of step.entities.filter((x) => x.hasValidatedTb)) {
      for (const c of (await get(augTaskId, e.code)).currencies) {
        expect([e.code, c.target, c.status, c.totals.translated]).toEqual([
          e.code,
          c.target,
          'OK',
          '0.00',
        ]);
      }
    }
  });

  it('missing historical rate → opening rate on share capital, with a warning', async () => {
    await ctx.prisma.entityHistoricalRate.delete({
      where: { entityCode_targetCurrency: { entityCode: 'IN', targetCurrency: 'USD' } },
    });
    const c = await currency(augTaskId, 'IN', 'USD');
    expect(line(c, '3001')).toMatchObject({
      basisLabel: 'opening (no historical rate)',
      rate: '0.0115740741',
    });
    expect(c.warnings.some((w) => /No historical rate INR → USD/.test(w))).toBe(true);
    expect(c.totals.translated).toBe('0.00');
    await ctx.prisma.entityHistoricalRate.create({
      data: {
        entityCode: 'IN',
        targetCurrency: 'USD',
        rate: '0.0133333333',
        toBeConfirmed: true,
        note: 'Illustrative seed value',
      },
    });
  });

  it('a rate-basis override shows on the line', async () => {
    await ctx.prisma.entityAccount.updateMany({
      where: { entityCode: 'IN', accountCode: '1010' },
      data: { rateBasisOverride: 'AVERAGE' },
    });
    const c = await currency(augTaskId, 'IN', 'USD');
    expect(line(c, '1010')).toMatchObject({ overridden: true, basis: 'AVERAGE' });
    expect(c.totals.translated).toBe('0.00');
    await ctx.prisma.entityAccount.updateMany({
      where: { entityCode: 'IN', accountCode: '1010' },
      data: { rateBasisOverride: null },
    });
  });

  it('the ratesStamp changes when a rate changes; a missing closing rate is a fail and blocks continue', async () => {
    const before = (await get(augTaskId, 'AE')).ratesStamp;
    const aug = new Date('2026-08-01');
    const row = await ctx.prisma.exchangeRate.findUniqueOrThrow({
      where: { month_currencyCode: { month: aug, currencyCode: 'AED' } },
    });
    try {
      await ctx.prisma.exchangeRate.update({
        where: { month_currencyCode: { month: aug, currencyCode: 'AED' } },
        data: { closing: null },
      });
      const ae = await get(augTaskId, 'AE');
      expect(ae.ratesStamp).not.toBe(before);
      const usd = ae.currencies.find((c) => c.target === 'USD')!;
      expect(usd.status).toBe('FAIL');
      expect(usd.failures[0]).toMatch(/closing rate is missing \(AED Aug-2026 closing\)/);
      expect(ae.canContinue).toBe(false);
      const blocked = await ctx
        .http()
        .post(`/api/tasks/${augTaskId}/entities/AE/translation/continue`)
        .set(as(priya));
      expect(blocked.status).toBe(400);
    } finally {
      await ctx.prisma.exchangeRate.update({
        where: { month_currencyCode: { month: aug, currencyCode: 'AED' } },
        data: { closing: row.closing },
      });
    }
    const ok = await ctx
      .http()
      .post(`/api/tasks/${augTaskId}/entities/AE/translation/continue`)
      .set(as(priya));
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ currentStep: 'STATEMENTS' });
  });

  it('finalised entities and Done tasks are read-only', async () => {
    expect(
      (
        await ctx
          .http()
          .post(`/api/tasks/${augTaskId}/entities/UK/translation/continue`)
          .set(as(priya))
      ).status,
    ).toBe(409);
    expect(
      (
        await ctx
          .http()
          .post(`/api/tasks/${julTaskId}/entities/IN/translation/continue`)
          .set(as(priya))
      ).status,
    ).toBe(409);
    void master;
  });
});
