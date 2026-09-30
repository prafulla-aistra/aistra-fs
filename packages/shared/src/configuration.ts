/**
 * Configuration (step 2): currencies, entities, group structure, financial-year calendar,
 * due dates and holidays. Shapes shared by the API and the web app.
 *
 * Decimal values (percentages, rates) travel as strings so they are never floats.
 * Dates are ISO calendar dates "YYYY-MM-DD".
 */
import type { ErpSystem, Gaap, PeriodStatus, PeriodType, StatementType } from './enums';

export type IsoDate = string;

// ---------------------------------------------------------------- currencies

export interface CurrencyDto {
  code: string;
  name: string;
  symbol: string;
  isActive: boolean;
  /** Entities using it (functional, reporting, translated or historical rate). */
  usedBy: string[];
}

export interface CreateCurrencyRequest {
  code: string;
  name: string;
  symbol: string;
}

export interface UpdateCurrencyRequest {
  name?: string;
  symbol?: string;
  isActive?: boolean;
}

// ---------------------------------------------------------------- entities

export interface HistoricalRateDto {
  /** 1 unit of the entity's functional currency = `rate` units of this currency. */
  currency: string;
  rate: string;
  toBeConfirmed: boolean;
  note: string | null;
}

export interface MissingHistoricalRateDto {
  currency: string;
  reasons: string[];
}

export interface EntityDto {
  code: string;
  legalName: string;
  shortName: string;
  country: string;
  functionalCurrency: string;
  reportingCurrency: string;
  translatedCurrencies: string[];
  parentCode: string | null;
  parentName: string | null;
  parentLegalName: string | null;
  /** % ultimately held by the ultimate parent (58.49 for AE), this month. */
  effectiveGroupPct: string | null;
  /** Month the current ownership row applies from. */
  ownershipEffectiveFrom: IsoDate | null;
  incorporatedOn: IsoDate | null;
  /** The functional currency can no longer change (the entity has finalised reports). */
  functionalCurrencyLocked: boolean;
  functionalCurrencyLockReason: string | null;
  /** % held by parent, e.g. "58.49"; null for the ultimate parent. */
  heldByParentPct: string | null;
  erp: ErpSystem;
  gaap: Gaap;
  isActive: boolean;
  toBeConfirmed: boolean;
  toBeConfirmedNote: string | null;
  /** Variance flags ignore movements below this (functional currency); null = not set. */
  materiality: string | null;
  sortOrder: number;
  historicalRates: HistoricalRateDto[];
  /** Historical rates this entity needs but does not have. */
  missingHistoricalRates: MissingHistoricalRateDto[];
}

export interface EntityInput {
  legalName: string;
  shortName: string;
  country: string;
  functionalCurrency: string;
  reportingCurrency: string;
  translatedCurrencies: string[];
  parentCode: string | null;
  heldByParentPct: string | null;
  erp: ErpSystem;
  gaap: Gaap;
  isActive: boolean;
  toBeConfirmed: boolean;
  toBeConfirmedNote: string | null;
  /** Optional for older clients; null clears it. */
  materiality?: string | null;
  incorporatedOn?: IsoDate | null;
  /** Required when a currency (functional, reporting, translated) changes. */
  reason?: string | null;
  /** Create only: the month the ownership applies from (default: this month). */
  ownershipEffectiveFrom?: IsoDate | null;
  historicalRates: {
    currency: string;
    rate: string;
    toBeConfirmed: boolean;
    note: string | null;
  }[];
}

export interface CreateEntityRequest extends EntityInput {
  code: string;
}

export type UpdateEntityRequest = EntityInput;

// ---------------------------------------------------------------- group structure

export interface GroupTreeNode {
  code: string;
  shortName: string;
  legalName: string;
  functionalCurrency: string;
  reportingCurrency: string;
  heldByParentPct: string | null;
  /** % ultimately held by the ultimate parent. */
  effectiveGroupPct: string;
  toBeConfirmed: boolean;
  children: GroupTreeNode[];
}

export interface ConsolidationLevelDto {
  level: number;
  name: string;
  parentCode: string;
  /** Level currency: the override if set, else the parent's reporting currency. */
  currency: string;
  defaultCurrency: string;
  currencyOverridden: boolean;
  parentLegalName: string;
  members: { code: string; shortName: string; legalName: string; functionalCurrency: string }[];
  /** Where non-controlling interests arise, e.g. India group 41.51%. */
  nci: { entityCode: string; name: string; nciPct: string; members: string[] }[];
}

export interface GroupIssueDto {
  code: string;
  entityCode?: string;
  message: string;
}

