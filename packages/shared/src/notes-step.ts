/**
 * Notes to accounts (task step "Notes"): structured, editable notes rolled forward from the
 * last finalised period. Every figure (live tokens, sub-caption totals, ties, stale-number
 * flags) is computed by the engine via the API; the web app only displays it.
 */
import type { StatementUnitCode } from './statements-step';
import type { ItemStatus } from './tasks';
import type { UploadStepDto } from './upload-step';
import type { MappingTabDto } from './mapping-step';

export type NoteKindCode = 'LINE' | 'NARRATIVE' | 'CUSTOM';
export type NoteStatusCode = 'DRAFT' | 'CARRIED_FORWARD' | 'EDITED' | 'REVIEWED';
export const NOTE_STATUS_LABELS: Record<NoteStatusCode, string> = {
  DRAFT: 'Draft – not reviewed',
  CARRIED_FORWARD: 'Carried forward – not reviewed',
  EDITED: 'Edited',
  REVIEWED: 'Reviewed',
};
export const NOTE_KIND_LABELS: Record<NoteKindCode, string> = {
  LINE: 'Line note',
  NARRATIVE: 'Narrative note',
  CUSTOM: 'Custom table note',
};

export interface RichNodeDto {
  type: string;
  text?: string;
  marks?: { type: string }[];
  attrs?: Record<string, unknown>;
  content?: RichNodeDto[];
}

export type FigureMeasureCode = 'current' | 'comparative' | 'variance' | 'variancePct';
export interface FigureRefDto {
  source: 'LINE' | 'FSLI' | 'ACCOUNT' | 'SUBCAPTION';
  key: string;
  measure: FigureMeasureCode;
}

export interface SubCaptionDto {
  id: string;
  label: string;
  accounts: string[];
}
export interface FiguresBlockDto {
  id: string;
  type: 'FIGURES';
  subCaptions: SubCaptionDto[];
}
export interface TextBlockDto {
  id: string;
  type: 'TEXT';
  label: string;
  doc: RichNodeDto;
}
export interface TableColumnDto {
  id: string;
  label: string;
  numeric: boolean;
  period: 'CURRENT' | 'COMPARATIVE' | null;
}
export interface TableBlockDto {
  id: string;
  type: 'TABLE';
  label: string;
  columns: TableColumnDto[];
  rows: { id: string; cells: Record<string, string> }[];
  mode: 'MEMO' | 'AGREE';
  agreeLine: string | null;
}
export type NoteBlockDto = FiguresBlockDto | TextBlockDto | TableBlockDto;

/** A FIGURES block with its figures: sub-caption groups, subtotals, total and the tie. */
export interface FiguresViewDto {
  lines: { key: string; label: string }[];
  groups: {
    id: string;
    label: string;
    accounts: {
      code: string;
      name: string;
      counterpartyCode: string | null;
      current: string | null;
      comparative: string | null;
    }[];
    subtotal: { current: string; comparative: string | null };
  }[];
  computed: {
    fsliCode: string;
    label: string;
    current: string | null;
    comparative: string | null;
  }[];
  total: { current: string; comparative: string | null };
  face: { current: string | null; comparative: string | null };
  ties: { current: boolean; comparative: boolean | null };
  errors: string[];
}

export interface TableViewDto {
  total: string | null;
  ties: boolean | null;
  agreeLabel: string | null;
  errors: string[];
}

export interface StaleFlagDto {
  blockId: string;
  number: string;
  message: string;
}

export interface NoteDto {
  id: string;
  /** Automatic; null when the note is hidden (nil figures, no text, not mandatory). */
  number: number | null;
  title: string;
  kind: NoteKindCode;
  status: NoteStatusCode;
  mandatory: boolean;
  hidden: boolean;
  lineKeys: string[];
  deletable: boolean;
  /** Why it cannot be deleted. */
  deleteBlocked: string | null;
  blocks: NoteBlockDto[];
  figures: Record<string, FiguresViewDto>;
  tables: Record<string, TableViewDto>;
  stale: StaleFlagDto[];
  version: number;
  carriedFrom: boolean;
  updatedBy: string | null;
  updatedAt: string;
  reviewedBy: string | null;
}

/** A figure that can be inserted as a live token, with its values (in the selected units). */
export interface CatalogItemDto {
  source: FigureRefDto['source'];
  key: string;
  label: string;
  group: string;
  values: Record<FigureMeasureCode, string | null>;
}

export interface EntityNotesDto {
  entity: {
    code: string;
    legalName: string;
    shortName: string;
    functionalCurrency: string;
    itemStatus: ItemStatus;
  };
  canEdit: boolean;
  readOnlyReason: string | null;
  hasTb: boolean;
  formatName: string;
  periodLabel: string;
  comparativeLabel: string;
  hasComparative: boolean;
  selection: { currency: string; unit: StatementUnitCode };
  options: { currencies: string[]; units: { code: StatementUnitCode; label: string }[] };
  progress: { reviewed: number; total: number; text: string };
  /** The period the notes were rolled forward from. */
  rolledFrom: { taskNumber: string; periodLabel: string } | null;
  notes: NoteDto[];
  catalog: CatalogItemDto[];
  lines: { key: string; label: string }[];
  roundingNote: string | null;
}

/** "Last finalised (Jul-2026)": the note exactly as finalised, and what changed since. */
export interface PriorNoteDto {
  periodLabel: string;
  taskNumber: string;
  note: Pick<NoteDto, 'title' | 'blocks' | 'figures' | 'tables'> | null;
  catalog: CatalogItemDto[];
  /** Per text block of the current note: words added / removed since the finalised text. */
  diff: Record<string, { op: 'same' | 'added' | 'removed'; text: string }[]>;
}

export interface NotesStepDto {
  task: UploadStepDto['task'];
  entities: (MappingTabDto & { reviewed: number | null; total: number | null })[];
}

export interface NoteSaveInput {
  title: string;
  blocks: NoteBlockDto[];
  baseVersion: number;
}

export interface NoteTemplateDto {
  id: string;
  formatCode: string;
  sortOrder: number;
  title: string;
  kind: NoteKindCode;
  lineKeys: string[];
  defaultBlocks: NoteBlockDto[];
  mandatory: boolean;
}

export interface NoteTemplatesDto {
  formatCode: string;
  templates: NoteTemplateDto[];
  /** Removing is blocked while a finalised report uses the format. */
  removeBlocked: string | null;
  lines: { key: string; label: string }[];
  canEdit: boolean;
}
