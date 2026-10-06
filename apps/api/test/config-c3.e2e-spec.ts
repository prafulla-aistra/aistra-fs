import type { ApprovalsDto, ControlCheckDto } from '@finance-close/shared';
import { DEMO_USERS } from '../prisma/seed-demo';
import { createTestApp, MASTER, type TestContext, tokenFor } from './helpers';

/** Config C3: the control-check register and approval rules (edit access: review.e2e-spec). */
let ctx: TestContext;
let master: string;
let viewer: string;
const as = (t: string) => ({ Authorization: `Bearer ${t}` });
const pw = (email: string) => DEMO_USERS.find((d) => d.email === email)!.password;

beforeAll(async () => {
  process.env.DEMO_MODE = 'true';
  ctx = await createTestApp();
  master = await tokenFor(ctx, MASTER.email, MASTER.password);
  viewer = await tokenFor(ctx, 'viewer@financeclose.local', pw('viewer@financeclose.local'));
});
afterAll(async () => {
  await ctx?.prisma.approvalRule.deleteMany({ where: { entityCode: 'UK' } });
  await ctx?.app.close();
});

describe('control checks', () => {
  it('seeds the SFS register with blocking checks, warnings and information checks', async () => {
    const res = await ctx
      .http()
      .get('/api/config/control-checks?statementType=SFS')
      .set(as(viewer));
    expect(res.status).toBe(200);
    const rows = res.body as ControlCheckDto[];
    const sev = (code: string) => rows.find((r) => r.code === code)?.severity;
    expect(sev('TB_BALANCED')).toBe('BLOCKING');
    expect(sev('BS_TIES')).toBe('BLOCKING');
    expect(sev('NOTES_REVIEWED')).toBe('WARNING');
    expect(sev('COMPARATIVE_PRESENT')).toBe('INFO');
    // Proposed defaults are flagged "to be confirmed".
    expect(rows.some((r) => r.toBeConfirmed)).toBe(true);
  });

  it('a viewer cannot change a check; the master can, and the change is audited old → new', async () => {
    const body = { severity: 'WARNING', threshold: '5.00', isActive: true, toBeConfirmed: true };
    expect(
      (
        await ctx
          .http()
          .put('/api/config/control-checks/RE_ROLL_FORWARD')
          .set(as(viewer))
          .send(body)
      ).status,
    ).toBe(403);
    const before = await ctx.prisma.controlCheck.findUniqueOrThrow({
      where: { code: 'RE_ROLL_FORWARD' },
    });
    const res = await ctx
      .http()
      .put('/api/config/control-checks/RE_ROLL_FORWARD')
      .set(as(master))
      .send(body);
    expect(res.status).toBe(200);
    expect(
      (res.body as ControlCheckDto[]).find((r) => r.code === 'RE_ROLL_FORWARD')!.threshold,
    ).toBe('5');
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'CONTROL_CHECK_UPDATE', entityId: 'RE_ROLL_FORWARD' },
      orderBy: { timestamp: 'desc' },
    });
    expect(audit.newValue).toMatchObject({ threshold: '5.00' });
    // Restore.
    await ctx.http().put('/api/config/control-checks/RE_ROLL_FORWARD').set(as(master)).send({
      severity: before.severity,
      threshold: before.threshold!.toString(),
      isActive: before.isActive,
      toBeConfirmed: before.toBeConfirmed,
    });
  });
});

describe('approvals', () => {
  it('has a default rule per statement type and lists the people who may review', async () => {
    const d = (await ctx.http().get('/api/config/approvals').set(as(viewer))).body as ApprovalsDto;
    expect(
      d.rules
        .filter((r) => r.entityCode === null && r.periodType === null)
        .map((r) => r.statementType)
        .sort(),
    ).toEqual(['CFS', 'SFS']);
    expect(d.candidates.some((c) => c.email === 'rahul@financeclose.local')).toBe(true);
    expect(d.segregation.length).toBeGreaterThan(0);
    expect(d.canEdit).toBe(false);
  });

  it('an entity override with two levels refuses the same person as reviewer and approver', async () => {
    const d = (await ctx.http().get('/api/config/approvals').set(as(master))).body as ApprovalsDto;
    const rahul = d.candidates.find((c) => c.email === 'rahul@financeclose.local')!.id;
    const same = await ctx
      .http()
      .put('/api/config/approvals')
      .set(as(master))
      .send({
        statementType: 'SFS',
        entityCode: 'UK',
        reviewLevels: 2,
        reviewerIds: [rahul],
        approverIds: [rahul],
      });
    expect(same.status).toBe(400);
    const ok = await ctx
      .http()
      .put('/api/config/approvals')
      .set(as(master))
      .send({
        statementType: 'SFS',
        entityCode: 'UK',
        reviewLevels: 2,
        reviewerIds: [rahul],
        approverIds: [],
      });
    expect(ok.status).toBe(200);
    const rule = (ok.body as ApprovalsDto).rules.find((r) => r.entityCode === 'UK')!;
    expect(rule).toMatchObject({ reviewLevels: 2, reviewers: [{ id: rahul }] });
    expect(
      (await ctx.http().delete(`/api/config/approvals/${rule.id}`).set(as(master))).status,
    ).toBe(204);
    const def = d.rules.find((r) => r.entityCode === null && r.periodType === null)!;
    expect(
      (await ctx.http().delete(`/api/config/approvals/${def.id}`).set(as(master))).status,
    ).toBe(400);
  });
});
