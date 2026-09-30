/**
 * Task workspace, step 2 "Review and map" (page 4). The API computes every total, rate,
 * reason and suggestion; the web app only displays them.
 */
import type { ErpSystem } from './enums';
import type { ItemStatus } from './tasks';
import type { UploadStepDto } from './upload-step';

/** Zoho account types (the account-type select). */
export const ZOHO_ACCOUNT_TYPES = [
  'Cash',
  'Bank',
  'Accounts Receivable',
  'Other Current Asset',
  'Stock',
  'Fixed Asset',
  'Other Asset',
  'Accounts Payable',
  'Other Current Liability',
  'Credit Card',
  'Long Term Liability',
  'Other Liability',
  'Equity',
  'Income',
  'Other Income',
  'Expense',
  'Cost Of Goods Sold',
  'Other Expense',
] as const;

export interface MappingTabDto {
  code: string;
  shortName: string;
  itemStatus: ItemStatus;
  currentStep: string;
  /** The latest TB version is validated (with or without warnings). */
  hasValidatedTb: boolean;
  /** Accounts still to map (0 = complete); null without a validated TB. */
  toMap: number | null;
}

export interface MappingStepDto {
  task: UploadStepDto['task'];
  entities: MappingTabDto[];
}

export interface RateValueDto {
  /** 10 decimals; null when missing. */
  value: string | null;
  /** e.g. "1 ÷ 86.90". */
  formula: string | null;
  missing: string[];
}

export interface TranslationRateRowDto {
  target: string;
  opening: RateValueDto;
  closing: RateValueDto;
  average: RateValueDto;
  /** From the entity master (equity: share capital and premium). */
  historical: RateValueDto;
}

export interface MappingRatesDto {
  periodLabel: string;
  functionalCurrency: string;
  rows: TranslationRateRowDto[];
  /** "No translation needed: reports in USD." when the entity has no translated currencies. */
  noTranslation: string | null;
  assumption: string | null;
  sourceLabel: string;
  appliedTo: { kind: string; text: string }[];
}

export type MapReasonCode = 'NOT_IN_COA' | 'NO_FSLI' | 'NO_COUNTERPARTY';

export interface AccountToMapDto {
  code: string;
  name: string;
  /** Signed: Dr positive, Cr negative. */
  amount: string;
  accountType: string | null;
  inCoa: boolean;
  reasons: MapReasonCode[];
  reasonText: string;
  current: { fsliCode: string | null; counterpartyCode: string | null };
  suggestion: { fsliCode: string; counterpartyCode: string | null; source: string } | null;
}

export interface MappedLineDto {
  code: string;
  name: string;
  accountType: string | null;
  fsliCode: string | null;
  fsliName: string | null;
  counterpartyCode: string | null;
  amount: string;
  mapped: boolean;
  intercompany: boolean;
  inCoa: boolean;
}

export interface FsliSummaryDto {
  rows: { code: string; name: string; statement: 'BS' | 'PL'; amount: string }[];
  unmapped: string;
  bsTotal: string;
  plTotal: string;
  profit: string;
  total: string;
  nil: boolean;
}

export interface IntercompanyRowDto {
  counterpartyCode: string;
  counterpartyName: string;
  receivable: string;
  payable: string;
  revenue: string;
  charges: string;
}

export interface FsliOptionDto {
  code: string;
  name: string;
  statement: 'BS' | 'PL';
  class: 'A' | 'L' | 'E' | 'I' | 'X';
  needsCounterparty: boolean;
}

export interface EntityMappingDto {
  entity: {
    code: string;
    legalName: string;
    shortName: string;
    functionalCurrency: string;
    erp: ErpSystem;
    itemStatus: ItemStatus;
    currentStep: string;
  };
  canEdit: boolean;
  readOnlyReason: string | null;
  /** null: no validated TB yet ("Upload a trial balance first"). */
  tb: { version: number; fileName: string; createdAt: string } | null;
  rates: MappingRatesDto;
  toMap: AccountToMapDto[];
  lines: MappedLineDto[];
  totals: { debits: string; credits: string; balanced: boolean };
  fsliSummary: FsliSummaryDto | null;
  intercompany: IntercompanyRowDto[];
  completion: {
    balanced: boolean;
    toMap: number;
    counterpartiesComplete: boolean;
    missingRates: string[];
    canContinue: boolean;
  };
  options: {
    fslis: FsliOptionDto[];
    accountTypes: readonly string[];
    counterparties: { code: string; name: string; directSubsidiary: boolean }[];
  };
}

export interface MappingInputDto {
  accountCode: string;
  accountType: string | null;
  fsliCode: string;
  counterpartyCode: string | null;
  /** The user ticked the account-type / FSLI-class warning. */
  confirmWarnings?: boolean;
  /** Required when changing an account that already had a mapping. */
  reason?: string | null;
}

/** Per-account problems returned with a 400 when saving mappings. */
export interface MappingRowIssuesDto {
  accountCode: string;
  errors: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
}

export const RATE_APPLIED_TO = [
  { kind: 'CLOSING', text: 'Closing → assets and liabilities' },
  { kind: 'AVERAGE', text: 'Average → income and expenses' },
  { kind: 'HISTORICAL', text: 'Historical → share capital and premium' },
  { kind: 'OPENING', text: 'Opening → other reserves' },
  {
    kind: 'ROLL_FORWARD',
    text: 'Retained earnings → roll-forward (explained in the translation step)',
  },
] as const;

export const CHANGE_MAPPING_NOTICE =
  'This changes the chart of accounts for this and future reports. Finalised reports are not affected.';

/** Configuration → Chart of accounts row. */
export interface ChartOfAccountDto {
  accountCode: string;
  accountName: string;
  accountType: string | null;
  fsliCode: string | null;
  fsliName: string | null;
  counterpartyCode: string | null;
  source: 'SEED' | 'COA_UPLOAD' | 'TASK_MAPPING';
  /** "Seed", "Chart of accounts upload", "Mapped in task SFS-2026-08-001". */
  sourceLabel: string;
  /** FSLI suggested automatically and not yet confirmed. */
  suggested: boolean;
  updatedBy: string | null;
  updatedAt: string;
}
