import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { EntityStatementsDto, StatementsStepDto, TbPreviewDto } from '@finance-close/shared';
import { SAMPLE_ENTITIES } from '../prisma/sample-data';
import { tbFileName, trialBalanceFile } from '../prisma/sample-files';
import { DEMO_USERS } from '../prisma/seed-demo';
import { createTestApp, deleteNonDemoTasks, type TestContext, tokenFor } from './helpers';

/**
 * Page 7 — step 5 "Statements and notes": India Aug-2026 in the demo task (after the page 4
 * mapping of 1455 and 6120), against Jul-2026 (finalised). Anything changed is put back.
 */
let ctx: TestContext;
let priya: string;
let augTaskId: string;
let julTaskId: string;
const pw = (email: string) => DEMO_USERS.find((d) => d.email === email)!.password;
const as = (token: string) => ({ Authorization: `Bearer ${token}` });

async function view(code: string, q: Record<string, string> = {}): Promise<EntityStatementsDto> {
  const qs = new URLSearchParams(q).toString();
  const res = await ctx
    .http()
    .get(`/api/tasks/${augTaskId}/entities/${code}/statements${qs ? `?${qs}` : ''}`)
    .set(as(priya));
  expect(res.status).toBe(200);
  return res.body as EntityStatementsDto;
}
const figures = (v: EntityStatementsDto, keys: string[]) => {
  const rows = [...v.balanceSheet.rows, ...v.profitAndLoss.rows];
  return Object.fromEntries(
    keys.map((k) => {
      const r = rows.find((x) => x.key === k);
      if (!r) throw new Error(`no row ${k}`);
      return [k, [r.current, r.comparative]];
    }),
  );
};

async function reset() {
  const rows = await ctx.prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!rows[0]?.db.endsWith('_test')) throw new Error('not a test database');
  await ctx.prisma.statementText.deleteMany({ where: { taskId: { in: [augTaskId, julTaskId] } } });
  await ctx.prisma.entityAccount.deleteMany({
    where: { source: 'TASK_MAPPING', accountCode: { in: ['1455', '6120', '6390'] } },
  });
  await ctx.prisma.taskEntity.update({
    where: { taskId_entityCode: { taskId: augTaskId, entityCode: 'IN' } },
    data: { currentStep: 'REVIEW' },
  });
}

