import type {
  CoaMergeSummaryDto,
  FileRefDto,
  RateSaveResultDto,
  TaskDetailDto,
  TbPreviewDto,
  TbVersionDto,
  UploadStepDto,
  WizardPeriodDto,
  WizardOptionsDto,
} from '@finance-close/shared';
import { DEMO_USERS } from '../prisma/seed-demo';
import { SAMPLE_ENTITIES, SAMPLE_RATES } from '../prisma/sample-data';
import {
  chartOfAccountsInFile,
  exchangeRatesFile,
  tbFileName,
  trialBalanceFile,
} from '../prisma/sample-files';
import {
  createTestApp,
  deleteNonDemoTasks,
  ensureSampleTb,
  MASTER,
  type TestContext,
  tokenFor,
} from './helpers';

/**
 * Page 3 — task workspace step 1 "Upload data". Uses the demo tasks (Jul-2026 done; Aug-2026
 * with US, UK, UC finalised) and a Jun-2026 SFS task created here and deleted afterwards.
 */
let ctx: TestContext;
let priya: string;
let master: string;
let junTask: TaskDetailDto;
let augTaskId: string;
let julTaskId: string;
const pw = (email: string) => DEMO_USERS.find((d) => d.email === email)!.password;
const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ALL = ['US', 'IN', 'AE', 'UK', 'UC', 'VS', 'VM'];

const sample = (code: string) => SAMPLE_ENTITIES.find((e) => e.code === code)!;
const upload = (
  token: string,
  taskId: string,
  code: string,
  body: Buffer,
  filename: string,
  kind = 'tb',
) =>
  ctx
    .http()
    .post(`/api/tasks/${taskId}/entities/${code}/${kind}`)
    .set(as(token))
    .attach('file', body, {
      filename,
      contentType: filename.endsWith('.csv') ? 'text/csv' : XLSX_TYPE,
    });
const confirm = (
  token: string,
  taskId: string,
  code: string,
  p: TbPreviewDto,
  acknowledged: string[] = [],
) =>
  ctx
    .http()
    .post(`/api/tasks/${taskId}/entities/${code}/tb/confirm`)
    .set(as(token))
    .send({ fileId: p.fileId, settings: p.settings, acknowledged });
const step = async (token: string, taskId: string) => {
  const res = await ctx.http().get(`/api/tasks/${taskId}/upload-step`).set(as(token));
  expect(res.status).toBe(200);
  return res.body as UploadStepDto;
};

beforeAll(async () => {
  process.env.DEMO_MODE = 'true';
  ctx = await createTestApp();
  await deleteNonDemoTasks(ctx);
  // Accounts added by an earlier run's chart-of-accounts upload would hide the "new accounts".
  await ctx.prisma.entityAccount.deleteMany({
    where: {
      source: { in: ['COA_UPLOAD', 'TASK_MAPPING'] },
      accountCode: { in: ['1455', '6120', '6390', '6150', '1060'] },
    },
  });
  priya = await tokenFor(ctx, 'priya@financeclose.local', pw('priya@financeclose.local'));
  master = await tokenFor(ctx, MASTER.email, MASTER.password);
  // The Aug-2026 demo task holds India's current sample TB (the duplicate-file check uses it).
  const demoAug = await ctx.prisma.task.findUniqueOrThrow({ where: { number: 'SFS-2026-08-001' } });
  await ensureSampleTb(
    ctx,
    priya,
    demoAug.id,
    'IN',
    trialBalanceFile(sample('IN'), 'aug'),
    tbFileName('IN', 'aug'),
  );

  const options = (await ctx.http().get('/api/task-wizard/options').set(as(priya)))
    .body as WizardOptionsDto;
  const fyId = options.financialYears.find((f) => f.label === 'FY 2026-27')!.id;
  const periods = (
    await ctx
      .http()
      .get('/api/task-wizard/periods')
      .query({ type: 'SFS', fyId, periodType: 'MONTHLY' })
      .set(as(priya))
  ).body as WizardPeriodDto[];
  const created = await ctx
    .http()
    .post('/api/tasks')
    .set(as(priya))
    .send({
      type: 'SFS',
      periodId: periods.find((p) => p.label === 'Jun-2026')!.id,
      formatCode: 'STATUTORY',
      description: 'Upload test',
      entityCodes: ALL,
    });
  expect(created.status).toBe(201);
  junTask = created.body as TaskDetailDto;
  augTaskId = (await ctx.prisma.task.findUniqueOrThrow({ where: { number: 'SFS-2026-08-001' } }))
    .id;
  julTaskId = (await ctx.prisma.task.findUniqueOrThrow({ where: { number: 'SFS-2026-07-001' } }))
    .id;
});
afterAll(async () => {
  if (ctx) {
    await deleteNonDemoTasks(ctx);
    await ctx.prisma.entityAccount.deleteMany({
      where: {
        source: { in: ['COA_UPLOAD', 'TASK_MAPPING'] },
        accountCode: { in: ['1455', '6120', '6390', '6150', '1060'] },
      },
    });
  }
  await ctx?.app.close();
});

