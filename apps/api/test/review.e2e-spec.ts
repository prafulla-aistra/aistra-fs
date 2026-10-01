import { createHash } from 'node:crypto';
import type {
  DashboardDto,
  EditAccessRequestDto,
  EntityStatementsDto,
  EntityNotesDto,
  FinalisedViewDto,
  NotificationsDto,
  ReviewPackDto,
} from '@finance-close/shared';
import { SAMPLE_ENTITIES } from '../prisma/sample-data';
import { tbFileName, trialBalanceFile } from '../prisma/sample-files';
import { DEMO_USERS } from '../prisma/seed-demo';
import { canonicalJson } from '../src/common/canonical-json';
import {
  activeUserToken,
  createTestApp,
  deleteNonDemoTasks,
  ensureSampleTb,
  MASTER,
  type TestContext,
  tokenFor,
} from './helpers';

/**
 * Page 8: review and finalise, on India Aug-2026 (demo task, restored afterwards). Logic only:
 * the demo figures are not verified, so no figure is asserted, only that figures do not change.
 */
let ctx: TestContext;
let priya: string;
let rahul: string;
let master: string;
let approver2: string;
let both: string; // SFS_PREPARE + SFS_REVIEW
let taskId: string;
let julTaskId: string;
let lockedBefore: { month: Date; currencyCode: string; locked: boolean }[] = [];
const pw = (email: string) => DEMO_USERS.find((d) => d.email === email)!.password;
const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const base = () => `/api/tasks/${taskId}/entities/IN`;
const EXTRA = ['1455', '6120'];

async function pack(token = priya): Promise<ReviewPackDto> {
  const res = await ctx.http().get(`${base()}/review`).set(as(token));
  expect(res.status).toBe(200);
  return res.body as ReviewPackDto;
}
const post = (path: string, token: string, body: object = {}) =>
  ctx.http().post(`${base()}${path}`).set(as(token)).send(body);
const acksFor = (p: ReviewPackDto) =>
  p.warningsToAcknowledge.map((key) => ({ key, comment: 'Acknowledged in the test run.' }));
const submit = async (token = priya) => {
  const p = await pack(token);
  return post('/review/submit', token, { declaration: true, acknowledgements: acksFor(p) });
};
const entityRow = () =>
  ctx.prisma.taskEntity.findUniqueOrThrow({
    where: { taskId_entityCode: { taskId, entityCode: 'IN' } },
  });

async function resetReviewState() {
  const where = { taskId, entityCode: 'IN' };
  await ctx.prisma.editAccessRequest.deleteMany({ where });
  await ctx.prisma.queryMessage.deleteMany({ where: { query: where } });
  await ctx.prisma.reviewQuery.deleteMany({ where });
  await ctx.prisma.signOff.deleteMany({ where: { submission: where } });
  await ctx.prisma.reviewSubmission.deleteMany({ where });
  await ctx.prisma.finalSnapshot.deleteMany({ where });
  await ctx.prisma.statementSnapshot.deleteMany({ where });
  await ctx.prisma.translationSnapshot.deleteMany({ where });
  await ctx.prisma.taskEntity.update({
    where: { taskId_entityCode: { taskId, entityCode: 'IN' } },
    data: {
      status: 'IN_PROGRESS',
      currentStep: 'NOTES',
      finalisedAt: null,
      finalisedById: null,
      lastEditedById: null,
    },
  });
  await ctx.prisma.task.update({ where: { id: taskId }, data: { completedAt: null } });
  await ctx.prisma.approvalRule.deleteMany({ where: { entityCode: { not: null } } });
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
  approver2 = (
    await activeUserToken(ctx, master, {
      name: 'Second approver',
      permissions: ['SFS_REVIEW', 'REPORTS_VIEW'],
      templateCode: null,
    })
  ).token;
  both = (
    await activeUserToken(ctx, master, {
      name: 'Preparer and reviewer',
      permissions: ['SFS_PREPARE', 'SFS_REVIEW', 'REPORTS_VIEW'],
      templateCode: null,
    })
  ).token;
  taskId = (await ctx.prisma.task.findUniqueOrThrow({ where: { number: 'SFS-2026-08-001' } })).id;
  julTaskId = (await ctx.prisma.task.findUniqueOrThrow({ where: { number: 'SFS-2026-07-001' } }))
    .id;
  await resetReviewState();
  await ensureSampleTb(
    ctx,
    priya,
    taskId,
    'IN',
    trialBalanceFile(
      SAMPLE_ENTITIES.find((e) => e.code === 'IN')!,
      'aug',
    ),
    tbFileName('IN', 'aug'),
  );
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
    ],
    skipDuplicates: true,
  });
  lockedBefore = await ctx.prisma.exchangeRate.findMany({
    select: { month: true, currencyCode: true, locked: true },
  });
});

