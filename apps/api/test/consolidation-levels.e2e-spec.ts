import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import type {
  CfsStatementsDto,
  CfsWorkspaceDto,
  DashboardDto,
  EditAccessRequestDto,
  EliminationsDto,
  EntityNotesDto,
  FinalisedViewDto,
  ReviewPackDto,
} from '@finance-close/shared';
import { DEMO_USERS } from '../prisma/seed-demo';
import { canonicalJson } from '../src/common/canonical-json';
import { createTestApp, deleteNonDemoTasks, MASTER, type TestContext, tokenFor } from './helpers';

/**
 * Page 10 on the demo Jul-2026 CFS task (every SFS finalised): levels 1 → 4 through
 * statements, notes, review and finalisation. The levels are reopened in the test database and
 * restored afterwards. Logic only — the demo figures are not verified, so only ties, balances,
 * attribution and immutability are asserted (the hand-checked fixtures are engine unit tests).
 */
let ctx: TestContext;
let priya: string;
let rahul: string;
let master: string;
let taskId: string;
let lockedBefore: { month: Date; currencyCode: string; locked: boolean }[] = [];
const pw = (e: string) => DEMO_USERS.find((d) => d.email === e)!.password;
const as = (t: string) => ({ Authorization: `Bearer ${t}` });
const lv = (n: number) => `/api/tasks/${taskId}/cfs/levels/${n}`;
const binary = (r: import('superagent').Response, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  r.on('data', (c: Buffer) => chunks.push(c));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};

async function restore() {
  const where = { taskId, entityCode: { in: ['L1', 'L2', 'L3', 'L4'] } };
  await ctx.prisma.consolidationRun.deleteMany({ where: { taskId } });
  await ctx.prisma.consolidationAdjustment.deleteMany({ where: { taskId } });
  await ctx.prisma.eliminationExplanation.deleteMany({ where: { taskId } });
  await ctx.prisma.editAccessRequest.deleteMany({ where });
  await ctx.prisma.queryMessage.deleteMany({ where: { query: where } });
  await ctx.prisma.reviewQuery.deleteMany({ where });
  await ctx.prisma.signOff.deleteMany({ where: { submission: where } });
  await ctx.prisma.reviewSubmission.deleteMany({ where });
  await ctx.prisma.finalSnapshot.deleteMany({ where });
  await ctx.prisma.entityNote.deleteMany({ where });
  await ctx.prisma.taskLevel.updateMany({
    where: { taskId },
    data: { status: 'FINALISED', currentStep: 'FINALISED', lastEditedById: null },
  });
}

/** Generate → statements → notes → submit (Priya, acknowledging warnings) → approve (Rahul). */
async function finaliseLevel(n: number) {
  const g = await ctx
    .http()
    .post(`${lv(n)}/eliminations/generate`)
    .set(as(priya));
  expect(g.status).toBe(201);
  const e = g.body as EliminationsDto;
  expect(e.issues).toEqual([]);
  for (const x of e.entries.filter((y) => y.canExplain && !y.explanation))
    expect(
      (
        await ctx
          .http()
          .post(`${lv(n)}/eliminations/${encodeURIComponent(x.id)}/explanation`)
          .set(as(priya))
          .send({ text: 'Timing difference on a cross-border invoice.' })
      ).status,
    ).toBe(201);
  const s = (
    await ctx
      .http()
      .get(`${lv(n)}/statements`)
      .set(as(priya))
  ).body as CfsStatementsDto;
  expect(s.ticks).toMatchObject({
    bsBalances: true,
    profitTies: true,
    crossFoots: true,
    attributionTies: true,
  });
  expect(
    (
      await ctx
        .http()
        .post(`/api/tasks/${taskId}/cfs/levels/${n}/continue`)
        .set(as(priya))
        .send({ from: 'STATEMENTS' })
    ).status,
  ).toBe(201);
  const notes = (
    await ctx
      .http()
      .get(`${lv(n)}/notes`)
      .set(as(priya))
  ).body as EntityNotesDto;
  expect(notes.canEdit).toBe(true);
  const pack = (
    await ctx
      .http()
      .get(`${lv(n)}/review`)
      .set(as(priya))
  ).body as ReviewPackDto;
  const failing = pack.checks.filter((c) => c.severity === 'BLOCKING' && c.result === 'FAIL');
  expect(failing.map((c) => `${c.code}: ${c.details}`)).toEqual([]);
  const sub = await ctx
    .http()
    .post(`${lv(n)}/review/submit`)
    .set(as(priya))
    .send({
      declaration: true,
      acknowledgements: pack.warningsToAcknowledge.map((key) => ({
        key,
        comment: 'Acknowledged in the test run.',
      })),
    });
  expect(sub.status).toBe(201);
  const ap = await ctx
    .http()
    .post(`${lv(n)}/review/approve`)
    .set(as(rahul))
    .send({ comment: null });
  expect(ap.status).toBe(201);
  expect((ap.body as ReviewPackDto).entity.itemStatus).toBe('FINALISED');
  return { e, s, pack: ap.body as ReviewPackDto };
}