describe('sample trial balances', () => {
  it.each(
    ALL.flatMap(
      (code) =>
        [
          [code, 'jul'],
          [code, 'aug'],
        ] as const,
    ),
  )('%s %s: detected, balanced, new accounts listed', async (code, month) => {
    const res = await upload(
      priya,
      junTask.id,
      code,
      trialBalanceFile(sample(code), month),
      tbFileName(code, month),
    );
    expect(res.status).toBe(201);
    const p = res.body as TbPreviewDto;
    expect(p.settings).toMatchObject({
      headerRow: 5,
      codeColumn: 0,
      nameColumn: 1,
      balanceColumn: 3,
      signConvention: 'DEBIT_POSITIVE',
    });
    expect(p.check!.balanced).toBe(true);
    expect(p.check!.errors).toEqual([]);
    expect(p.check!.totals.difference).toBe('0.00');
    expect(p.preview).toHaveLength(10);
    const expected =
      month === 'aug' ? (({ IN: ['1455', '6120'] } as Record<string, string[]>)[code] ?? []) : [];
    expect(p.check!.newAccounts.map((a) => a.code).sort()).toEqual(expected);
    // The files are for Jul/Aug; this task is Jun-2026.
    expect(p.check!.needsAcknowledgement.map((w) => w.code)).toEqual(['PERIOD_MISMATCH']);
  });

  it('the Aug-26 IN file shows "2 accounts are not in the chart of accounts"', async () => {
    const p = (
      await upload(
        priya,
        junTask.id,
        'IN',
        trialBalanceFile(sample('IN'), 'aug'),
        tbFileName('IN', 'aug'),
      )
    ).body as TbPreviewDto;
    expect(p.check!.info.find((i) => i.code === 'NEW_ACCOUNTS')!.message).toMatch(
      /^2 accounts are not in the chart of accounts and will need mapping in the next step: 1455 Advance to Suppliers, 6120 Staff Welfare Expenses/,
    );
    // The same file is already in the Aug-2026 demo task for IN (another period).
    expect(p.check!.warnings.find((w) => w.code === 'DUPLICATE_FILE')!.message).toMatch(
      /IN · Aug-2026/,
    );
  });
});

