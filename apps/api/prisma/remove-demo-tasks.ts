/**
 * Removes every DEMO close task (is_demo = true) — `npm run demo:remove-tasks`.
 * Real tasks are never touched. The removal is recorded in the audit log.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { withConnectionDefaults } from '../src/prisma/database-url';

const prisma = new PrismaClient({
  datasourceUrl: withConnectionDefaults(process.env.DATABASE_URL ?? ''),
});

async function main(): Promise<void> {
  const demo = await prisma.task.findMany({ where: { isDemo: true }, select: { number: true } });
  if (demo.length === 0) {
    console.log('No demo tasks to remove.');
    return;
  }
  await prisma.$transaction([
    prisma.task.deleteMany({ where: { isDemo: true } }), // entities and levels cascade
    prisma.auditLog.create({
      data: {
        action: 'DEMO_TASKS_REMOVED',
        entityType: 'TASK',
        entityId: 'demo',
        oldValue: { tasks: demo.map((t) => t.number).sort() },
      },
    }),
  ]);
  console.log(`Removed ${demo.length} demo task(s): ${demo.map((t) => t.number).join(', ')}.`);
  console.log(
    'They come back on the next "npm run dev" while DEMO_MODE=true; set DEMO_MODE=false to keep them out.',
  );
}

main()
  .catch((err: unknown) => {
    console.error('Failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
