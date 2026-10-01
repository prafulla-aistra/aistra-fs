/**
 * Task workspace, step 5 "Statements and notes" (page 7). Every figure comes from the engine
 * (buildStatement, lineNote, intercompanyNote, scaleAmount) via the API; the web app only
 * displays it.
 */
import type { ComparativeSourceKind } from './comparatives-step';
import type { FormatLineTypeCode, FormatRoleCode } from './configuration-c2';
import type { MappingTabDto } from './mapping-step';
import type { ItemStatus } from './tasks';
import type { UploadStepDto } from './upload-step';

export type StatementUnitCode = 'ACTUAL' | 'THOUSANDS' | 'LAKHS' | 'CRORES' | 'MILLIONS';
export const STATEMENT_UNITS: { code: StatementUnitCode; label: string }[] = [
  { code: 'ACTUAL', label: 'Actual' },
  { code: 'THOUSANDS', label: 'Thousands' },
  { code: 'LAKHS', label: 'Lakhs' },
  { code: 'CRORES', label: 'Crores' },
  { code: 'MILLIONS', label: 'Millions' },
];

export const STATEMENTS_FOOTER =
  'Corrections are made in the ERP and the trial balance re-uploaded, so the statements always agree to the books.';
export const ROUNDING_NOTE = 'Figures may not add due to rounding';
export const INTERCOMPANY_NOTE_LABEL =
  'Related party balances – intercompany (full related party disclosure to follow)';

export interface TieDto {
  ok: boolean;
  /** Face figure less what it must equal (0.00 when it ties), in the units shown. */
  difference: string;
}

export interface StatementRowDto {
  key: string;
  type: FormatLineTypeCode;
  label: string;
  indent: number;
  role: FormatRoleCode | null;
  note: number | null;
  current: string | null;
  comparative: string | null;
  /** Total equity and liabilities (= total assets) and profit (= profit carried to the BS). */
  tie: { current: TieDto; comparative: TieDto | null; text: string } | null;
}

export interface StatementViewDto {
  title: string;
  comparativeTitle: string | null;
  rows: StatementRowDto[];
}

export interface EntityStatementsDto {
  entity: {
    code: string;
    legalName: string;
    shortName: string;
    functionalCurrency: string;
    gaap: string;
    itemStatus: ItemStatus;
    currentStep: string;
  };
  canEdit: boolean;
  readOnlyReason: string | null;
  /** Figures come from the stored snapshot (finalised entity or done task). */
  fromSnapshot: boolean;
  hasTb: boolean;
  options: {
    formats: { code: string; name: string; version: number; isTaskFormat: boolean }[];
    currencies: { code: string; translatedFrom: string | null; status: 'OK' | 'FAIL' }[];
    units: { code: StatementUnitCode; label: string }[];
  };
  selection: {
    format: string;
    formatName: string;
    formatVersion: number;
    isTaskFormat: boolean;
    currency: string;
    unit: StatementUnitCode;
    showNil: boolean;
  };
  header: {
    legalName: string;
    formatName: string;
    /** "INR · Actual", "INR · Lakhs". */
    currencyUnits: string;
    /** "Translated from INR". */
    translatedFrom: string | null;
    periodLabel: string;
    comparativeLabel: string;
    comparativeSource: { kind: ComparativeSourceKind; label: string; taskNumber: string | null };
    /** "No comparative" when there is none. */
    noComparative: string | null;
  };
  /** The selected currency failed to translate. */
  failures: string[];
  balanceSheet: StatementViewDto;
  profitAndLoss: StatementViewDto;
  roundingNote: string | null;
  warnings: string[];
  footer: string;
  canContinue: boolean;
}

export interface StatementsStepDto {
  task: UploadStepDto['task'] & { formatName: string | null };
  entities: (MappingTabDto & { ties: boolean | null })[];
}
