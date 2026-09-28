import type { Prisma } from '@prisma/client';
import { fyLabel, generatePeriods } from '@finance-close/engine';
import { toDbDate } from '../../common/db-dates';

/**
 * Row data for a financial year and its 17 generated periods (12 months, 4 quarters,
 * 1 annual). Shared by the API and the seed so both create identical calendars.
 */
export function financialYearCreateData(
  startYear: number,
  createdById: string | null,
): Prisma.FinancialYearCreateInput {
  const periods = generatePeriods(startYear);
  const annual = periods.find((p) => p.type === 'ANNUAL')!;
  return {
    startYear,
    label: fyLabel(startYear),
    startDate: toDbDate(annual.startDate),
    endDate: toDbDate(annual.endDate),
    ...(createdById ? { createdBy: { connect: { id: createdById } } } : {}),
    periods: {
      create: periods.map((p) => ({
        type: p.type,
        sequence: p.sequence,
        label: p.label,
        startDate: toDbDate(p.startDate),
        endDate: toDbDate(p.endDate),
      })),
    },
  };
}
