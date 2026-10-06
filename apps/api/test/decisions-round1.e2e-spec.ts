import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type {
  AcquisitionsDto,
  AcquisitionUploadPreviewDto,
  ApprovalsDto,
  EditAccessRequestDto,
  FinancialYearDto,
  HolidayCalendarsDto,
  HolidayDto,
  ReviewPackDto,
  SigningDetailsDto,
  StatutoryDetailsDto,
  TaskDetailDto,
  TbPreviewDto,
  TbVersionDto,
  WizardOptionsDto,
  WizardPeriodDto,
} from '@finance-close/shared';
import { DEMO_USERS } from '../prisma/seed-demo';
import { createTestApp, deleteNonDemoTasks, MASTER, type TestContext, tokenFor } from './helpers';

/**
 * Decisions round 1 (API): approval defaults by period type, edit-access segregation of duties,
 * the acquisitions template, statutory and signing details, holiday calendars, year-to-date
 * trial balances and the quarterly checks against months. Logic only (demo data not verified).
 */
let ctx: TestContext;
let priya: string;
let rahul: string;
let master: string;
let masterId: string;
let augTaskId: string;
let julTaskId: string;
const pw = (e: string) => DEMO_USERS.find((d) => d.email === e)!.password;
const as = (t: string) => ({ Authorization: `Bearer ${t}` });
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const binary = (r: import('superagent').Response, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  r.on('data', (c: Buffer) => chunks.push(c));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};

beforeAll(async () => {
  process.env.DEMO_MODE = 'true';
  ctx = await createTestApp();
  await deleteNonDemoTasks(ctx);
  priya = await tokenFor(ctx, 'priya@financeclose.local', pw('priya@financeclose.local'));
  rahul = await tokenFor(ctx, 'rahul@financeclose.local', pw('rahul@financeclose.local'));
  master = await tokenFor(ctx, MASTER.email, MASTER.password);
  masterId = (await ctx.prisma.user.findFirstOrThrow({ where: { isMaster: true } })).id;
  augTaskId = (await ctx.prisma.task.findUniqueOrThrow({ where: { number: 'SFS-2026-08-001' } }))
    .id;
  julTaskId = (await ctx.prisma.task.findUniqueOrThrow({ where: { number: 'SFS-2026-07-001' } }))
    .id;
});
afterAll(async () => {
  if (ctx) {
    await deleteNonDemoTasks(ctx);
    await ctx.prisma.uploadProfile.updateMany({
      where: { entityCode: 'UK' },
      data: { plBasis: 'PERIOD' },
    });
    await ctx.prisma.entityAccount.deleteMany({
      where: { entityCode: 'UK', accountCode: 'YTD-PRIOR' },
    });
  }
  await ctx?.app.close();
});

async function createTask(
  type: 'MONTHLY' | 'QUARTERLY',
  pick: (p: WizardPeriodDto) => boolean,
  entityCodes: string[],
) {
  const options = (await ctx.http().get('/api/task-wizard/options').set(as(priya)))
    .body as WizardOptionsDto;
  const fyId = options.financialYears.find((f) => f.label === 'FY 2026-27')!.id;
  const periods = (
    await ctx
      .http()
      .get('/api/task-wizard/periods')
      .query({ type: 'SFS', fyId, periodType: type })
      .set(as(priya))
  ).body as WizardPeriodDto[];
  const period = periods.find(pick);
  expect(period).toBeDefined();
  const res = await ctx.http().post('/api/tasks').set(as(priya)).send({
    type: 'SFS',
    periodId: period!.id,
    formatCode: 'STATUTORY',
    description: 'Round 1 test',
    entityCodes,
  });
  expect(res.status).toBe(201);
  return res.body as TaskDetailDto;
}

describe('approval defaults (Q6)', () => {
  it('seeds Quarterly / Annual SFS and the Level 4 parent (US) at two levels; monthly stays one', async () => {
    const d = (await ctx.http().get('/api/config/approvals').set(as(master))).body as ApprovalsDto;
    const pick = (st: string, e: string | null, p: string | null) =>
      d.rules.find((r) => r.statementType === st && r.entityCode === e && r.periodType === p)
        ?.reviewLevels;
    expect([
      pick('SFS', null, null),
      pick('SFS', null, 'QUARTERLY'),
      pick('SFS', null, 'ANNUAL'),
      pick('CFS', null, null),
      pick('CFS', 'US', null),
    ]).toEqual([1, 2, 2, 1, 2]);
    expect(d.segregation.some((s) => /edit-access request/.test(s))).toBe(true);
  });
});