beforeAll(async () => {
  process.env.DEMO_MODE = 'true';
  ctx = await createTestApp();
  const rows = await ctx.prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!rows[0]?.db.endsWith('_test')) throw new Error('not a test database');
  await deleteNonDemoTasks(ctx);
  priya = await tokenFor(ctx, 'priya@financeclose.local', pw('priya@financeclose.local'));
  rahul = await tokenFor(ctx, 'rahul@financeclose.local', pw('rahul@financeclose.local'));
  master = await tokenFor(ctx, MASTER.email, MASTER.password);
  taskId = (await ctx.prisma.task.findUniqueOrThrow({ where: { number: 'CFS-2026-07-001' } })).id;
  lockedBefore = await ctx.prisma.exchangeRate.findMany({
    select: { month: true, currencyCode: true, locked: true },
  });
  await restore();
  await ctx.prisma.taskLevel.updateMany({
    where: { taskId },
    data: { status: 'NOT_STARTED', currentStep: 'READINESS' },
  });
  await ctx.prisma.task.update({ where: { id: taskId }, data: { completedAt: null } });
});
afterAll(async () => {
  if (ctx) {
    await restore();
    await ctx.prisma.task.update({
      where: { id: taskId },
      data: { completedAt: new Date('2026-08-18T10:30:00.000Z') },
    });
    for (const r of lockedBefore)
      await ctx.prisma.exchangeRate.updateMany({
        where: { month: r.month, currencyCode: r.currencyCode, locked: !r.locked },
        data: { locked: r.locked },
      });
  }
  await ctx?.app.close();
});

