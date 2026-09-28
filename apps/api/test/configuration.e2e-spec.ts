import type {
  EntityDto,
  FinancialYearDto,
  GroupStructureDto,
  PeriodDto,
} from '@finance-close/shared';
import { activeUserToken, createTestApp, MASTER, type TestContext, tokenFor } from './helpers';

let ctx: TestContext;
let master: string;
let preparer: string; // Preparer template: SFS_PREPARE, CFS_PREPARE, REPORTS_VIEW
let nobody: string; // no permissions

beforeAll(async () => {
  ctx = await createTestApp();
  master = await tokenFor(ctx, MASTER.email, MASTER.password);
  preparer = (await activeUserToken(ctx, master)).token;
  nobody = (await activeUserToken(ctx, master, { permissions: [], templateCode: null })).token;
});

afterAll(async () => {
  await ctx?.app.close();
});

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

async function entity(code: string): Promise<EntityDto> {
  return (await ctx.http().get(`/api/config/entities/${code}`).set(as(master))).body as EntityDto;
}

/** The editable fields of an entity, for PATCH. */
function input(e: EntityDto) {
  return {
    legalName: e.legalName,
    shortName: e.shortName,
    country: e.country,
    functionalCurrency: e.functionalCurrency,
    reportingCurrency: e.reportingCurrency,
    translatedCurrencies: e.translatedCurrencies,
    parentCode: e.parentCode,
    heldByParentPct: e.heldByParentPct,
    erp: e.erp,
    gaap: e.gaap,
    isActive: e.isActive,
    toBeConfirmed: e.toBeConfirmed,
    toBeConfirmedNote: e.toBeConfirmedNote,
    historicalRates: e.historicalRates.map(({ currency, rate, toBeConfirmed, note }) => ({
      currency,
      rate,
      toBeConfirmed,
      note,
    })),
  };
}

describe('access: REPORTS_VIEW can view, only CONFIG_MANAGE can edit', () => {
  const reads = [
    '/api/config/entities',
    '/api/config/entities/IN',
    '/api/config/group-structure',
    '/api/config/currencies',
    '/api/config/financial-years',
    '/api/config/financial-years/options',
    '/api/config/due-date-rules',
    '/api/config/holidays',
  ];

  it.each(reads)('a Preparer (REPORTS_VIEW) can read %s', async (url) => {
    expect((await ctx.http().get(url).set(as(preparer))).status).toBe(200);
  });

  it.each(reads)('a user with neither permission cannot read %s', async (url) => {
    expect((await ctx.http().get(url).set(as(nobody))).status).toBe(403);
  });

  it('a Preparer cannot change anything', async () => {
    const fy = (
      (await ctx.http().get('/api/config/financial-years').set(as(master)))
        .body as FinancialYearDto[]
    )[0]!;
    const periodId = fy.periods[0]!.id;
    const holidays = (await ctx.http().get('/api/config/holidays').set(as(master))).body as {
      id: string;
    }[];
    const ae = input(await entity('AE'));
    const inE = input(await entity('IN'));
    // Built lazily: supertest opens a server per request when it is created.
    const writes = [
      () =>
        ctx.http().post('/api/config/currencies').send({ code: 'EUR', name: 'Euro', symbol: '€' }),
      () => ctx.http().patch('/api/config/currencies/INR').send({ name: 'Rupee' }),
      () => ctx.http().delete('/api/config/currencies/LKR'),
      () => ctx.http().patch('/api/config/entities/IN').send(inE),
      () =>
        ctx
          .http()
          .post('/api/config/entities')
          .send({ ...ae, code: 'ZZ' }),
      () => ctx.http().post('/api/config/financial-years').send({ startYear: 2027 }),
      () => ctx.http().patch(`/api/config/periods/${periodId}/status`).send({ status: 'CLOSED' }),
      () =>
        ctx
          .http()
          .put(`/api/config/periods/${periodId}/due-dates/SFS`)
          .send({ dueDate: '2030-01-01', reason: 'Testing access' }),
      () => ctx.http().patch('/api/config/due-date-rules/SFS/MONTHLY').send({ workingDays: 9 }),
      () => ctx.http().post('/api/config/holidays').send({ date: '2030-01-01', description: 'X' }),
      () => ctx.http().delete(`/api/config/holidays/${holidays[0]!.id}`),
    ];
    for (const write of writes) {
      const res = await write().set(as(preparer));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        code: 'PERMISSION_DENIED',
        requiredPermission: 'CONFIG_MANAGE',
      });
    }
  });
});

