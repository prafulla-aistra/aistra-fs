import ExcelJS from 'exceljs';
import type {
  AcquisitionsDto,
  AggregationDto,
  CfsWorkspaceDto,
  EliminationsDto,
  IntercompanyPairsDto,
  ReadinessDto,
} from '@finance-close/shared';
import { DEMO_USERS } from '../prisma/seed-demo';
import { createTestApp, deleteNonDemoTasks, MASTER, type TestContext, tokenFor } from './helpers';

/**
 * Page 9 on the demo Jul-2026 CFS task (all SFS finalised). Level 1 Veracity Services is
 * reopened in the test database for the test and restored afterwards. Logic only: the demo
 * figures are not verified, so no demo figure is asserted — only that columns balance, entries
 * balance and the checks pass (the to-the-cent fixture is in the engine unit tests).
 */
let ctx: TestContext;
let priya: string;
let rahul: string;
let master: string;
let taskId: string;
const pw = (email: string) => DEMO_USERS.find((d) => d.email === email)!.password;
const as = (t: string) => ({ Authorization: `Bearer ${t}` });
const base = () => `/api/tasks/${taskId}/cfs`;

async function restore() {
  await ctx.prisma.consolidationRun.deleteMany({ where: { taskId } });
  await ctx.prisma.consolidationAdjustment.deleteMany({ where: { taskId } });
  await ctx.prisma.taskLevel.updateMany({
    where: { taskId },
    data: { status: 'FINALISED', currentStep: 'FINALISED' },
  });
  await ctx.prisma.taskLevel.update({
    where: { taskId_level: { taskId, level: 1 } },
    data: { currency: 'SGD' },
  });
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
  await restore();
  // Reopen levels 1–4 (test only) so level 1 can be prepared; level 2 then waits for level 1.
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
  }
  await ctx?.app.close();
});

describe('configuration: intercompany pairs and the acquisitions register', () => {
  it('seeds the pairs from the charts of accounts (to be confirmed)', async () => {
    const d = (await ctx.http().get('/api/config/intercompany-pairs').set(as(master)))
      .body as IntercompanyPairsDto;
    const vs = d.pairs.find((p) => p.entityA === 'VM' && p.entityB === 'VS')!;
    expect(vs).toMatchObject({ tolerance: '1.00', toBeConfirmed: true });
    expect(vs.accountsLinked).toBeGreaterThan(0);
  });

  it('stores an acquisition-date rate into every level currency the subsidiary belongs to', async () => {
    const d = (await ctx.http().get('/api/config/acquisitions').set(as(master)))
      .body as AcquisitionsDto;
    const vm = d.acquisitions.find((a) => a.subsidiaryCode === 'VM')!;
    expect(vm).toMatchObject({ parentCode: 'VS', toBeConfirmed: true });
    // VM is in L1 (SGD), L2 Unconstrained (USD), L3 India (INR), L4 US (USD); parent VS is SGD.
    expect(vm.ratesNeeded.map((r) => r.currency)).toEqual(['INR', 'SGD', 'USD']);
    expect(vm.ratesNeeded.every((r) => r.present)).toBe(true);
  });

  it('a viewer cannot change the register; changes are audited', async () => {
    const d = (await ctx.http().get('/api/config/acquisitions').set(as(master)))
      .body as AcquisitionsDto;
    const vm = d.acquisitions.find((a) => a.subsidiaryCode === 'VM')!;
    const body = { ...vm, note: 'Checked in the e2e test.', rates: vm.rates };
    delete (body as Partial<typeof vm>).id;
    expect(
      (await ctx.http().put(`/api/config/acquisitions/${vm.id}`).set(as(rahul)).send(body)).status,
    ).toBe(403);
    const res = await ctx.http().put(`/api/config/acquisitions/${vm.id}`).set(as(master)).send({
      subsidiaryCode: vm.subsidiaryCode,
      parentCode: vm.parentCode,
      acquiredOn: vm.acquiredOn,
      pctAcquired: vm.pctAcquired,
      cost: vm.cost,
      shareCapital: vm.shareCapital,
      premium: vm.premium,
      preAcquisitionReserves: vm.preAcquisitionReserves,
      toBeConfirmed: vm.toBeConfirmed,
      note: vm.note,
      rates: vm.rates,
    });
    expect(res.status).toBe(200);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'ACQUISITION_CHANGE', entityId: vm.id },
      orderBy: { timestamp: 'desc' },
    });
    expect(audit?.oldValue).toBeTruthy();
  });
});

