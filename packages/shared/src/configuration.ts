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
  toBeConfirmed: boolean;
  children: GroupTreeNode[];
}

export interface ConsolidationLevelDto {
  level: number;
  name: string;
  parentCode: string;
  /** Default level currency: the parent entity's reporting currency. */
  currency: string;
  members: { code: string; shortName: string }[];
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
