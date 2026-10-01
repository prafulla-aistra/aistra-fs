/**
 * Prepares the TEST database for the Playwright browser journey (npm run test:browser):
 * the same setup as the API integration tests (embedded server, migrations, seed with the
 * test settings), then puts the journey's starting point back: India's Aug-26 new accounts
 * (1455, 6120) are not yet mapped. The development database is never touched.
 */
import { PrismaClient } from '@prisma/client';
import globalSetup from './global-setup';

async function main() {
  // Playwright passes the test database URL; use it as is (do not derive another _test name).
  if (process.env.DATABASE_URL) process.env.TEST_DATABASE_URL ??= process.env.DATABASE_URL;
  globalSetup();
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  const db =
    (await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`)[0]?.db ?? '';
  if (!db.endsWith('_test')) throw new Error(`Refusing to prepare ${db}: not a test database`);
  await prisma.entityAccount.deleteMany({
    where: { entityCode: 'IN', accountCode: { in: ['1455', '6120'] } },
  });
  // The configuration journey adds entity ZSG; remove it so every run starts the same.
  for (const where of [{ entityCode: 'ZSG' }]) {
    await prisma.entityOwnership.deleteMany({ where });
    await prisma.entityHistoricalRate.deleteMany({ where });
    await prisma.entityTranslatedCurrency.deleteMany({ where });
  }
  await prisma.entity.deleteMany({ where: { code: 'ZSG' } });
  const aug = await prisma.task.findUnique({ where: { number: 'SFS-2026-08-001' } });
  if (aug) await prisma.entityNote.deleteMany({ where: { taskId: aug.id, entityCode: 'IN' } });
  await prisma.task.updateMany({
    where: { number: 'SFS-2026-08-001' },
    data: { comparativeBasis: 'PREVIOUS_PERIOD' },
  });
  await prisma.$disconnect();
  console.log(`Browser test database ready: ${db}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
