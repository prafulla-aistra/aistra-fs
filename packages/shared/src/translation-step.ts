/**
 * Task workspace, step 4 "Currency translation" (page 6). Every figure comes from the engine
 * (translateTB) via the API; the web app only displays it.
 */
import type { EntityComparativesDto } from './comparatives-step';
import type { MappingTabDto } from './mapping-step';
import type { UploadStepDto } from './upload-step';

export interface TranslationRateDto {
  full: string | null;
  value: string | null;
  formula: string | null;
  sourceMonths: string[];
  missing: string[];
}

export interface TranslatedLineDto {
  code: string;
  name: string;
  fsliCode: string | null;
  fsliName: string | null;
  basis: 'CLOSING' | 'AVERAGE' | 'HISTORICAL' | 'OPENING' | 'ROLL_FORWARD' | 'COMPUTED';
  basisLabel: string;
  overridden: boolean;
  rate: string | null;
  functional: string;
  translated: string;
}

export interface TranslationSummaryDto {
  totalAssets: string;
  totalLiabilities: string;
  shareCapitalAndPremium: string;
  retainedEarnings: string;
  otherReserves: string;
  profit: string;
  fctr: string;
  totalEquity: string;
  balanced: boolean;
}

export interface CurrencyTranslationDto {
  target: string;
  /** "INR → USD" */
  label: string;
  status: 'OK' | 'FAIL';
  failures: string[];
  rates: {
    opening: TranslationRateDto;
    closing: TranslationRateDto;
    average: TranslationRateDto;
    historical: TranslationRateDto;
  };
  lines: TranslatedLineDto[];
  profit: string | null;
  fctr: string | null;
  totals: { functional: string; translated: string | null };
  summary: TranslationSummaryDto | null;
  reMethod: { kind: 'ROLL_FORWARD' | 'OPENING_RATE' | 'SAME_CURRENCY' | 'NONE'; text: string };
  warnings: string[];
  /** FCTR this period less FCTR of the finalised comparative (same currency), or null. */
  fctrMovement: {
    current: string;
    comparative: string;
    movement: string;
    comparativeLabel: string;
  } | null;
  fctrMovementNote: string;
}

export interface EntityTranslationDto {
  entity: EntityComparativesDto['entity'];
  canEdit: boolean;
  readOnlyReason: string | null;
  tb: { version: number; fileName: string } | null;
  periodLabel: string;
  periodType: string;
  /** "No translation needed: <entity> presents in <currency>." */
  noTranslation: string | null;
  currencies: CurrencyTranslationDto[];
  /** Changes whenever a rate used here changes (for "Rates changed since you last viewed"). */
  ratesStamp: string;
  canContinue: boolean;
}

export interface TranslationStepDto {
  task: UploadStepDto['task'];
  entities: (MappingTabDto & { currencies: number; failed: number | null })[];
}
