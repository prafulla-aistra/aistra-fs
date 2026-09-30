import { Injectable } from '@nestjs/common';
import type { ChartOfAccountDto } from '@finance-close/shared';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';

const SOURCE_LABELS = {
  SEED: 'Seed',
  COA_UPLOAD: 'Chart of accounts upload',
  TASK_MAPPING: 'Mapped in task',
} as const;

/** An entity's chart of accounts with its FSLI mapping and where each mapping came from. */
@Injectable()
export class ChartOfAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(entityCode: string): Promise<ChartOfAccountDto[]> {
    if (!(await this.prisma.entity.findUnique({ where: { code: entityCode } })))
      throw ApiError.notFound(`Entity ${entityCode} not found.`);
    const rows = await this.prisma.entityAccount.findMany({
      where: { entityCode },
      include: {
        fsli: { select: { name: true } },
        mappedInTask: { select: { number: true } },
        updatedBy: { select: { name: true } },
      },
      orderBy: { accountCode: 'asc' },
    });
    return rows.map((a) => ({
      accountCode: a.accountCode,
      accountName: a.accountName,
      accountType: a.accountType,
      fsliCode: a.fsliCode,
      fsliName: a.fsli?.name ?? null,
      counterpartyCode: a.counterpartyCode,
      source: a.source,
      sourceLabel:
        a.source === 'TASK_MAPPING' && a.mappedInTask
          ? `Mapped in task ${a.mappedInTask.number}`
          : SOURCE_LABELS[a.source],
      suggested: a.suggested,
      updatedBy: a.updatedBy?.name ?? null,
      updatedAt: a.updatedAt.toISOString(),
    }));
  }
}
