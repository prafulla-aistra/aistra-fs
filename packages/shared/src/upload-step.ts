/**
 * Task workspace, step 1 "Upload data" (page 3). The API computes every status, total and
 * warning; the web app only displays them.
 */
import type { ErpSystem, StatementType } from './enums';
import type { ItemStatus, TaskStatus } from './tasks';

export const SIGN_CONVENTIONS = [
  { code: 'DEBIT_POSITIVE', label: 'Debit positive, credit negative' },
  { code: 'CREDIT_POSITIVE', label: 'Credit positive' },
  { code: 'DRCR_SUFFIX', label: 'Dr-Cr suffix' },
  { code: 'SEPARATE_COLUMNS', label: 'Separate debit and credit columns' },
] as const;
export type SignConvention = (typeof SIGN_CONVENTIONS)[number]['code'];

export interface TbColumnSettingsDto {
  /** 0-based row index of the header row. */
  headerRow: number;
  codeColumn: number;
  nameColumn: number;
  balanceColumn: number | null;
  debitColumn: number | null;
  creditColumn: number | null;
  /** Account type column (optional). */
  typeColumn?: number | null;
  signConvention: SignConvention;
}

export interface UploadIssueDto {
  code: string;
  message: string;
  rows?: number[];
  accounts?: string[];
}

export type TbStatus = 'ERROR' | 'VALIDATED_WITH_WARNINGS' | 'VALIDATED';
export type EntityUploadStatus = 'PENDING' | TbStatus;
export const UPLOAD_STATUS_LABELS: Record<EntityUploadStatus, string> = {
  PENDING: 'Pending',
  ERROR: 'Error',
  VALIDATED_WITH_WARNINGS: 'Validated with warnings',
  VALIDATED: 'Validated',
};

/** Largest accepted upload (all kinds). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const TB_FILE_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const;
export const DOCUMENT_FILE_EXTENSIONS = [
  '.pdf',
  '.xlsx',
  '.xls',
  '.csv',
  '.docx',
  '.doc',
  '.png',
  '.jpg',
  '.jpeg',
  '.txt',
  '.zip',
] as const;

export interface FileRefDto {
  id: string;
  name: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface TbTotalsDto {
  debits: string;
  credits: string;
  difference: string;
}

export interface TbVersionDto {
  id: string;
  version: number;
  status: TbStatus;
  file: FileRefDto;
  totals: TbTotalsDto;
  lineCount: number;
  newAccounts: { code: string; name: string }[];
  errors: UploadIssueDto[];
  warnings: UploadIssueDto[];
  info: UploadIssueDto[];
  acknowledged: string[];
  createdBy: string;
  createdAt: string;
}

export interface CoaMergeSummaryDto {
  file: FileRefDto;
  added: number;
  updated: number;
  unchanged: number;
  addedAccounts: { code: string; name: string; fsliCode: string | null }[];
  warnings: UploadIssueDto[];
}

/** Decision round 1 (Q10a): how the TB carries the P&L. */
export type PlBasis = 'PERIOD' | 'YTD';

export interface UploadEntityCardDto {
  /** Upload profile: P&L as the period movement (default) or year-to-date. */
  plBasis: PlBasis;
  code: string;
  legalName: string;
  shortName: string;
  functionalCurrency: string;
  erp: ErpSystem;
  itemStatus: ItemStatus;
  /** Workflow step this entity is at (UPLOAD_DATA, MAPPING, ...). */
  currentStep: string;
  uploadStatus: EntityUploadStatus;
  /** This user may upload for this entity now. */
  canEdit: boolean;
  /** Why the card is read-only, when it is. */
  readOnlyReason: string | null;
  tb: { latest: TbVersionDto | null; versionCount: number };
  coa: { latest: FileRefDto | null; count: number };
  documents: FileRefDto[];
}

export interface RateCellDto {
  month: string;
  currency: string;
  opening: string | null;
  closing: string | null;
  average: string | null;
  source: string | null;
  enteredBy: string | null;
  enteredAt: string | null;
}

export interface RateMonthDto {
  /** First day of the month. */
  month: string;
  label: string;
  locked: boolean;
  lockedReason: string | null;
}

