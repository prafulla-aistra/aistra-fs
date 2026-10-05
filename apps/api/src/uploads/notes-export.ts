import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import PDFDocument from 'pdfkit';
import type { EntityNotesDto, EntityStatementsDto, NoteDto } from '@finance-close/shared';
import { type Para, toParas } from './rich-text';

/**
 * The full set of financial statements as Word (.docx) and PDF: cover page, balance sheet,
 * P&L, and the notes in order (text, figures with sub-captions, custom tables), with the entity
 * and period in the header and page numbers in the footer. Figures are the API's text values.
 */
export interface FullSetInput {
  statements: EntityStatementsDto;
  notes: EntityNotesDto;
  taskNumber: string;
  exportedBy: string;
  exportedAt: Date;
  /** Cover subtitle (default "Financial statements"). */
  subtitle?: string;
  /** Signature block at the end (consolidated statements). */
  signature?: { entityName: string; lines: string[] };
}

const indian = (s: EntityStatementsDto) =>
  s.selection.unit === 'LAKHS' || s.selection.unit === 'CRORES';

/** "(1,234.50)" / "12,34,567.00" / "–"; the value is exact text from the API. */
export function amount(v: string | null, indianGrouping: boolean): string {
  if (v === null) return '';
  const negative = v.startsWith('-');
  const [int = '0', dec] = v.replace('-', '').split('.');
  if (/^0*$/.test(int) && (!dec || /^0*$/.test(dec))) return '–';
  const grouped = indianGrouping
    ? int.length > 3
      ? `${int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${int.slice(-3)}`
      : int
    : int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const text = `${grouped}${dec !== undefined ? `.${dec}` : ''}`;
  return negative ? `(${text})` : text;
}

interface Row {
  label: string;
  note: string;
  current: string;
  comparative: string;
  style: 'heading' | 'line' | 'subtotal' | 'total';
  indent: number;
}

function statementRows(s: EntityStatementsDto, st: 'BS' | 'PL'): Row[] {
  const view = st === 'BS' ? s.balanceSheet : s.profitAndLoss;
  return view.rows.map((r) => ({
    label: r.label,
    note: r.note === null ? '' : String(r.note),
    current: r.type === 'HEADING' ? '' : amount(r.current, indian(s)),
    comparative: r.type === 'HEADING' ? '' : amount(r.comparative, indian(s)),
    style:
      r.type === 'HEADING'
        ? 'heading'
        : r.type === 'TOTAL'
          ? r.role
            ? 'total'
            : 'subtotal'
          : 'line',
    indent: r.indent,
  }));
}

/** A note's content as neutral parts (paragraphs and tables) for both writers. */
type Part =
  | { kind: 'label'; text: string }
  | { kind: 'para'; para: Para }
  | {
      kind: 'table';
      head: string[];
      rows: { cells: string[]; style: 'line' | 'caption' | 'subtotal' | 'total' }[];
    };

function noteParts(n: NoteDto, d: EntityNotesDto, s: EntityStatementsDto): Part[] {
  const parts: Part[] = [];
  const ind = indian(s);
  const comp = d.hasComparative;
  const head = ['', d.periodLabel, ...(comp ? [d.comparativeLabel] : [])];
  for (const b of n.blocks) {
    if (b.type === 'TEXT') {
      if (b.label) parts.push({ kind: 'label', text: b.label });
      for (const p of toParas(b.doc, d.catalog)) parts.push({ kind: 'para', para: p });
    }
    if (b.type === 'GENERATED') {
      const g = n.generated?.[b.id];
      if (b.label) parts.push({ kind: 'label', text: b.label });
      if (g && g.columns.length)
        parts.push({
          kind: 'table',
          head: g.columns.map((c) => c.label),
          rows: g.rows.map((r) => ({
            cells: r.cells.map((c) => c ?? ''),
            style: r.total ? 'total' : 'line',
          })),
        });
      if (g?.footnote) parts.push({ kind: 'label', text: g.footnote });
    }
    if (b.type === 'FIGURES') {
      const f = n.figures[b.id];
      if (!f) continue;
      const rows: Extract<Part, { kind: 'table' }>['rows'] = [];
      for (const g of f.groups) {
        if (g.label) rows.push({ cells: [g.label, '', ...(comp ? [''] : [])], style: 'caption' });
        for (const a of g.accounts)
          rows.push({
            cells: [
              `${a.name}${a.counterpartyCode ? ` (${a.counterpartyCode})` : ''}`,
              amount(a.current, ind),
              ...(comp ? [amount(a.comparative, ind)] : []),
            ],
            style: 'line',
          });
        if (g.label)
          rows.push({
            cells: [
              `Total ${g.label.toLowerCase()}`,
              amount(g.subtotal.current, ind),
              ...(comp ? [amount(g.subtotal.comparative, ind)] : []),
            ],
            style: 'subtotal',
          });
      }
      for (const c of f.computed)
        rows.push({
          cells: [c.label, amount(c.current, ind), ...(comp ? [amount(c.comparative, ind)] : [])],
          style: 'line',
        });
      rows.push({
        cells: [
          'Total',
          amount(f.total.current, ind),
          ...(comp ? [amount(f.total.comparative, ind)] : []),
        ],
        style: 'total',
      });
      parts.push({ kind: 'table', head, rows });
    }
    if (b.type === 'TABLE') {
      if (b.label) parts.push({ kind: 'label', text: b.label });
      parts.push({
        kind: 'table',
        head: b.columns.map((c) =>
          c.period === 'CURRENT'
            ? d.periodLabel
            : c.period === 'COMPARATIVE'
              ? d.comparativeLabel
              : c.label,
        ),
        rows: b.rows.map((r) => ({
          cells: b.columns.map((c) => r.cells[c.id] ?? ''),
          style: 'line' as const,
        })),
      });
    }
  }
  return parts;
}

