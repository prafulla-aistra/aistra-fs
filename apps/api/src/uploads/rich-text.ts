import type { CatalogItemDto, FigureRefDto, RichNodeDto } from '@finance-close/shared';

/** A run of text with its marks; figure tokens are resolved to their value. */
export interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  figure: boolean;
}
/** A paragraph of a rich document for export: plain, bullet or numbered (with its number). */
export interface Para {
  kind: 'p' | 'bullet' | 'numbered';
  number: number | null;
  level: number;
  runs: Run[];
}

/** "₹" style prefixes are not used: figures show as the statements do (brackets for negatives). */
export function figureText(ref: FigureRefDto, catalog: CatalogItemDto[]): string {
  const item = catalog.find((c) => c.source === ref.source && c.key === ref.key);
  const v = item?.values[ref.measure] ?? null;
  if (v === null) return '–';
  if (ref.measure === 'variancePct') return `${v}%`;
  const negative = v.startsWith('-');
  const [int = '0', dec] = v.replace('-', '').split('.');
  const text = `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${dec !== undefined ? `.${dec}` : ''}`;
  return negative ? `(${text})` : text;
}

/** Flattens a rich document into paragraphs (lists become bullet / numbered paragraphs). */
export function toParas(doc: RichNodeDto | undefined, catalog: CatalogItemDto[]): Para[] {
  const out: Para[] = [];
  const runsOf = (n: RichNodeDto): Run[] =>
    (n.content ?? []).flatMap((c): Run[] => {
      if (c.type === 'text') {
        const marks = new Set((c.marks ?? []).map((m) => m.type));
        return [
          {
            text: c.text ?? '',
            bold: marks.has('bold'),
            italic: marks.has('italic'),
            figure: false,
          },
        ];
      }
      if (c.type === 'figure')
        return [
          {
            text: figureText(c.attrs as unknown as FigureRefDto, catalog),
            bold: false,
            italic: false,
            figure: true,
          },
        ];
      if (c.type === 'hardBreak')
        return [{ text: '\n', bold: false, italic: false, figure: false }];
      return runsOf(c);
    });
  const walk = (n: RichNodeDto, list: { kind: 'bullet' | 'numbered'; level: number } | null) => {
    if (n.type === 'paragraph' || n.type === 'heading') {
      out.push({ kind: list?.kind ?? 'p', number: null, level: list?.level ?? 0, runs: runsOf(n) });
      return;
    }
    if (n.type === 'bulletList' || n.type === 'orderedList') {
      const kind = n.type === 'bulletList' ? 'bullet' : 'numbered';
      let i = 0;
      for (const item of n.content ?? []) {
        i++;
        const before = out.length;
        for (const c of item.content ?? []) walk(c, { kind, level: (list?.level ?? -1) + 1 });
        const first = out[before];
        if (first && kind === 'numbered') first.number = i;
      }
      return;
    }
    for (const c of n.content ?? []) walk(c, list);
  };
  if (doc) walk(doc, null);
  return out.filter(
    (p, i, all) => p.runs.some((r) => r.text.trim() !== '') || (i > 0 && i < all.length - 1),
  );
}

export const paraText = (p: Para) =>
  `${p.kind === 'bullet' ? '• ' : p.kind === 'numbered' ? `${p.number ?? ''}. ` : ''}${p.runs.map((r) => r.text).join('')}`;
