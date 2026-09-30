import type {
  AccountTypeDefaultDto,
  AppSettingsDto,
  CoaPreviewDto,
  CrossRateDto,
  EntityCoaDto,
  FormatDetailDto,
  FormatIssueDto,
  FormatPreviewDto,
  FormatSaveResultDto,
  FsliDto,
  RateGridDto,
  RatePreviewDto,
  RateSaveResultDto,
} from '@finance-close/shared';
import * as XLSX from 'xlsx';
import { chartOfAccountsInFile } from '../prisma/sample-files';
import { activeUserToken, createTestApp, MASTER, type TestContext, tokenFor } from './helpers';

let ctx: TestContext;
let master: string;
let preparer: string; // SFS_PREPARE, CFS_PREPARE, REPORTS_VIEW
let augTaskId: string;

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sheet(rows: (string | number)[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Rates');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
const binary = (
  res: import('superagent').Response,
  cb: (err: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const readXlsx = (body: Buffer) => {
  const wb = XLSX.read(body, { type: 'buffer' });
  return XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]!]!, {
    header: 1,
    raw: false,
  });
};

async function assertTestDb() {
  const rows = await ctx.prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!rows[0]?.db.endsWith('_test')) throw new Error('not a test database');
}

/** Puts STATUTORY back to its single seeded version and removes test formats and rates. */
async function resetFormats() {
  await assertTestDb();
  await ctx.prisma.task.updateMany({
    where: { formatCode: 'STATUTORY' },
    data: { formatVersion: 1 },
  });
  await ctx.prisma.formatVersion.deleteMany({
    where: { formatCode: 'STATUTORY', version: { gt: 1 } },
  });
  await ctx.prisma.format.update({
    where: { code: 'STATUTORY' },
    data: { currentVersion: 1, name: 'Statutory FS (Schedule III, Division II)' },
  });
  await ctx.prisma.formatVersion.deleteMany({ where: { formatCode: 'STAT_COPY' } });
  await ctx.prisma.format.deleteMany({ where: { code: 'STAT_COPY' } });
}

beforeAll(async () => {
  ctx = await createTestApp();
  master = await tokenFor(ctx, MASTER.email, MASTER.password);
  preparer = (await activeUserToken(ctx, master)).token;
  augTaskId = (await ctx.prisma.task.findUniqueOrThrow({ where: { number: 'SFS-2026-08-001' } }))
    .id;
  await resetFormats();
});

afterAll(async () => {
  await resetFormats();
  await ctx.prisma.exchangeRate.deleteMany({ where: { month: new Date('2027-03-01') } });
  await ctx.prisma.appSetting.updateMany({ where: { key: 'RATE_SOURCE' }, data: { value: '' } });
  await ctx.prisma.appSetting.updateMany({
    where: { key: 'IC_DIFF_THRESHOLD' },
    data: { value: '1.00' },
  });
  await ctx.prisma.appSetting.updateMany({
    where: { key: 'VARIANCE_PCT_THRESHOLD' },
    data: { value: '0.20' },
  });
  await ctx?.app.close();
});

describe('access: REPORTS_VIEW views, only CONFIG_MANAGE edits', () => {
  it.each([
    '/api/config/settings',
    '/api/config/exchange-rates/grid',
    '/api/config/formats/STATUTORY',
    '/api/config/formats/preview-sources',
    '/api/config/entities/IN/coa',
    '/api/config/fslis',
    '/api/config/account-type-defaults',
  ])('a Preparer can read %s', async (url) => {
    expect((await ctx.http().get(url).set(as(preparer))).status).toBe(200);
  });

  it('a Preparer cannot change settings, formats, FSLIs, defaults, accounts or config rates', async () => {
    const tries = [
      () =>
        ctx
          .http()
          .put('/api/config/settings')
          .send({ rateSource: 'x', icDiffThreshold: '1', variancePct: '20' }),
      () =>
        ctx
          .http()
          .put('/api/config/formats/STATUTORY')
          .send({ name: 'x', description: '', lines: [] }),
      () => ctx.http().patch('/api/config/fslis/CASH').send({ name: 'x' }),
      () =>
        ctx
          .http()
          .put('/api/config/account-type-defaults')
          .send({ erp: 'ZOHO', accountType: 'Bank', fsliCode: 'CASH' }),
      () =>
        ctx.http().patch('/api/config/entities/IN/accounts/1010').send({
          accountType: null,
          fsliCode: 'CASH',
          counterpartyCode: null,
          rateBasisOverride: null,
        }),
      () =>
        ctx
          .http()
          .put('/api/config/exchange-rates')
          .send({
            rates: [
              { month: '2027-03-01', currency: 'INR', opening: '1', closing: null, average: null },
            ],
          }),
    ];
    for (const t of tries) expect((await t().set(as(preparer))).status).toBe(403);
  });
});