afterAll(async () => {
  if (ctx) {
    await resetReviewState();
    await ctx.prisma.entityNote.deleteMany({ where: { taskId, entityCode: 'IN' } });
    await ctx.prisma.entityAccount.deleteMany({
      // Not in the seeded chart of accounts (page 3 tests expect them new); any source, as the
      // configuration edit above changes it.
      where: { entityCode: 'IN', accountCode: { in: EXTRA } },
    });
    for (const r of lockedBefore)
      await ctx.prisma.exchangeRate.updateMany({
        where: { month: r.month, currencyCode: r.currencyCode, locked: !r.locked },
        data: { locked: r.locked },
      });
  }
  await ctx?.app.close();
});

describe('submit for review', () => {
  it('runs the check register and lists the 10 sections of the pack', async () => {
    const p = await pack();
    expect(p.declaration).toMatch(
      /^I confirm the trial balance agrees to Zoho as at .+, and all accounts are mapped and reviewed\.$/,
    );
    expect(p.checks.length).toBeGreaterThan(10);
    for (const c of p.checks) expect(['PASS', 'FAIL', 'NA']).toContain(c.result);
    expect(p.signOffs.map((s) => s.role)).toEqual(['PREPARER', 'REVIEWER', 'APPROVER']);
    expect(p.keyFigures[0]!.rows.map((r) => r.label)).toEqual([
      'Total assets',
      'Total equity',
      'Revenue',
      'Profit for the period',
    ]);
    for (const k of [
      'variances',
      'notes',
      'translation',
      'intercompany',
      'files',
      'changes',
      'queries',
    ] as const)
      expect(p[k]).toBeDefined();
    expect(p.files.length).toBeGreaterThan(0);
  });

  it('a failing blocking check stops the submission', async () => {
    const acc = await ctx.prisma.entityAccount.findUniqueOrThrow({
      where: { entityCode_accountCode: { entityCode: 'IN', accountCode: '6120' } },
    });
    await ctx.prisma.entityAccount.update({ where: { id: acc.id }, data: { fsliCode: null } });
    try {
      const p = await pack();
      expect(p.checks.find((c) => c.code === 'ALL_MAPPED')).toMatchObject({
        result: 'FAIL',
        severity: 'BLOCKING',
      });
      expect(p.actions.canSubmit).toBe(false);
      const res = await submit();
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/blocking check/);
      expect((await entityRow()).status).toBe('IN_PROGRESS');
    } finally {
      await ctx.prisma.entityAccount.update({ where: { id: acc.id }, data: { fsliCode: 'EMP' } });
    }
  });

  it('every blocking check passes on the restored data', async () => {
    const p = await pack();
    const failing = p.checks.filter((c) => c.severity === 'BLOCKING' && c.result === 'FAIL');
    expect(failing.map((c) => `${c.name}: ${c.details}`)).toEqual([]);
  });

  it('a failing warning needs an acknowledgement of at least 10 characters, and the declaration is required', async () => {
    const p = await pack();
    // Notes rolled forward start "carried forward" (not reviewed): the warning fails.
    expect(p.warningsToAcknowledge).toContain('NOTES_REVIEWED');
    const none = await post('/review/submit', priya, { declaration: true, acknowledgements: [] });
    expect(none.status).toBe(400);
    expect(none.body.message).toMatch(/Acknowledge each failing warning/);
    const short = await post('/review/submit', priya, {
      declaration: true,
      acknowledgements: p.warningsToAcknowledge.map((key) => ({ key, comment: 'ok' })),
    });
    expect(short.status).toBe(400);
    const noDecl = await post('/review/submit', priya, {
      declaration: false,
      acknowledgements: acksFor(p),
    });
    expect(noDecl.status).toBe(400);
    expect(noDecl.body.message).toMatch(/declaration/);
  });

  it('two review levels: configured for India before submitting', async () => {
    const users = await ctx.prisma.user.findMany({ select: { id: true } });
    expect(users.length).toBeGreaterThan(0);
    const res = await ctx
      .http()
      .put('/api/config/approvals')
      .set(as(master))
      .send({
        statementType: 'SFS',
        entityCode: 'IN',
        reviewLevels: 2,
        reviewerIds: [],
        approverIds: [],
      });
    expect(res.status).toBe(200);
  });

  it('submits: India In review, acknowledgements stored, reviewers notified, dashboard counts it', async () => {
    const res = await submit();
    expect(res.status).toBe(201);
    const p = res.body as ReviewPackDto;
    expect(p.entity.itemStatus).toBe('IN_REVIEW');
    expect(p.state).toMatchObject({ stage: 1, reviewLevels: 2, submissionNumber: 1 });
    expect(p.acknowledgements.map((a) => a.key)).toEqual(p.warningsToAcknowledge);
    expect(p.signOffs[0]).toMatchObject({ role: 'PREPARER', status: 'SUBMITTED' });
    expect((await entityRow()).status).toBe('IN_REVIEW');
    const bell = (await ctx.http().get('/api/notifications').set(as(rahul)))
      .body as NotificationsDto;
    expect(bell.items[0]).toMatchObject({ kind: 'SUBMITTED_FOR_REVIEW', read: false });
    const d = (await ctx.http().get('/api/dashboard').set(as(rahul))).body as DashboardDto;
    expect(d.attention).toMatchObject({ awaitingReview: 1, awaitingYourReview: 1 });
    expect((await submit()).status).toBe(409);
  });

  it('an edit after submission withdraws it automatically (back In progress); resubmitting works', async () => {
    const notes = (await ctx.http().get(`${base()}/notes`).set(as(priya))).body as EntityNotesDto;
    const n = notes.notes[0]!;
    const save = await ctx
      .http()
      .put(`${base()}/notes/${n.id}`)
      .set(as(priya))
      .send({ title: `${n.title} (edited)`, blocks: n.blocks, baseVersion: n.version });
    expect(save.status).toBe(200);
    expect((await entityRow()).status).toBe('IN_PROGRESS');
    const sub = await ctx.prisma.reviewSubmission.findFirstOrThrow({
      where: { taskId, entityCode: 'IN', number: 1 },
    });
    expect(sub.status).toBe('WITHDRAWN');
    expect(sub.closedReason).toMatch(/Note edited/);
    const bell = (await ctx.http().get('/api/notifications').set(as(rahul)))
      .body as NotificationsDto;
    expect(bell.items[0]!.kind).toBe('SUBMISSION_WITHDRAWN');
    const again = await submit();
    expect(again.status).toBe(201);
    expect((again.body as ReviewPackDto).state.submissionNumber).toBe(2);
  });
});