describe('group structure', () => {
  it('shows the tree and derives the 4 consolidation levels', async () => {
    const g = (await ctx.http().get('/api/config/group-structure').set(as(preparer)))
      .body as GroupStructureDto;
    expect(g.issues).toEqual([]);
    expect(g.tree!.code).toBe('US');
    expect(g.tree!.children.map((c) => [c.code, c.heldByParentPct])).toEqual([['IN', '58.49']]);
    expect(
      g.levels.map(
        (l) => `L${l.level} ${l.name} (${l.members.map((m) => m.code).join(', ')}) ${l.currency}`,
      ),
    ).toEqual([
      'L1 Veracity Services (VS, VM) SGD',
      'L2 Unconstrained (UC, VS, VM) USD',
      'L3 India (IN, AE, UK, UC, VS, VM) INR',
      'L4 US (US, IN, AE, UK, UC, VS, VM) USD',
    ]);
  });

  it('seeds the 7 entities with historical rates and no missing-rate warnings', async () => {
    const list = (await ctx.http().get('/api/config/entities').set(as(preparer)))
      .body as EntityDto[];
    expect(list.map((e) => e.code)).toEqual(['US', 'IN', 'AE', 'UK', 'UC', 'VS', 'VM']);
    const vm = list.find((e) => e.code === 'VM')!;
    expect(vm).toMatchObject({
      functionalCurrency: 'LKR',
      parentCode: 'VS',
      erp: 'XERO',
      gaap: 'IFRS',
      toBeConfirmed: true,
    });
    expect(vm.historicalRates).toEqual([
      { currency: 'INR', rate: '0.275', toBeConfirmed: true, note: 'Illustrative seed value' },
      { currency: 'SGD', rate: '0.0044', toBeConfirmed: true, note: 'Illustrative seed value' },
      { currency: 'USD', rate: '0.00333', toBeConfirmed: true, note: 'Illustrative seed value' },
    ]);
    expect(list.find((e) => e.code === 'IN')!.historicalRates[0]!.rate).toBe('0.0133333333');
    expect(list.every((e) => e.missingHistoricalRates.length === 0)).toBe(true);
  });
});

describe('entity validation and audit', () => {
  const patch = (code: string, body: object) =>
    ctx.http().patch(`/api/config/entities/${code}`).set(as(master)).send(body);

  it('rejects a second ultimate parent, circular chains and bad % held', async () => {
    const inE = input(await entity('IN'));
    const noParent = await patch('IN', { ...inE, parentCode: null, heldByParentPct: null });
    expect(noParent.status).toBe(400);
    expect(noParent.body.message).toMatch(/exactly one ultimate parent/);

    const cyclic = await patch('UC', { ...input(await entity('UC')), parentCode: 'VM' });
    expect(cyclic.status).toBe(400);
    expect(cyclic.body.message).toMatch(/Circular parent chain/);

    for (const pct of ['0', '100.5', '-3']) {
      const res = await patch('IN', { ...inE, heldByParentPct: pct });
      expect(res.status).toBe(400);
    }
    const rootPct = await patch('US', { ...input(await entity('US')), heldByParentPct: '100' });
    expect(rootPct.status).toBe(400);
    expect(rootPct.body.message).toMatch(/ultimate parent, so it cannot have a % held/);
  });

  it('rejects translated currencies that include the functional currency', async () => {
    const uk = input(await entity('UK'));
    const res = await patch('UK', { ...uk, translatedCurrencies: ['GBP', 'INR'] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/must not include the functional currency/);
  });

  it('warns about a missing historical rate, and audits the change with old and new values', async () => {
    const vm = input(await entity('VM'));
    const withoutUsd = {
      ...vm,
      historicalRates: vm.historicalRates.filter((r) => r.currency !== 'USD'),
    };
    const res = await patch('VM', withoutUsd);
    expect(res.status).toBe(200);
    expect((res.body as EntityDto).missingHistoricalRates).toEqual([
      {
        currency: 'USD',
        reasons: ['translated currency', 'L2 Unconstrained level currency', 'L4 US level currency'],
      },
    ]);

    const log = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'ENTITY_UPDATE', entityId: 'VM' },
      orderBy: { id: 'desc' },
    });
    expect(Object.keys(log.oldValue as object)).toEqual(['historicalRates']);
    expect(
      (log.oldValue as { historicalRates: Record<string, string> }).historicalRates.USD,
    ).toMatch(/^0.00333/);
    expect(
      (log.newValue as { historicalRates: Record<string, string> }).historicalRates.USD,
    ).toBeUndefined();

    expect((await patch('VM', vm)).status).toBe(200); // restore
    expect((await entity('VM')).missingHistoricalRates).toEqual([]);
  });

  it('a saved change moves the consolidation levels (VM under UC), and moving it back restores them', async () => {
    const vm = input(await entity('VM'));
    expect((await patch('VM', { ...vm, parentCode: 'UC' })).status).toBe(200);
    const g = (await ctx.http().get('/api/config/group-structure').set(as(master)))
      .body as GroupStructureDto;
    expect(g.levels.map((l) => l.name)).toEqual(['Unconstrained', 'India', 'US']);
    expect((await patch('VM', vm)).status).toBe(200);
    const back = (await ctx.http().get('/api/config/group-structure').set(as(master)))
      .body as GroupStructureDto;
    expect(back.levels).toHaveLength(4);
  });
});

