/**
 * Database seed entry point — run with `npm run db:seed` (also run by `npm run dev`).
 *
 * Seeds must be idempotent (safe to run repeatedly): use upserts keyed on business
 * codes, never blind inserts. The group structure, periods and reference data from
 * CLAUDE.md are added here as their tables are introduced in later steps.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // Confirms the seed can reach the database; no tables exist yet in this step.
  await prisma.$queryRaw`SELECT 1`;
  console.log('Seed complete (nothing to seed yet).');
}

main()
  .catch((err: unknown) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
