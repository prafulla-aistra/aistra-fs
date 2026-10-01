/**
 * DEMO DATA — the finalised Jul-2026 India note set (demo SFS-2026-07-001), so the Aug-2026
 * Notes step rolls forward from it: started from the Statutory note templates, with a few text
 * blocks, cash sub-captions, a live figure, a custom table and one typed figure that changes
 * in Aug (prepaid expenses 1,200,000; the stale-number check flags it). All reviewed.
 * Create-only: an existing Jul note set is left alone.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ComparativeSourceService } from '../src/uploads/comparative-source.service';
import { NotesService } from '../src/uploads/notes.service';
import { StatementFiguresService } from '../src/uploads/statement-figures';
import { stepInclude } from '../src/uploads/step-access';
import { TranslationService } from '../src/uploads/translation.service';
import { tableBlock, textBlock } from './seed-note-templates';

type Extra = {
  blocks: Record<string, unknown>[];
  subCaptions?: { label: string; accounts: string[] }[];
};

export async function seedDemoNotes(client: PrismaClient): Promise<void> {
  const prisma = client as unknown as PrismaService;
  const sources = new ComparativeSourceService(prisma);
  const figures = new StatementFiguresService(
    prisma,
    sources,
    new TranslationService(prisma, null as never, sources),
  );
  const notes = new NotesService(prisma, new AuditService(prisma), figures);
  const task = await client.task.findUnique({
    where: { number: 'SFS-2026-07-001' },
    include: stepInclude,
  });
  const te = task?.entities.find((e) => e.entityCode === 'IN' && e.status === 'FINALISED');
  if (!task?.isDemo || !te) return;
  const created = await notes.storeInitialSet(task, te);
  if (!created) return;
  const priya = await client.user.findUnique({ where: { email: 'priya@financeclose.local' } });

  const byLine = (key: string) => created.find((n) => n.lineKeys.includes(key));
  const extra = new Map<string, Extra>();
  const deposits = byLine('BS:ca_oth');
  if (deposits)
    extra.set(deposits.id, {
      blocks: [
        textBlock(
          'Deposits and prepayments',
          'The security deposit of 12,350,000 is held by the landlord of the Bengaluru office.',
          'Prepaid expenses of 1,200,000 relate to annual software licences paid in advance.',
        ),
      ],
    });
  const receivables = byLine('BS:trade_rec');
  if (receivables)
    extra.set(receivables.id, {
      blocks: [
        textBlock(
          'Terms and conditions',
          'Trade receivables are non-interest bearing and are generally on terms of 30 to 60 days.',
        ),
      ],
    });
  const cash = byLine('BS:cash');
  if (cash)
    extra.set(cash.id, {
      subCaptions: [
        { label: 'Balances with banks', accounts: ['1010'] },
        { label: 'Cash on hand', accounts: ['1020'] },
      ],
      blocks: [
        {
          id: randomUUID(),
          type: 'TEXT',
          label: '',
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'Balances with banks of ' },
                  { type: 'figure', attrs: { source: 'ACCOUNT', key: '1010', measure: 'current' } },
                  { type: 'text', text: ' are held in current accounts with scheduled banks.' },
                ],
              },
            ],
          },
        },
      ],
    });
  const commitments = created.find((n) => n.title === 'Contingent liabilities and commitments');
  if (commitments)
    extra.set(commitments.id, {
      blocks: [
        tableBlock('Contingent liabilities and commitments', [
          [
            'Estimated amount of contracts remaining to be executed on capital account',
            '2,500,000',
            '2,000,000',
          ],
          ['Bank guarantees given', '1,000,000', '1,000,000'],
        ]),
      ],
    });

  for (const n of created) {
    const x = extra.get(n.id);
    let blocks = n.blocks as unknown as Record<string, unknown>[];
    if (x?.subCaptions)
      blocks = blocks.map((b) =>
        b.type === 'FIGURES'
          ? { ...b, subCaptions: x.subCaptions!.map((s) => ({ id: randomUUID(), ...s })) }
          : b,
      );
    if (x?.blocks) blocks = n.kind === 'CUSTOM' ? x.blocks : [...blocks, ...x.blocks];
    await client.entityNote.update({
      where: { id: n.id },
      data: {
        blocks: blocks as unknown as Prisma.InputJsonValue,
        status: 'REVIEWED',
        reviewedById: priya?.id ?? null,
        reviewedAt: new Date('2026-08-10T10:00:00Z'),
        updatedById: priya?.id ?? null,
      },
    });
    await client.entityNoteVersion.create({
      data: {
        noteId: n.id,
        version: 1,
        title: n.title,
        blocks: blocks as unknown as Prisma.InputJsonValue,
        status: 'REVIEWED',
        editedById: priya?.id ?? null,
      },
    });
  }
  console.log(`Demo Jul-2026 India notes seeded: ${created.length}`);
}