describe('confirming a trial balance', () => {
  it('requires the period warning to be acknowledged, then saves version 1 and starts the entity', async () => {
    const p = (
      await upload(
        priya,
        junTask.id,
        'VS',
        trialBalanceFile(sample('VS'), 'jul'),
        tbFileName('VS', 'jul'),
      )
    ).body as TbPreviewDto;
    const refused = await confirm(priya, junTask.id, 'VS', p);
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('ACKNOWLEDGEMENT_REQUIRED');

    const ok = await confirm(priya, junTask.id, 'VS', p, ['PERIOD_MISMATCH']);
    expect(ok.status).toBe(201);
    const v = ok.body as TbVersionDto;
    expect(v).toMatchObject({
      version: 1,
      status: 'VALIDATED_WITH_WARNINGS',
      acknowledged: ['PERIOD_MISMATCH'],
      lineCount: 29,
    });
    expect(await ctx.prisma.tbLine.count({ where: { tbVersionId: v.id } })).toBe(29);
    const te = await ctx.prisma.taskEntity.findUniqueOrThrow({
      where: { taskId_entityCode: { taskId: junTask.id, entityCode: 'VS' } },
    });
    expect(te.status).toBe('IN_PROGRESS');
    const audit = await ctx.prisma.auditLog.findMany({ where: { entityId: v.id } });
    expect(audit.map((a) => a.action).sort()).toEqual(['TB_UPLOAD', 'TB_WARNING_ACKNOWLEDGE']);

    const s = await step(priya, junTask.id);
    const card = s.entities.find((e) => e.code === 'VS')!;
    expect(card).toMatchObject({
      uploadStatus: 'VALIDATED_WITH_WARNINGS',
      itemStatus: 'IN_PROGRESS',
      canEdit: true,
    });
    expect(card.tb.latest!.file.name).toBe('Trial_Balance_VS_Jul-26.xlsx');
  });

  it('saves an unbalanced trial balance as Error and shows the difference', async () => {
    const e = sample('IN');
    // Receivables (1100) increased by 1,000.00 without a matching entry.
    const broken = {
      ...e,
      accounts: e.accounts.map((a) =>
        a.code === '1100' ? { ...a, aug: (Number(a.aug) + 1000).toFixed(2) } : a,
      ),
    };
    const p = (
      await upload(
        priya,
        junTask.id,
        'IN',
        trialBalanceFile(broken, 'aug'),
        'Trial_Balance_IN_Aug-26.xlsx',
      )
    ).body as TbPreviewDto;
    expect(p.check!.balanced).toBe(false);
    expect(p.check!.status).toBe('ERROR');
    expect(p.check!.totals.difference).toBe('1000.00');
    const v = (await confirm(priya, junTask.id, 'IN', p, ['PERIOD_MISMATCH'])).body as TbVersionDto;
    expect(v.status).toBe('ERROR');
    expect(v.errors.at(-1)!.code).toBe('UNBALANCED');
    const card = (await step(priya, junTask.id)).entities.find((c) => c.code === 'IN')!;
    expect(card.uploadStatus).toBe('ERROR');
  });

  it('replacing keeps earlier versions', async () => {
    const p = (
      await upload(
        priya,
        junTask.id,
        'IN',
        trialBalanceFile(sample('IN'), 'aug'),
        tbFileName('IN', 'aug'),
      )
    ).body as TbPreviewDto;
    // The column settings are remembered for the entity.
    expect(p.settingsSource).toBe('PROFILE');
    expect((await confirm(priya, junTask.id, 'IN', p, ['PERIOD_MISMATCH'])).status).toBe(201);
    const versions = (
      await ctx.http().get(`/api/tasks/${junTask.id}/entities/IN/tb/versions`).set(as(priya))
    ).body as TbVersionDto[];
    expect(versions.map((v) => [v.version, v.status])).toEqual([
      [2, 'VALIDATED_WITH_WARNINGS'],
      [1, 'ERROR'],
    ]);
  });

  it('reads separate debit and credit columns from CSV, re-parses with edited settings', async () => {
    const csv = [
      'Aistra Labs UK Ltd',
      'Trial Balance',
      'As of 30/06/2026',
      '',
      'Account Code,Account Name,Debit,Credit',
      '1001,Barclays Business Account,"1,250.50",',
      '2001,Accounts Payable,,(250.50)',
      '3001,Equity Share Capital,,"1,000.00"',
      ',Total,"1,250.50","1,250.50"',
    ].join('\n');
    const res = await upload(priya, junTask.id, 'UK', Buffer.from(csv), 'uk.csv');
    const p = res.body as TbPreviewDto;
    expect(p.settings).toMatchObject({
      signConvention: 'SEPARATE_COLUMNS',
      debitColumn: 2,
      creditColumn: 3,
    });
    expect(p.check).toMatchObject({
      balanced: true,
      status: 'VALIDATED',
      needsAcknowledgement: [],
    });
    expect(p.preview.map((l) => l.amount)).toEqual(['1250.5', '-250.5', '-1000']);

    // Treat column C as a single signed balance instead: now it does not balance.
    const edited = await ctx
      .http()
      .post(`/api/tasks/${junTask.id}/entities/UK/tb/preview`)
      .set(as(priya))
      .send({
        fileId: p.fileId,
        settings: { ...p.settings, signConvention: 'DEBIT_POSITIVE', balanceColumn: 2 },
      });
    expect(edited.status).toBe(201);
    expect((edited.body as TbPreviewDto).check!.balanced).toBe(false);
  });

  it('rejects files that are not spreadsheets', async () => {
    const res = await upload(priya, junTask.id, 'UK', Buffer.from('%PDF-1.4'), 'tb.pdf');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_REJECTED');
  });
});

