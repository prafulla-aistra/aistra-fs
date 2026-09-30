/**
 * DEMO DATA — stored translations of the finalised Jul-2026 demo SFS (demo mode only),
 * produced by the engine's translateTB from the Jul-26 sample TBs. There is no finalised
 * Jun-2026, so Jul retained earnings are translated at the opening rate. The Aug-2026
 * translation step rolls retained earnings forward from these.
 *
 * Recomputed on every seed (the demo data may have been revised); only demo tasks.
 */
import type { PrismaClient } from '@prisma/client';
import { fromDbDate } from '../src/common/db-dates';
import { mappedLines, monthlyRates, translateLines } from '../src/uploads/translation-inputs';

export async function seedDemoTranslations(prisma: PrismaClient): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { number: 'SFS-2026-07-001' },
    include: {
      period: true,
      entities: {
        include: { entity: { include: { translatedCurrencies: true, historicalRates: true } } },
      },
    },
  });
  if (!task?.isDemo) return;
  const period = {
    startDate: fromDbDate(task.period.startDate),
    endDate: fromDbDate(task.period.endDate),
    label: task.period.label,
  };
  let written = 0;
  for (const te of task.entities.filter((e) => e.status === 'FINALISED')) {
    const functional = te.entity.functionalCurrency;
    const targets = te.entity.translatedCurrencies
      .map((t) => t.currencyCode)
      .filter((c) => c !== functional);
    if (targets.length === 0) continue;
    const lines = await mappedLines(prisma, task.id, te.entityCode);
    if (!lines) continue;
    const rates = await monthlyRates(prisma, [functional, ...targets], period);
    for (const target of targets) {
      const h = te.entity.historicalRates.find((r) => r.targetCurrency === target);
      const r = translateLines({
        lines,
        functionalCurrency: functional,
        target,
        period,
        rates,
        historicalRate: h ? h.rate.toString() : null,
        prior: null,
        priorPeriodLabel: 'Jun-2026',
        rollForwardPassed: false,
      });
      if (r.status !== 'OK') {
        console.warn(
          `Demo translation ${te.entityCode} → ${target} skipped: ${r.failures.join(' ')}`,
        );
        continue;
      }
      const data = {
        periodId: task.periodId,
        retained: r.fsliTotals.find((f) => f.fsliCode === 'RETAINED')?.translated ?? '0.00',
        profit: r.profit!,
        fctr: r.fctr!,
        result: JSON.parse(JSON.stringify(r)),
        source: 'SEED',
      };
      const key = {
        taskId_entityCode_targetCurrency: {
          taskId: task.id,
          entityCode: te.entityCode,
          targetCurrency: target,
        },
      };
      const before = await prisma.translationSnapshot.findUnique({ where: key });
      if (
        before &&
        before.fctr.toFixed(2) === data.fctr &&
        before.profit.toFixed(2) === data.profit &&
        before.retained.toFixed(2) === data.retained
      )
        continue;
      await prisma.translationSnapshot.upsert({
        where: key,
        create: { taskId: task.id, entityCode: te.entityCode, targetCurrency: target, ...data },
        update: data,
      });
      written++;
    }
  }
  if (written > 0) console.log(`Demo translation snapshots (Jul-2026) written: ${written}`);
}