describe('currencies', () => {
  it('cannot delete or deactivate a currency in use; can add and delete an unused one', async () => {
    const del = await ctx.http().delete('/api/config/currencies/LKR').set(as(master));
    expect(del.status).toBe(409);
    expect(del.body.message).toMatch(/used by VM/);

    const deact = await ctx
      .http()
      .patch('/api/config/currencies/INR')
      .set(as(master))
      .send({ isActive: false });
    expect(deact.status).toBe(403);
    expect(deact.body.message).toMatch(/used by active entities/);

    await ctx.http().delete('/api/config/currencies/CHF').set(as(master)); // leftover from a failed run
    const add = await ctx
      .http()
      .post('/api/config/currencies')
      .set(as(master))
      .send({ code: 'chf', name: 'Swiss franc', symbol: 'CHF' });
    expect(add.status).toBe(201);
    expect(add.body).toMatchObject({ code: 'CHF', isActive: true, usedBy: [] });
    expect((await ctx.http().delete('/api/config/currencies/CHF').set(as(master))).status).toBe(
      204,
    );
    const actions = (
      await ctx.prisma.auditLog.findMany({
        where: { entityType: 'CURRENCY', entityId: 'CHF' },
        orderBy: { id: 'desc' },
        take: 2,
      })
    ).map((a) => a.action);
    expect(actions).toEqual(['CURRENCY_DELETE', 'CURRENCY_CREATE']);
  });
});

