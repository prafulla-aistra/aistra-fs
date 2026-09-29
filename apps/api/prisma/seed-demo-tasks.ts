/**
 * DEMO DATA — close tasks for the dashboard. Seeded only when DEMO_MODE=true, every row is
 * flagged is_demo, and `npm run demo:remove-tasks` deletes them all.
 *
 *   Jul-2026 Monthly SFS  all 7 entities Finalised           → Done (locked)
 *   Jul-2026 Monthly CFS  all 4 levels Finalised             → Done (locked)
 *   Aug-2026 Monthly SFS  US, UK, UC Finalised; IN In review;
 *                         AE In progress; VS, VM Not started → In review
 *   Aug-2026 CFS          not created
 */
import type { PrismaClient, TaskItemStatus } from '@prisma/client';
import { calculateDueDate, deriveConsolidationLevels } from '@finance-close/engine';
import { fromDbDate, toDbDate } from '../src/common/db-dates';

const at = (iso: string) => new Date(iso);

export async function seedDemoTasks(prisma: PrismaClient): Promise<void> {
  const priya = await prisma.user.findUnique({ where: { email: 'priya@financeclose.local' } });
  const rahul = await prisma.user.findUnique({ where: { email: 'rahul@financeclose.local' } });
  const jul = await prisma.period.findFirst({ where: { type: 'MONTHLY', label: 'Jul-2026' } });
  const aug = await prisma.period.findFirst({ where: { type: 'MONTHLY', label: 'Aug-2026' } });
  if (!priya || !rahul || !jul || !aug) {
    console.warn('Demo tasks skipped: demo users or FY 2026-27 periods are missing.');
    return;
  }

  const entities = await prisma.entity.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  const levels = deriveConsolidationLevels(
    entities.map((e) => ({
      code: e.code,
      name: e.shortName,
      parentCode: e.parentCode,
      heldByParentPct: e.heldByParentPct?.toString() ?? null,
      reportingCurrency: e.reportingCurrency,
    })),
  );
  const rules = await prisma.dueDateRule.findMany();
  const holidays = (await prisma.holiday.findMany()).map((h) => fromDbDate(h.date));
  const dueDate = (period: { endDate: Date }, type: 'SFS' | 'CFS') => {
    const days =
      rules.find((r) => r.statementType === type && r.periodType === 'MONTHLY')?.workingDays ?? 0;
    return toDbDate(calculateDueDate(fromDbDate(period.endDate), days, holidays));
  };

  const sfs = async (
    number: string,
    period: typeof jul,
    statuses: Record<string, TaskItemStatus>,
    dates: { created: string; updated: string; finalised?: string; completed?: string },
    currentStep: string,
  ) => {
    if (await prisma.task.findUnique({ where: { number } })) return;
    const stepFor = (s: TaskItemStatus) =>
      ({
        NOT_STARTED: 'UPLOAD_TB',
        IN_PROGRESS: 'MAPPING',
        IN_REVIEW: 'REVIEW',
        FINALISED: 'FINALISED',
      })[s];
    await prisma.task.create({
      data: {
        number,
        type: 'SFS',
        periodId: period.id,
        description: `Monthly standalone financial statements — ${period.label}`,
        dueDate: dueDate(period, 'SFS'),
        currentStep,
        createdById: priya.id,
        createdAt: at(dates.created),
        updatedAt: at(dates.updated),
        completedAt: dates.completed ? at(dates.completed) : null,
        isDemo: true,
        entities: {
          create: entities.map((e) => {
            const status = statuses[e.code] ?? 'NOT_STARTED';
            return {
              entityCode: e.code,
              status,
              currentStep: stepFor(status),
              ...(status === 'FINALISED'
                ? { finalisedById: rahul.id, finalisedAt: at(dates.finalised ?? dates.updated) }
                : {}),
            };
          }),
        },
      },
    });
    console.log(`Demo task created: ${number}`);
  };

  const allFinal = Object.fromEntries(entities.map((e) => [e.code, 'FINALISED' as const]));
  await sfs(
    'SFS-2026-07-001',
    jul,
    allFinal,
    {
      created: '2026-08-01T09:00:00+05:30',
      updated: '2026-08-10T17:30:00+05:30',
      finalised: '2026-08-10T17:30:00+05:30',
      completed: '2026-08-10T17:30:00+05:30',
    },
    'FINALISED',
  );

  if (!(await prisma.task.findUnique({ where: { number: 'CFS-2026-07-001' } }))) {
    await prisma.task.create({
      data: {
        number: 'CFS-2026-07-001',
        type: 'CFS',
        periodId: jul.id,
        description: `Monthly consolidated financial statements — ${jul.label}`,
        dueDate: dueDate(jul, 'CFS'),
        currentStep: 'FINALISED',
        createdById: priya.id,
        createdAt: at('2026-08-11T10:00:00+05:30'),
        updatedAt: at('2026-08-18T16:00:00+05:30'),
        completedAt: at('2026-08-18T16:00:00+05:30'),
        isDemo: true,
        levels: {
          create: levels.map((l) => ({
            level: l.level,
            name: l.name,
            parentEntityCode: l.parentCode,
            currency: l.currency,
            members: l.members,
            status: 'FINALISED' as const,
            currentStep: 'FINALISED',
            finalisedById: rahul.id,
            finalisedAt: at('2026-08-18T16:00:00+05:30'),
          })),
        },
      },
    });
    console.log('Demo task created: CFS-2026-07-001');
  }

  await sfs(
    'SFS-2026-08-001',
    aug,
    {
      US: 'FINALISED',
      UK: 'FINALISED',
      UC: 'FINALISED',
      IN: 'IN_REVIEW',
      AE: 'IN_PROGRESS',
      VS: 'NOT_STARTED',
      VM: 'NOT_STARTED',
    },
    {
      created: '2026-09-01T09:15:00+05:30',
      updated: '2026-09-25T15:40:00+05:30',
      finalised: '2026-09-18T12:00:00+05:30',
    },
    'MAPPING',
  );
}
