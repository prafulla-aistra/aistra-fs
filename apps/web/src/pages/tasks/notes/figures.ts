import type {
  CatalogItemDto,
  EntityNotesDto,
  FigureRefDto,
  NoteStatusCode,
} from '@finance-close/shared';
import { statementAmount } from '@/lib/format';

/** Lakhs and crores use Indian digit grouping. */
export const indianGrouping = (d: Pick<EntityNotesDto, 'selection'>) =>
  d.selection.unit === 'LAKHS' || d.selection.unit === 'CRORES';

/** The text of a live figure (the value comes from the API's catalog; text only here). */
export function figureDisplay(
  ref: FigureRefDto,
  catalog: CatalogItemDto[],
  indian: boolean,
): string {
  const item = catalog.find((c) => c.source === ref.source && c.key === ref.key);
  const v = item?.values[ref.measure] ?? null;
  if (v === null) return '–';
  return ref.measure === 'variancePct' ? `${v}%` : statementAmount(v, indian);
}

export const statusVariant = (s: NoteStatusCode) =>
  s === 'REVIEWED' ? 'success' : s === 'EDITED' ? 'review' : 'warning';