describe('edit access: segregation of duties (Q6)', () => {
  it('nobody decides their own request, nor one for an entity they last edited', async () => {
    const te = await ctx.prisma.taskEntity.findFirstOrThrow({
      where: { taskId: julTaskId, entityCode: 'UK' },
    });
    const priyaId = (
      await ctx.prisma.user.findFirstOrThrow({ where: { email: 'priya@financeclose.local' } })
    ).id;
    const own = await ctx.prisma.editAccessRequest.create({
      data: {
        taskId: julTaskId,
        entityCode: 'UK',
        reason: 'Round 1 test: own request.',
        requestedById: masterId,
      },
    });
    const other = await ctx.prisma.editAccessRequest.create({
      data: {
        taskId: julTaskId,
        entityCode: 'UK',
        reason: 'Round 1 test: last editor.',
        requestedById: priyaId,
      },
    });
    try {
      const a = await ctx
        .http()
        .post(`/api/edit-access-requests/${own.id}/decide`)
        .set(as(master))
        .send({ approve: false, comment: 'Not needed.' });
      expect([a.status, a.body.message]).toEqual([403, 'You cannot decide your own request.']);

      await ctx.prisma.taskEntity.update({
        where: { taskId_entityCode: { taskId: julTaskId, entityCode: 'UK' } },
        data: { lastEditedById: masterId },
      });
      const list = (await ctx.http().get('/api/edit-access-requests').set(as(master)))
        .body as EditAccessRequestDto[];
      const row = list.find((r) => r.id === other.id)!;
      expect(row.canDecide).toBe(false);
      expect(row.cannotDecideReason).toMatch(/You last edited UK in this task/);
      const b = await ctx
        .http()
        .post(`/api/edit-access-requests/${other.id}/decide`)
        .set(as(master))
        .send({ approve: false, comment: 'Not needed.' });
      expect(b.status).toBe(403);
      expect(b.body.message).toMatch(/You last edited UK/);

      // Not the last editor any more: the master may decide (reject here, nothing reopens).
      await ctx.prisma.taskEntity.update({
        where: { taskId_entityCode: { taskId: julTaskId, entityCode: 'UK' } },
        data: { lastEditedById: te.lastEditedById },
      });
      const c = await ctx
        .http()
        .post(`/api/edit-access-requests/${other.id}/decide`)
        .set(as(master))
        .send({ approve: false, comment: 'Not needed.' });
      expect(c.status).toBe(201);
    } finally {
      await ctx.prisma.taskEntity.update({
        where: { taskId_entityCode: { taskId: julTaskId, entityCode: 'UK' } },
        data: { lastEditedById: te.lastEditedById },
      });
      await ctx.prisma.editAccessRequest.deleteMany({ where: { id: { in: [own.id, other.id] } } });
    }
  });
});

