/**
 * New-task wizard (page 2). The API computes every availability tag and due date; the web
 * app only shows them. The API enforces all rules again on create.
 */
import type { ErpSystem, Gaap, PeriodType, StatementType } from './enums';
import type { TaskStatus } from './tasks';

/** Workflow steps of a task. The task workspace (next pages) implements them. */
export const TASK_STEPS = [
  { code: 'UPLOAD_DATA', label: 'Upload data', short: 'Upload' },
  { code: 'MAPPING', label: 'Review and map', short: 'Map' },
  { code: 'COMPARATIVES', label: 'Comparatives', short: 'Comparatives' },
  { code: 'TRANSLATION', label: 'Currency translation', short: 'Translation' },
  { code: 'STATEMENTS', label: 'Statements', short: 'Statements' },
  { code: 'NOTES', label: 'Notes to accounts', short: 'Notes' },
  { code: 'REVIEW', label: 'Review', short: 'Review' },
  { code: 'FINALISED', label: 'Finalised', short: 'Finalised' },
] as const;
export type TaskStepCode = (typeof TASK_STEPS)[number]['code'];

export function taskStepLabel(code: string): string {
  const i = TASK_STEPS.findIndex((s) => s.code === code);
  return i >= 0 ? `Step ${i + 1} · ${TASK_STEPS[i]!.label}` : code;
}

export interface TaskRefDto {
  id: string;
  number: string;
  status: TaskStatus;
}

export interface WizardTaskTypeDto {
  type: StatementType | 'MIS';
  label: string;
  description: string;
  enabled: boolean;
  /** Why it is not available, when disabled. */
  reason?: string;
}

export interface WizardOptionsDto {
  /** Only types the user may prepare (plus MIS, shown disabled). */
  types: WizardTaskTypeDto[];
  /** Open financial years. */
  financialYears: { id: string; label: string; startDate: string; endDate: string }[];
  /** The open FY containing today, if any. */
  defaultFyId: string | null;
  formats: { code: string; name: string; description: string }[];
  /** The format this user chose last (if still active). */
  defaultFormatCode: string | null;
  /** The dashboard's period in close. */
  periodInCloseId: string | null;
  preparer: { id: string; name: string };
}

export type PeriodAvailability = 'AVAILABLE' | 'TASK_EXISTS' | 'NOT_ENDED' | 'CLOSED';

export interface WizardPeriodDto {
  id: string;
  /** "Aug-2026", "Q1 (Apr–Jun 2026)", "FY 2026-27 (Apr-2026 to Mar-2027)". */
  label: string;
  type: PeriodType;
  startDate: string;
  endDate: string;
  availability: PeriodAvailability;
  /** Available, or a task exists (step 6 then shows what is left or links to the task). */
  selectable: boolean;
  existingTasks: TaskRefDto[];
  /** SFS: entities in the user's scope not yet in a task. CFS: 1 if a task can be created, else 0. */
  remaining: number;
  /** Due date for this period and task type (rules, holidays and overrides). */
  dueDate: string;
  isPeriodInClose: boolean;
}

export interface WizardEntityDto {
  code: string;
  shortName: string;
  legalName: string;
  functionalCurrency: string;
  translatedCurrencies: string[];
  gaap: Gaap;
  erp: ErpSystem;
  toBeConfirmed: boolean;
  toBeConfirmedNote: string | null;
  /** The SFS task for the same period that already includes this entity. */
  inTask: TaskRefDto | null;
}

export interface WizardLevelDto {
  level: number;
  name: string;
  currency: string;
  members: { code: string; shortName: string }[];
  /** Member entities whose SFS for the period is finalised. */
  sfsFinalised: number;
  sfsTotal: number;
}

export interface WizardLevelsDto {
  levels: WizardLevelDto[];
  existingTask: TaskRefDto | null;
  canCreate: boolean;
  /** Why a CFS task cannot be created, if it cannot. */
  blockedReason: string | null;
}

export interface CreateTaskRequest {
  type: StatementType;
  periodId: string;
  formatCode: string;
  /** SFS only: at least one. */
  entityCodes?: string[];
  description: string;
  reviewerNote?: string | null;
}