describe('workspace and level path', () => {
  it('lists the four levels bottom-up; level 2 waits for level 1', async () => {
    const res = await ctx.http().get(base()).set(as(priya));
    expect(res.status).toBe(200);
    const w = res.body as CfsWorkspaceDto;
    expect(w.levels.map((l) => `${l.level} ${l.name} ${l.currency} ${l.memberCount}`)).toEqual([
      '1 Veracity Services SGD 2',
      '2 Unconstrained USD 3',
      '3 India INR 6',
      '4 US USD 7',
    ]);
    expect(w.levels[0]!.available).toBe(true);
    expect(w.levels[1]!.available).toBe(false);
    expect(w.levels[1]!.waitingFor).toEqual(['Level 1 Veracity Services must be finalised first.']);
  });

  it('a level that is not available cannot be prepared', async () => {
    const res = await ctx.http().post(`${base()}/levels/2/eliminations/generate`).set(as(priya));
    expect(res.status).toBe(409);
  });
});

describe('level 1 Veracity Services', () => {
  it('readiness: members, translation source, rates and configuration checks', async () => {
    const r = (await ctx.http().get(`${base()}/levels/1/readiness`).set(as(priya)))
      .body as ReadinessDto;
    expect(r.currency).toMatchObject({
      current: 'SGD',
      configured: 'SGD',
      eliminationsGenerated: false,
      canChange: true,
    });
    expect(
      r.members.map((m) => [m.code, m.role, m.functionalCurrency, m.sfs.status, m.source.kind]),
    ).toEqual([
      ['VS', 'Level parent', 'SGD', 'FINALISED', 'SAME_CURRENCY'],
      ['VM', 'Subsidiary of VS', 'LKR', 'FINALISED', expect.stringMatching(/SNAPSHOT|COMPUTED/)],
    ]);
    expect(r.rates.map((x) => x.currency)).toEqual(['LKR']);
    expect(r.rates[0]!.closing).toMatch(/^\d+\.\d{10}$/);
    expect(r.checks.map((c) => c.code)).toEqual([
      'IC_PAIRS',
      'ACQUISITIONS',
      'ACQUISITION_RATES',
      'HISTORICAL_RATES',
      'RATES',
    ]);
    expect(r.checks.find((c) => c.code === 'ACQUISITIONS')!.status).toBe('WARNING'); // to be confirmed
    expect(r.canContinue).toBe(true);
  });

  it('a user without CFS_PREPARE cannot change anything', async () => {
    expect(
      (await ctx.http().post(`${base()}/levels/1/eliminations/generate`).set(as(rahul))).status,
    ).toBe(403);
  });

  it('aggregation: entity-wise columns + aggregate, every column balances; Excel with SUM formulas', async () => {
    expect(
      (
        await ctx
          .http()
          .post(`${base()}/levels/1/continue`)
          .set(as(priya))
          .send({ from: 'READINESS' })
      ).body,
    ).toEqual({ currentStep: 'AGGREGATION' });
    const a = (await ctx.http().get(`${base()}/levels/1/aggregation`).set(as(priya)))
      .body as AggregationDto;
    expect(a.entities.map((e) => e.code)).toEqual(['VS', 'VM']);
    expect(a.balances.map((b) => [b.code, b.balanced, b.profitTies])).toEqual([
      ['VS', true, true],
      ['VM', true, true],
      ['AGGREGATE', true, true],
    ]);
    const ta = a.balanceSheet.find((r) => r.role === 'TOTAL_ASSETS')!;
    expect(ta.aggregate).toBeTruthy();
    const res = await ctx
      .http()
      .get(`${base()}/levels/1/aggregation/export`)
      .set(as(priya))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    const buf = res.body as Buffer;
    await wb.xlsx.load(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    );
    const ws = wb.getWorksheet('Balance sheet')!;
    const formulas: string[] = [];
    ws.eachRow((row) =>
      row.eachCell((c) => {
        if (typeof c.value === 'object' && c.value && 'formula' in c.value)
          formulas.push(String(c.value.formula));
      }),
    );
    expect(formulas.some((f) => /^SUM\(B\d+:C\d+\)$/.test(f))).toBe(true);
    expect(
      (
        await ctx
          .http()
          .post(`${base()}/levels/1/continue`)
          .set(as(priya))
          .send({ from: 'AGGREGATION' })
      ).status,
    ).toBe(201);
  });

  let generated: EliminationsDto;
  it('generates the eliminations: IC VS ↔ VM, investment in VM; every entry balances; checks pass', async () => {
    const res = await ctx.http().post(`${base()}/levels/1/eliminations/generate`).set(as(priya));
    expect(res.status).toBe(201);
    generated = res.body as EliminationsDto;
    expect(generated.issues).toEqual([]);
    expect(generated.entries.map((e) => e.type).sort()).toEqual([
      'IC_BALANCE',
      'IC_PNL',
      'INVESTMENT',
    ]);
    for (const e of generated.entries) {
      expect(e.balanced).toBe(true);
      expect(e.originText).toBe('This level');
    }
    const inv = generated.entries.find((e) => e.type === 'INVESTMENT')!;
    expect(inv.calculation.join(' ')).toMatch(
      /Goodwill \(SGD\) = cost .* − net assets acquired .* = /,
    );
    expect(generated.summary).toMatchObject({ entries: 3, balanced: true });
    expect(generated.checks.map((c) => [c.code, c.passed])).toEqual([
      ['ENTRIES_BALANCE', true],
      ['INVESTMENTS_ELIMINATED', true],
      ['IC_ELIMINATED', true],
      ['CONSOLIDATED_BALANCES', true],
    ]);
    expect(generated.stale).toBe(false);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'ELIMINATIONS_GENERATE', entityId: `${taskId}:1` },
    });
    expect(audit).toBeTruthy();
  });

  it('regenerating gives the same entries', async () => {
    const again = (await ctx.http().post(`${base()}/levels/1/eliminations/generate`).set(as(priya)))
      .body as EliminationsDto;
    expect(again.entries.map((e) => e.lines)).toEqual(generated.entries.map((e) => e.lines));
  });

  it('a manual adjustment must balance; it is audited and only its creator can delete it', async () => {
    const url = `${base()}/levels/1/adjustments`;
    const bad = await ctx
      .http()
      .post(url)
      .set(as(priya))
      .send({
        narration: 'Accrual',
        reason: 'Late supplier invoice',
        lines: [
          { entityCode: 'VS', fsliCode: 'OTH_EXP', debit: '100.00', credit: null },
          { entityCode: 'VS', fsliCode: 'CUR_OTH_LIAB', debit: null, credit: '90.00' },
        ],
      });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/does not balance/);
    const ok = await ctx
      .http()
      .post(url)
      .set(as(priya))
      .send({
        narration: 'Accrual',
        reason: 'Late supplier invoice',
        lines: [
          { entityCode: 'VS', fsliCode: 'OTH_EXP', debit: '100.00', credit: null },
          { entityCode: null, fsliCode: 'CUR_OTH_LIAB', debit: null, credit: '100.00' },
        ],
      });
    expect(ok.status).toBe(201);
    const d = ok.body as EliminationsDto;
    const m = d.entries.find((e) => e.type === 'MANUAL')!;
    expect(m.lines.map((l) => [l.fsliCode, l.debit, l.credit])).toEqual([
      ['OTH_EXP', '100.00', null],
      ['CUR_OTH_LIAB', null, '100.00'],
    ]);
    expect(m.manual?.canDelete).toBe(true);
    expect(d.summary?.entries).toBe(4);
    expect(d.checks.every((c) => c.passed)).toBe(true);
    // The currency cannot change while a manual adjustment exists.
    expect(
      (await ctx.http().put(`${base()}/levels/1/currency`).set(as(priya)).send({ currency: 'USD' }))
        .status,
    ).toBe(409);
    // Only the creator deletes.
    expect((await ctx.http().delete(`${url}/${m.manual!.id}`).set(as(master))).status).toBe(403);
    const del = await ctx.http().delete(`${url}/${m.manual!.id}`).set(as(priya));
    expect(del.status).toBe(200);
    expect((del.body as EliminationsDto).entries.some((e) => e.type === 'MANUAL')).toBe(false);
    const audit = await ctx.prisma.auditLog.findMany({
      where: {
        action: { in: ['CONSOLIDATION_ADJUSTMENT_CREATE', 'CONSOLIDATION_ADJUSTMENT_DELETE'] },
        entityId: m.manual!.id,
      },
    });
    expect(audit).toHaveLength(2);
  });

  it('changing the level currency clears the generated eliminations; everything still balances in USD', async () => {
    const r = (
      await ctx.http().put(`${base()}/levels/1/currency`).set(as(priya)).send({ currency: 'USD' })
    ).body as ReadinessDto;
    expect(r.currency).toMatchObject({ current: 'USD', eliminationsGenerated: false });
    // VS (SGD) and VM (LKR) now both come from their USD translation (or are computed).
    expect(r.members.every((m) => ['SNAPSHOT', 'COMPUTED'].includes(m.source.kind))).toBe(true);
    const e = (await ctx.http().get(`${base()}/levels/1/eliminations`).set(as(priya)))
      .body as EliminationsDto;
    expect(e.generated).toBeNull();
    const g = (await ctx.http().post(`${base()}/levels/1/eliminations/generate`).set(as(priya)))
      .body as EliminationsDto;
    expect(g.currency).toBe('USD');
    expect(g.entries.every((x) => x.balanced)).toBe(true);
    expect(g.checks.find((c) => c.code === 'CONSOLIDATED_BALANCES')!.passed).toBe(true);
    // Back to SGD for the other tests.
    await ctx.http().put(`${base()}/levels/1/currency`).set(as(priya)).send({ currency: 'SGD' });
  });

  it('a stale set is reported after the configuration changes', async () => {
    await ctx.http().post(`${base()}/levels/1/eliminations/generate`).set(as(priya));
    const pair = await ctx.prisma.intercompanyPair.findUniqueOrThrow({
      where: { entityA_entityB: { entityA: 'VM', entityB: 'VS' } },
    });
    await ctx.prisma.intercompanyPair.delete({ where: { id: pair.id } });
    try {
      const e = (await ctx.http().get(`${base()}/levels/1/eliminations`).set(as(priya)))
        .body as EliminationsDto;
      expect(e.stale).toBe(true);
      expect(
        (
          await ctx
            .http()
            .post(`${base()}/levels/1/continue`)
            .set(as(priya))
            .send({ from: 'ELIMINATIONS' })
        ).status,
      ).toBe(400);
    } finally {
      await ctx.prisma.intercompanyPair.create({
        data: {
          entityA: pair.entityA,
          entityB: pair.entityB,
          tolerance: pair.tolerance,
          toBeConfirmed: pair.toBeConfirmed,
          note: pair.note,
        },
      });
    }
  });
});