describe('queries, segregation of duties and approval', () => {
  it('a preparer cannot approve (no review permission)', async () => {
    expect((await post('/review/approve', priya)).status).toBe(403);
  });

  it('whoever prepared or last edited the entity cannot review it, even with the review permission', async () => {
    // The "both" user edits a note (restoring its title): the submission is withdrawn; Priya resubmits.
    const n = ((await ctx.http().get(`${base()}/notes`).set(as(both))).body as EntityNotesDto)
      .notes[0]!;
    expect(
      (
        await ctx
          .http()
          .put(`${base()}/notes/${n.id}`)
          .set(as(both))
          .send({
            title: n.title.replace(/ \(edited\)$/, ''),
            blocks: n.blocks,
            baseVersion: n.version,
          })
      ).status,
    ).toBe(200);
    expect((await submit(priya)).status).toBe(201);
    const p = await pack(both);
    expect(p.actions.canDecide).toBe(false);
    expect(p.actions.approveBlockedBy.join(' ')).toMatch(
      /You last edited this entity.*segregation of duties/,
    );
    const res = await post('/review/approve', both);
    expect(res.status).toBe(403);
  });

  it('an open or answered query blocks approval; closing it unblocks', async () => {
    const before = await pack(rahul);
    const note = before.queryTargets.NOTE[0]!;
    const raised = await post('/review/queries', rahul, {
      targetType: 'NOTE',
      targetKey: note.key,
      text: 'Please explain the movement in this note.',
    });
    expect(raised.status).toBe(201);
    const q = (raised.body as ReviewPackDto).queries.at(-1)!;
    expect(q).toMatchObject({
      status: 'OPEN',
      targetType: 'NOTE',
      targetLabel: note.label,
      link: { step: 'NOTES', key: note.key },
    });
    expect((await post('/review/approve', rahul)).status).toBe(409);
    expect(
      ((await ctx.http().get('/api/dashboard').set(as(priya))).body as DashboardDto).attention
        .openQueries,
    ).toBe(1);

    const answered = await ctx
      .http()
      .post(`${base()}/review/queries/${q.id}/answer`)
      .set(as(priya))
      .field('text', 'Movement is the new supplier advance.');
    expect(answered.status).toBe(201);
    expect((answered.body as ReviewPackDto).queries.at(-1)!.status).toBe('ANSWERED');
    expect((await post('/review/approve', rahul)).status).toBe(409);

    const closed = await post(`/review/queries/${q.id}/status`, rahul, {
      status: 'CLOSED',
      comment: null,
    });
    expect(closed.status).toBe(201);
    expect((closed.body as ReviewPackDto).queries.at(-1)!.status).toBe('CLOSED');
  });

  it('returning needs a comment and sends the entity back to the preparer', async () => {
    expect((await post('/review/return', rahul, { comment: 'short' })).status).toBe(400);
    const res = await post('/review/return', rahul, {
      comment: 'Please re-check the advance to suppliers.',
    });
    expect(res.status).toBe(201);
    expect((await entityRow()).status).toBe('IN_PROGRESS');
    expect((await submit()).status).toBe(201);
  });

  it('two levels need two different people', async () => {
    const one = await post('/review/approve', rahul, { comment: 'Reviewed.' });
    expect(one.status).toBe(201);
    expect((one.body as ReviewPackDto).state.stage).toBe(2);
    expect((await entityRow()).status).toBe('IN_REVIEW');
    const p = await pack(rahul);
    expect(p.actions.decidingAs).toBe('APPROVER');
    expect(p.actions.approveBlockedBy.join(' ')).toMatch(/approver must be a different person/i);
    expect((await post('/review/approve', rahul)).status).toBe(403);
  });

  it('finalising is atomic: if a blocking check fails at that moment, nothing changes', async () => {
    const acc = await ctx.prisma.entityAccount.findUniqueOrThrow({
      where: { entityCode_accountCode: { entityCode: 'IN', accountCode: '6120' } },
    });
    await ctx.prisma.entityAccount.update({ where: { id: acc.id }, data: { fsliCode: null } }); // bypasses the guard
    try {
      const res = await post('/review/approve', approver2);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Cannot finalise/);
      expect((await entityRow()).status).toBe('IN_REVIEW');
      expect(await ctx.prisma.finalSnapshot.count({ where: { taskId, entityCode: 'IN' } })).toBe(0);
      expect(
        await ctx.prisma.reviewSubmission.count({
          where: { taskId, entityCode: 'IN', status: 'ACTIVE' },
        }),
      ).toBe(1);
    } finally {
      await ctx.prisma.entityAccount.update({ where: { id: acc.id }, data: { fsliCode: 'EMP' } });
    }
  });
});

