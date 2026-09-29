import type { Prisma, TbVersion } from '@prisma/client';
import type { TbCheckResult, TbColumnSettings, TbLayout } from '@finance-close/engine';

/**
 * Saves a checked trial balance as the next version for the task entity, with its lines.
 * Earlier versions are kept. Used by the upload service and by the demo seed.
 */
export async function saveTbVersion(
  db: Prisma.TransactionClient,
  v: {
    taskId: string;
    entityCode: string;
    fileId: string;
    check: TbCheckResult;
    settings: TbColumnSettings;
    layout: Pick<TbLayout, 'period' | 'organisation'>;
    acknowledged: string[];
    createdById: string;
    createdAt?: Date;
  },
): Promise<TbVersion> {
  const last = await db.tbVersion.findFirst({
    where: { taskId: v.taskId, entityCode: v.entityCode },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const c = v.check;
  const version = await db.tbVersion.create({
    data: {
      taskId: v.taskId,
      entityCode: v.entityCode,
      version: (last?.version ?? 0) + 1,
      fileId: v.fileId,
      status: c.status,
      debits: c.totals.debits,
      credits: c.totals.credits,
      difference: c.totals.difference,
      lineCount: c.lines.length,
      newAccounts: c.newAccounts,
      issues: {
        errors: c.errors,
        warnings: c.warnings,
        info: c.info,
      } as unknown as Prisma.InputJsonObject,
      settings: { ...v.settings },
      detectedPeriod: v.layout.period ?? undefined,
      detectedOrganisation: v.layout.organisation?.slice(0, 300) ?? null,
      acknowledgements: v.acknowledged,
      createdById: v.createdById,
      ...(v.createdAt ? { createdAt: v.createdAt } : {}),
    },
  });
  await db.tbLine.createMany({
    data: c.lines.map((l) => ({
      tbVersionId: version.id,
      accountCode: l.accountCode.slice(0, 40),
      accountName: l.accountName.slice(0, 200),
      amount: l.amount,
      sourceRows: l.sourceRows,
      zero: l.zero,
    })),
  });
  return version;
}