const coverLines = (x: FullSetInput) => {
  const s = x.statements;
  const end = s.profitAndLoss.title.replace('Statement of profit and loss ', '');
  return {
    title: s.header.legalName,
    subtitle: x.subtitle ?? 'Financial statements',
    period: end.charAt(0).toUpperCase() + end.slice(1),
    details: [
      `Format: ${s.header.formatName}`,
      `Currency: ${s.header.currencyUnits}${s.header.translatedFrom ? ` (${s.header.translatedFrom})` : ''}`,
      `Task: ${x.taskNumber}`,
      `Status: ${x.notes.progress.text}`,
      `Exported by ${x.exportedBy} on ${x.exportedAt.toISOString().slice(0, 10)}`,
    ],
  };
};

// ---------------------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------------------

const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: none, bottom: none, left: none, right: none };

function wordTable(
  head: string[],
  rows: { cells: string[]; style: string }[],
  widths: number[],
): Table {
  const cell = (text: string, i: number, style: string, isHead = false) =>
    new TableCell({
      width: { size: widths[i] ?? 20, type: WidthType.PERCENTAGE },
      borders: {
        ...noBorders,
        ...(isHead ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: '0F2A3D' } } : {}),
        ...(i > 0 && (style === 'subtotal' || style === 'total')
          ? { top: { style: BorderStyle.SINGLE, size: 4, color: '0F2A3D' } }
          : {}),
        ...(i > 0 && style === 'total'
          ? { bottom: { style: BorderStyle.DOUBLE, size: 6, color: '0F2A3D' } }
          : {}),
      },
      children: [
        new Paragraph({
          alignment: i > 0 ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [
            new TextRun({
              text,
              bold: isHead || style === 'heading' || style === 'subtotal' || style === 'total',
              italics: style === 'caption',
              size: 18,
            }),
          ],
        }),
      ],
    });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, i, 'line', true)) }),
      ...rows.map((r) => new TableRow({ children: r.cells.map((c, i) => cell(c, i, r.style)) })),
    ],
  });
}

function wordPara(p: Para): Paragraph {
  const children = p.runs.map(
    (r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic, size: 20 }),
  );
  if (p.kind === 'bullet') return new Paragraph({ bullet: { level: p.level }, children });
  if (p.kind === 'numbered')
    return new Paragraph({ numbering: { reference: 'numbered', level: p.level }, children });
  return new Paragraph({ spacing: { after: 120 }, children });
}