describe('finalise', () => {
  let statementsBefore: EntityStatementsDto;
  let hash: string;

  it('the second person approves: snapshot v1 with a stable SHA-256 hash, rates locked, entity Finalised', async () => {
    statementsBefore = (await ctx.http().get(`${base()}/statements`).set(as(priya)))
      .body as EntityStatementsDto;
    const res = await post('/review/approve', approver2, { comment: 'Approved.' });
    expect(res.status).toBe(201);
    const row = await entityRow();
    expect(row).toMatchObject({ status: 'FINALISED', currentStep: 'FINALISED' });
    const snap = await ctx.prisma.finalSnapshot.findFirstOrThrow({
      where: { taskId, entityCode: 'IN' },
    });
    expect(snap).toMatchObject({ version: 1, state: 'FINAL' });
    expect(snap.hash).toMatch(/^[0-9a-f]{64}$/);
    hash = snap.hash!;
    // The hash is reproducible from the stored data (the banner repeating it excluded).
    const data = JSON.parse(JSON.stringify(snap.data)) as {
      pack: { state: { finalised: unknown } };
    };
    data.pack.state.finalised = null;
    expect(createHash('sha256').update(canonicalJson(data)).digest('hex')).toBe(hash);
    expect(
      await ctx.prisma.statementSnapshot.findFirst({ where: { taskId, entityCode: 'IN' } }),
    ).toMatchObject({ source: 'FINALISE' });
    const aug = await ctx.prisma.exchangeRate.findMany({
      where: { month: new Date('2026-08-01T00:00:00.000Z'), currencyCode: 'INR' },
    });
    expect(aug.length).toBeGreaterThan(0);
    expect(aug.every((r) => r.locked)).toBe(true);
    const p = await pack(rahul);
    expect(p.fromSnapshot).toBe(true);
    expect(p.state.finalised).toMatchObject({ version: 1, hash });
    expect(p.signOffs.map((s) => s.status)).toEqual(['SUBMITTED', 'APPROVED', 'APPROVED']);
    // Read-only now.
    expect((await submit()).status).toBe(409);
  });

  it('the finalised figures do not change when the mapping is changed in configuration', async () => {
    const acc = await ctx.prisma.entityAccount.findUniqueOrThrow({
      where: { entityCode_accountCode: { entityCode: 'IN', accountCode: '1455' } },
    });
    const patch = await ctx
      .http()
      .patch('/api/config/entities/IN/accounts/1455')
      .set(as(master))
      .send({
        accountType: acc.accountType,
        fsliCode: 'CASH',
        counterpartyCode: null,
        rateBasisOverride: null,
        reason: 'Test: remap after finalise',
      });
    expect(patch.status).toBe(200);
    try {
      const after = (await ctx.http().get(`${base()}/statements`).set(as(priya)))
        .body as EntityStatementsDto;
      expect(canonicalJson(after.balanceSheet)).toBe(canonicalJson(statementsBefore.balanceSheet));
      expect(canonicalJson(after.profitAndLoss)).toBe(
        canonicalJson(statementsBefore.profitAndLoss),
      );
      const snap = await ctx.prisma.finalSnapshot.findFirstOrThrow({
        where: { taskId, entityCode: 'IN' },
      });
      expect(snap.hash).toBe(hash);
    } finally {
      await ctx
        .http()
        .patch('/api/config/entities/IN/accounts/1455')
        .set(as(master))
        .send({
          accountType: acc.accountType,
          fsliCode: acc.fsliCode,
          counterpartyCode: null,
          rateBasisOverride: null,
          reason: 'Test: restore mapping',
        });
    }
  });

  it('downloads the review record PDF', async () => {
    const res = await ctx
      .http()
      .get(`${base()}/finalised/review-record`)
      .set(as(rahul))
      .buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/pdf/);
    expect(res.body.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('reopening is blocked while a finalised consolidation level includes the entity', async () => {
    const res = await ctx
      .http()
      .post('/api/edit-access-requests')
      .set(as(priya))
      .send({ taskId: julTaskId, entityCode: 'IN', reason: 'Correct a July mapping error.' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/consolidation .*level L\d/);
  });

  it('approved edit access creates a v2 working copy and keeps v1', async () => {
    const view = (await ctx.http().get(`${base()}/finalised`).set(as(priya)))
      .body as FinalisedViewDto;
    expect(view.canRequestEditAccess).toBe(true);
    expect(view.banner).toMatch(/Finalised on .+ Snapshot v1/);
    const req = await ctx
      .http()
      .post('/api/edit-access-requests')
      .set(as(priya))
      .send({ taskId, entityCode: 'IN', reason: 'Reclassify the supplier advance.' });
    expect(req.status).toBe(201);
    const r = req.body as EditAccessRequestDto;
    expect(
      ((await ctx.http().get('/api/dashboard').set(as(master))).body as DashboardDto).attention
        .editAccessRequests,
    ).toBe(1);
    const decided = await ctx
      .http()
      .post(`/api/edit-access-requests/${r.id}/decide`)
      .set(as(master))
      .send({ approve: true, comment: null });
    expect(decided.status).toBe(201);
    expect((await entityRow()).status).toBe('IN_PROGRESS');
    const snaps = await ctx.prisma.finalSnapshot.findMany({
      where: { taskId, entityCode: 'IN' },
      orderBy: { version: 'asc' },
    });
    expect(snaps.map((s) => [s.version, s.state])).toEqual([
      [1, 'FINAL'],
      [2, 'WORKING'],
    ]);
    expect(snaps[0]!.hash).toBe(hash);
    const after = (await ctx.http().get(`${base()}/finalised`).set(as(priya)))
      .body as FinalisedViewDto;
    expect(after.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(after.versions[0]!.keyFigures.length).toBeGreaterThan(0);
    const record = await ctx
      .http()
      .get(`${base()}/finalised/review-record?version=1`)
      .set(as(priya));
    expect(record.status).toBe(200);
  });
});