describe('access rules', () => {
  it('a finalised entity is read-only (409) and a Done task is locked (409)', async () => {
    const us = await upload(
      priya,
      augTaskId,
      'US',
      trialBalanceFile(sample('US'), 'aug'),
      tbFileName('US', 'aug'),
    );
    expect(us.status).toBe(409);
    expect(us.body.code).toBe('ENTITY_FINALISED');
    const jul = await upload(
      priya,
      julTaskId,
      'IN',
      trialBalanceFile(sample('IN'), 'jul'),
      tbFileName('IN', 'jul'),
    );
    expect(jul.status).toBe(409);
    expect(jul.body.code).toBe('TASK_LOCKED');
  });

  it('a preparer outside the entity scope gets 403; a viewer cannot upload', async () => {
    const res = await ctx
      .http()
      .post('/api/users')
      .set(as(master))
      .send({
        name: 'India-only preparer',
        email: `india.${Date.now()}@test.local`,
        temporaryPassword: 'Temporary123',
        templateCode: 'PREPARER',
        permissions: ['SFS_PREPARE', 'REPORTS_VIEW'],
        entityScope: ['IN'],
      });
    expect(res.status).toBe(201);
    const temp = await tokenFor(ctx, res.body.email, 'Temporary123');
    const changed = await ctx
      .http()
      .post('/api/auth/change-password')
      .set(as(temp))
      .send({ currentPassword: 'Temporary123', newPassword: 'NewPassword456' });
    const india = changed.body.accessToken as string;
    const uk = await upload(
      india,
      junTask.id,
      'UK',
      trialBalanceFile(sample('UK'), 'aug'),
      tbFileName('UK', 'aug'),
    );
    expect(uk.status).toBe(403);
    // They only see their own entity's card.
    expect((await step(india, junTask.id)).entities.map((e) => e.code)).toEqual(['IN']);

    const viewer = await tokenFor(
      ctx,
      'viewer@financeclose.local',
      pw('viewer@financeclose.local'),
    );
    expect((await step(viewer, junTask.id)).entities.every((e) => !e.canEdit)).toBe(true);
    const denied = await upload(
      viewer,
      junTask.id,
      'IN',
      trialBalanceFile(sample('IN'), 'aug'),
      tbFileName('IN', 'aug'),
    );
    expect(denied.status).toBe(403);
  });
});

describe('Aug-2026 demo task', () => {
  it('shows 5 of 7 validated, rates complete and locked, and finalised cards read-only', async () => {
    const s = await step(priya, augTaskId);
    expect(s.summary.text).toBe('5 of 7 entities validated · rates complete for Aug-2026');
    expect(s.rates.currencies).toEqual(['INR', 'AED', 'GBP', 'SGD', 'LKR']);
    expect(s.rates.months).toEqual([
      expect.objectContaining({ month: '2026-08-01', label: 'Aug-2026', locked: true }),
    ]);
    expect(s.rates.sourceLabel).toBe('To be confirmed – Open question 2');
    expect(s.entities.map((e) => [e.code, e.uploadStatus, e.canEdit])).toEqual([
      ['US', 'VALIDATED', false],
      ['IN', 'VALIDATED', true],
      ['AE', 'VALIDATED', true],
      ['UK', 'VALIDATED', false],
      ['UC', 'VALIDATED', false],
      ['VS', 'PENDING', true],
      ['VM', 'PENDING', true],
    ]);
    expect(s.entities.find((e) => e.code === 'IN')!.tb.latest!.newAccounts).toHaveLength(2);
    expect(s.entities.find((e) => e.code === 'UK')!.tb.latest!.newAccounts).toHaveLength(1);
    expect(s.canContinue).toBe(true);
  });
});

