import type { CatalogItemDto, FigureRefDto, RichNodeDto } from '@finance-close/shared';
import { figureDisplay } from './figures';

/** Read-only rendering of a rich document (used by the "Last finalised" panel). */
export function RichTextView({
  doc,
  catalog,
  indian,
}: {
  doc: RichNodeDto;
  catalog: CatalogItemDto[];
  indian: boolean;
}) {
  const render = (n: RichNodeDto, i: number): React.ReactNode => {
    const kids = (n.content ?? []).map(render);
    switch (n.type) {
      case 'doc':
        return (
          <div key={i} className="space-y-2">
            {kids}
          </div>
        );
      case 'paragraph':
        return <p key={i}>{kids}</p>;
      case 'bulletList':
        return (
          <ul key={i} className="list-disc pl-5">
            {kids}
          </ul>
        );
      case 'orderedList':
        return (
          <ol key={i} className="list-decimal pl-5">
            {kids}
          </ol>
        );
      case 'listItem':
        return <li key={i}>{kids}</li>;
      case 'hardBreak':
        return <br key={i} />;
      case 'figure':
        return (
          <span
            key={i}
            className="mx-0.5 rounded bg-mint px-1 font-medium text-primary tabular-nums"
          >
            {figureDisplay(n.attrs as unknown as FigureRefDto, catalog, indian)}
          </span>
        );
      case 'text': {
        const marks = new Set((n.marks ?? []).map((m) => m.type));
        let el: React.ReactNode = n.text;
        if (marks.has('bold')) el = <strong>{el}</strong>;
        if (marks.has('italic')) el = <em>{el}</em>;
        return <span key={i}>{el}</span>;
      }
      default:
        return <span key={i}>{kids}</span>;
    }
  };
  return <div className="text-sm">{render(doc, 0)}</div>;
}
