import type { IsoDate } from './configuration';

/**
 * Configuration C2: settings, exchange-rate maintenance, report formats, FSLI names,
 * account-type defaults and the chart of accounts.
 */

// ---------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------

export interface AppSettingsDto {
  /** Where rates come from; '' until decided. */
  rateSource: string;
  /** rateSource, or the default RATE_SOURCE_LABEL (to be confirmed). */
  rateSourceLabel: string;
  /** IC differences above this go to suspense (level currency), e.g. "1.00". */
  icDiffThreshold: string;
  /** Variance flag threshold in percent, e.g. "20". */
  variancePct: string;
  canEdit: boolean;
}

export interface AppSettingsInput {
  rateSource: string;
  icDiffThreshold: string;
  variancePct: string;
}

// ---------------------------------------------------------------------------------------
// Exchange rates
// ---------------------------------------------------------------------------------------

export type RateMonthStatus = 'COMPLETE' | 'MISSING' | 'LOCKED';

export interface RateGridCellDto {
  currency: string;
  opening: string | null;
  closing: string | null;
  average: string | null;
  source: string | null;
  enteredBy: string | null;
  enteredAt: string | null;
}

export interface RateCheckDto {
  currency: string;
  code: 'OPENING_NOT_PRIOR_CLOSING' | 'LARGE_MOVE' | 'MISSING';
  message: string;
}

export interface RateGridMonthDto {
  month: IsoDate;
  /** "Aug-2026" */
  label: string;
  /** "FY 2026-27" */
  fyLabel: string;
  status: RateMonthStatus;
  /** Finalised reports that lock the month. */
  lockedBy: string[];
  lockedReason: string | null;
  missing: number;
  cells: RateGridCellDto[];
  checks: RateCheckDto[];
}

export interface RateGridDto {
  /** Every non-USD currency. */
  currencies: string[];
  /** Newest first. */
  months: RateGridMonthDto[];
  /** The month "Add next month" creates, with its opening pre-filled from this closing. */
  nextMonth: { month: IsoDate; label: string; openings: Record<string, string | null> };
  sourceLabel: string;
  canEdit: boolean;
}

export type RatePreviewStatus = 'NEW' | 'CHANGED' | 'UNCHANGED' | 'LOCKED';

export interface RatePreviewRowDto {
  month: IsoDate;
  label: string;
  currency: string;
  status: RatePreviewStatus;
  before: { opening: string | null; closing: string | null; average: string | null } | null;
  after: { opening: string | null; closing: string | null; average: string | null };
}

export interface RatePreviewDto {
  fileName: string;
  rows: RatePreviewRowDto[];
  summary: { new: number; changed: number; unchanged: number; skippedLocked: number };
  errors: { row: number; message: string }[];
  warnings: { month: string; currency: string; code: string; message: string }[];
}

export interface CrossRateDto {
  month: IsoDate;
  label: string;
  from: string;
  to: string;
  /** "1 GBP = x INR; rate_INR ÷ rate_GBP". */
  rates: {
    kind: 'opening' | 'closing' | 'average';
    value: string | null;
    formula: string | null;
    missing: string[];
  }[];
}

// ---------------------------------------------------------------------------------------
// Report formats
// ---------------------------------------------------------------------------------------

export type FormatStatementCode = 'BS' | 'PL';
export type FormatLineTypeCode = 'HEADING' | 'LINE' | 'TOTAL';
export type FormatRoleCode = 'PROFIT' | 'TOTAL_ASSETS' | 'TOTAL_EQUITY_LIABILITIES';

export interface FormatLineDto {
  key: string;
  statement: FormatStatementCode;
  type: FormatLineTypeCode;
  label: string;
  indent: number;
  fslis: string[];
  formula: { key: string; op: '+' | '-' }[];
  role: FormatRoleCode | null;
}

export interface FormatIssueDto {
  code: string;
  statement: FormatStatementCode;
  message: string;
  lineKey?: string;
  fsliCode?: string;
}

export interface FormatVersionDto {
  version: number;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  /** Tasks attached to this version. */
  tasks: string[];
  /** Tasks with a finalised entity or level: the version can no longer change. */
  finalisedTasks: string[];
}

export interface FormatDetailDto {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  currentVersion: number;
  /** The version shown (current unless another was asked for). */
  version: number;
  lines: FormatLineDto[];
  versions: FormatVersionDto[];
  /** Saving the current version creates a new version (a finalised report uses it). */
  savesAsNewVersion: boolean;
  canEdit: boolean;
}

export interface FormatSaveInput {
  name: string;
  description: string;
  lines: FormatLineDto[];
  note?: string | null;
}

export interface FormatSaveResultDto {
  format: FormatDetailDto;
  /** A new version was created (the old one stays attached to finalised reports). */
  newVersion: boolean;
}

export interface FormatPreviewSourceDto {
  taskId: string;
  taskNumber: string;
  periodLabel: string;
  entityCode: string;
  entityName: string;
  currency: string;
  finalised: boolean;
}

export interface FormatPreviewRowDto {
  key: string;
  statement: FormatStatementCode;
  type: FormatLineTypeCode;
  label: string;
  indent: number;
  role: FormatRoleCode | null;
  value: string | null;
}

export interface FormatPreviewDto {
  source: FormatPreviewSourceDto;
  rows: FormatPreviewRowDto[];
  /** Total assets = total equity and liabilities (null when a marker is missing). */
  balanced: boolean | null;
  /** Lines of the TB without an FSLI (not shown in the preview). */
  unmapped: string;
}

