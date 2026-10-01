import PDFDocument from 'pdfkit';
import type { ReviewPackDto } from '@finance-close/shared';
import { amount } from './notes-export';

type Pack = Omit<ReviewPackDto, 'actions' | 'fromSnapshot'>;

const RESULT = { PASS: 'Pass', FAIL: 'Fail', NA: 'n/a' } as const;
const STATUS: Record<string, string> = {
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  RETURNED: 'Returned',
  WAITING: 'Waiting',
  NOT_STARTED: 'Not started',
  NOT_REQUIRED: 'Not required',
};

/** The review record of a finalised version: sign-offs, checks, acknowledgements, queries, hash. */
export function reviewRecordPdf(x: {
  pack: Pack;
  taskNumber: string;
  version: number;
  hash: string;
  finalisedAt: string;
  exportedBy: string;
}): Promise<Buffer> {
  const p = x.pack;
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
    bufferPages: true,
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );
  const ink = '#0F2A3D';
  const muted = '#64748B';
  const heading = (t: string) => {
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(12).fillColor(ink).text(t).moveDown(0.3);
    doc.font('Helvetica').fontSize(9).fillColor('#000');
  };
  const line = (t: string, opts: { color?: string; bold?: boolean } = {}) =>
    doc
      .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fillColor(opts.color ?? '#000')
      .text(t, { width: doc.page.width - 100 });

  doc.font('Helvetica-Bold').fontSize(18).fillColor(ink).text('Review record');
  doc
    .font('Helvetica')
    .fontSize(11)
    .fillColor('#000')
    .text(`${p.entity.legalName} (${p.entity.code})`);
  doc.text(`${p.periodLabel} · task ${x.taskNumber} · snapshot v${x.version}`);
  doc
    .fontSize(9)
    .fillColor(muted)
    .text(`Finalised ${x.finalisedAt.slice(0, 16).replace('T', ' ')} UTC`);
  doc.text(`SHA-256 ${x.hash}`);
  doc.text(
    `Exported by ${x.exportedBy} on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  );

  heading('Sign-offs');
  for (const s of p.signOffs)
    line(
      `${s.role === 'PREPARER' ? 'Preparer' : s.role === 'REVIEWER' ? 'Reviewer' : 'Approver'}: ${s.name ?? '–'} · ${STATUS[s.status] ?? s.status}${s.at ? ` · ${s.at.slice(0, 16).replace('T', ' ')} UTC` : ''}${s.comment ? ` · "${s.comment}"` : ''}`,
    );
  heading('Declaration');
  line(p.declaration);

  heading('Control checks');
  for (const c of p.checks)
    line(
      `${RESULT[c.result]} · ${c.severity.toLowerCase()} · ${c.name}${c.currency ? ` (${c.currency})` : ''}: ${c.details}`,
      {
        color: c.result === 'FAIL' ? '#B42318' : '#000',
      },
    );

  heading('Warning acknowledgements');
  if (p.acknowledgements.length === 0) line('None needed.', { color: muted });
  for (const a of p.acknowledgements) line(`${a.key}: "${a.comment}"${a.by ? ` (${a.by})` : ''}`);

  heading('Key figures');
  for (const k of p.keyFigures) {
    line(k.currency, { bold: true });
    for (const r of k.rows)
      line(
        `${r.label}: ${amount(r.current, false)} (comparative ${amount(r.comparative, false)}; variance ${amount(r.variance, false)}${r.variancePct ? `, ${r.variancePct}%` : ''})`,
      );
  }

  heading('Review queries');
  if (p.queries.length === 0) line('No queries were raised.', { color: muted });
  for (const q of p.queries) {
    line(
      `${q.targetLabel} · ${q.status.toLowerCase()} · raised by ${q.raisedBy} ${q.raisedAt.slice(0, 10)}`,
      { bold: true },
    );
    line(q.text);
    for (const m of q.messages)
      line(
        `  ${m.kind === 'ANSWER' ? 'Answer' : m.kind === 'CLOSE' ? 'Closed' : 'Reopened'} by ${m.author} ${m.at.slice(0, 10)}${m.text ? `: ${m.text}` : ''}${m.file ? ` [${m.file.name}]` : ''}`,
        {
          color: muted,
        },
      );
  }

  heading('Source files');
  for (const f of p.files)
    line(
      `${f.name}${f.version ? ` (TB v${f.version})` : ''} · ${f.uploadedBy} · SHA-256 ${f.sha256}`,
    );

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(muted)
      .text(
        `${p.entity.code} ${p.periodLabel} · review record v${x.version} · page ${i + 1} of ${range.count}`,
        50,
        doc.page.height - 35,
        { align: 'center', lineBreak: false },
      );
  }
  doc.end();
  return done;
}