export interface RatesPanelDto {
  periodLabel: string;
  /** Functional and translated currencies of the task's entities, except USD. */
  currencies: string[];
  months: RateMonthDto[];
  /** One per currency × month (values null when missing). */
  cells: RateCellDto[];
  complete: boolean;
  missing: number;
  warnings: { month: string; currency: string; code: string; message: string }[];
  /** Policy label for where rates come from. */
  sourceLabel: string;
  /** Shown for quarters / years (how period rates are derived from months). */
  assumption: string | null;
  canEdit: boolean;
}

export interface UploadStepDto {
  task: {
    id: string;
    number: string;
    type: StatementType;
    periodLabel: string;
    description: string;
    dueDate: string;
    status: TaskStatus;
    currentStep: string;
    locked: boolean;
  };
  rates: RatesPanelDto;
  entities: UploadEntityCardDto[];
  summary: {
    validated: number;
    total: number;
    ratesComplete: boolean;
    /** "5 of 7 entities validated · rates complete for Aug-2026" */
    text: string;
  };
  /** At least one entity is validated and still on this step, and the user may prepare. */
  canContinue: boolean;
}

/** Response to a TB file upload and to each re-parse with edited column settings. */
export interface TbPreviewDto {
  fileId: string;
  fileName: string;
  /** Headers of the header row, for the column dropdowns ("Column D · Closing Balance"). */
  columns: { index: number; label: string }[];
  settings: TbColumnSettingsDto | null;
  settingsSource: 'PROFILE' | 'DETECTED' | 'EDITED' | 'NONE';
  detectedPeriod: { from: string; to: string } | { asOf: string } | null;
  detectedOrganisation: string | null;
  /** First 10 lines under the header, with the amount as it will be saved. */
  preview: { row: number; code: string; name: string; amount: string | null }[];
  check: {
    status: TbStatus;
    balanced: boolean;
    totals: TbTotalsDto;
    lineCount: number;
    newAccounts: { code: string; name: string }[];
    errors: UploadIssueDto[];
    warnings: UploadIssueDto[];
    info: UploadIssueDto[];
    needsAcknowledgement: UploadIssueDto[];
  } | null;
}

/** Result of a rate file upload or a manual save. */
export interface RateSaveResultDto {
  file: FileRefDto | null;
  changed: number;
  unchanged: number;
  /** Upload with skip-locked: rows of locked months left out. */
  skippedLocked?: number;
  warnings: { month: string; currency: string; code: string; message: string }[];
}

/** Rates fetched from the free API for months of a period, before saving. */
export interface RateFetchRowDto {
  month: string;
  currency: string;
  /** Feed the figures came from. */
  source: string;
  opening: string | null;
  closing: string | null;
  average: string | null;
  /** The previous month's last working day (opening) and this month's (closing). */
  openingDate: string | null;
  closingDate: string | null;
  /** Working days averaged. */
  days: number;
  /** Rates stored today for the month, if any. */
  current: { opening: string | null; closing: string | null; average: string | null } | null;
  /** NEW / CHANGED / UNCHANGED / LOCKED / ERROR. */
  status: 'NEW' | 'CHANGED' | 'UNCHANGED' | 'LOCKED' | 'ERROR';
  problems: string[];
}

export interface RateFetchPreviewDto {
  rows: RateFetchRowDto[];
  /** How the figures are worked out. */
  method: string;
  /** At least one NEW or CHANGED row and no feed failure. */
  canSave: boolean;
}

export interface RateInputDto {
  month: string;
  currency: string;
  opening: string | null;
  closing: string | null;
  average: string | null;
}

/**
 * Shown when no rate source is set (Configuration → Settings): the free-API default (rates can also be
 * entered or uploaded; FBIL is not mandatory for now).
 */
export const RATE_SOURCE_LABEL =
  'Free API: ECB reference rates (Frankfurter) for the currencies the ECB publishes, currency-api for the others (e.g. AED, LKR); closing = last working day of the month; average = mean of working-day rates; opening = previous month closing';
export const PERIOD_AVERAGE_ASSUMPTION =
  'Assumption: for a quarter or year, opening = first month’s opening, closing = last month’s closing, average = simple mean of the monthly averages.';
