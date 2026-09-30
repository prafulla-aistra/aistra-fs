/**
 * DEMO DATA — stored statement figures (statement_snapshot) of the finalised entities in the
 * demo SFS tasks (Jul-2026: all; Aug-2026: US, UK, UC), made by the same code as the
 * statements step. Finalised statements read these instead of recalculating. Rebuilt when
 * the demo data is revised (SEED snapshots only). Oldest period first, so Aug comparatives
 * read Jul's snapshot.
 */
import type { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ComparativeSourceService } from '../src/uploads/comparative-source.service';
import { StatementFiguresService } from '../src/uploads/statement-figures';
import { stepInclude } from '../src/uploads/step-access';
import { TranslationService } from '../src/uploads/translation.service';

export async function seedDemoStatements(client: PrismaClient): Promise<void> {
  const prisma = client as unknown as PrismaService;
  const sources = new ComparativeSourceService(prisma);
  const translation = new TranslationService(prisma, null as never, sources);
  const figures = new StatementFiguresService(prisma, sources, translation);
  const tasks = await client.task.findMany({
    where: { isDemo: true, type: 'SFS', entities: { some: { status: 'FINALISED' } } },
    include: stepInclude,
    orderBy: { period: { startDate: 'asc' } },
  });
  let written = 0;
  for (const task of tasks)
    for (const te of task.entities.filter((e) => e.status === 'FINALISED'))
      if (await figures.store(task, te, 'SEED')) written++;
  if (written > 0) console.log(`Demo statement snapshots written: ${written}`);
}