describe('acquisitions template (Q3) and NCI measurement (Q8)', () => {
  const upload = (body: Buffer, confirm = false) =>
    ctx
      .http()
      .post(`/api/config/acquisitions/upload${confirm ? '?confirm=true' : ''}`)
      .set(as(master))
      .attach('file', body, { filename: 'acquisitions.xlsx', contentType: XLSX });

  it('downloads the register as a template; uploading it back changes nothing', async () => {
    const res = await ctx
      .http()
      .get('/api/config/acquisitions/template')
      .set(as(master))
      .buffer(true)
      .parse(binary);
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as never);
    const ws = wb.getWorksheet('Acquisitions')!;
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    expect(header.slice(0, 13)).toEqual([
      'Subsidiary',
      'Parent',
      'Acquired on',
      '% acquired',
      'Cost',
      'Share capital',
      'Securities premium',
      'Pre-acquisition reserves',
      'NCI measurement',
      'NCI fair value',
      'To be confirmed',
      'Rates to be confirmed',
      'Note',
    ]);
    expect(header.slice(13).every((h) => /^Rate [A-Z]{3}$/.test(String(h)))).toBe(true);
    const p = (await upload(res.body as Buffer)).body as AcquisitionUploadPreviewDto;
    expect(p.problems).toEqual([]);
    expect(
      p.rows.filter((r) => r.action !== 'UNCHANGED').map((r) => [r.row, r.action, r.problems]),
    ).toEqual([]);
    expect(p.canSave).toBe(true);
  });

  it('previews errors without saving; a valid new row saves on confirm (fair value NCI)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Acquisitions');
    ws.addRow([
      'Subsidiary',
      'Parent',
      'Acquired on',
      '% acquired',
      'Cost',
      'Share capital',
      'Securities premium',
      'Pre-acquisition reserves',
      'NCI measurement',
      'NCI fair value',
      'To be confirmed',
      'Rates to be confirmed',
      'Note',
      'Rate INR',
    ]);
    ws.addRow([
      'UK',
      'IN',
      '2019-01-15',
      '80',
      '1000',
      '500',
      '0',
      '100',
      'Fair value',
      '',
      'Y',
      'Y',
      'Round 1 test',
      '90',
    ]);
    ws.addRow(['ZZ', 'IN', 'not a date', '120', '', '1', '', '', '', '', '', '', '', '']);
    const bad = Buffer.from(await wb.xlsx.writeBuffer());
    const p = (await upload(bad)).body as AcquisitionUploadPreviewDto;
    expect(p.canSave).toBe(false);
    expect(p.rows[0]!.problems).toEqual([
      'NCI fair value: required when NCI is measured at fair value.',
    ]);
    expect(p.rows[1]!.problems).toEqual([
      'Acquired on: a date (YYYY-MM-DD).',
      '% acquired: more than 0 and at most 100.',
      'Cost: required.',
    ]);
    expect((await upload(bad, true)).status).toBe(400);
    expect(await ctx.prisma.acquisition.count({ where: { note: 'Round 1 test' } })).toBe(0);

    ws.spliceRows(3, 1);
    ws.getCell('J2').value = 260;
    const good = Buffer.from(await wb.xlsx.writeBuffer());
    const q = (await upload(good)).body as AcquisitionUploadPreviewDto;
    expect(q.rows.map((r) => [r.action, r.nciMeasurement, r.nciFairValue, r.rates])).toEqual([
      ['CREATE', 'FAIR_VALUE', '260', ['INR 90']],
    ]);
    const saved = await upload(good, true);
    expect([saved.status, (saved.body as AcquisitionUploadPreviewDto).saved]).toEqual([201, true]);
    const list = (await ctx.http().get('/api/config/acquisitions').set(as(master)))
      .body as AcquisitionsDto;
    const row = list.acquisitions.find((a) => a.note === 'Round 1 test')!;
    expect(row).toMatchObject({
      subsidiaryCode: 'UK',
      pctAcquired: '80',
      nciMeasurement: 'FAIR_VALUE',
      nciFairValue: '260.00',
      toBeConfirmed: true,
    });
    expect(
      await ctx.prisma.auditLog.count({ where: { entityType: 'ACQUISITION', entityId: row.id } }),
    ).toBe(1);
    expect(
      (await ctx.http().delete(`/api/config/acquisitions/${row.id}`).set(as(master))).status,
    ).toBe(204);
  });

  it('a fair-value acquisition needs the fair value; the seeded IN row carries an illustrative one', async () => {
    const list = (await ctx.http().get('/api/config/acquisitions').set(as(master)))
      .body as AcquisitionsDto;
    const inRow = list.acquisitions.find((a) => a.subsidiaryCode === 'IN')!;
    expect(inRow.nciFairValue).not.toBeNull();
    expect(inRow.nciMeasurement).toBeNull();
    const res = await ctx.http().post('/api/config/acquisitions').set(as(master)).send({
      subsidiaryCode: 'UK',
      parentCode: 'IN',
      acquiredOn: '2019-01-15',
      pctAcquired: '80',
      cost: '1',
      shareCapital: '1',
      premium: '0',
      preAcquisitionReserves: '0',
      nciMeasurement: 'FAIR_VALUE',
      nciFairValue: null,
      toBeConfirmed: true,
      note: null,
      rates: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/NCI fair value/);
  });
});

