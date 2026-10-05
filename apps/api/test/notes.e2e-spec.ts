import JSZip from 'jszip';
import type {
  EntityNotesDto,
  EntityStatementsDto,
  NoteDto,
  NoteTemplatesDto,
  PriorNoteDto,
  TableBlockDto,
  TextBlockDto,
} from '@finance-close/shared';
import { SAMPLE_ENTITIES } from '../prisma/sample-data';
import { tbFileName, trialBalanceFile } from '../prisma/sample-files';
import { DEMO_USERS } from '../prisma/seed-demo';
import {
  createTestApp,
  deleteNonDemoTasks,
  ensureSampleTb,
  MASTER,
  type TestContext,
  tokenFor,
} from './helpers';

/**
 * Notes to accounts: India Aug-2026 rolled forward from the seeded, finalised Jul-2026 notes.
 * Logic only (the demo figures are not verified): roll forward, live figures, stale numbers,
 * sub-captions tie to the face, review status, custom notes, exports, template rules.
 */
let ctx: TestContext;
let priya: string;
let master: string;
let augTaskId: string;
let julTaskId: string;
const pw = (email: string) => DEMO_USERS.find((d) => d.email === email)!.password;
const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const base = () => `/api/tasks/${augTaskId}/entities/IN`;

async function notes(q = ''): Promise<EntityNotesDto> {
  const res = await ctx.http().get(`${base()}/notes${q}`).set(as(priya));
  expect(res.status).toBe(200);
  return res.body as EntityNotesDto;
}
const byLine = (d: EntityNotesDto, key: string) => d.notes.find((n) => n.lineKeys.includes(key))!;
const save = (n: NoteDto, patch: Partial<Pick<NoteDto, 'title' | 'blocks'>>) =>
  ctx
    .http()
    .put(`${base()}/notes/${n.id}`)
    .set(as(priya))
    .send({
      title: patch.title ?? n.title,
      blocks: patch.blocks ?? n.blocks,
      baseVersion: n.version,
    });

beforeAll(async () => {
  process.env.DEMO_MODE = 'true';
  ctx = await createTestApp();
  await deleteNonDemoTasks(ctx);
  priya = await tokenFor(ctx, 'priya@financeclose.local', pw('priya@financeclose.local'));
  master = await tokenFor(ctx, MASTER.email, MASTER.password);
  augTaskId = (await ctx.prisma.task.findUniqueOrThrow({ where: { number: 'SFS-2026-08-001' } }))
    .id;
  julTaskId = (await ctx.prisma.task.findUniqueOrThrow({ where: { number: 'SFS-2026-07-001' } }))
    .id;
  const rows = await ctx.prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!rows[0]?.db.endsWith('_test')) throw new Error('not a test database');
  await ctx.prisma.entityNote.deleteMany({ where: { taskId: augTaskId, entityCode: 'IN' } });
  await ensureSampleTb(
    ctx,
    priya,
    augTaskId,
    'IN',
    trialBalanceFile(
      SAMPLE_ENTITIES.find((e) => e.code === 'IN')!,
      'aug',
    ),
    tbFileName('IN', 'aug'),
  );
  await ctx.prisma.entityAccount.createMany({
    data: [
      {
        entityCode: 'IN',
        accountCode: '1455',
        accountName: 'Advance to Suppliers',
        accountType: 'Other Current Asset',
        fsliCode: 'CUR_OTH',
        source: 'TASK_MAPPING',
        suggested: false,
      },
      {
        entityCode: 'IN',
        accountCode: '6120',
        accountName: 'Staff Welfare Expenses',
        accountType: 'Expense',
        fsliCode: 'EMP',
        source: 'TASK_MAPPING',
        suggested: false,
      },
    ],
    skipDuplicates: true,
  });
});
afterAll(async () => {
  if (ctx) {
    await ctx.prisma.entityNote.deleteMany({ where: { taskId: augTaskId, entityCode: 'IN' } });
    await ctx.prisma.entityAccount.deleteMany({
      where: { source: 'TASK_MAPPING', accountCode: { in: ['1455', '6120'] } },
    });
  }
  await ctx?.app.close();
});

