import type { EntityStatementsDto } from '@finance-close/shared';

/** Lakhs and crores use Indian digit grouping. */
export const indianUnits = (d: EntityStatementsDto) =>
  d.selection.unit === 'LAKHS' || d.selection.unit === 'CRORES';
