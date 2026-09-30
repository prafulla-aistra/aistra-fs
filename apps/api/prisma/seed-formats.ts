/**
 * Report formats: names and version-1 lines from format-definitions.ts. A format that
 * already has versions is left alone (the Configuration editor owns it); only its row is
 * created if missing.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { FormatLine } from '@finance-close/engine';
import { FORMAT_DEFINITIONS } from './format-definitions';

export function formatLineRows(
  versionId: string,
  lines: readonly FormatLine[],
): Prisma.FormatLineCreateManyInput[] {
  const order = { PL: 0, BS: 0 };
  return lines.map((l) => ({
    versionId,
    statement: l.statement,
    sortOrder: ++order[l.statement],
    key: l.key,
    type: l.type,
    label: l.label,
    indent: l.indent,
    fslis: l.fslis,
    formula: l.formula as unknown as Prisma.InputJsonValue,
    role: l.role,
  }));
}

export async function seedFormats(prisma: PrismaClient): Promise<void> {
  for (const f of FORMAT_DEFINITIONS) {
    const existing = await prisma.format.findUnique({
      where: { code: f.code },
      include: { _count: { select: { versions: true } } },
    });
    if (existing && existing._count.versions > 0) continue;
    await prisma.$transaction(async (tx) => {
      // The C2 rename of the two original formats happens once, with their first version.
      await tx.format.upsert({
        where: { code: f.code },
        create: {
          code: f.code,
          name: f.name,
          description: f.description,
          sortOrder: f.sortOrder,
          currentVersion: 1,
        },
        update: {
          name: f.name,
          description: f.description,
          sortOrder: f.sortOrder,
          currentVersion: 1,
        },
      });
      const v = await tx.formatVersion.create({
        data: { formatCode: f.code, version: 1, note: 'Seeded layout' },
      });
      await tx.formatLine.createMany({ data: formatLineRows(v.id, f.lines) });
    });
  }
}