describe('roll forward from the finalised Jul-2026 notes', () => {
  it('copies every note, block, sub-caption and table; notes start "carried forward"', async () => {
    const d = await notes();
    expect(d.rolledFrom).toEqual({ taskNumber: 'SFS-2026-07-001', periodLabel: 'Jul-2026' });
    const jul = await ctx.prisma.entityNote.findMany({
      where: { taskId: julTaskId, entityCode: 'IN' },
      orderBy: { sortOrder: 'asc' },
    });
    expect(d.notes.map((n) => n.title).slice(0, jul.length)).toEqual(jul.map((n) => n.title));
    expect(d.notes.filter((n) => n.carriedFrom).every((n) => n.status === 'CARRIED_FORWARD')).toBe(
      true,
    );
    expect(d.progress.text).toBe(`0 of ${d.notes.filter((n) => !n.hidden).length} notes reviewed`);
    const cash = byLine(d, 'BS:cash');
    expect(cash.figures[cash.blocks[0]!.id]!.groups.map((g) => g.label)).toEqual([
      'Balances with banks',
      'Cash on hand',
    ]);
    // Custom table: last period's current column moved to comparative; current left blank.
    const commitments = d.notes.find((n) => n.title === 'Contingent liabilities and commitments')!;
    const t = commitments.blocks.find((b) => b.type === 'TABLE') as TableBlockDto;
    expect(t.rows.map((r) => [r.cells.current, r.cells.comparative])).toEqual([
      ['', '2,500,000'],
      ['', '1,000,000'],
    ]);
    // Opening again does not roll forward twice.
    expect((await notes()).notes.length).toBe(d.notes.length);
  });

  it('numbers visible notes 1..n; the statements use the same numbers', async () => {
    const d = await notes();
    const visible = d.notes.filter((n) => !n.hidden);
    expect(visible.map((n) => n.number)).toEqual(visible.map((_, i) => i + 1));
    expect(d.notes.filter((n) => n.hidden).every((n) => n.number === null)).toBe(true);
    const s = (await ctx.http().get(`${base()}/statements`).set(as(priya)))
      .body as EntityStatementsDto;
    const tr = s.balanceSheet.rows.find((r) => r.key === 'trade_rec')!;
    expect(tr.note).toBe(byLine(d, 'BS:trade_rec').number);
  });
});

describe('live figures and the stale-number check', () => {
  it('a live token shows the Jul figure in Jul and the Aug figure in Aug', async () => {
    const d = await notes();
    const cash = byLine(d, 'BS:cash');
    const aug = d.catalog.find((c) => c.source === 'ACCOUNT' && c.key === '1010')!.values.current;
    const bank = cash.figures[cash.blocks[0]!.id]!.groups[0]!.accounts.find(
      (a) => a.code === '1010',
    )!;
    expect(aug).toBe(bank.current);
    const prior = (await ctx.http().get(`${base()}/notes/${cash.id}/prior`).set(as(priya)))
      .body as PriorNoteDto;
    const jul = prior.catalog.find((c) => c.source === 'ACCOUNT' && c.key === '1010')!.values
      .current;
    expect(prior.periodLabel).toBe('Jul-2026');
    expect(jul).toBe(bank.comparative);
    expect(jul).not.toBe(aug);
  });

  it('flags a typed figure that equals last period’s but not this period’s; not the unchanged one', async () => {
    const d = await notes();
    const deposits = byLine(d, 'BS:ca_oth');
    expect(deposits.stale.map((f) => f.number)).toEqual(['1,200,000']);
    expect(deposits.stale[0]!.message).toBe(
      "This looks like last period's figure (1,200,000). Update it or replace it with a live figure.",
    );
  });

  it('replacing the number with a live figure clears the flag; the side panel shows what changed', async () => {
    const d = await notes();
    const n = byLine(d, 'BS:ca_oth');
    const blocks = n.blocks.map((b) => {
      if (b.type !== 'TEXT') return b;
      const doc = JSON.parse(
        JSON.stringify(b.doc).replace(
          'Prepaid expenses of 1,200,000 relate',
          'Prepaid expenses of {{T}} relate',
        ),
      ) as TextBlockDto['doc'];
      const para = doc.content!.find((p) =>
        (p.content ?? []).some((c) => (c.text ?? '').includes('{{T}}')),
      )!;
      const [before, after] = para.content![0]!.text!.split('{{T}}');
      para.content = [
        { type: 'text', text: before },
        { type: 'figure', attrs: { source: 'ACCOUNT', key: '1300', measure: 'current' } },
        { type: 'text', text: after },
      ];
      return { ...b, doc };
    });
    const res = await save(n, { blocks });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: 2, status: 'EDITED' });
    const after = byLine(await notes(), 'BS:ca_oth');
    expect(after.stale).toEqual([]);
    expect(after.status).toBe('EDITED');
    const prior = (await ctx.http().get(`${base()}/notes/${n.id}/prior`).set(as(priya)))
      .body as PriorNoteDto;
    const diff = Object.values(prior.diff).flat();
    expect(diff).toContainEqual({ op: 'removed', text: '1,200,000' });
    expect(diff).toContainEqual({ op: 'added', text: '{figure}' });
    // A stale version is refused.
    expect((await save(n, { title: 'X' })).status).toBe(409);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'NOTE_UPDATE', entityId: n.id } }),
    ).toBe(1);
  });
});