describe('settings', () => {
  it('defaults: rate source to be confirmed, IC threshold 1.00, variance 20%', async () => {
    const s = (await ctx.http().get('/api/config/settings').set(as(master))).body as AppSettingsDto;
    expect(s).toMatchObject({
      rateSource: '',
      rateSourceLabel: 'To be confirmed – Open question 2',
      icDiffThreshold: '1.00',
      variancePct: '20',
      canEdit: true,
    });
  });

  it('saves (audited) and the rate panels show the new source', async () => {
    const res = await ctx
      .http()
      .put('/api/config/settings')
      .set(as(master))
      .send({ rateSource: 'RBI reference rate', icDiffThreshold: '5', variancePct: '12.5' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      rateSource: 'RBI reference rate',
      icDiffThreshold: '5.00',
      variancePct: '12.5',
    });
    expect(
      (await ctx.prisma.appSetting.findUnique({ where: { key: 'VARIANCE_PCT_THRESHOLD' } }))!.value,
    ).toBe('0.125');
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'SETTINGS_UPDATE' },
      orderBy: { timestamp: 'desc' },
    });
    expect(audit!.oldValue).toMatchObject({ RATE_SOURCE: '', VARIANCE_PCT_THRESHOLD: '0.20' });
    expect(audit!.newValue).toMatchObject({
      RATE_SOURCE: 'RBI reference rate',
      IC_DIFF_THRESHOLD: '5.00',
    });
    const grid = (await ctx.http().get('/api/config/exchange-rates/grid').set(as(master)))
      .body as RateGridDto;
    expect(grid.sourceLabel).toBe('RBI reference rate');
    await ctx
      .http()
      .put('/api/config/settings')
      .set(as(master))
      .send({ rateSource: '', icDiffThreshold: '1.00', variancePct: '20' });
  });

  it('rejects a bad threshold', async () => {
    const res = await ctx
      .http()
      .put('/api/config/settings')
      .set(as(master))
      .send({ rateSource: '', icDiffThreshold: 'abc', variancePct: '0' });
    expect(res.status).toBe(400);
  });
});

