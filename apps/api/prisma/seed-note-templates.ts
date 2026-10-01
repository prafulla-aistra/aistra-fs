/**
 * Note templates per report format (Configuration → Report formats → Notes). Create-only: once a
 * format has templates, the Configuration page owns them. Text may use placeholders filled from
 * the entity master when a note set starts: {legalName}, {country}, {functionalCurrency},
 * {gaap}, {erp}, {periodLabel}, {periodEnd}, {periodSpan}.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

type Block = Record<string, unknown>;
const doc = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })),
});
export const textBlock = (label: string, ...paragraphs: string[]): Block => ({
  id: randomUUID(),
  type: 'TEXT',
  label,
  doc: doc(...paragraphs),
});
export const tableBlock = (label: string, rows: [string, string, string][] = []): Block => ({
  id: randomUUID(),
  type: 'TABLE',
  label,
  columns: [
    { id: 'nature', label: 'Nature', numeric: false, period: null },
    { id: 'current', label: 'Current period', numeric: true, period: 'CURRENT' },
    { id: 'comparative', label: 'Comparative period', numeric: true, period: 'COMPARATIVE' },
  ],
  rows: rows.map(([nature, current, comparative]) => ({
    id: randomUUID(),
    cells: { nature, current, comparative },
  })),
  mode: 'MEMO',
  agreeLine: null,
});

const CORPORATE = textBlock(
  '',
  '{legalName} ("the Company") is incorporated in {country}. Its functional currency is {functionalCurrency}.',
);
const BASIS = textBlock(
  '',
  'These standalone financial statements for the {periodSpan} ended {periodEnd} ({periodLabel}) have been prepared in accordance with {gaap} on the historical cost basis, from the trial balance extracted from {erp}. They are presented in {functionalCurrency}.',
);
const POLICIES = [
  textBlock(
    'Revenue recognition',
    'Revenue from services is recognised as the services are rendered, at the amount of consideration the Company expects to be entitled to.',
  ),
  textBlock(
    'Property, plant and equipment and depreciation',
    'Property, plant and equipment are stated at cost less accumulated depreciation. Depreciation is charged on a straight-line basis over the useful lives of the assets.',
  ),
  textBlock(
    'Foreign currency',
    'Transactions in foreign currencies are recorded at the rate on the date of the transaction; monetary items are restated at the closing rate and differences are taken to profit or loss.',
  ),
  textBlock(
    'Employee benefits',
    'Short-term employee benefits are expensed as the related service is provided. Post-employment benefits follow the applicable plans.',
  ),
  textBlock(
    'Income taxes',
    'Current tax is provided at the amount expected to be paid. Deferred tax is recognised on temporary differences.',
  ),
  textBlock(
    'Leases',
    'Right-of-use assets and lease liabilities are recognised for leases other than short-term and low-value leases.',
  ),
  textBlock(
    'Financial instruments',
    'Financial assets and liabilities are recognised when the Company becomes a party to the contract and are measured at amortised cost unless stated otherwise.',
  ),
];
const RELATED = textBlock(
  '',
  'Balances and transactions with group entities are disclosed below. Full related party disclosure to follow.',
);

interface TemplateDef {
  title: string;
  kind: 'LINE' | 'NARRATIVE' | 'CUSTOM';
  lineKeys?: string[];
  blocks?: Block[];
  mandatory?: boolean;
}

export async function seedNoteTemplates(prisma: PrismaClient): Promise<void> {
  const formats = await prisma.format.findMany({
    include: { _count: { select: { noteTemplates: true } } },
  });
  let created = 0;
  for (const f of formats) {
    if (f._count.noteTemplates > 0) continue;
    const version = await prisma.formatVersion.findUnique({
      where: { formatCode_version: { formatCode: f.code, version: f.currentVersion } },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!version) continue;
    const lineNotes: TemplateDef[] = (['BS', 'PL'] as const).flatMap((st) => {
      const own = version.lines.filter((l) => l.statement === st);
      const plain = (label: string) => label.replace(/^\([a-z0-9]+\)\s*|^[IVX]+\s+/, '');
      // The headings a line sits under (nearest first).
      const parents = (i: number) => {
        const out: string[] = [];
        let indent = own[i]!.indent;
        for (let j = i - 1; j >= 0 && indent > 0; j--)
          if (own[j]!.type === 'HEADING' && own[j]!.indent < indent) {
            out.push(plain(own[j]!.label));
            indent = own[j]!.indent;
          }
        return out;
      };
      const rows = own
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => l.type === 'LINE')
        .map(({ l, i }) => {
          const ps = parents(i);
          const parent = ps[0];
          // The section a line belongs to: the nearest "... current ..." heading.
          const section = ps.find((h) => /current/i.test(h));
          let title = plain(l.label);
          if (title === 'Others' && parent) title = `Other ${parent.toLowerCase()}`;
          return { title, section, key: `${st}:${l.key}` };
        });
      return rows.map((r) => ({
        title:
          rows.filter((x) => x.title === r.title).length > 1 && r.section
            ? `${r.title} (${r.section.toLowerCase()})`
            : r.title,
        kind: 'LINE' as const,
        lineKeys: [r.key],
      }));
    });
    const full = f.code === 'STATUTORY';
    const defs: TemplateDef[] = [
      { title: 'Corporate information', kind: 'NARRATIVE', blocks: [CORPORATE], mandatory: true },
      { title: 'Basis of preparation', kind: 'NARRATIVE', blocks: [BASIS], mandatory: true },
      ...(full
        ? [
            {
              title: 'Significant accounting policies',
              kind: 'NARRATIVE' as const,
              blocks: POLICIES,
              mandatory: true,
            },
          ]
        : []),
      ...lineNotes,
      {
        title: 'Related party transactions and balances',
        kind: 'NARRATIVE',
        blocks: [RELATED],
        mandatory: full,
      },
      ...(full
        ? ([
            {
              title: 'Contingent liabilities and commitments',
              kind: 'CUSTOM',
              blocks: [tableBlock('Contingent liabilities and commitments')],
            },
            {
              title: 'Events after the reporting period',
              kind: 'NARRATIVE',
              blocks: [
                textBlock(
                  '',
                  'There were no significant events after the reporting period that require adjustment or disclosure.',
                ),
              ],
            },
            { title: 'Other information', kind: 'NARRATIVE', blocks: [textBlock('', '')] },
          ] as TemplateDef[])
        : []),
    ];
    await prisma.noteTemplate.createMany({
      data: defs.map((d, i) => ({
        formatCode: f.code,
        sortOrder: i + 1,
        title: d.title,
        kind: d.kind,
        lineKeys: d.lineKeys ?? [],
        defaultBlocks: (d.blocks ?? []) as unknown as Prisma.InputJsonValue,
        mandatory: d.mandatory ?? false,
      })),
    });
    created += defs.length;
  }
  if (created > 0) console.log(`Note templates seeded: ${created}`);
}
