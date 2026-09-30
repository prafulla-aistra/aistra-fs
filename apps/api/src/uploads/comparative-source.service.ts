import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { comparativePeriod, generatePeriods, type TbLineInput } from '@finance-close/engine';
import type { ComparativeBasis, ComparativeSourceKind } from '@finance-close/shared';
import { fromDbDate } from '../common/db-dates';
import { PrismaService } from '../prisma/prisma.service';
import type { StepTask } from './step-access';

type VersionWithLines = Prisma.TbVersionGetPayload<{
  include: { lines: true; file: true; task: true };
}>;

export interface ComparativePeriodRef {
  /** null when the period is not in the calendar (its financial year was never created). */
  id: string | null;
  label: string;
  startDate: string;
  endDate: string;
}

export interface ResolvedComparative {
  period: ComparativePeriodRef;
  kind: ComparativeSourceKind;
  version: VersionWithLines | null;
  /** A finalised comparative exists: uploading one here is not offered. */
  finalisedExists: boolean;
}

const include = { lines: { orderBy: { accountCode: 'asc' as const } }, file: true, task: true };

/**
 * Finds the comparative period of a task and the TB to compare with, in this order:
 *   1. Finalised — the entity's finalised SFS for that period;
 *   2. Draft — a validated TB for that period in another task;
 *   3. Uploaded here — a comparative TB uploaded on this task's comparatives step;
 *   4. None.
 */
@Injectable()
export class ComparativeSourceService {
  constructor(private readonly prisma: PrismaService) {}

  /** The comparative period (the task's basis unless another is given). */
  async period(
    task: StepTask,
    basis: ComparativeBasis = task.comparativeBasis,
  ): Promise<ComparativePeriodRef> {
    const ref = comparativePeriod(
      {
        type: task.period.type,
        sequence: task.period.sequence,
        fyStartYear: task.period.financialYear.startYear,
      },
      basis,
    );
    const row = await this.prisma.period.findFirst({
      where: {
        type: ref.type,
        sequence: ref.sequence,
        financialYear: { startYear: ref.fyStartYear },
      },
    });
    if (row)
      return {
        id: row.id,
        label: row.label,
        startDate: fromDbDate(row.startDate),
        endDate: fromDbDate(row.endDate),
      };
    const g = generatePeriods(ref.fyStartYear).find(
      (x) => x.type === ref.type && x.sequence === ref.sequence,
    )!;
    return { id: null, label: g.label, startDate: g.startDate, endDate: g.endDate };
  }

  /** Latest validated TB of the entity in a task (current or comparative purpose). */
  private latestValid(where: Prisma.TbVersionWhereInput) {
    return this.prisma.tbVersion.findFirst({
      where: { ...where, status: { not: 'ERROR' } },
      orderBy: [{ createdAt: 'desc' }, { version: 'desc' }],
      include,
    });
  }

  async resolve(
    task: StepTask,
    entityCode: string,
    basis: ComparativeBasis = task.comparativeBasis,
  ): Promise<ResolvedComparative> {
    const period = await this.period(task, basis);
    if (!period.id) return { period, kind: 'NONE', version: null, finalisedExists: false };

    const others = await this.prisma.taskEntity.findMany({
      where: { entityCode, taskId: { not: task.id }, task: { type: 'SFS', periodId: period.id } },
      include: { task: true },
      orderBy: { task: { createdAt: 'desc' } },
    });
    for (const te of others.filter((o) => o.status === 'FINALISED')) {
      const v = await this.latestValid({ taskId: te.taskId, entityCode, purpose: 'CURRENT' });
      if (v) return { period, kind: 'FINALISED', version: v, finalisedExists: true };
    }
    const finalisedExists = others.some((o) => o.status === 'FINALISED');
    for (const te of others.filter((o) => o.status !== 'FINALISED')) {
      const v = await this.latestValid({ taskId: te.taskId, entityCode, purpose: 'CURRENT' });
      if (v) return { period, kind: 'DRAFT', version: v, finalisedExists };
    }
    const uploaded = await this.latestValid({
      taskId: task.id,
      entityCode,
      purpose: 'COMPARATIVE',
      periodId: period.id,
    });
    if (uploaded) return { period, kind: 'UPLOADED', version: uploaded, finalisedExists };
    return { period, kind: 'NONE', version: null, finalisedExists };
  }

  /** Comparative TB lines (for mapping comparative-only accounts). */
  lines(version: VersionWithLines | null): TbLineInput[] {
    return (version?.lines ?? []).map((l) => ({
      accountCode: l.accountCode,
      accountName: l.accountName,
      accountType: l.accountType,
      amount: l.amount.toFixed(2),
    }));
  }
}