describe('exchange rates', () => {
  it('grid: newest month first, grouped by FY; Jul and Aug locked by finalised reports', async () => {
    const grid = (await ctx.http().get('/api/config/exchange-rates/grid').set(as(master)))
      .body as RateGridDto;
    expect(grid.currencies).toEqual(expect.arrayContaining(['INR', 'GBP', 'AED', 'SGD', 'LKR']));
    expect(grid.months.map((m) => m.month)).toEqual(
      [...grid.months.map((m) => m.month)].sort().reverse(),
    );
    const jul = grid.months.find((m) => m.month === '2026-07-01')!;
    expect(jul).toMatchObject({ fyLabel: 'FY 2026-27', status: 'LOCKED' });
    expect(jul.lockedBy).toEqual(['CFS-2026-07-001', 'SFS-2026-07-001']);
    const aug = grid.months.find((m) => m.month === '2026-08-01')!;
    // US, UK and UC are finalised in the Aug SFS task, so Aug is locked too.
    expect(aug).toMatchObject({ status: 'LOCKED', lockedBy: ['SFS-2026-08-001'], missing: 0 });
    expect(aug.cells.find((c) => c.currency === 'INR')).toMatchObject({
      opening: '86.4',
      closing: '86.9',
      average: '86.6',
    });
  });

  it('upload preview: N new, N changed, N skipped because locked — nothing saved', async () => {
    const file = sheet([
      ['Month', 'Currency', 'Opening', 'Closing', 'Average'],
      ['2026-07', 'INR', '85.80', '86.45', '86.10'],
      ['2026-08', 'INR', '86.40', '86.90', '86.60'],
      ['2027-03', 'INR', '90.00', '91.00', '90.50'],
      ['2027-03', 'USD', '1', '1', '1'],
    ]);
    const res = await ctx
      .http()
      .post('/api/config/exchange-rates/preview')
      .set(as(master))
      .attach('file', file, { filename: 'rates.xlsx', contentType: XLSX_TYPE });
    expect(res.status).toBe(201);
    const p = res.body as RatePreviewDto;
    expect(p.summary).toEqual({ new: 1, changed: 0, unchanged: 1, skippedLocked: 1 });
    expect(p.rows.find((r) => r.month === '2026-07-01')).toMatchObject({
      status: 'LOCKED',
      before: { closing: '86.4' },
      after: { closing: '86.45' },
    });
    expect(p.rows.some((r) => r.currency === 'USD')).toBe(false); // USD is 1 by definition
    expect(await ctx.prisma.exchangeRate.count({ where: { month: new Date('2027-03-01') } })).toBe(
      0,
    );
  });

  it('upload saves new and changed rows and skips locked months', async () => {
    const file = sheet([
      ['Month', 'Currency', 'Opening', 'Closing', 'Average'],
      ['2026-07', 'INR', '85.80', '86.45', '86.10'],
      ['2027-03', 'INR', '90.00', '91.00', '90.50'],
    ]);
    const res = await ctx
      .http()
      .post('/api/config/exchange-rates/upload')
      .set(as(master))
      .attach('file', file, { filename: 'rates.xlsx', contentType: XLSX_TYPE });
    expect(res.status).toBe(201);
    expect(res.body as RateSaveResultDto).toMatchObject({
      changed: 1,
      unchanged: 0,
      skippedLocked: 1,
    });
    const jul = await ctx.prisma.exchangeRate.findUniqueOrThrow({
      where: { month_currencyCode: { month: new Date('2026-07-01'), currencyCode: 'INR' } },
    });
    expect(jul.closing!.toString()).toBe('86.4');
  });

  it('month drawer save: a locked month cannot be edited', async () => {
    const res = await ctx
      .http()
      .put('/api/config/exchange-rates')
      .set(as(master))
      .send({
        rates: [
          { month: '2026-07-01', currency: 'INR', opening: null, closing: '86.50', average: null },
        ],
      });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('SFS-2026-07-001');
  });

  it('checks per month: missing values, opening ≠ prior closing', async () => {
    const res = await ctx
      .http()
      .put('/api/config/exchange-rates')
      .set(as(master))
      .send({
        rates: [
          { month: '2027-03-01', currency: 'GBP', opening: '0.80', closing: null, average: null },
        ],
      });
    expect(res.status).toBe(200);
    const grid = (await ctx.http().get('/api/config/exchange-rates/grid').set(as(master)))
      .body as RateGridDto;
    const mar = grid.months[0]!;
    expect(mar).toMatchObject({ month: '2027-03-01', fyLabel: 'FY 2026-27', status: 'MISSING' });
    expect(mar.checks.map((c) => c.message)).toContain('GBP Mar-2027: closing, average missing.');
    expect(grid.nextMonth).toMatchObject({ month: '2027-04-01', label: 'Apr-2027' });
    expect(grid.nextMonth.openings.INR).toBe('91');
  });

  it('template and export download as Excel', async () => {
    const t = await ctx
      .http()
      .get('/api/config/exchange-rates/template')
      .set(as(master))
      .buffer(true)
      .parse(binary);
    expect(t.status).toBe(200);
    expect(t.headers['content-type']).toContain('spreadsheetml');
    const rows = readXlsx(t.body as Buffer);
    expect(rows[0]).toEqual(['Month', 'Currency', 'Opening', 'Closing', 'Average']);
    expect(rows.find((r) => r[1] === 'INR')).toEqual(['2027-04', 'INR', '91', '', '']);
    const e = await ctx
      .http()
      .get('/api/config/exchange-rates/export')
      .set(as(preparer))
      .buffer(true)
      .parse(binary);
    expect(e.status).toBe(200);
    expect(readXlsx(e.body as Buffer)).toContainEqual(['2026-08', 'INR', '86.4', '86.9', '86.6']);
  });

  it('cross-rate viewer: GBP → INR for Aug-2026 with its formula', async () => {
    const res = await ctx
      .http()
      .get('/api/config/exchange-rates/cross?month=2026-08-01&from=GBP&to=INR')
      .set(as(preparer));
    expect(res.status).toBe(200);
    const c = res.body as CrossRateDto;
    expect(c.rates.find((r) => r.kind === 'closing')).toMatchObject({
      value: '116.3319946452',
      formula: '86.90 ÷ 0.747',
    });
  });
});

