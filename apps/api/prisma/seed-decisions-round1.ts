/**
 * Decisions round 1: one-time changes to data the earlier seeds created (marker: audit_log
 * SEED_APPLIED decisions-round1). After that Configuration owns the data.
 *
 *  - FSLI IC_DIFF_PL "Unreconciled intercompany differences" (P&L, expense, consolidation only)
 *    placed next to OTH_EXP (Other expenses) on every stored format line, so the coverage check
 *    keeps passing. (New databases get it from seed-accounts / format-definitions.)
 *  - Control check CFS_IC_DIFFERENCES_EXPLAINED → "IC difference above threshold", BLOCKING
 *    (it becomes a warning once explained).
 *  - Approval defaults: Quarterly and Annual SFS 2 levels; the top consolidation level's parent
 *    (Level 4, US) 2 levels. Monthly SFS and CFS Levels 1–3 keep the 1-level default.
 *  - NCI fair value of partly owned subsidiaries (ILLUSTRATIVE, to be confirmed): NCI % × net
 *    assets at acquisition, so fair-value measurement gives the same NCI as proportionate until
 *    the real value is entered.
 *  - Setting PER_ENTITY_HOLIDAYS = false.
 */
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@finance-close/engine';

const MARKER = { action: 'SEED_APPLIED', entityType: 'SEED', entityId: 'decisions-round1' };

export async function seedDecisionsRound1(prisma: PrismaClient): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: 'PER_ENTITY_HOLIDAYS' },
    create: { key: 'PER_ENTITY_HOLIDAYS', value: 'false' },
    update: {},
  });
  if (await prisma.auditLog.findFirst({ where: MARKER })) return;

  // IC_DIFF_PL on every format line that carries OTH_EXP.
  const lines = await prisma.formatLine.findMany({ where: { fslis: { has: 'OTH_EXP' } } });
  let formatLines = 0;
  for (const l of lines) {
    if (l.fslis.includes('IC_DIFF_PL')) continue;
    const at = l.fslis.indexOf('OTH_EXP');
    const fslis = [...l.fslis.slice(0, at + 1), 'IC_DIFF_PL', ...l.fslis.slice(at + 1)];
    await prisma.formatLine.update({ where: { id: l.id }, data: { fslis } });
    formatLines++;
  }

  const check = await prisma.controlCheck.updateMany({
    where: { code: 'CFS_IC_DIFFERENCES_EXPLAINED' },
    data: {
      name: 'IC difference above threshold',
      description:
        'An intercompany difference above the pair tolerance is blocking while unexplained; once explained (20+ characters) it is a warning to acknowledge.',
      severity: 'BLOCKING',
    },
  });

  // Approval defaults (demo users stay as configured; empty lists = anyone with the permission).
  let rules = 0;
  for (const periodType of ['QUARTERLY', 'ANNUAL'] as const) {
    const exists = await prisma.approvalRule.findFirst({
      where: { statementType: 'SFS', entityCode: null, periodType },
    });
    if (!exists) {
      await prisma.approvalRule.create({
        data: { statementType: 'SFS', entityCode: null, periodType, reviewLevels: 2 },
      });
      rules++;
    }
  }
  const top = await prisma.entity.findFirst({ where: { parentCode: null, isActive: true } });
  if (top) {
    const exists = await prisma.approvalRule.findFirst({
      where: { statementType: 'CFS', entityCode: top.code, periodType: null },
    });
    if (!exists) {
      await prisma.approvalRule.create({
        data: { statementType: 'CFS', entityCode: top.code, reviewLevels: 2 },
      });
      rules++;
    }
  }

  // Illustrative NCI fair values (to be confirmed).
  const acqs = await prisma.acquisition.findMany({ orderBy: { acquiredOn: 'asc' } });
  const bySub = new Map<string, typeof acqs>();
  for (const a of acqs)
    bySub.set(`${a.subsidiaryCode}|${a.parentCode}`, [
      ...(bySub.get(`${a.subsidiaryCode}|${a.parentCode}`) ?? []),
      a,
    ]);
  let fairValues = 0;
  for (const steps of bySub.values()) {
    const pct = steps.reduce((s, x) => s.plus(x.pctAcquired.toString()), new Decimal('0'));
    const first = steps[0]!;
    if (pct.gte(100) || first.nciFairValue !== null) continue;
    const nci = new Decimal('100').minus(pct).dividedBy(100);
    const net = new Decimal(first.shareCapital.toString())
      .plus(first.premium.toString())
      .plus(first.preAcquisitionReserves.toString());
    await prisma.acquisition.update({
      where: { id: first.id },
      data: {
        nciFairValue: nci.times(net).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
        toBeConfirmed: true,
        note: `${first.note ? `${first.note} ` : ''}NCI fair value illustrative (NCI % × net assets at acquisition); confirm.`.slice(
          0,
          500,
        ),
      },
    });
    fairValues++;
  }

  await prisma.auditLog.create({
    data: {
      ...MARKER,
      newValue: {
        formatLines,
        controlCheck: check.count,
        approvalRules: rules,
        nciFairValues: fairValues,
      },
    },
  });
  console.log(
    `Decisions round 1 applied: ${formatLines} format lines, ${rules} approval rules, ${fairValues} NCI fair values (illustrative).`,
  );
}