/** Uploads and confirms India's Aug-26 TB in the demo task, as a preparer would. */
async function uploadSample(body: Buffer) {
  const up = await ctx
    .http()
    .post(`/api/tasks/${augTaskId}/entities/IN/tb`)
    .set(as(priya))
    .attach('file', body, {
      filename: tbFileName('IN', 'aug'),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  expect(up.status).toBe(201);
  const p = up.body as TbPreviewDto;
  const ok = await ctx
    .http()
    .post(`/api/tasks/${augTaskId}/entities/IN/tb/confirm`)
    .set(as(priya))
    .send({
      fileId: p.fileId,
      settings: p.settings,
      acknowledged: (p.check?.needsAcknowledgement ?? []).map((i) => i.code),
    });
  expect(ok.status).toBe(201);
}

beforeAll(async () => {
  process.env.DEMO_MODE = 'true';
  ctx = await createTestApp();
  await deleteNonDemoTasks(ctx);
  priya = await tokenFor(ctx, 'priya@financeclose.local', pw('priya@financeclose.local'));
  augTaskId = (await ctx.prisma.task.findUniqueOrThrow({ where: { number: 'SFS-2026-08-001' } }))
    .id;
  julTaskId = (await ctx.prisma.task.findUniqueOrThrow({ where: { number: 'SFS-2026-07-001' } }))
    .id;
  await reset();
  // India's Aug-26 TB as in the current sample data: uploaded (before the mapping, as in the
  // journey) only if the latest version is an older file.
  const body = trialBalanceFile(
    SAMPLE_ENTITIES.find((e) => e.code === 'IN')!,
    'aug',
  );
  const latest = await ctx.prisma.tbVersion.findFirst({
    where: { taskId: augTaskId, entityCode: 'IN', purpose: 'CURRENT' },
    orderBy: { version: 'desc' },
    include: { file: true },
  });
  if (latest?.file.sha256 !== createHash('sha256').update(body).digest('hex'))
    await uploadSample(body);
  // The page 4 mapping of the two Aug-only India accounts (and UK's 6390).
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
});
afterAll(async () => {
  if (ctx) await reset();
  await ctx?.app.close();
});

describe('India Aug-2026, Monthly internal format', () => {
  it('INR: the page 7 figures, with the finalised Jul-2026 comparative', async () => {
    const v = await view('IN', { format: 'MANAGEMENT' });
    expect(v.selection).toMatchObject({
      format: 'MANAGEMENT',
      isTaskFormat: false,
      currency: 'INR',
    });
    expect(v.header.comparativeSource).toMatchObject({
      kind: 'FINALISED',
      taskNumber: 'SFS-2026-07-001',
    });
    expect(v.header.translatedFrom).toBeNull();
    expect(
      figures(v, [
        'revenue',
        'ebitda',
        'pbt',
        'tax',
        'net_profit',
        'total_assets',
        'total_equity',
        'total_liabilities',
      ]),
    ).toEqual({
      revenue: ['59870764.50', '57506584.16'],
      ebitda: ['20810764.50', '19406584.16'],
      pbt: ['19660764.50', '18256584.16'],
      tax: ['1900000.00', '1900000.00'],
      net_profit: ['17760764.50', '16356584.16'],
      total_assets: ['745317348.66', '727556584.16'],
      total_equity: ['699117348.66', '681356584.16'],
      total_liabilities: ['46200000.00', '46200000.00'],
    });
    expect(v.balanceSheet.title).toBe('Balance sheet as at 31 August 2026');
    expect(v.profitAndLoss.title).toBe(
      'Statement of profit and loss for the month ended 31 August 2026',
    );
  });

  it('USD: translated with each period’s own rates (Jul from its finalised translation)', async () => {
    const v = await view('IN', { format: 'MANAGEMENT', currency: 'USD' });
    expect(v.header.translatedFrom).toBe('Translated from INR');
    expect(
      figures(v, [
        'revenue',
        'ebitda',
        'pbt',
        'tax',
        'net_profit',
        'total_assets',
        'total_equity',
        'total_liabilities',
      ]),
    ).toEqual({
      revenue: ['691348.32', '667904.58'],
      ebitda: ['240309.06', '225395.88'],
      pbt: ['227029.62', '212039.32'],
      tax: ['21939.96', '22067.36'],
      net_profit: ['205089.66', '189971.96'],
      total_assets: ['8576724.39', '8420793.78'],
      total_equity: ['8045078.81', '7886071.57'],
      total_liabilities: ['531645.58', '534722.21'],
    });
    expect(v.notes.rates).toMatchObject({ currencyPair: 'INR → USD' });
    expect(v.notes.note1.translation).toContain('closing rate');
  });

  it('Lakhs: total assets 7,453.17 and the rounding note', async () => {
    const v = await view('IN', { format: 'MANAGEMENT', unit: 'LAKHS' });
    expect(figures(v, ['total_assets']).total_assets![0]).toBe('7453.17');
    expect(v.roundingNote).toBe('Figures may not add due to rounding');
    expect(v.header.currencyUnits).toBe('INR · Lakhs');
  });
});

describe('India Aug-2026, Statutory format (the task format)', () => {
  it('Schedule III figures', async () => {
    const v = await view('IN');
    expect(v.selection).toMatchObject({ format: 'STATUTORY', isTaskFormat: true });
    const f = figures(v, [
      'total_income',
      'employee',
      'other_exp',
      'total_expenses',
      'profit',
      'share_cap',
      'other_equity',
      'trade_rec',
    ]);
    expect(Object.fromEntries(Object.entries(f).map(([k, x]) => [k, x[0]]))).toEqual({
      total_income: '60120764.50',
      employee: '33310000.00',
      other_exp: '5750000.00',
      total_expenses: '40460000.00',
      profit: '17760764.50',
      share_cap: '100000000.00',
      other_equity: '599117348.66',
      trade_rec: '85618978.63',
    });
  });

  it('ties: balance sheet and profit in every currency, and every note total to the face', async () => {
    for (const format of ['STATUTORY', 'MANAGEMENT', 'INVESTOR'])
      for (const currency of ['INR', 'USD']) {
        const v = await view('IN', { format, currency });
        const tel = v.balanceSheet.rows.find((r) => r.role === 'TOTAL_EQUITY_LIABILITIES')!;
        const profit = v.profitAndLoss.rows.find((r) => r.role === 'PROFIT')!;
        expect([format, currency, tel.tie!.current.ok, tel.tie!.comparative!.ok]).toEqual([
          format,
          currency,
          true,
          true,
        ]);
        expect(profit.tie!.current.ok).toBe(true);
        expect(v.notes.lines.length).toBeGreaterThan(5);
        expect(
          v.notes.lines.filter((n) => !n.ties.current || n.ties.comparative === false),
        ).toEqual([]);
      }
  });

  it('notes: numbered from 3, BS first then P&L, matching the face; intercompany note', async () => {
    const v = await view('IN');
    const first = v.notes.lines[0]!;
    expect(first).toMatchObject({ number: 3, statement: 'BS' });
    const bsNumbers = v.balanceSheet.rows.filter((r) => r.note !== null).map((r) => r.note);
    const plNumbers = v.profitAndLoss.rows.filter((r) => r.note !== null).map((r) => r.note);
    expect(Math.max(...(bsNumbers as number[]))).toBeLessThan(Math.min(...(plNumbers as number[])));
    expect(v.notes.lines.map((n) => n.number)).toEqual([...bsNumbers, ...plNumbers]);
    const equity = v.notes.lines.find((n) => n.key === 'other_equity')!;
    expect(equity.computed.map((c) => c.fsliCode)).toEqual(['PROFIT']);
    expect(v.notes.intercompany!.label).toBe(
      'Related party balances – intercompany (full related party disclosure to follow)',
    );
    expect(v.notes.intercompany!.rows.length).toBeGreaterThan(0);
    expect(v.notes.note1.text).toContain('Aistra GenAI India Pvt Ltd');
    expect(v.notes.note1.text).toContain('Ind AS');
    expect(v.notes.note2.text).toContain('Draft – to be reviewed');
    expect(v.footer).toContain('Corrections are made in the ERP');
  });

  it('nil lines hide by default and show with the toggle', async () => {
    const hidden = await view('IN');
    const shown = await view('IN', { showNil: 'true' });
    expect(shown.balanceSheet.rows.length).toBeGreaterThan(hidden.balanceSheet.rows.length);
    expect(hidden.balanceSheet.rows.some((r) => r.key === 'goodwill')).toBe(false);
    expect(shown.balanceSheet.rows.find((r) => r.key === 'goodwill')!.current).toBe('0.00');
  });
});

describe('unmapped accounts', () => {
  it('are named in a warning (the statements cannot agree to the TB)', async () => {
    const row = await ctx.prisma.entityAccount.findUniqueOrThrow({
      where: { entityCode_accountCode: { entityCode: 'IN', accountCode: '6120' } },
    });
    await ctx.prisma.entityAccount.delete({ where: { id: row.id } });
    try {
      const v = await view('IN');
      expect(v.warnings[0]).toBe(
        '1 account is not mapped (6120), so the statements cannot agree to the trial balance. Map them on step 2 · Review and map.',
      );
    } finally {
      const { id: _id, createdAt: _c, updatedAt: _u, ...data } = row;
      await ctx.prisma.entityAccount.create({ data });
    }
  });
});

describe('notes text, snapshots, continue', () => {
  it('Note 1 is editable (audited); Note 2 is carried forward from the previous task', async () => {
    await ctx.prisma.statementText.create({
      data: {
        taskId: julTaskId,
        entityCode: 'IN',
        kind: 'NOTE2',
        text: 'Draft – to be reviewed. Jul policies.',
      },
    });
    const v = await view('IN');
    expect(v.notes.note2).toMatchObject({
      text: 'Draft – to be reviewed. Jul policies.',
      carriedFrom: 'SFS-2026-07-001 (Jul-2026)',
      edited: false,
    });
    const res = await ctx
      .http()
      .put(`/api/tasks/${augTaskId}/entities/IN/statement-notes`)
      .set(as(priya))
      .send({ kind: 'NOTE1', text: 'Edited corporate information.' });
    expect(res.status).toBe(204);
    expect((await view('IN')).notes.note1).toMatchObject({
      text: 'Edited corporate information.',
      edited: true,
    });
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'STATEMENT_NOTE_UPDATE', entityId: `${augTaskId}:IN` },
      }),
    ).toBeGreaterThan(0);
  });

  it('a done task reads the stored snapshot, ties, and is read-only (India Jul-2026)', async () => {
    for (const currency of ['INR', 'USD']) {
      const res = await ctx
        .http()
        .get(
          `/api/tasks/${julTaskId}/entities/IN/statements?format=MANAGEMENT&currency=${currency}`,
        )
        .set(as(priya));
      const v = res.body as EntityStatementsDto;
      expect(v).toMatchObject({
        fromSnapshot: true,
        canEdit: false,
        readOnlyReason: 'This task is done and locked.',
      });
      const tel = v.balanceSheet.rows.find((r) => r.role === 'TOTAL_EQUITY_LIABILITIES')!;
      expect(tel.tie!.current.ok).toBe(true);
      expect(v.profitAndLoss.rows.find((r) => r.key === 'net_profit')!.current).toBe(
        currency === 'INR' ? '16356584.16' : '189971.96',
      );
    }
    const res = await ctx
      .http()
      .put(`/api/tasks/${julTaskId}/entities/IN/statement-notes`)
      .set(as(priya))
      .send({ kind: 'NOTE1', text: 'x' });
    expect(res.status).toBe(409);
  });

  it('step tabs, and continue to review and finalise', async () => {
    const step = (await ctx.http().get(`/api/tasks/${augTaskId}/statements-step`).set(as(priya)))
      .body as StatementsStepDto;
    expect(step.entities.find((e) => e.code === 'IN')!.ties).toBe(true);
    await ctx.prisma.taskEntity.update({
      where: { taskId_entityCode: { taskId: augTaskId, entityCode: 'IN' } },
      data: { currentStep: 'STATEMENTS' },
    });
    const res = await ctx
      .http()
      .post(`/api/tasks/${augTaskId}/entities/IN/statements/continue`)
      .set(as(priya));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ currentStep: 'REVIEW' });
  });
});