// ---------------------------------------------------------------------------------------
// Chart of accounts (configuration)
// ---------------------------------------------------------------------------------------

export interface CoaAccountDto {
  accountCode: string;
  accountName: string;
  accountType: string | null;
  parentAccount: string | null;
  fsliCode: string | null;
  fsliName: string | null;
  intercompany: boolean;
  needsCounterparty: boolean;
  counterpartyCode: string | null;
  rateBasisOverride: string | null;
  /** The FSLI's own rate basis. */
  fsliRateBasis: string | null;
  source: string;
  sourceLabel: string;
  suggested: boolean;
  /** Client grouping the mapping came from (null: not in the client's groupings). */
  grouping: string | null;
  mappingStatus: MappingStatusCode;
  /** In a confirmed trial balance of this entity (an account the figures use). */
  inTrialBalance: boolean;
  updatedBy: string | null;
  updatedAt: string;
}

export type MappingStatusCode =
  'SYSTEM' | 'GROUPING' | 'NOT_IN_GROUPINGS' | 'SUGGESTED' | 'NO_COUNTERPARTY' | 'UNMAPPED';

/** Tag text and what the finance team should do. */
export const MAPPING_STATUS: Record<
  MappingStatusCode,
  { label: string; hint: string; tone: 'success' | 'warning' | 'destructive' | 'neutral' }
> = {
  SYSTEM: {
    label: 'System line',
    hint: 'Added by the app (profit of earlier months, mapped to retained earnings).',
    tone: 'neutral',
  },
  GROUPING: {
    label: 'Client grouping',
    hint: 'Mapped from the client groupings workbook.',
    tone: 'success',
  },
  NOT_IN_GROUPINGS: {
    label: 'Not in client groupings',
    hint: 'Mapped by hand: add this account code and its grouping to the client workbook.',
    tone: 'warning',
  },
  SUGGESTED: {
    label: 'Auto-suggested',
    hint: 'Guessed from the Zoho account type: check it, or give it a grouping in the client workbook.',
    tone: 'warning',
  },
  NO_COUNTERPARTY: {
    label: 'Counterparty missing',
    hint: 'Intercompany line without the group entity on the other side: choose the counterparty.',
    tone: 'destructive',
  },
  UNMAPPED: {
    label: 'Unmapped',
    hint: 'Choose an FSLI (line) for this account.',
    tone: 'destructive',
  },
};

export interface CoaStatsDto {
  accounts: number;
  mapped: number;
  /** Mapped share in percent, 1 dp, e.g. "95.8". */
  mappedPct: string;
  unmapped: number;
  /** Intercompany FSLI but no counterparty entity. */
  icWithoutCounterparty: number;
}

export interface EntityCoaDto {
  entity: { code: string; name: string; erp: string; currency: string };
  stats: CoaStatsDto;
  accounts: CoaAccountDto[];
  canEdit: boolean;
  /** Mapping frozen: tasks map new accounts only; changes are made here, with a reason. */
  mapping: { frozen: boolean; frozenAt: string | null; frozenBy: string | null };
}

/** Import of the client's "Account Code → Grouping" sheet (Financials workbook TB sheets). */
export type GroupingStatus =
  | 'NEW'
  | 'CHANGE'
  | 'SAME'
  | 'NO_GROUPING'
  | 'UNKNOWN_GROUPING'
  | 'NEEDS_COUNTERPARTY'
  | 'NOT_IN_COA';

export const GROUPING_STATUS_LABELS: Record<GroupingStatus, string> = {
  NEW: 'Mapped (was unmapped)',
  CHANGE: 'Mapping changes',
  SAME: 'Already mapped like this',
  NO_GROUPING: 'No grouping in the file – left as is',
  UNKNOWN_GROUPING: 'Grouping not recognised – left as is',
  NEEDS_COUNTERPARTY: 'Intercompany, counterparty not in the name – map it by hand',
  NOT_IN_COA: 'Not in the chart of accounts – ignored',
};

export interface GroupingImportItemDto {
  code: string;
  name: string;
  grouping: string;
  fsliCode: string | null;
  fsliName: string | null;
  counterpartyCode: string | null;
  status: GroupingStatus;
  before: {
    fsliCode: string | null;
    fsliName: string | null;
    counterpartyCode: string | null;
  } | null;
}

export interface GroupingImportPreviewDto {
  fileName: string;
  /** Sheets with an "Account Code" and "Grouping" header; the one used is `sheet`. */
  sheets: string[];
  sheet: string | null;
  items: GroupingImportItemDto[];
  counts: Partial<Record<GroupingStatus, number>>;
}

export interface GroupingImportResultDto {
  applied: number;
  frozen: boolean;
  coa: EntityCoaDto;
}

export interface CoaAccountInput {
  accountType: string | null;
  fsliCode: string;
  counterpartyCode: string | null;
  rateBasisOverride: string | null;
  reason?: string | null;
  confirmWarnings?: boolean;
}

export interface CoaPreviewDto {
  fileName: string;
  added: { code: string; name: string; type: string | null; fsliCode: string | null }[];
  updated: {
    code: string;
    before: { name: string; type: string | null; parent: string | null };
    after: { name: string; type: string | null; parent: string | null };
  }[];
  unchanged: number;
  warnings: { code: string; message: string }[];
}

/** Rate-basis overrides an account may take (COMPUTED is the system's own). */
export const RATE_BASIS_OVERRIDES = [
  'CLOSING',
  'AVERAGE',
  'HISTORICAL',
  'OPENING',
  'ROLL_FORWARD',
] as const;