describe('financial years, periods and due dates', () => {
  async function aug2026(): Promise<PeriodDto> {
    const years = (await ctx.http().get('/api/config/financial-years').set(as(preparer)))
      .body as FinancialYearDto[];
    return years
      .find((y) => y.label === 'FY 2026-27')!
      .periods.find((p) => p.label === 'Aug-2026')!;
  }

  it('FY 2026-27 has 12 months, 4 quarters and 1 annual period', async () => {
    const years = (await ctx.http().get('/api/config/financial-years').set(as(preparer)))
      .body as FinancialYearDto[];
    expect(years.map((y) => y.label)).toEqual(expect.arrayContaining(['FY 2025-26', 'FY 2026-27']));
    const fy = years.find((y) => y.label === 'FY 2026-27')!;
    expect(fy.periods.filter((p) => p.type === 'MONTHLY').map((p) => p.label)[0]).toBe('Apr-2026');
    expect(fy.periods.filter((p) => p.type === 'MONTHLY')).toHaveLength(12);
    expect(
      fy.periods.filter((p) => p.type === 'QUARTERLY').map((p) => [p.startDate, p.endDate]),
    ).toEqual([
      ['2026-04-01', '2026-06-30'],
      ['2026-07-01', '2026-09-30'],
      ['2026-10-01', '2026-12-31'],
      ['2027-01-01', '2027-03-31'],
    ]);
    expect(fy.periods.filter((p) => p.type === 'ANNUAL')).toHaveLength(1);
  });

  it('calculates the Aug-2026 monthly SFS due date (7 working days) as 9 Sep 2026', async () => {
    const p = await aug2026();
    expect(p.dueDates.find((d) => d.statementType === 'SFS')).toMatchObject({
      workingDays: 7,
      calculated: '2026-09-09',
      effective: '2026-09-09',
      override: null,
    });
    expect(p.dueDates.find((d) => d.statementType === 'CFS')!.workingDays).toBe(12);
  });

  it('an override needs a reason, is audited, and can be cleared', async () => {
    const p = await aug2026();
    const url = `/api/config/periods/${p.id}/due-dates/SFS`;

    const noReason = await ctx.http().put(url).set(as(master)).send({ dueDate: '2026-09-15' });
    expect(noReason.status).toBe(400);
    expect(noReason.body.message).toMatch(/reason/);
    const tooEarly = await ctx
      .http()
      .put(url)
      .set(as(master))
      .send({ dueDate: '2026-08-20', reason: 'Too early' });
    expect(tooEarly.status).toBe(400);

    const ok = await ctx
      .http()
      .put(url)
      .set(as(master))
      .send({ dueDate: '2026-09-15', reason: 'Audit visit in week 2' });
    expect(ok.status).toBe(200);
    expect((ok.body as PeriodDto).dueDates[0]).toMatchObject({
      calculated: '2026-09-09',
      effective: '2026-09-15',
      override: { dueDate: '2026-09-15', reason: 'Audit visit in week 2' },
    });
    const log = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'DUE_DATE_OVERRIDE_SET', entityId: 'Aug-2026' },
      orderBy: { id: 'desc' },
    });
    expect(log.oldValue).toMatchObject({ task: 'Monthly SFS', dueDate: '2026-09-09' });
    expect(log.newValue).toMatchObject({ dueDate: '2026-09-15', reason: 'Audit visit in week 2' });

    const cleared = await ctx
      .http()
      .post(`${url}/clear`)
      .set(as(master))
      .send({ reason: 'Visit moved' });
    expect(cleared.status).toBe(200);
    expect((cleared.body as PeriodDto).dueDates[0]!.effective).toBe('2026-09-09');
  });

  it('holidays move the due date', async () => {
    const add = await ctx
      .http()
      .post('/api/config/holidays')
      .set(as(master))
      .send({ date: '2026-09-03', description: 'Test holiday' });
    try {
      expect(add.status).toBe(201);
      expect((await aug2026()).dueDates[0]!.calculated).toBe('2026-09-10');
    } finally {
      await ctx.http().delete(`/api/config/holidays/${add.body.id}`).set(as(master));
    }
    expect((await aug2026()).dueDates[0]!.calculated).toBe('2026-09-09');
  });

  it('periods can be closed and reopened (audited)', async () => {
    const p = await aug2026();
    const closed = await ctx
      .http()
      .patch(`/api/config/periods/${p.id}/status`)
      .set(as(master))
      .send({ status: 'CLOSED' });
    expect((closed.body as PeriodDto).status).toBe('CLOSED');
    const reopened = await ctx
      .http()
      .patch(`/api/config/periods/${p.id}/status`)
      .set(as(master))
      .send({ status: 'OPEN' });
    expect((reopened.body as PeriodDto).status).toBe('OPEN');
    const actions = (
      await ctx.prisma.auditLog.findMany({
        where: { entityType: 'PERIOD', entityId: 'Aug-2026' },
        orderBy: { id: 'desc' },
        take: 2,
      })
    ).map((a) => a.action);
    expect(actions).toEqual(['PERIOD_REOPEN', 'PERIOD_CLOSE']);
  });

  it('only listed financial years can be created, and never twice', async () => {
    expect(
      (
        await ctx
          .http()
          .post('/api/config/financial-years')
          .set(as(master))
          .send({ startYear: 2031 })
      ).status,
    ).toBe(400);
    const dup = await ctx
      .http()
      .post('/api/config/financial-years')
      .set(as(master))
      .send({ startYear: 2026 });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe('FY 2026-27 already exists.');
  });
});