describe('exchange rates', () => {
  const junInr = { month: '2026-06-01', currency: 'INR' };
  const put = (rates: object[]) =>
    ctx.http().put('/api/exchange-rates').set(as(priya)).send({ rates });

  it('flags a move of more than 10% and opening ≠ prior closing, then restores', async () => {
    const before = await ctx.prisma.exchangeRate.findUniqueOrThrow({
      where: { month_currencyCode: { month: new Date('2026-06-01'), currencyCode: 'INR' } },
    });
    const res = await put([{ ...junInr, opening: '83.4', closing: '93.9', average: null }]);
    expect(res.status).toBe(200);
    const r = res.body as RateSaveResultDto;
    expect(r.changed).toBe(1);
    expect(r.warnings.map((w) => w.code)).toEqual(['OPENING_NOT_PRIOR_CLOSING', 'LARGE_MOVE']);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'RATES_UPDATE' },
      orderBy: { id: 'desc' },
    });
    expect(audit!.oldValue).toEqual([
      expect.objectContaining({ closing: before.closing!.toString() }),
    ]);
    const restore = await put([
      {
        ...junInr,
        opening: before.opening!.toString(),
        closing: before.closing!.toString(),
        average: before.average!.toString(),
      },
    ]);
    expect(restore.body.changed).toBe(1);
  });

  it('refuses to change a locked month (409), but accepts the same values again', async () => {
    // Start from the sample rates (an earlier run may have left manual edits in the test DB).
    for (const r of SAMPLE_RATES) {
      await ctx.prisma.exchangeRate.updateMany({
        where: { month: new Date(r.month), currencyCode: r.currency },
        data: { opening: r.opening, closing: r.closing, average: r.average },
      });
    }
    const locked = await put([
      { month: '2026-08-01', currency: 'INR', opening: '83.9', closing: '85', average: '84.01' },
    ]);
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('RATES_LOCKED');
    const file = await ctx
      .http()
      .post('/api/exchange-rates/upload')
      .set(as(priya))
      .attach('file', exchangeRatesFile(), {
        filename: 'Exchange_Rates_per_USD_sample.xlsx',
        contentType: XLSX_TYPE,
      });
    expect(file.status).toBe(201);
    expect(file.body).toMatchObject({ changed: 0, unchanged: 25 });
  });

  it('rejects invalid rates', async () => {
    const res = await put([{ ...junInr, opening: 'abc', closing: null, average: null }]);
    expect(res.status).toBe(400);
  });
});

describe('chart of accounts and documents', () => {
  it('merges the IN chart of accounts: new codes get the type default, existing FSLIs are untouched', async () => {
    const before = await ctx.prisma.entityAccount.findUniqueOrThrow({
      where: { entityCode_accountCode: { entityCode: 'IN', accountCode: '1450' } },
    });
    const res = await upload(
      priya,
      junTask.id,
      'IN',
      chartOfAccountsInFile(),
      'Chart_of_Accounts_IN_sample.xlsx',
      'coa',
    );
    expect(res.status).toBe(201);
    const s = res.body as CoaMergeSummaryDto;
    expect(s).toMatchObject({ added: 4, updated: 0, unchanged: 46 });
    expect(s.addedAccounts.map((a) => [a.code, a.fsliCode]).sort()).toEqual([
      ['1060', 'CASH'],
      ['1455', 'CUR_OTH'],
      ['6120', 'OTH_EXP'],
      ['6150', 'OTH_EXP'],
    ]);
    const after = await ctx.prisma.entityAccount.findUniqueOrThrow({
      where: { entityCode_accountCode: { entityCode: 'IN', accountCode: '1450' } },
    });
    expect([after.fsliCode, after.counterpartyCode]).toEqual([
      before.fsliCode,
      before.counterpartyCode,
    ]);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'COA_UPLOAD', entityId: 'IN' } }),
    ).toBeGreaterThan(0);
  });

  it('stores other documents and serves the original bytes', async () => {
    const res = await upload(
      priya,
      junTask.id,
      'AE',
      Buffer.from('bank letter'),
      'Bank confirmation.txt',
      'documents',
    );
    expect(res.status).toBe(201);
    const f = res.body as FileRefDto;
    const list = await ctx
      .http()
      .get(`/api/tasks/${junTask.id}/entities/AE/files`)
      .query({ kind: 'OTHER' })
      .set(as(priya));
    expect((list.body as FileRefDto[]).map((x) => x.name)).toEqual(['Bank confirmation.txt']);
    const dl = await ctx
      .http()
      .get(`/api/files/${f.id}/download`)
      .set(as(priya))
      .responseType('blob');
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toContain('Bank%20confirmation.txt');
    expect(Buffer.from(dl.body as Buffer).toString()).toBe('bank letter');
  });
});

describe('continue', () => {
  it('moves validated entities to Mapping and leaves the others on this step', async () => {
    const res = await ctx.http().post(`/api/tasks/${junTask.id}/continue`).set(as(priya));
    expect(res.status).toBe(201);
    expect((res.body as { moved: string[] }).moved.sort()).toEqual(['IN', 'VS']);
    const rows = await ctx.prisma.taskEntity.findMany({ where: { taskId: junTask.id } });
    expect(
      rows
        .filter((r) => r.currentStep === 'MAPPING')
        .map((r) => r.entityCode)
        .sort(),
    ).toEqual(['IN', 'VS']);
    expect(
      (await ctx.prisma.task.findUniqueOrThrow({ where: { id: junTask.id } })).currentStep,
    ).toBe('MAPPING');
  });
});