describe('report formats', () => {
  const fetchFormat = async (code = 'STATUTORY') =>
    (await ctx.http().get(`/api/config/formats/${code}`).set(as(master))).body as FormatDetailDto;

  it('three seeded formats, each passing the coverage check', async () => {
    const list = (await ctx.http().get('/api/config/formats').set(as(master))).body as {
      code: string;
      name: string;
    }[];
    expect(list.map((f) => f.name)).toEqual([
      'Monthly internal (management)',
      'Investor reporting',
      'Statutory FS (Schedule III, Division II)',
    ]);
    for (const code of ['MANAGEMENT', 'INVESTOR', 'STATUTORY']) {
      const f = await fetchFormat(code);
      const check = await ctx
        .http()
        .post('/api/config/formats/check')
        .set(as(master))
        .send({ lines: f.lines });
      expect(check.body.issues).toEqual([]);
    }
    expect((await fetchFormat()).description).toContain('MSME');
  });

  it('coverage check: leaving "Other expenses" unplaced blocks saving', async () => {
    const f = await fetchFormat();
    const lines = f.lines.map((l) => ({ ...l, fslis: l.fslis.filter((c) => c !== 'OTH_EXP') }));
    const check = await ctx
      .http()
      .post('/api/config/formats/check')
      .set(as(master))
      .send({ lines });
    const issues = check.body.issues as FormatIssueDto[];
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'UNPLACED',
        fsliCode: 'OTH_EXP',
        message: 'Other expenses (OTH_EXP) is not placed on any P&L line.',
      }),
    );
    const save = await ctx
      .http()
      .put('/api/config/formats/STATUTORY')
      .set(as(master))
      .send({ name: f.name, description: f.description, lines });
    expect(save.status).toBe(400);
    expect(save.body.message).toContain('Other expenses (OTH_EXP) is not placed on any P&L line.');
    expect((await fetchFormat()).version).toBe(1);
  });

  it('a format used by a finalised report gets a new version on save; the old one stays attached', async () => {
    const f = await fetchFormat();
    expect(f.savesAsNewVersion).toBe(true);
    expect(f.versions[0]!.finalisedTasks).toContain('SFS-2026-07-001');
    const lines = f.lines.map((l) =>
      l.key === 'revenue' ? { ...l, label: 'I Revenue from operations (net)' } : l,
    );
    expect(lines.some((l) => l.label === 'I Revenue from operations (net)')).toBe(true);
    const res = await ctx
      .http()
      .put('/api/config/formats/STATUTORY')
      .set(as(master))
      .send({ name: f.name, description: f.description, lines, note: 'Renamed revenue' });
    expect(res.status).toBe(200);
    const r = res.body as FormatSaveResultDto;
    expect(r.newVersion).toBe(true);
    expect(r.format.currentVersion).toBe(2);
    const jul = await ctx.prisma.task.findUniqueOrThrow({ where: { number: 'SFS-2026-07-001' } });
    expect(jul.formatVersion).toBe(1);
    const v1 = (await ctx.http().get('/api/config/formats/STATUTORY?version=1').set(as(master)))
      .body as FormatDetailDto;
    expect(v1.lines.some((l) => l.label === 'I Revenue from operations (net)')).toBe(false);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'FORMAT_VERSION_CREATE', entityId: 'STATUTORY' },
      orderBy: { timestamp: 'desc' },
    });
    expect(audit).not.toBeNull();
    // v2 is not used by a finalised report: saving again edits it in place.
    const again = await ctx
      .http()
      .put('/api/config/formats/STATUTORY')
      .set(as(master))
      .send({ name: f.name, description: f.description, lines: f.lines });
    expect((again.body as FormatSaveResultDto).newVersion).toBe(false);
    expect((again.body as FormatSaveResultDto).format.currentVersion).toBe(2);
  });

  it('duplicate a format', async () => {
    const res = await ctx
      .http()
      .post('/api/config/formats/STATUTORY/duplicate')
      .set(as(master))
      .send({ code: 'STAT_COPY', name: 'Statutory copy' });
    expect(res.status).toBe(201);
    const copy = res.body as FormatDetailDto;
    expect(copy).toMatchObject({ code: 'STAT_COPY', name: 'Statutory copy', currentVersion: 1 });
    expect(copy.lines.length).toBe((await fetchFormat()).lines.length);
    expect(
      (
        await ctx
          .http()
          .post('/api/config/formats/STATUTORY/duplicate')
          .set(as(master))
          .send({ code: 'STAT_COPY', name: 'x' })
      ).status,
    ).toBe(409);
  });

  it("preview with India's Aug-2026 figures: profit 17,760,764.50 and the balance sheet balances", async () => {
    // Map the two Aug-only accounts (as the preparer would on step 2).
    for (const [code, name, fsli] of [
      ['1455', 'Aug account 1455', 'CUR_OTH'],
      ['6120', 'Aug account 6120', 'EMP'],
    ] as const)
      await ctx.prisma.entityAccount.upsert({
        where: { entityCode_accountCode: { entityCode: 'IN', accountCode: code } },
        create: {
          entityCode: 'IN',
          accountCode: code,
          accountName: name,
          fsliCode: fsli,
          source: 'TASK_MAPPING',
          suggested: false,
        },
        update: { fsliCode: fsli },
      });
    const sources = (await ctx.http().get('/api/config/formats/preview-sources').set(as(master)))
      .body as { taskId: string; entityCode: string; finalised: boolean }[];
    expect(sources[0]!.finalised).toBe(true);
    expect(sources.some((s) => s.taskId === augTaskId && s.entityCode === 'IN')).toBe(true);
    const f = await fetchFormat();
    const res = await ctx
      .http()
      .post('/api/config/formats/preview')
      .set(as(preparer))
      .send({ lines: f.lines, taskId: augTaskId, entityCode: 'IN' });
    expect(res.status).toBe(201);
    const p = res.body as FormatPreviewDto;
    expect(p.unmapped).toBe('0.00');
    expect(p.rows.find((r) => r.role === 'PROFIT')!.value).toBe('17760764.50');
    expect(p.balanced).toBe(true);
    await ctx.prisma.entityAccount.deleteMany({
      where: { entityCode: 'IN', source: 'TASK_MAPPING', accountCode: { in: ['1455', '6120'] } },
    });
  });
});