describe('levels 1 → 4', () => {
  let l1Hash = '';
  let l1Statements: CfsStatementsDto;

  it('level 1: statements show entity columns, eliminations and consolidated; ticks; equity and profit attribution', async () => {
    await ctx
      .http()
      .post(`${lv(1)}/eliminations/generate`)
      .set(as(priya));
    const s = (
      await ctx
        .http()
        .get(`${lv(1)}/statements`)
        .set(as(priya))
    ).body as CfsStatementsDto;
    expect(s.columns.map((c) => c.kind)).toEqual([
      'ENTITY',
      'ENTITY',
      'ELIM_BF',
      'ELIM_LEVEL',
      'CONSOLIDATED',
    ]);
    expect(s.header.comparativeSource.kind).toBe('NONE'); // Jun-2026 SFS are not finalised
    expect(s.ticks).toEqual({
      bsBalances: true,
      bsDifference: '0.00',
      profitTies: true,
      crossFoots: true,
      attributionTies: true,
    });
    const eq = s.balanceSheet.equity.CONSOLIDATED!;
    expect(eq.nci).toBe('0.00'); // VM is 100% owned
    const pa = s.profitAndLoss.attribution.CONSOLIDATED!;
    expect(pa.nci).toBe('0.00');
    expect(pa.owners).toBe(pa.total);
    const narrow = (
      await ctx
        .http()
        .get(`${lv(1)}/statements?showEntities=false&unit=THOUSANDS`)
        .set(as(priya))
    ).body as CfsStatementsDto;
    expect(narrow.columns.map((c) => c.kind)).toEqual(['CONSOLIDATED']);
    expect(narrow.roundingNote).toBeTruthy();
  });

  it('level 1 notes: consolidation notes with generated tables (subsidiaries, goodwill, IC summary)', async () => {
    const n = (
      await ctx
        .http()
        .get(`${lv(1)}/notes`)
        .set(as(priya))
    ).body as EntityNotesDto;
    const titles = n.notes.map((x) => x.title);
    for (const t of ['Basis of consolidation', 'List of subsidiaries', 'Intercompany eliminations'])
      expect(titles).toContain(t);
    expect(titles).not.toContain('Basis of preparation');
    const subs = n.notes.find((x) => x.title === 'List of subsidiaries')!;
    const g = Object.values(subs.generated ?? {})[0]!;
    expect(g.columns.map((c) => c.label)).toEqual([
      'Subsidiary',
      'Country',
      'Functional currency',
      '% held by parent',
      'Effective group %',
      'Consolidated from',
    ]);
    expect(g.rows).toHaveLength(1);
    expect(g.rows[0]!.cells[0]).toMatch(/Veracity Managed Services/);
    const basis = n.notes.find((x) => x.title === 'Basis of consolidation')!;
    const text = JSON.stringify(basis.blocks);
    expect(text).toMatch(/presented in SGD/);
    expect(text).not.toMatch(/\{subsidiaries\}/);
    const line = n.notes.find((x) => x.kind === 'LINE' && Object.values(x.figures)[0]?.breakdown);
    expect(Object.values(line!.figures)[0]!.breakdown!.columns.map((c) => c.code)).toEqual([
      'VS',
      'VM',
      'ELIM_BF',
      'ELIM_LEVEL',
      'CONSOLIDATED',
    ]);
  });

  it('level 1 finalises: an immutable snapshot with a stable SHA-256 hash; level 2 opens', async () => {
    const before = (await ctx.http().get(`/api/tasks/${taskId}/cfs`).set(as(priya)))
      .body as CfsWorkspaceDto;
    expect(before.levels[1]!.available).toBe(false);
    const r = await finaliseLevel(1);
    l1Statements = r.s;
    const snap = await ctx.prisma.finalSnapshot.findFirstOrThrow({
      where: { taskId, entityCode: 'L1', state: 'FINAL' },
    });
    expect(snap.hash).toMatch(/^[0-9a-f]{64}$/);
    l1Hash = snap.hash!;
    const data = JSON.parse(JSON.stringify(snap.data)) as {
      pack: { state: { finalised: unknown } };
    };
    data.pack.state.finalised = null;
    expect(createHash('sha256').update(canonicalJson(data)).digest('hex')).toBe(l1Hash);
    const after = (await ctx.http().get(`/api/tasks/${taskId}/cfs`).set(as(priya)))
      .body as CfsWorkspaceDto;
    expect(after.levels.map((l) => [l.level, l.status, l.available])).toEqual([
      [1, 'FINALISED', true],
      [2, 'NOT_STARTED', true],
      [3, 'NOT_STARTED', false],
      [4, 'NOT_STARTED', false],
    ]);
  });

  it('finalised level 1 is read from its snapshot: a configuration change does not move it', async () => {
    const acq = await ctx.prisma.acquisition.findFirstOrThrow({ where: { subsidiaryCode: 'VM' } });
    await ctx.prisma.acquisition.update({
      where: { id: acq.id },
      data: { cost: acq.cost.plus(1000) },
    });
    try {
      const s = (
        await ctx
          .http()
          .get(`${lv(1)}/statements`)
          .set(as(rahul))
      ).body as CfsStatementsDto;
      expect(s.fromSnapshot).toBe(true);
      expect(canonicalJson(s.balanceSheet)).toBe(canonicalJson(l1Statements.balanceSheet));
      expect(
        (
          await ctx.prisma.finalSnapshot.findFirstOrThrow({
            where: { taskId, entityCode: 'L1', state: 'FINAL' },
          })
        ).hash,
      ).toBe(l1Hash);
      expect(
        (
          await ctx
            .http()
            .post(`${lv(1)}/eliminations/generate`)
            .set(as(priya))
        ).status,
      ).toBe(409);
    } finally {
      await ctx.prisma.acquisition.update({ where: { id: acq.id }, data: { cost: acq.cost } });
    }
  });

  it('level 2 (USD): level 1 entries are recomputed in USD and labelled brought forward', async () => {
    const g = (
      await ctx
        .http()
        .post(`${lv(2)}/eliminations/generate`)
        .set(as(priya))
    ).body as EliminationsDto;
    expect(g.currency).toBe('USD');
    const bf = g.entries.filter((e) => e.originLevel === 1);
    expect(bf.length).toBeGreaterThan(0);
    for (const e of bf) {
      expect(e.originText).toBe('Brought forward from Level 1 Veracity Services');
      expect(e.balanced).toBe(true);
    }
    expect(g.entries.some((e) => e.originLevel === 2 && e.type === 'INVESTMENT')).toBe(true);
    const s = (
      await ctx
        .http()
        .get(`${lv(2)}/statements`)
        .set(as(priya))
    ).body as CfsStatementsDto;
    expect(s.columns.map((c) => c.kind)).toContain('ELIM_BF');
    expect(s.ticks.crossFoots).toBe(true);
  });

  it('a member’s SFS snapshot changing after generation blocks submission until regenerated', async () => {
    const uc = await ctx.prisma.task.findUniqueOrThrow({ where: { number: 'SFS-2026-07-001' } });
    const snap = await ctx.prisma.statementSnapshot.findUniqueOrThrow({
      where: { taskId_entityCode: { taskId: uc.id, entityCode: 'UC' } },
    });
    // A new snapshot of the same figures (as after a reopen and re-finalisation).
    await ctx.prisma.statementSnapshot.delete({ where: { id: snap.id } });
    await ctx.prisma.statementSnapshot.create({
      data: {
        taskId: uc.id,
        entityCode: 'UC',
        figures: snap.figures as object,
        source: snap.source,
      },
    });
    const e = (
      await ctx
        .http()
        .get(`${lv(2)}/eliminations`)
        .set(as(priya))
    ).body as EliminationsDto;
    expect(e.membersChanged).toEqual(['UC']);
    const pack = (
      await ctx
        .http()
        .get(`${lv(2)}/review`)
        .set(as(priya))
    ).body as ReviewPackDto;
    expect(pack.actions.canSubmit).toBe(false);
    expect(pack.actions.submitBlockedBy.join(' ')).toMatch(
      /Member data changed – regenerate eliminations \(UC\)/,
    );
    expect(
      (
        await ctx
          .http()
          .post(`${lv(2)}/review/submit`)
          .set(as(priya))
          .send({ declaration: true, acknowledgements: [] })
      ).status,
    ).toBe(409);
    await ctx
      .http()
      .post(`${lv(2)}/eliminations/generate`)
      .set(as(priya));
    expect(
      (
        (
          await ctx
            .http()
            .get(`${lv(2)}/eliminations`)
            .set(as(priya))
        ).body as EliminationsDto
      ).membersChanged,
    ).toEqual([]);
  });

  it('the preparer cannot approve; finalising level 2 opens level 3', async () => {
    await ctx
      .http()
      .post(`/api/tasks/${taskId}/cfs/levels/2/continue`)
      .set(as(priya))
      .send({ from: 'STATEMENTS' });
    const pack = (
      await ctx
        .http()
        .get(`${lv(2)}/review`)
        .set(as(priya))
    ).body as ReviewPackDto;
    await ctx
      .http()
      .post(`${lv(2)}/review/submit`)
      .set(as(priya))
      .send({
        declaration: true,
        acknowledgements: pack.warningsToAcknowledge.map((key) => ({
          key,
          comment: 'Acknowledged in the test run.',
        })),
      });
    expect(
      (
        await ctx
          .http()
          .post(`${lv(2)}/review/approve`)
          .set(as(priya))
          .send({ comment: null })
      ).status,
    ).toBe(403);
    expect(
      (
        await ctx
          .http()
          .post(`${lv(2)}/review/approve`)
          .set(as(rahul))
          .send({ comment: null })
      ).status,
    ).toBe(201);
    const w = (await ctx.http().get(`/api/tasks/${taskId}/cfs`).set(as(priya)))
      .body as CfsWorkspaceDto;
    expect(w.levels[2]!.available).toBe(true);
  });

  it('level 3 (INR) and level 4 (USD): NCI for the India group 41.51%; owners + NCI = profit', async () => {
    await finaliseLevel(3);
    const g = (
      await ctx
        .http()
        .post(`${lv(4)}/eliminations/generate`)
        .set(as(priya))
    ).body as EliminationsDto;
    const nci = g.entries.find((e) => e.type === 'NCI')!;
    expect(nci.title).toBe('Non-controlling interests in IN (41.51%)');
    expect(nci.entities).toEqual(['IN', 'AE', 'UK', 'UC', 'VS', 'VM']);
    const s = (
      await ctx
        .http()
        .get(`${lv(4)}/statements`)
        .set(as(priya))
    ).body as CfsStatementsDto;
    const a = s.profitAndLoss.attribution.CONSOLIDATED!;
    expect(a.nci).toBe(nci.nciProfit);
    expect((Number(a.owners) * 100 + Number(a.nci) * 100) / 100).toBeCloseTo(Number(a.total), 2);
    expect(s.ticks.attributionTies).toBe(true);
    const n = (
      await ctx
        .http()
        .get(`${lv(4)}/notes`)
        .set(as(priya))
    ).body as EntityNotesDto;
    const nciNote = n.notes.find((x) => x.title === 'Non-controlling interests')!;
    expect(Object.values(nciNote.generated!)[0]!.rows[0]!.cells[1]).toBe('41.51%');
    const gw = n.notes.find((x) => x.title === 'Goodwill')!;
    expect(Object.values(gw.generated!)[0]!.columns[2]!.label).toBe('Closing rate into USD');
    await finaliseLevel(4);
  });

  it('dashboard: 4 of 4 levels finalised and "Close complete" with the date', async () => {
    const d = (await ctx.http().get('/api/dashboard').set(as(priya))).body as DashboardDto;
    const jul = (
      await ctx
        .http()
        .get(`/api/dashboard?period=${d.periods.find((p) => p.label === 'Jul-2026')!.id}`)
        .set(as(priya))
    ).body as DashboardDto;
    expect(jul.consolidation).toMatchObject({ finalised: 4, total: 4, next: null });
    expect(jul.period!.deadline).toMatchObject({ kind: 'COMPLETE' });
    expect((jul.period!.deadline as { completedOn: string | null }).completedOn).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it('group pack: Excel with the ten sheets and SUM formulas; Word and PDF consolidated statements', async () => {
    const x = await ctx
      .http()
      .get(`${lv(4)}/statements/export?type=xlsx`)
      .set(as(rahul))
      .buffer(true)
      .parse(binary);
    expect(x.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    const buf = x.body as Buffer;
    await wb.xlsx.load(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    );
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Exchange Rates',
      'Entity Wise PL',
      'Entity Wise BS',
      'Eliminations',
      'Consol PL',
      'Consol BS',
      'NCI',
      'Goodwill',
      'Checks',
      'Notes',
    ]);
    const formulas: string[] = [];
    wb.getWorksheet('Entity Wise BS')!.eachRow((r) =>
      r.eachCell((c) => {
        if (typeof c.value === 'object' && c.value && 'formula' in c.value)
          formulas.push(String(c.value.formula));
      }),
    );
    expect(formulas.some((f) => /^SUM\(B\d+:[A-Z]+\d+\)$/.test(f))).toBe(true);
    for (const type of ['docx', 'pdf']) {
      const r = await ctx
        .http()
        .get(`${lv(4)}/statements/export?type=${type}`)
        .set(as(rahul))
        .buffer(true)
        .parse(binary);
      expect(r.status).toBe(200);
      expect((r.body as Buffer).length).toBeGreaterThan(1000);
    }
  });

  it('reopen order: level 1 is blocked while level 4 is finalised; the entity SFS is blocked too', async () => {
    const blocked = await ctx
      .http()
      .post('/api/edit-access-requests')
      .set(as(priya))
      .send({ taskId, entityCode: 'L1', reason: 'Correct a manual adjustment.' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/Reopen Level 4 US first/);
    const sfs = await ctx.prisma.task.findUniqueOrThrow({ where: { number: 'SFS-2026-07-001' } });
    const entity = await ctx
      .http()
      .post('/api/edit-access-requests')
      .set(as(priya))
      .send({ taskId: sfs.id, entityCode: 'VM', reason: 'Correct a mapping error.' });
    expect(entity.status).toBe(409);
    // Level 4 (the top) can reopen: v2 working copy, v1 kept.
    const req = await ctx
      .http()
      .post('/api/edit-access-requests')
      .set(as(priya))
      .send({ taskId, entityCode: 'L4', reason: 'Reclassify an adjustment.' });
    expect(req.status).toBe(201);
    const ok = await ctx
      .http()
      .post(`/api/edit-access-requests/${(req.body as EditAccessRequestDto).id}/decide`)
      .set(as(master))
      .send({ approve: true, comment: null });
    expect(ok.status).toBe(201);
    const snaps = await ctx.prisma.finalSnapshot.findMany({
      where: { taskId, entityCode: 'L4' },
      orderBy: { version: 'asc' },
    });
    expect(snaps.map((s) => [s.version, s.state])).toEqual([
      [1, 'FINAL'],
      [2, 'WORKING'],
    ]);
    const v = (
      await ctx
        .http()
        .get(`${lv(4)}/finalised`)
        .set(as(priya))
    ).body as FinalisedViewDto;
    expect(v.versions.map((x) => x.version)).toEqual([1, 2]);
    const w = (await ctx.http().get(`/api/tasks/${taskId}/cfs`).set(as(priya)))
      .body as CfsWorkspaceDto;
    expect(w.levels[3]!.status).toBe('IN_PROGRESS');
  });
});
