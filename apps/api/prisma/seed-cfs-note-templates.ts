/**
 * Page 10: consolidation note templates for every report format (applies to CFS only). Runs
 * once (marker: audit_log SEED_APPLIED page10-cfs-note-templates-v2); after that Configuration
 * owns the templates. It also marks the standalone "Basis of preparation" note as SFS only (the
 * consolidation uses "Basis of consolidation" instead).
 */
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { textBlock } from './seed-note-templates';

const MARKER = {
  action: 'SEED_APPLIED',
  entityType: 'SEED',
  entityId: 'page10-cfs-note-templates-v2',
};
const generated = (source: string, label = '') => ({
  id: randomUUID(),
  type: 'GENERATED',
  source,
  label,
});

const BASIS_OF_CONSOLIDATION = textBlock(
  '',
  'These consolidated financial statements for the {periodSpan} ended {periodEnd} ({periodLabel}) comprise {legalName} (the parent) and its subsidiaries: {subsidiaries}. Subsidiaries are consolidated from the date control is obtained.',
  'They are presented in {levelCurrency}. Each entity is translated directly from its functional currency into {levelCurrency}: assets and liabilities at the closing rate, income and expenses at the average rate, share capital and securities premium at historical rates, and retained earnings rolled forward from the previous period. The resulting exchange differences are recognised in the foreign currency translation reserve.',
  'Intercompany balances and transactions are eliminated. The investment in each subsidiary is eliminated against its share capital, premium and pre-acquisition reserves; any excess of cost is goodwill and any shortfall a capital reserve. Non-controlling interests are measured at their proportionate share of the subsidiary’s net assets.',
);

export async function seedCfsNoteTemplates(prisma: PrismaClient): Promise<void> {
  if (await prisma.auditLog.findFirst({ where: MARKER })) return;
  if ((await prisma.noteTemplate.count({ where: { appliesTo: 'CFS' } })) > 0) {
    await prisma.auditLog.create({
      data: { ...MARKER, newValue: { templates: 'already present' } },
    });
    return;
  }
  const formats = await prisma.format.findMany();
  let created = 0;
  for (const f of formats) {
    const version = await prisma.formatVersion.findUnique({
      where: { formatCode_version: { formatCode: f.code, version: f.currentVersion } },
      include: { lines: true },
    });
    const hasLine = (k: string) =>
      Boolean(version?.lines.some((l) => l.statement === 'BS' && l.key === k && l.type === 'LINE'));
    // NCI and goodwill: on their statement line when the format has one (figures + generated
    // table), else a narrative note. The standalone line templates of those lines become SFS only.
    const lineNote = async (k: string, title: string, source: string, sortOrder: number) => {
      if (!hasLine(k))
        return {
          title,
          sortOrder,
          kind: 'NARRATIVE' as const,
          lineKeys: [] as string[],
          blocks: [generated(source)],
          mandatory: false,
        };
      const lineKey = `BS:${k}`;
      const existing = await prisma.noteTemplate.findFirst({
        where: { formatCode: f.code, lineKeys: { has: lineKey } },
      });
      await prisma.noteTemplate.updateMany({
        where: { formatCode: f.code, lineKeys: { has: lineKey }, appliesTo: 'ALL' },
        data: { appliesTo: 'SFS' },
      });
      return {
        title: existing?.title ?? title,
        sortOrder: existing?.sortOrder ?? sortOrder,
        kind: 'LINE' as const,
        lineKeys: [lineKey],
        blocks: [generated(source)],
        mandatory: false,
      };
    };
    const defs = [
      {
        title: 'Basis of consolidation',
        sortOrder: 2,
        kind: 'NARRATIVE' as const,
        lineKeys: [] as string[],
        blocks: [BASIS_OF_CONSOLIDATION],
        mandatory: true,
      },
      {
        title: 'List of subsidiaries',
        sortOrder: 2,
        kind: 'NARRATIVE' as const,
        lineKeys: [] as string[],
        blocks: [generated('SUBSIDIARIES')],
        mandatory: true,
      },
      await lineNote('goodwill', 'Goodwill', 'GOODWILL', 901),
      await lineNote('nci', 'Non-controlling interests', 'NCI', 902),
      {
        title: 'Intercompany eliminations',
        sortOrder: 903,
        kind: 'NARRATIVE' as const,
        lineKeys: [] as string[],
        blocks: [generated('IC_SUMMARY')],
        mandatory: true,
      },
      {
        title: 'Foreign currency translation reserve',
        sortOrder: 904,
        kind: 'NARRATIVE' as const,
        lineKeys: [] as string[],
        blocks: [generated('FCTR')],
        mandatory: false,
      },
    ];
    await prisma.noteTemplate.createMany({
      data: defs.map((d) => ({
        formatCode: f.code,
        sortOrder: d.sortOrder,
        title: d.title,
        kind: d.kind,
        lineKeys: d.lineKeys,
        defaultBlocks: d.blocks as unknown as Prisma.InputJsonValue,
        mandatory: d.mandatory,
        appliesTo: 'CFS',
      })),
    });
    created += defs.length;
    await prisma.noteTemplate.updateMany({
      where: { formatCode: f.code, title: 'Basis of preparation', appliesTo: 'ALL' },
      data: { appliesTo: 'SFS' },
    });
  }
  await prisma.auditLog.create({ data: { ...MARKER, newValue: { templates: created } } });
  if (created > 0) console.log(`Consolidation note templates seeded: ${created}`);
}