describe('FSLI master and account-type defaults', () => {
  it('FSLIs show "used by N accounts"; names can be edited (audited)', async () => {
    const list = (await ctx.http().get('/api/config/fslis').set(as(master))).body as FsliDto[];
    expect(list.find((f) => f.code === 'CASH')!.accounts).toBeGreaterThan(0);
    const before = list.find((f) => f.code === 'OTH_EXP')!.name;
    expect(
      (
        await ctx
          .http()
          .patch('/api/config/fslis/OTH_EXP')
          .set(as(master))
          .send({ name: 'Other operating expenses' })
      ).status,
    ).toBe(204);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'FSLI_RENAME', entityId: 'OTH_EXP' },
      orderBy: { timestamp: 'desc' },
    });
    expect(audit!.oldValue).toEqual({ name: before });
    await ctx.http().patch('/api/config/fslis/OTH_EXP').set(as(master)).send({ name: before });
  });

  it('defaults: add, change and delete a Zoho type → FSLI (audited); system FSLIs refused', async () => {
    const start = new Date();
    const set = await ctx
      .http()
      .put('/api/config/account-type-defaults')
      .set(as(master))
      .send({ erp: 'ZOHO', accountType: 'Test Type', fsliCode: 'CASH' });
    expect(set.status).toBe(200);
    expect(set.body as AccountTypeDefaultDto).toMatchObject({
      accountType: 'Test Type',
      fsliCode: 'CASH',
    });
    await ctx
      .http()
      .put('/api/config/account-type-defaults')
      .set(as(master))
      .send({ erp: 'ZOHO', accountType: 'test type', fsliCode: 'CUR_OTH' });
    expect(
      (await ctx.prisma.accountTypeDefault.findUnique({
        where: { erp_accountType: { erp: 'ZOHO', accountType: 'Test Type' } },
      }))!.fsliCode,
    ).toBe('CUR_OTH');
    expect(
      (
        await ctx
          .http()
          .put('/api/config/account-type-defaults')
          .set(as(master))
          .send({ erp: 'ZOHO', accountType: 'X', fsliCode: 'PROFIT' })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx
          .http()
          .delete('/api/config/account-type-defaults/ZOHO/Test%20Type')
          .set(as(master))
      ).status,
    ).toBe(204);
    expect(
      await ctx.prisma.auditLog.count({
        where: {
          action: { in: ['ACCOUNT_TYPE_DEFAULT_SET', 'ACCOUNT_TYPE_DEFAULT_DELETE'] },
          entityId: 'ZOHO:Test Type',
          timestamp: { gte: start },
        },
      }),
    ).toBe(3);
  });
});