export async function fullSetDocx(x: FullSetInput): Promise<Buffer> {
  const s = x.statements;
  const cover = coverLines(x);
  const statementTable = (st: 'BS' | 'PL') => {
    const rows = statementRows(s, st);
    return wordTable(
      ['Particulars', 'Note', s.header.periodLabel, s.header.comparativeLabel || ''],
      rows.map((r) => ({
        cells: [`${'    '.repeat(r.indent)}${r.label}`, r.note, r.current, r.comparative],
        style: r.style,
      })),
      [52, 8, 20, 20],
    );
  };
  const h = (text: string) =>
    new Paragraph({
      spacing: { before: 240, after: 120 },
      children: [new TextRun({ text, bold: true, size: 26, color: '0F2A3D' })],
    });
  const noteBlocks = x.notes.notes
    .filter((n) => n.number !== null)
    .flatMap((n) => [
      new Paragraph({
        spacing: { before: 240, after: 80 },
        keepNext: true,
        children: [
          new TextRun({ text: `${n.number}. ${n.title}`, bold: true, size: 22, color: '0F2A3D' }),
        ],
      }),
      ...noteParts(n, x.notes, s).map((part) =>
        part.kind === 'label'
          ? new Paragraph({
              spacing: { before: 80 },
              children: [new TextRun({ text: part.text, italics: true, size: 20 })],
            })
          : part.kind === 'para'
            ? wordPara(part.para)
            : wordTable(
                part.head,
                part.rows,
                part.head.length === 2
                  ? [70, 30]
                  : part.head.length === 3
                    ? [60, 20, 20]
                    : part.head.map(() => 100 / part.head.length),
              ),
      ),
    ]);
  const doc = new Document({
    creator: 'Finance Close',
    title: `${s.header.legalName} – ${s.header.periodLabel}`,
    numbering: {
      config: [
        {
          reference: 'numbered',
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
          })),
        },
      ],
    },
    sections: [
      {
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: `${s.header.legalName} · ${s.header.periodLabel}`,
                    size: 16,
                    color: '64748B',
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
                    size: 16,
                    color: '64748B',
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({
            spacing: { before: 3000 },
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: cover.title, bold: true, size: 40, color: '0F2A3D' })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: cover.subtitle, size: 32 })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 600 },
            children: [new TextRun({ text: cover.period, size: 24 })],
          }),
          ...cover.details.map(
            (t) =>
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: t, size: 18, color: '64748B' })],
              }),
          ),
          new Paragraph({ children: [new PageBreak()] }),
          h(s.balanceSheet.title),
          new Paragraph({
            children: [new TextRun({ text: s.header.currencyUnits, size: 16, color: '64748B' })],
          }),
          statementTable('BS'),
          new Paragraph({ children: [new PageBreak()] }),
          h(s.profitAndLoss.title),
          new Paragraph({
            children: [new TextRun({ text: s.header.currencyUnits, size: 16, color: '64748B' })],
          }),
          statementTable('PL'),
          new Paragraph({ children: [new PageBreak()] }),
          h('Notes to the financial statements'),
          ...noteBlocks,
          ...(x.signature
            ? [
                new Paragraph({
                  spacing: { before: 600 },
                  children: [
                    new TextRun({
                      text: `For and on behalf of the Board of ${x.signature.entityName}`,
                      bold: true,
                      size: 20,
                    }),
                  ],
                }),
                ...x.signature.lines.map(
                  (l) =>
                    new Paragraph({
                      spacing: { before: 480 },
                      children: [
                        new TextRun({ text: `_____________________________   ${l}`, size: 20 }),
                        new TextRun({
                          text: '   Name:                     Date:              Place:',
                          size: 16,
                          color: '64748B',
                        }),
                      ],
                    }),
                ),
              ]
            : []),
          new Paragraph({
            spacing: { before: 400 },
            children: [new TextRun({ text: s.footer, italics: true, size: 16, color: '64748B' })],
          }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

// ---------------------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------------------

export function fullSetPdf(x: FullSetInput): Promise<Buffer> {
  const s = x.statements;
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 56, bottom: 56, left: 50, right: 50 },
    bufferPages: true,
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );
  const width = doc.page.width - 100;
  const bottom = () => doc.page.height - 70;
  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };
  const ink = '#0F2A3D';

  const cover = coverLines(x);
  doc
    .moveDown(10)
    .font('Helvetica-Bold')
    .fontSize(22)
    .fillColor(ink)
    .text(cover.title, { align: 'center' });
  doc
    .moveDown(0.5)
    .font('Helvetica')
    .fontSize(16)
    .fillColor('#000')
    .text(cover.subtitle, { align: 'center' });
  doc.fontSize(12).text(cover.period, { align: 'center' }).moveDown(2);
  doc.fontSize(9).fillColor('#64748B');
  for (const t of cover.details) doc.text(t, { align: 'center' });

  const table = (
    head: string[],
    rows: { cells: string[]; style: string; indent?: number }[],
    widths: number[],
  ) => {
    const cols = widths.map((w) => (w / 100) * width);
    const draw = (cells: string[], style: string, isHead: boolean, indent = 0) => {
      doc
        .font(
          isHead || style !== 'line'
            ? style === 'caption'
              ? 'Helvetica-Oblique'
              : 'Helvetica-Bold'
            : 'Helvetica',
        )
        .fontSize(8.5)
        .fillColor('#000');
      const hgt =
        Math.max(
          ...cells.map((c, i) =>
            doc.heightOfString(c, { width: cols[i]! - 6 - (i === 0 ? indent * 10 : 0) }),
          ),
        ) + 4;
      ensure(hgt + 4);
      const y = doc.y;
      let xPos = 50;
      cells.forEach((c, i) => {
        doc.text(c, xPos + (i === 0 ? indent * 10 : 0), y + 2, {
          width: cols[i]! - 6 - (i === 0 ? indent * 10 : 0),
          align: i > 0 ? 'right' : 'left',
        });
        xPos += cols[i]!;
      });
      const right = 50 + width;
      const firstNum = 50 + cols[0]! + (cols.length === 4 ? cols[1]! : 0);
      if (isHead)
        doc
          .moveTo(50, y + hgt)
          .lineTo(right, y + hgt)
          .lineWidth(0.6)
          .strokeColor(ink)
          .stroke();
      if (style === 'subtotal' || style === 'total')
        doc.moveTo(firstNum, y).lineTo(right, y).lineWidth(0.6).strokeColor(ink).stroke();
      if (style === 'total') {
        doc
          .moveTo(firstNum, y + hgt)
          .lineTo(right, y + hgt)
          .stroke();
        doc
          .moveTo(firstNum, y + hgt + 2)
          .lineTo(right, y + hgt + 2)
          .stroke();
      }
      doc.x = 50;
      doc.y = y + hgt + (style === 'total' ? 4 : 1);
    };
    draw(head, 'line', true);
    for (const r of rows) draw(r.cells, r.style, false, r.indent ?? 0);
    doc.moveDown(0.5);
  };
  const heading = (t: string) => {
    ensure(40);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(ink).text(t, 50, doc.y, { width });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#64748B')
      .text(s.header.currencyUnits)
      .moveDown(0.5);
  };
  for (const st of ['BS', 'PL'] as const) {
    doc.addPage();
    heading((st === 'BS' ? s.balanceSheet : s.profitAndLoss).title);
    table(
      ['Particulars', 'Note', s.header.periodLabel, s.header.comparativeLabel || ''],
      statementRows(s, st).map((r) => ({
        cells: [r.label, r.note, r.current, r.comparative],
        style: r.style === 'heading' ? 'caption' : r.style,
        indent: r.indent,
      })),
      [52, 8, 20, 20],
    );
  }
  doc.addPage();
  heading('Notes to the financial statements');
  for (const n of x.notes.notes.filter((v) => v.number !== null)) {
    ensure(50);
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .fillColor(ink)
      .text(`${n.number}. ${n.title}`, 50, doc.y, { width })
      .moveDown(0.3);
    for (const part of noteParts(n, x.notes, s)) {
      if (part.kind === 'label')
        doc
          .font('Helvetica-Oblique')
          .fontSize(9)
          .fillColor('#000')
          .text(part.text, 50, doc.y, { width });
      if (part.kind === 'para') {
        const p = part.para;
        const prefix =
          p.kind === 'bullet' ? '•  ' : p.kind === 'numbered' ? `${p.number ?? ''}.  ` : '';
        ensure(20);
        doc.fontSize(9).fillColor('#000');
        const indent = p.kind === 'p' ? 0 : 12 + p.level * 12;
        doc.font('Helvetica').text(prefix, 50 + indent, doc.y, {
          continued: p.runs.length > 0,
          width: width - indent,
        });
        p.runs.forEach((r, i) =>
          doc
            .font(
              r.bold && r.italic
                ? 'Helvetica-BoldOblique'
                : r.bold
                  ? 'Helvetica-Bold'
                  : r.italic
                    ? 'Helvetica-Oblique'
                    : 'Helvetica',
            )
            .text(r.text, { continued: i < p.runs.length - 1 }),
        );
        doc.moveDown(0.3);
      }
      if (part.kind === 'table')
        table(
          part.head,
          part.rows,
          part.head.length === 3
            ? [60, 20, 20]
            : part.head.length === 2
              ? [70, 30]
              : part.head.map(() => 100 / part.head.length),
        );
    }
    doc.moveDown(0.5);
  }
  if (x.signature) {
    ensure(140);
    doc
      .moveDown(2)
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#000')
      .text(`For and on behalf of the Board of ${x.signature.entityName}`, 50, doc.y, { width });
    for (const l of x.signature.lines) {
      doc
        .moveDown(2.2)
        .font('Helvetica')
        .fontSize(9)
        .text(`_____________________________   ${l}`, 50, doc.y, { width });
      doc
        .fontSize(8)
        .fillColor('#64748B')
        .text('Name:                         Date:                 Place:', 50, doc.y, { width })
        .fillColor('#000');
    }
    doc.moveDown(1);
  }
  doc
    .font('Helvetica-Oblique')
    .fontSize(8)
    .fillColor('#64748B')
    .text(s.footer, 50, doc.y, { width });

  // Header and page numbers on every page but the cover.
  const range = doc.bufferedPageRange();
  for (let i = 1; i < range.count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(8).fillColor('#64748B');
    doc.text(`${s.header.legalName} · ${s.header.periodLabel}`, 50, 30, {
      width,
      lineBreak: false,
    });
    doc.text(`Page ${i + 1} of ${range.count}`, 50, doc.page.height - 40, {
      width,
      align: 'right',
      lineBreak: false,
    });
  }
  doc.end();
  return done;
}
