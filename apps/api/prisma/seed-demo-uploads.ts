/**
 * DEMO DATA — trial balances already uploaded in the demo tasks (demo mode only):
 *   SFS-2026-07-001 (Done)         all 7 entities, Jul-26 sample TBs
 *   SFS-2026-08-001 (In review)    US, UK, UC (finalised), IN (in review), AE (in progress)
 *                                  from the Aug-26 sample TBs; VS and VM not uploaded yet
 * Files go through StorageService like real uploads. Skipped for a task entity that already
 * has a TB version. Removed with the demo tasks (npm run demo:remove-tasks).
 */
import type { PrismaClient } from '@prisma/client';
import { checkTrialBalance, detectTbLayout } from '@finance-close/engine';
import { fromDbDate } from '../src/common/db-dates';
import { resolveFromRepoRoot } from '../src/config/paths';
import { LocalStorageService } from '../src/storage/local-storage.service';
import { readSheetRows } from '../src/uploads/sheets';
import { sha256, storeUpload } from '../src/uploads/stored-files';
import { saveTbVersion } from '../src/uploads/tb-versions';
import { SAMPLE_ENTITIES } from './sample-data';
import { type SampleMonth, tbFileName, trialBalanceFile } from './sample-files';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function seedDemoUploads(prisma: PrismaClient): Promise<void> {
  const priya = await prisma.user.findUnique({ where: { email: 'priya@financeclose.local' } });
  if (!priya) return;
  const storage = new LocalStorageService(
    resolveFromRepoRoot(process.env.STORAGE_LOCAL_DIR?.trim() || './data/uploads'),
  );
  const plan: [taskNumber: string, month: SampleMonth, entities: string[], at: string][] = [
    [
      'SFS-2026-07-001',
      'jul',
      ['US', 'IN', 'AE', 'UK', 'UC', 'VS', 'VM'],
      '2026-08-03T11:00:00+05:30',
    ],
    ['SFS-2026-08-001', 'aug', ['US', 'IN', 'AE', 'UK', 'UC'], '2026-09-03T11:00:00+05:30'],
  ];
  let created = 0;
  let replaced = 0;
  for (const [number, month, codes, at] of plan) {
    const task = await prisma.task.findUnique({
      where: { number },
      include: { period: true, entities: { include: { entity: true } } },
    });
    if (!task?.isDemo) continue;
    for (const te of task.entities.filter((x) => codes.includes(x.entityCode))) {
      const sample = SAMPLE_ENTITIES.find((e) => e.code === te.entityCode);
      if (!sample) continue;
      const body = trialBalanceFile(sample, month);
      const existing = await prisma.tbVersion.findMany({
        where: { taskId: task.id, entityCode: te.entityCode, purpose: 'CURRENT' },
        include: { file: true },
      });
      if (existing.length > 0) {
        // Keep anything a person uploaded. Only a seeded version whose sample file has since
        // changed (the sample data was revised) is replaced.
        const seededOnly = existing.every(
          (v) => v.createdById === priya.id && v.createdAt.getTime() === new Date(at).getTime(),
        );
        if (!seededOnly || existing.every((v) => v.file.sha256 === sha256(body))) continue;
        await prisma.$transaction(async (tx) => {
          await tx.tbVersion.deleteMany({ where: { id: { in: existing.map((v) => v.id) } } });
          await tx.uploadedFile.deleteMany({
            where: { id: { in: existing.map((v) => v.fileId) } },
          });
        });
        for (const v of existing) await storage.delete(v.file.storageKey);
        replaced++;
      }
      const fileName = tbFileName(sample.code, month);
      const rows = readSheetRows(body, fileName);
      const layout = detectTbLayout(rows);
      if (!layout.settings) continue;
      const known = await prisma.entityAccount.findMany({
        where: { entityCode: te.entityCode },
        select: { accountCode: true },
      });
      const check = checkTrialBalance({
        rows,
        settings: layout.settings,
        layout,
        period: {
          startDate: fromDbDate(task.period.startDate),
          endDate: fromDbDate(task.period.endDate),
          label: task.period.label,
        },
        legalName: te.entity.legalName,
        knownAccounts: new Set(known.map((k) => k.accountCode)),
        sameFileElsewhere: [],
      });
      await prisma.$transaction(async (tx) => {
        const file = await storeUpload(tx, storage, {
          kind: 'TB',
          body,
          originalName: fileName,
          contentType: XLSX_TYPE,
          taskId: task.id,
          entityCode: te.entityCode,
          uploadedById: priya.id,
          uploadedAt: new Date(at),
        });
        await saveTbVersion(tx, {
          taskId: task.id,
          entityCode: te.entityCode,
          fileId: file.id,
          check,
          settings: layout.settings!,
          layout,
          acknowledged: [],
          createdById: priya.id,
          createdAt: new Date(at),
        });
        await tx.uploadProfile.upsert({
          where: { entityCode: te.entityCode },
          create: {
            entityCode: te.entityCode,
            settings: { ...layout.settings! },
            updatedById: priya.id,
          },
          update: {},
        });
      });
      created++;
    }
  }
  if (created > 0)
    console.log(
      `Demo trial balances uploaded: ${created}${replaced > 0 ? ` (${replaced} replaced by revised sample data)` : ''}`,
    );
}