describe('chart of accounts', () => {
  afterAll(async () => {
    await ctx.prisma.entityAccount.deleteMany({
      where: { entityCode: 'IN', accountCode: { in: ['6150', '1060', '1455', '6120'] } },
    });
    await ctx.prisma.entityAccount.updateMany({
      where: { entityCode: 'IN', accountCode: '1010' },
      data: { rateBasisOverride: null, source: 'SEED', updatedById: null, suggested: false },
    });
  });

  it('stats: accounts, mapped %, unmapped, intercompany without counterparty', async () => {
    const c = (await ctx.http().get('/api/config/entities/IN/coa').set(as(preparer)))
      .body as EntityCoaDto;
    expect(c.stats.accounts).toBe(c.accounts.length);
    expect(c.stats.mapped + c.stats.unmapped).toBe(c.stats.accounts);
    expect(c.stats.icWithoutCounterparty).toBe(0);
    expect(c.canEdit).toBe(false);
  });

  it('changing an existing mapping needs a reason; the change is audited with source "Edited in configuration"', async () => {
    const body = {
      accountType: 'Bank',
      fsliCode: 'CASH',
      counterpartyCode: null,
      rateBasisOverride: 'HISTORICAL',
    };
    const no = await ctx
      .http()
      .patch('/api/config/entities/IN/accounts/1010')
      .set(as(master))
      .send(body);
    expect(no.status).toBe(400);
    expect(no.body.message).toBe('Give a reason for changing an existing mapping.');
    const ok = await ctx
      .http()
      .patch('/api/config/entities/IN/accounts/1010')
      .set(as(master))
      .send({ ...body, reason: 'Test override' });
    expect(ok.status).toBe(200);
    const a = (ok.body as EntityCoaDto).accounts.find((x) => x.accountCode === '1010')!;
    expect(a).toMatchObject({
      rateBasisOverride: 'HISTORICAL',
      sourceLabel: 'Edited in configuration',
    });
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'ACCOUNT_UPDATE', entityId: 'IN:1010' },
      orderBy: { timestamp: 'desc' },
    });
    expect(audit!.newValue).toMatchObject({
      rateBasisOverride: 'HISTORICAL',
      reason: 'Test override',
    });
  });

  it('an intercompany FSLI needs a counterparty', async () => {
    const res = await ctx
      .http()
      .patch('/api/config/entities/IN/accounts/1010')
      .set(as(master))
      .send({
        accountType: 'Bank',
        fsliCode: 'IC_REC',
        counterpartyCode: null,
        rateBasisOverride: null,
        reason: 'x test',
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('counterparty');
  });

  it('upload Zoho COA: preview first (nothing saved), then merge', async () => {
    const file = chartOfAccountsInFile();
    const pre = await ctx
      .http()
      .post('/api/config/entities/IN/coa/preview')
      .set(as(master))
      .attach('file', file, { filename: 'coa.xlsx', contentType: XLSX_TYPE });
    expect(pre.status).toBe(201);
    const p = pre.body as CoaPreviewDto;
    expect(p.added.map((a) => a.code).sort()).toEqual(['1060', '1455', '6120', '6150']);
    expect(p.added.find((a) => a.code === '6150')).toMatchObject({
      type: 'Expense',
      fsliCode: 'OTH_EXP',
    });
    expect(
      await ctx.prisma.entityAccount.count({ where: { entityCode: 'IN', accountCode: '6150' } }),
    ).toBe(0);
    const up = await ctx
      .http()
      .post('/api/config/entities/IN/coa/upload')
      .set(as(master))
      .attach('file', file, { filename: 'coa.xlsx', contentType: XLSX_TYPE });
    expect(up.status).toBe(201);
    expect((up.body as EntityCoaDto).accounts.find((a) => a.accountCode === '6150')).toMatchObject({
      sourceLabel: 'Chart of accounts upload',
      suggested: true,
    });
  });

  it('export to Excel', async () => {
    const res = await ctx
      .http()
      .get('/api/config/entities/IN/coa/export')
      .set(as(preparer))
      .buffer(true)
      .parse(binary);
    expect(res.status).toBe(200);
    const rows = readXlsx(res.body as Buffer);
    expect(rows[0]!.slice(0, 5)).toEqual([
      'Account Code',
      'Account Name',
      'Account Type',
      'Parent Account',
      'FSLI',
    ]);
    expect(rows.some((r) => r[0] === '1010')).toBe(true);
  });
});