describe('sub-captions, review, custom notes', () => {
  it('a sub-caption in trade receivables: subtotals, and the note still totals to the face', async () => {
    const n = byLine(await notes(), 'BS:trade_rec');
    const fig = n.blocks.find((b) => b.type === 'FIGURES')!;
    const accounts = n.figures[fig.id]!.groups.flatMap((g) => g.accounts.map((a) => a.code));
    const blocks = n.blocks.map((b) =>
      b.type === 'FIGURES'
        ? {
            ...b,
            subCaptions: [
              { id: 'good', label: 'Unsecured, considered good', accounts: [accounts[0]!] },
            ],
          }
        : b,
    );
    expect((await save(n, { blocks })).status).toBe(200);
    const v = byLine(await notes(), 'BS:trade_rec').figures[fig.id]!;
    expect(v.groups[0]!.label).toBe('Unsecured, considered good');
    expect(v.groups.at(-1)!.label).toBe('Other');
    expect(v.ties.current).toBe(true);
    expect(v.total.current).toBe(v.face.current);
    // An account in two sub-captions is refused.
    const again = byLine(await notes(), 'BS:trade_rec');
    const dup = again.blocks.map((b) =>
      b.type === 'FIGURES'
        ? {
            ...b,
            subCaptions: [
              ...b.subCaptions,
              { id: 'x', label: 'Credit impaired', accounts: [accounts[0]!] },
            ],
          }
        : b,
    );
    expect((await save(again, { blocks: dup })).status).toBe(400);
  });

  it('review: Reviewed, and editing a reviewed note sets it back to Edited', async () => {
    const n = byLine(await notes(), 'BS:cash');
    expect(
      (
        await ctx
          .http()
          .post(`${base()}/notes/${n.id}/review`)
          .set(as(priya))
          .send({ reviewed: true })
      ).body,
    ).toEqual({ status: 'REVIEWED' });
    const d = await notes();
    expect(d.progress.reviewed).toBe(1);
    const r = byLine(d, 'BS:cash');
    expect((await save(r, { title: 'Cash and bank balances' })).status).toBe(200);
    expect(byLine(await notes(), 'BS:cash').status).toBe('EDITED');
  });

  it('add a custom note with a table; delete rules', async () => {
    const d = await notes();
    const created = await ctx
      .http()
      .post(`${base()}/notes`)
      .set(as(priya))
      .send({ title: 'Contingent liabilities', afterNoteId: null });
    expect(created.status).toBe(201);
    let n = (await notes()).notes.find((x) => x.id === created.body.id)!;
    const table: TableBlockDto = {
      id: 'cl',
      type: 'TABLE',
      label: '',
      columns: [
        { id: 'nature', label: 'Nature', numeric: false, period: null },
        { id: 'cur', label: '', numeric: true, period: 'CURRENT' },
        { id: 'comp', label: '', numeric: true, period: 'COMPARATIVE' },
      ],
      rows: [
        {
          id: 'r1',
          cells: { nature: 'Claims not acknowledged as debt', cur: '500,000', comp: '450,000' },
        },
      ],
      mode: 'MEMO',
      agreeLine: null,
    };
    expect((await save(n, { blocks: [...n.blocks, table] })).status).toBe(200);
    n = (await notes()).notes.find((x) => x.id === created.body.id)!;
    expect(n.tables.cl).toMatchObject({ total: '500000.00', errors: [] });
    expect(
      (
        await save(n, {
          blocks: [{ ...table, rows: [{ id: 'r', cells: { nature: 'X', cur: 'abc', comp: '' } }] }],
        })
      ).status,
    ).toBe(400);
    // A line note with a value cannot be deleted; a custom note can.
    const line = byLine(d, 'BS:trade_rec');
    expect((await ctx.http().delete(`${base()}/notes/${line.id}`).set(as(priya))).status).toBe(409);
    expect((await ctx.http().delete(`${base()}/notes/${n.id}`).set(as(priya))).status).toBe(204);
  });

  it('finalised notes are read-only', async () => {
    const jul = await ctx.prisma.entityNote.findFirstOrThrow({
      where: { taskId: julTaskId, entityCode: 'IN' },
    });
    const res = await ctx
      .http()
      .put(`/api/tasks/${julTaskId}/entities/IN/notes/${jul.id}`)
      .set(as(priya))
      .send({ title: 'x', blocks: [], baseVersion: 1 });
    expect(res.status).toBe(409);
  });
});

