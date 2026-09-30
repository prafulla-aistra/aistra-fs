/**
 * Task workspace, step 3 "Comparatives" (page 5). The API resolves the comparative source and
 * computes every variance, flag and check; the web app only displays them.
 */
import type { ErpSystem } from './enums';
import type { AccountToMapDto, EntityMappingDto, MappingTabDto } from './mapping-step';
import type { ItemStatus } from './tasks';
import type { UploadStepDto } from './upload-step';

export type ComparativeBasis = 'PREVIOUS_PERIOD' | 'SAME_PERIOD_LAST_YEAR';
export const COMPARATIVE_BASIS_OPTIONS: { code: ComparativeBasis; label: string }[] = [
  { code: 'PREVIOUS_PERIOD', label: 'Previous period' },
  { code: 'SAME_PERIOD_LAST_YEAR', label: 'Same period last year' },
];

export type ComparativeSourceKind = 'FINALISED' | 'DRAFT' | 'UPLOADED' | 'NONE';
export const COMPARATIVE_SOURCE_LABELS: Record<ComparativeSourceKind, string> = {
  FINALISED: 'Finalised',
  DRAFT: 'Draft – not finalised',
  UPLOADED: 'Uploaded here',
  NONE: 'None',
};
export const DRAFT_COMPARATIVE_WARNING =
  'Comparatives are from a draft trial balance and may change.';
export const ROLL_FORWARD_FAIL_TEXT =
  'Opening retained earnings do not agree to prior RE + prior profit. Retained earnings will be translated at the opening rate instead of rolled forward.';

export interface ComparativesStepDto {
  task: UploadStepDto['task'];
  basis: ComparativeBasis;
  canChangeBasis: boolean;
  currentPeriodLabel: string;
  comparativePeriodLabel: string;
  entities: (MappingTabDto & { flagged: number | null; explained: number | null })[];
}

export interface RollForwardDto {
  status: 'PASS' | 'FAIL' | 'NOT_APPLICABLE' | 'NO_COMPARATIVE';
  openingRe: string | null;
  priorRe: string | null;
  priorPl: string | null;
  expected: string | null;
  difference: string | null;
  /** Plain-language result. */
  message: string;
}

export interface ComparisonRowDto {
  key: string;
  code: string;
  name: string;
  fsliCode: string | null;
  fsliName: string | null;
  current: string;
  comparative: string | null;
  variance: string | null;
  variancePct: string | null;
  tag: 'NEW' | 'NIL_THIS_PERIOD' | null;
  flagged: boolean;
  explanation: { text: string; by: string; at: string } | null;
}

export interface EntityComparativesDto {
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
  /** The current TB (null: not validated yet). */
  tb: { version: number; fileName: string } | null;
  basis: ComparativeBasis;
  comparativePeriod: { id: string | null; label: string };
  source: {
    kind: ComparativeSourceKind;
    label: string;
    taskNumber: string | null;
    fileName: string | null;
    version: number | null;
    debits: string | null;
    credits: string | null;
    lineCount: number | null;
  };
  warning: string | null;
  /** Shown when there is no comparative, or it cannot be shown yet (unmapped accounts). */
  blankReason: string | null;
  /** Upload a comparative TB here (not when a finalised one exists). */
  canUpload: boolean;
  /** Comparative accounts that are not mapped (same panel as step 2). */
  toMap: AccountToMapDto[];
  options: EntityMappingDto['options'];
  rollForward: RollForwardDto;
  accountRows: ComparisonRowDto[];
  fsliRows: ComparisonRowDto[];
  totals: {
    current: string;
    currentNil: boolean;
    comparative: string | null;
    comparativeNil: boolean | null;
  };
  materiality: string | null;
  pctThreshold: string;
  flagged: number;
  explained: number;
}
