/**
 * DEMO DATA — stored translations (translation_snapshot) of every finalised entity in the demo
 * SFS tasks (Jul-2026: all; Aug-2026: US, UK, UC), made by the translation step itself
 * (retained earnings rolled forward from the finalised prior period where it exists).
 * Finalised entities read these instead of recalculating.
 *
 * A finalised entity's TB is fully mapped (finalisation requires it). The demo Aug-26 UK TB has
 * 6390 Bank Charges, which is not in the seeded chart of accounts, so it is mapped here as it
 * would have been before UK was finalised (6390 → the default FSLI for its account type).
 *
 * Oldest period first, so Aug rolls forward from Jul. Only demo tasks; SEED snapshots follow
 * revisions of the demo data.
 */
import type { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ComparativeSourceService } from '../src/uploads/comparative-source.service';
import { stepInclude } from '../src/uploads/step-access';
import { canonicalJson } from '../src/common/canonical-json';
import { mappedLines } from '../src/uploads/translation-inputs';
import { TranslationService } from '../src/uploads/translation.service';

export async function seedDemoTranslations(client: PrismaClient): Promise<void> {
  const prisma = client as unknown as PrismaService;
  const translation = new TranslationService(
    prisma,
    null as never,
    new ComparativeSourceService(prisma),
  );
  const tasks = await client.task.findMany({
    where: { isDemo: true, type: 'SFS', entities: { some: { status: 'FINALISED' } } },
    include: stepInclude,
    orderBy: { period: { startDate: 'asc' } },
  });
  let written = 0;
  let mapped = 0;
  for (const task of tasks) {
    for (const te of task.entities.filter((e) => e.status === 'FINALISED')) {
      // Map any account of the finalised TB that the chart of accounts does not have yet.
      const version = await client.tbVersion.findFirst({
        where: { taskId: task.id, entityCode: te.entityCode, purpose: 'CURRENT' },
        orderBy: { version: 'desc' },
        include: { lines: true },
      });
      if (!version) continue;
      const known = new Set(
        (await client.entityAccount.findMany({ where: { entityCode: te.entityCode } })).map(
          (a) => a.accountCode,
        ),
      );
      for (const l of version.lines.filter((x) => !known.has(x.accountCode))) {
        const d = l.accountType
          ? await client.accountTypeDefault.findFirst({
              where: { erp: te.entity.erp, accountType: l.accountType },
            })
          : null;
        if (!d) continue;
        await client.entityAccount.create({
          data: {
            entityCode: te.entityCode,
            accountCode: l.accountCode,
            accountName: l.accountName,
            accountType: l.accountType,
            fsliCode: d.fsliCode,
            source: 'SEED',
            suggested: false,
          },
        });
        mapped++;
      }

      const lines = await mappedLines(client, task.id, te.entityCode);
      if (!lines) continue;
      for (const { target, result: r } of await translation.translate(task, te, lines)) {
        if (r.status !== 'OK') {
          console.warn(
            `Demo translation ${task.number} ${te.entityCode} → ${target} skipped: ${r.failures.join(' ')}`,
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
        const before = await client.translationSnapshot.findUnique({ where: key });
        if (before && before.source !== 'SEED') continue;
        if (before && canonicalJson(before.result) === canonicalJson(data.result)) continue;
        await client.translationSnapshot.upsert({
          where: key,
          create: { taskId: task.id, entityCode: te.entityCode, targetCurrency: target, ...data },
          update: data,
        });
        written++;
      }
    }
  }
  if (mapped > 0) console.log(`Demo accounts mapped for finalised entities: ${mapped}`);
  if (written > 0) console.log(`Demo translation snapshots written: ${written}`);
}