describe('statutory and signing details (Q9)', () => {
  afterAll(async () => {
    await ctx.prisma.signingDetails.deleteMany({ where: { taskId: augTaskId, key: 'IN' } });
    await ctx.prisma.statutoryDetails.deleteMany({ where: { entityCode: 'IN' } });
  });

  it('signs with the officers in office on the board approval date', async () => {
    const put = await ctx
      .http()
      .put('/api/config/entities/IN/statutory')
      .set(as(master))
      .send({
        registeredOffice: 'Pune, India',
        registrationNo: 'U72900PN2020PTC000000',
        officers: [
          {
            name: 'Former Director',
            designation: 'Director',
            identifier: 'DIN 00000001',
            effectiveFrom: '2020-01-01',
            effectiveTo: '2026-06-30',
          },
          {
            name: 'Asha Rao',
            designation: 'Director',
            identifier: 'DIN 00000002',
            effectiveFrom: '2026-07-01',
            effectiveTo: null,
          },
          {
            name: 'Vikram Shah',
            designation: 'Chief Financial Officer',
            identifier: null,
            effectiveFrom: '2024-04-01',
            effectiveTo: null,
          },
        ],
      });
    expect(put.status).toBe(200);
    expect((put.body as StatutoryDetailsDto).officers).toHaveLength(3);
    expect(
      await ctx.prisma.auditLog.count({
        where: { entityType: 'STATUTORY_DETAILS', entityId: 'IN' },
      }),
    ).toBeGreaterThan(0);
    // Viewers may read, not change.
    expect(
      (
        await ctx
          .http()
          .put('/api/config/entities/IN/statutory')
          .set(as(priya))
          .send({ registeredOffice: null, registrationNo: null, officers: [] })
      ).status,
    ).toBe(403);

    const s = await ctx
      .http()
      .put(`/api/tasks/${augTaskId}/signing/IN`)
      .set(as(priya))
      .send({ boardApprovalDate: '2026-09-15', place: 'Pune' });
    expect(s.status).toBe(200);
    const d = s.body as SigningDetailsDto;
    expect(d).toMatchObject({
      boardApprovalDate: '2026-09-15',
      place: 'Pune',
      officersConfigured: true,
    });
    expect(d.signatories.map((x) => x.name)).toEqual(['Asha Rao', 'Vikram Shah']);

    const doc = await ctx
      .http()
      .get(`/api/tasks/${augTaskId}/entities/IN/notes/export`)
      .query({ type: 'docx' })
      .set(as(priya))
      .buffer(true)
      .parse(binary);
    expect(doc.status).toBe(200);
    const xml = await (
      await JSZip.loadAsync(doc.body as Buffer)
    )
      .file('word/document.xml')!
      .async('string');
    expect(xml).toContain('Asha Rao (DIN 00000002)');
    expect(xml).toContain('15/09/2026');
    expect(xml).toContain('Place: Pune');
    expect(xml).not.toContain('Former Director');
  });

  it('a done task is locked; short places are refused', async () => {
    expect(
      (
        await ctx
          .http()
          .put(`/api/tasks/${julTaskId}/signing/IN`)
          .set(as(priya))
          .send({ boardApprovalDate: '2026-08-15', place: 'Pune' })
      ).status,
    ).toBe(409);
    expect(
      (
        await ctx
          .http()
          .put(`/api/tasks/${augTaskId}/signing/IN`)
          .set(as(priya))
          .send({ boardApprovalDate: '2026-08-15', place: 'P' })
      ).status,
    ).toBe(400);
  });
});

describe('holiday calendars (Q4)', () => {
  it('off by default; switched on, an entity with a country calendar gets its own SFS due date', async () => {
    const before = (await ctx.http().get('/api/config/holiday-calendars').set(as(master)))
      .body as HolidayCalendarsDto;
    expect(before.perEntity).toBe(false);
    const h = await ctx
      .http()
      .post('/api/config/holidays')
      .set(as(master))
      .send({ date: '2026-09-01', description: 'UK holiday (test)', calendar: 'UK' });
    expect(h.status).toBe(201);
    const holiday = h.body as HolidayDto;
    try {
      const on = await ctx
        .http()
        .put('/api/config/holiday-calendars')
        .set(as(master))
        .send({ perEntity: true, entities: [{ code: 'UK', holidayCalendar: 'UK' }] });
      expect(on.status).toBe(200);
      const fys = (await ctx.http().get('/api/config/financial-years').set(as(master)))
        .body as FinancialYearDto[];
      const jul = fys
        .flatMap(
          (f) =>
            (
              f as unknown as {
                periods: {
                  label: string;
                  dueDates: { statementType: string; calculated: string }[];
                  entityDueDates: { entityCode: string; calendar: string; calculated: string }[];
                }[];
              }
            ).periods,
        )
        .find((p) => p.label === 'Aug-2026')!;
      const group = jul.dueDates.find((x) => x.statementType === 'SFS')!.calculated;
      const uk = jul.entityDueDates.find((x) => x.entityCode === 'UK')!;
      expect(uk.calendar).toBe('UK');
      // The UK holiday on 1 Sep pushes the UK date one working day later than the group's.
      expect(uk.calculated > group).toBe(true);
    } finally {
      await ctx
        .http()
        .put('/api/config/holiday-calendars')
        .set(as(master))
        .send({ perEntity: false, entities: [{ code: 'UK', holidayCalendar: null }] });
      await ctx.http().delete(`/api/config/holidays/${holiday.id}`).set(as(master));
    }
  });
});