export interface GroupStructureDto {
  /** null when the structure is invalid (see issues). */
  tree: GroupTreeNode | null;
  levels: ConsolidationLevelDto[];
  issues: GroupIssueDto[];
  /** The structure is shown as at this month (first day). */
  asAt: IsoDate;
}

export interface OwnershipRowDto {
  id: string;
  parentCode: string | null;
  parentLegalName: string | null;
  heldByParentPct: string | null;
  effectiveFrom: IsoDate;
  reason: string;
  by: string | null;
  at: string;
  /** In force this month. */
  current: boolean;
}

export interface ChangeOwnershipRequest {
  parentCode: string | null;
  heldByParentPct: string | null;
  /** First day of a month. */
  effectiveFrom: IsoDate;
  reason: string;
}

export interface EntityDetailDto {
  entity: EntityDto;
  ownership: OwnershipRowDto[];
  /** Consolidation levels the entity belongs to this month. */
  levels: { level: number; name: string; currency: string }[];
  chartOfAccounts: { accounts: number; mapped: number; mappedPct: string };
  tasks: {
    id: string;
    number: string;
    type: StatementType;
    periodLabel: string;
    status: string;
    itemStatus: string;
  }[];
  history: {
    id: string;
    timestamp: string;
    action: string;
    user: string | null;
    oldValue: unknown;
    newValue: unknown;
  }[];
  /** Why the entity cannot be deactivated now (null = it can). */
  deactivateBlockedReason: string | null;
}

/** Live preview for the add-entity wizard. */
export interface EntityPreviewRequest {
  code: string;
  functionalCurrency: string;
  reportingCurrency: string;
  translatedCurrencies: string[];
  parentCode: string | null;
  heldByParentPct: string | null;
  effectiveFrom: IsoDate;
}

export interface EntityPreviewDto {
  /** Ultimate parent first, ending with the new entity. */
  path: { code: string; legalName: string }[];
  effectiveGroupPct: string | null;
  levels: { level: number; name: string; currency: string }[];
  requiredHistoricalRates: { currency: string; reasons: string[] }[];
  issues: GroupIssueDto[];
}

// ---------------------------------------------------------------- calendar and due dates

export interface DueDateDto {
  statementType: StatementType;
  workingDays: number;
  /** From the rule and the holiday list. */
  calculated: IsoDate;
  override: { dueDate: IsoDate; reason: string; by: string; at: string } | null;
  /** The override if there is one, else the calculated date. */
  effective: IsoDate;
}

export interface PeriodDto {
  id: string;
  type: PeriodType;
  sequence: number;
  label: string;
  startDate: IsoDate;
  endDate: IsoDate;
  status: PeriodStatus;
  statusChangedAt: string | null;
  statusChangedBy: string | null;
  dueDates: DueDateDto[];
}

export interface FinancialYearDto {
  id: string;
  startYear: number;
  label: string;
  startDate: IsoDate;
  endDate: IsoDate;
  periods: PeriodDto[];
}

export interface FinancialYearOption {
  startYear: number;
  label: string;
  exists: boolean;
}

/** Financial years that can be created (CLAUDE.md step 2 list). */
export const FINANCIAL_YEAR_START_YEARS = [2024, 2025, 2026, 2027] as const;

export interface DueDateRuleDto {
  statementType: StatementType;
  periodType: PeriodType;
  workingDays: number;
}

export interface HolidayDto {
  id: string;
  date: IsoDate;
  description: string;
}

export interface OverrideDueDateRequest {
  dueDate: IsoDate;
  reason: string;
}

export interface ClearOverrideRequest {
  reason: string;
}

export interface ChangePeriodStatusRequest {
  status: PeriodStatus;
}

export const STATEMENT_LABELS: Record<StatementType, string> = {
  SFS: 'Standalone (SFS)',
  CFS: 'Consolidated (CFS)',
};
export const PERIOD_TYPE_LABELS: Record<PeriodType, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  ANNUAL: 'Annual',
};

// ---------------------------------------------------------------- reference data (read-only)

export interface FsliDto {
  code: string;
  name: string;
  statement: 'BS' | 'PL';
  class: 'A' | 'L' | 'E' | 'I' | 'X';
  rateBasis: string;
  consolidationOnly: boolean;
  needsCounterparty: boolean;
  intercompany: boolean;
  computed: boolean;
  /** Accounts mapped to it, across all entities. */
  accounts: number;
}

export interface AccountTypeDefaultDto {
  erp: string;
  accountType: string;
  fsliCode: string;
  fsliName: string;
}

export interface FormatDto {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  tasks: number;
}

export interface ExchangeRateRowDto {
  month: IsoDate;
  currency: string;
  opening: string | null;
  closing: string | null;
  average: string | null;
  source: string;
  enteredBy: string | null;
  enteredAt: string;
}