describe('exports and templates', () => {
  const binary = (
    res: import('superagent').Response,
    cb: (err: Error | null, body: Buffer) => void,
  ) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  it('Word: cover, statements and every note with its text and tables; PDF', async () => {
    const d = await notes();
    const res = await ctx
      .http()
      .get(`${base()}/notes/export?type=docx`)
      .set(as(priya))
      .buffer(true)
      .parse(binary);
    expect(res.status).toBe(200);
    const xml = await (
      await JSZip.loadAsync(res.body as Buffer)
    )
      .file('word/document.xml')!
      .async('string');
    for (const t of [
      'Financial statements',
      'Balance sheet as at',
      'Notes to the financial statements',
      'Terms and conditions',
      'Balances with banks',
    ])
      expect(xml).toContain(t);
    for (const n of d.notes.filter((x) => x.number !== null).slice(0, 5))
      expect(xml).toContain(`${n.number}. ${n.title}`);
    const pdf = await ctx
      .http()
      .get(`${base()}/notes/export?type=pdf`)
      .set(as(priya))
      .buffer(true)
      .parse(binary);
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('templates: listed per format; removal blocked while a finalised report uses the format', async () => {
    const t = (await ctx.http().get('/api/config/formats/STATUTORY/note-templates').set(as(master)))
      .body as NoteTemplatesDto;
    expect(t.templates.filter((x) => x.appliesTo !== 'CFS').slice(0, 3).map((x) => x.title)).toEqual([
      'Corporate information',
      'Basis of preparation',
      'Significant accounting policies',
    ]);
    expect(
      t.templates.find((x) => x.title === 'Significant accounting policies')!.defaultBlocks,
    ).toHaveLength(7);
    expect(t.removeBlocked).toMatch(
      /blocked while a finalised report uses this format \(SFS-2026-0[78]-001\)/,
    );
    expect(
      (
        await ctx
          .http()
          .delete(`/api/config/formats/STATUTORY/note-templates/${t.templates.at(-1)!.id}`)
          .set(as(master))
      ).status,
    ).toBe(409);
    expect(
      (
        await ctx
          .http()
          .put(`/api/config/formats/STATUTORY/note-templates/${t.templates[0]!.id}`)
          .set(as(priya))
          .send({ title: 'x', kind: 'NARRATIVE', lineKeys: [], mandatory: true, defaultText: '' })
      ).status,
    ).toBe(403);
  });
});