describe('year-to-date trial balances (Q10a)', () => {
  let codes: { cash: string; capital: string; revenue: string; expense: string };
  const csv = (rows: [string, string, string, string][]) =>
    Buffer.from(
      ['Account Code,Account Name,Debit,Credit', ...rows.map((r) => r.join(','))].join('\n'),
    );
  const send = async (taskId: string, body: Buffer) => {
    const up = await ctx
      .http()
      .post(`/api/tasks/${taskId}/entities/UK/tb`)
      .set(as(priya))
      .attach('file', body, { filename: 'uk-ytd.csv', contentType: 'text/csv' });
    expect(up.status).toBe(201);
    return up.body as TbPreviewDto;
  };

  beforeAll(async () => {
    const acc = await ctx.prisma.entityAccount.findMany({
      where: { entityCode: 'UK', fsliCode: { not: null } },
      orderBy: { accountCode: 'asc' },
    });
    const of = (f: string) => acc.find((a) => a.fsliCode === f)!.accountCode;
    codes = {
      cash: of('CASH'),
      capital: of('SHARE_CAP'),
      revenue: of('REV_OPS'),
      expense: of('OTH_EXP'),
    };
  });

  it('April is YTD as is; May is converted with April; a missing previous YTD TB blocks', async () => {
    const apr = await createTask('MONTHLY', (p) => p.label === 'Apr-2026', ['UK']);
    const set = await ctx
      .http()
      .put(`/api/tasks/${apr.id}/entities/UK/upload-profile`)
      .set(as(priya))
      .send({ plBasis: 'YTD' });
    expect(set.status).toBe(200);
    const may = await createTask('MONTHLY', (p) => p.label === 'May-2026', ['UK']);
    const jun = await createTask('MONTHLY', (p) => p.label === 'Jun-2026', ['UK']);
    const c = codes;

    // June before May: the May YTD TB is missing → error, cannot be confirmed as valid.
    const early = await send(
      jun.id,
      csv([
        [c.cash, 'Cash', '1500', ''],
        [c.capital, 'Capital', '', '600'],
        [c.revenue, 'Revenue', '', '1200'],
        [c.expense, 'Other', '300', ''],
      ]),
    );
    expect(early.check!.status).toBe('ERROR');
    expect(early.check!.errors.map((e) => e.message)).toEqual([
      "This trial balance is year-to-date: upload the May-2026 YTD trial balance first (the period P&L is this TB's YTD P&L less May-2026's).",
    ]);

    const a = await send(
      apr.id,
      csv([
        [c.cash, 'Cash', '1000', ''],
        [c.capital, 'Capital', '', '600'],
        [c.revenue, 'Revenue', '', '500'],
        [c.expense, 'Other', '100', ''],
      ]),
    );
    expect(a.check!.status).not.toBe('ERROR');
    const ca = await ctx
      .http()
      .post(`/api/tasks/${apr.id}/entities/UK/tb/confirm`)
      .set(as(priya))
      .send({
        fileId: a.fileId,
        settings: a.settings,
        acknowledged: a.check!.needsAcknowledgement.map((w) => w.code),
      });
    expect(ca.status).toBe(201);
    const aprLines = await ctx.prisma.tbLine.findMany({
      where: { tbVersionId: (ca.body as TbVersionDto).id },
      orderBy: { accountCode: 'asc' },
    });
    expect(
      aprLines.map((l) => [l.accountCode, l.amount.toFixed(2), l.ytdAmount?.toFixed(2) ?? null]),
    ).toEqual(
      [
        [c.cash, '1000.00', null],
        [c.capital, '-600.00', null],
        [c.revenue, '-500.00', '-500.00'],
        [c.expense, '100.00', '100.00'],
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );

    const m = await send(
      may.id,
      csv([
        [c.cash, 'Cash', '1500', ''],
        [c.capital, 'Capital', '', '600'],
        [c.revenue, 'Revenue', '', '1200'],
        [c.expense, 'Other', '300', ''],
      ]),
    );
    expect(m.check!.status).not.toBe('ERROR');
    expect(m.check!.info.some((i) => i.code === 'YTD_CONVERTED')).toBe(true);
    expect(m.check!.newAccounts.map((x) => x.code)).not.toContain('YTD-PRIOR');
    const cm = await ctx
      .http()
      .post(`/api/tasks/${may.id}/entities/UK/tb/confirm`)
      .set(as(priya))
      .send({
        fileId: m.fileId,
        settings: m.settings,
        acknowledged: m.check!.needsAcknowledgement.map((w) => w.code),
      });
    expect(cm.status).toBe(201);
    const mayLines = await ctx.prisma.tbLine.findMany({
      where: { tbVersionId: (cm.body as TbVersionDto).id },
    });
    const amt = (code: string) => mayLines.find((l) => l.accountCode === code)!.amount.toFixed(2);
    // Period P&L = YTD May − YTD April; balance sheet as uploaded; earlier months' profit in YTD-PRIOR.
    expect([amt(c.cash), amt(c.capital), amt(c.revenue), amt(c.expense), amt('YTD-PRIOR')]).toEqual(
      ['1500.00', '-600.00', '-700.00', '200.00', '-400.00'],
    );
    expect(mayLines.reduce((s, l) => s + Number(l.amount.toFixed(2)) * 100, 0)).toBe(0);
    const prior = await ctx.prisma.entityAccount.findUniqueOrThrow({
      where: { entityCode_accountCode: { entityCode: 'UK', accountCode: 'YTD-PRIOR' } },
    });
    expect(prior.fsliCode).toBe('RETAINED');

    expect(
      (
        await ctx
          .http()
          .put(`/api/tasks/${apr.id}/entities/UK/upload-profile`)
          .set(as(priya))
          .send({ plBasis: 'PERIOD' })
      ).status,
    ).toBe(200);
  });
});

describe('quarterly SFS against its months (Q10b)', () => {
  it('warns that a month is not finalised, uses two review levels, and takes an explanation', async () => {
    const q2 = await createTask('QUARTERLY', (p) => p.startDate === '2026-04-01', ['UK']);
    const pack = (await ctx.http().get(`/api/tasks/${q2.id}/entities/UK/review`).set(as(priya)))
      .body as ReviewPackDto;
    const months = pack.checks.find((c) => c.code === 'PERIOD_MONTHS_FINALISED')!;
    expect([months.result, months.severity]).toEqual(['FAIL', 'WARNING']);
    expect(months.details).toMatch(/Apr-2026, May-2026, Jun-2026/);
    expect(pack.checks.find((c) => c.code === 'PERIOD_TIES_TO_MONTHS')!.result).toBe('NA');
    expect(pack.periodCheck).toMatchObject({
      monthsNotFinalised: ['Apr-2026', 'May-2026', 'Jun-2026'],
      differences: 0,
    });
    expect(pack.state.reviewLevels).toBe(2);

    const base = `/api/tasks/${q2.id}/entities/UK/review/period-explanation`;
    expect((await ctx.http().post(base).set(as(priya)).send({ text: 'Too short.' })).status).toBe(
      400,
    );
    const ok = await ctx
      .http()
      .post(base)
      .set(as(priya))
      .send({ text: 'The months are still open; the quarter is a draft.' });
    expect(ok.status).toBe(201);
    expect((ok.body as ReviewPackDto).periodCheck!.explanation).toBe(
      'The months are still open; the quarter is a draft.',
    );
    expect(
      (
        await ctx
          .http()
          .post(`/api/tasks/${augTaskId}/entities/IN/review/period-explanation`)
          .set(as(priya))
          .send({ text: 'Monthly tasks are not checked this way.' })
      ).status,
    ).toBe(400);

    const monthly = (
      await ctx.http().get(`/api/tasks/${augTaskId}/entities/IN/review`).set(as(rahul))
    ).body as ReviewPackDto;
    expect(monthly.periodCheck).toBeNull();
    expect(monthly.checks.find((c) => c.code === 'PERIOD_MONTHS_FINALISED')!.result).toBe('NA');
  });
});

describe('IC difference explanations (Q7)', () => {
  it('need at least 20 characters', async () => {
    const cfs = await ctx.prisma.task.findUniqueOrThrow({ where: { number: 'CFS-2026-07-001' } });
    const r = await ctx
      .http()
      .post(`/api/tasks/${cfs.id}/cfs/levels/1/eliminations/IC%3Ax/explanation`)
      .set(as(priya))
      .send({ text: 'Timing difference.' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/at least 20 characters/);
  });
});