describe('Excel export', () => {
  const binary = (
    res: import('superagent').Response,
    cb: (err: Error | null, body: Buffer) => void,
  ) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  it('all currencies: sheets, real numbers, SUM formulas for totals and note totals', async () => {
    const res = await ctx
      .http()
      .get(`/api/tasks/${augTaskId}/entities/IN/statements/export?format=MANAGEMENT&currency=ALL`)
      .set(as(priya))
      .buffer(true)
      .parse(binary);
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((res.body as Buffer).buffer as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Cover',
      'BS INR',
      'P&L INR',
      'Notes INR',
      'BS USD',
      'P&L USD',
      'Notes USD',
      'TB',
      'Translation USD',
      'Checks',
    ]);
    const pl = wb.getWorksheet('P&L INR')!;
    const find = (label: string) => {
      let row = 0;
      pl.eachRow((r, n) => {
        if (r.getCell(1).value === label) row = n;
      });
      return pl.getRow(row);
    };
    expect(find('Revenue').getCell(3).value).toBe(59870764.5);
    const ebitda = find('EBITDA').getCell(3).value as { formula: string; result: number };
    expect(ebitda.formula).toMatch(/^SUM\(C\d+,-C\d+\)$/);
    expect(ebitda.result).toBe(20810764.5);
    const notes = wb.getWorksheet('Notes INR')!;
    const sums: string[] = [];
    notes.eachRow((r) => {
      const c = r.getCell(3).value as { formula?: string } | null;
      if (c && typeof c === 'object' && c.formula) sums.push(c.formula);
    });
    expect(sums.some((f) => /^SUM\(C\d+:C\d+\)$/.test(f))).toBe(true);
    expect(wb.getWorksheet('BS INR')!.views[0]).toMatchObject({ state: 'frozen', ySplit: 5 });
  });
});
