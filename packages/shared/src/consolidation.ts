/**
 * CFS workspace (page 9): the level path, step 1 Readiness, step 2 Aggregation and step 3
 * Eliminations; configuration of intercompany pairs and the acquisitions register.
 */
import type { ItemStatus } from './tasks';
import type { UploadStepDto } from './upload-step';

export const CFS_LEVEL_STEPS = [
  { code: 'READINESS', label: 'Readiness and currency', short: 'Readiness' },
  { code: 'AGGREGATION', label: 'Aggregation', short: 'Aggregation' },
  { code: 'ELIMINATIONS', label: 'Eliminations', short: 'Eliminations' },
  { code: 'STATEMENTS', label: 'Consolidated statements', short: 'Statements' },
  { code: 'NOTES', label: 'Notes to accounts', short: 'Notes' },
  { code: 'REVIEW', label: 'Review', short: 'Review' },
  { code: 'FINALISED', label: 'Finalised', short: 'Finalised' },
] as const;
export type CfsLevelStepCode = (typeof CFS_LEVEL_STEPS)[number]['code'];

export interface CfsLevelDto {
  level: number;
  name: string;
  parentCode: string;
  currency: string;
  memberCount: number;
  members: { code: string; shortName: string }[];
  status: ItemStatus;
  currentStep: string;
  /** Every member's SFS is finalised and every lower level is finalised. */
  available: boolean;
  /** What the level waits for when not available. */
  waitingFor: string[];
}

export interface CfsWorkspaceDto {
  task: UploadStepDto['task'];
  levels: CfsLevelDto[];
  canPrepare: boolean;
}

export type TranslationSourceKind = 'SAME_CURRENCY' | 'SNAPSHOT' | 'COMPUTED' | 'MISSING';

export interface ReadinessMemberDto {
  code: string;
  shortName: string;
  /** "Level parent" or "Subsidiary of VS". */
  role: string;
  heldByParentPct: string | null;
  effectiveGroupPct: string;
  functionalCurrency: string;
  sfs: {
    status: ItemStatus | 'NONE';
    taskNumber: string | null;
    taskId: string | null;
    snapshotVersion: string | null;
  };
  source: { kind: TranslationSourceKind; text: string; warning: string | null };
  translationWarnings: string[];
  comparative: { periodLabel: string; status: ItemStatus | 'NONE'; taskNumber: string | null };
}

export interface ReadinessCheckDto {
  code: 'IC_PAIRS' | 'ACQUISITIONS' | 'ACQUISITION_RATES' | 'HISTORICAL_RATES' | 'RATES';
  label: string;
  status: 'OK' | 'WARNING' | 'MISSING';
  details: string[];
}

export interface CfsLevelHeaderDto {
  taskId: string;
  taskNumber: string;
  periodLabel: string;
  level: number;
  name: string;
  currency: string;
  status: ItemStatus;
  currentStep: string;
  available: boolean;
  waitingFor: string[];
  /** The task can still be edited by this user (CFS_PREPARE, not submitted, not finalised). */
  editable: boolean;
  readOnlyReason: string | null;
}

export interface ReadinessDto {
  level: CfsLevelHeaderDto;
  currency: {
    current: string;
    /** From configuration: the parent's reporting currency, or the override. */
    configured: string;
    options: string[];
    /** Eliminations exist: changing the currency clears them. */
    eliminationsGenerated: boolean;
    canChange: boolean;
  };
  members: ReadinessMemberDto[];
  rates: {
    currency: string;
    opening: string | null;
    closing: string | null;
    average: string | null;
    formula: string | null;
    missing: string[];
  }[];
  checks: ReadinessCheckDto[];
  canContinue: boolean;
  continueBlockedBy: string[];
}

export interface AggregationRowDto {
  key: string;
  type: 'HEADING' | 'LINE' | 'TOTAL';
  label: string;
  indent: number;
  role: string | null;
  /** Per member code (displayed sign, 2 dp); null for headings. */
  values: Record<string, string | null>;
  aggregate: string | null;
}

export interface AggregationDto {
  level: CfsLevelHeaderDto;
  currency: string;
  formatName: string;
  entities: { code: string; shortName: string }[];
  balanceSheet: AggregationRowDto[];
  profitAndLoss: AggregationRowDto[];
  fslis: {
    code: string;
    name: string;
    statement: 'BS' | 'PL';
    values: Record<string, string>;
    aggregate: string;
  }[];
  /** Balance ticks per column (member code, and "AGGREGATE"). */
  balances: { code: string; balanced: boolean; difference: string; profitTies: boolean }[];
  missing: string[];
}

export interface EliminationLineDto {
  entityCode: string | null;
  fsliCode: string;
  fsliName: string;
  counterpartyCode: string | null;
  /** Signed, debit +. */
  amount: string;
  debit: string | null;
  credit: string | null;
  note: string;
}

export interface EliminationEntryDto {
  id: string;
  type: 'IC_BALANCE' | 'IC_PNL' | 'INVESTMENT' | 'NCI' | 'MANUAL';
  typeLabel: string;
  title: string;
  originLevel: number;
  originText: string;
  entities: string[];
  lines: EliminationLineDto[];
  /** Σ debits / Σ credits of the entry (positive, 2 dp). */
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
  flagged: boolean;
  flags: string[];
  calculation: string[];
  difference: string | null;
  goodwill: string | null;
  nciProfit: string | null;
  /** Flagged IC differences: the explanation (required for review). */
  explanation: { text: string; by: string; at: string } | null;
  canExplain: boolean;
  manual: {
    id: string;
    reason: string;
    createdBy: string;
    createdAt: string;
    canDelete: boolean;
    /** Where the entry comes from (e.g. a workbook sheet and cells). */
    sourceRef: string | null;
    /** The generated entry this one replaces (its title), when it is of this level. */
    replaces: { id: string; title: string } | null;
    /** Not carried to higher levels. */
    thisLevelOnly: boolean;
    /** Brought forward from the previous month's consolidation (task number). */
    broughtForwardFrom: string | null;
    /** Entered at this level (false: carried from a lower level). */
    ownLevel: boolean;
  } | null;
}

export interface EliminationsDto {
  level: CfsLevelHeaderDto;
  currency: string;
  generated: { at: string; by: string } | null;
  /** The eliminations no longer match the members' data or configuration: regenerate. */
  stale: boolean;
  /** Members whose SFS snapshot changed since the eliminations were generated: regenerate. */
  membersChanged: string[];
  entries: EliminationEntryDto[];
  issues: string[];
  summary: {
    entries: number;
    totalDebit: string;
    totalCredit: string;
    balanced: boolean;
    icDifferencesFlagged: number;
    goodwill: string;
    capitalReserve: string;
  } | null;
  checks: { code: string; label: string; passed: boolean; details: string }[];
  canGenerate: boolean;
  generateBlockedBy: string[];
  manualOptions: {
    entities: { code: string; shortName: string }[];
    fslis: { code: string; name: string; statement: 'BS' | 'PL' }[];
    /** Generated entries of this level a manual entry can replace. */
    replaceable: { id: string; title: string }[];
  };
  /** The previous month's consolidation of this level, to bring its manual entries forward. */
  bringForward: {
    taskNumber: string;
    period: string;
    levelStatus: string;
    /** Manual entries entered at that level. */
    available: number;
    /** Of those, already brought into this task. */
    alreadyBrought: number;
  } | null;
}

export interface ManualAdjustmentInput {
  narration: string;
  reason: string;
  sourceRef?: string | null;
  /** A generated entry of this level the manual entry replaces (e.g. INVESTMENT:IN:AE). */
  replacesEntryId?: string | null;
  thisLevelOnly?: boolean;
  lines: {
    entityCode: string | null;
    fsliCode: string;
    counterpartyCode?: string | null;
    debit: string | null;
    credit: string | null;
    /** Where the figure comes from (e.g. a workbook cell). */
    ref?: string | null;
  }[];
}

// ---------------------------------------------------------------------------------------
// Configuration: intercompany pairs and the acquisitions register
// ---------------------------------------------------------------------------------------

export interface IntercompanyPairDto {
  id: string;
  entityA: string;
  entityB: string;
  tolerance: string;
  toBeConfirmed: boolean;
  note: string | null;
  /** Accounts in either chart of accounts with the other as counterparty. */
  accountsLinked: number;
}

export interface IntercompanyPairsDto {
  pairs: IntercompanyPairDto[];
  entities: { code: string; shortName: string }[];
  /** Pairs with intercompany accounts in a chart of accounts that are not marked. */
  suggested: { entityA: string; entityB: string; accounts: number }[];
  canEdit: boolean;
}

export interface IntercompanyPairInput {
  entityA: string;
  entityB: string;
  tolerance: string;
  toBeConfirmed: boolean;
  note: string | null;
}

export interface AcquisitionDto {
  id: string;
  subsidiaryCode: string;
  subsidiaryName: string;
  subsidiaryCurrency: string;
  parentCode: string;
  parentCurrency: string;
  acquiredOn: string;
  pctAcquired: string;
  cost: string;
  shareCapital: string;
  premium: string;
  preAcquisitionReserves: string;
  /** null = the default by the consolidating parent's GAAP (US GAAP: fair value; else proportionate). */
  nciMeasurement: NciMeasurement | null;
  /** NCI fair value at the acquisition date (subsidiary's currency), fair value method. */
  nciFairValue: string | null;
  toBeConfirmed: boolean;
  note: string | null;
  rates: { currency: string; rate: string; toBeConfirmed: boolean }[];
  /** Currencies a rate is needed for (the parent's and every level the subsidiary is in). */
  ratesNeeded: { currency: string; reasons: string[]; present: boolean }[];
}

export interface AcquisitionsDto {
  acquisitions: AcquisitionDto[];
  /** Subsidiaries (entities with a parent) without any acquisitions register row. */
  missing: { code: string; shortName: string; parentCode: string }[];
  entities: {
    code: string;
    shortName: string;
    functionalCurrency: string;
    parentCode: string | null;
  }[];
  canEdit: boolean;
}

export interface AcquisitionInput {
  subsidiaryCode: string;
  parentCode: string;
  acquiredOn: string;
  pctAcquired: string;
  cost: string;
  shareCapital: string;
  premium: string;
  preAcquisitionReserves: string;
  nciMeasurement?: NciMeasurement | null;
  nciFairValue?: string | null;
  toBeConfirmed: boolean;
  note: string | null;
  rates: { currency: string; rate: string; toBeConfirmed: boolean }[];
}

export type NciMeasurement = 'PROPORTIONATE' | 'FAIR_VALUE';

/** Acquisitions template upload: one row per acquisition, previewed before saving. */
export interface AcquisitionUploadRowDto {
  /** Spreadsheet row number. */
  row: number;
  action: 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'ERROR';
  subsidiaryCode: string;
  parentCode: string;
  acquiredOn: string;
  pctAcquired: string;
  cost: string;
  nciMeasurement: NciMeasurement | null;
  nciFairValue: string | null;
  rates: string[];
  problems: string[];
}

export interface AcquisitionUploadPreviewDto {
  fileName: string;
  rows: AcquisitionUploadRowDto[];
  /** File-level problems (missing columns, no rows). */
  problems: string[];
  canSave: boolean;
  saved: boolean;
}

// ---------------------------------------------------------------------------------------
// Page 10: consolidated statements, review extras
// ---------------------------------------------------------------------------------------

export type CfsColumnKind = 'ENTITY' | 'ELIM_BF' | 'ELIM_LEVEL' | 'CONSOLIDATED' | 'COMPARATIVE';

export interface CfsStatementRowDto {
  key: string;
  type: 'HEADING' | 'LINE' | 'TOTAL';
  label: string;
  indent: number;
  role: string | null;
  note: number | null;
  /** Per column code (displayed sign, selected units); null for headings / no comparative. */
  values: Record<string, string | null>;
}

export interface CfsAttributionDto {
  owners: string;
  nci: string;
  total: string;
}

export interface CfsStatementsDto {
  level: CfsLevelHeaderDto;
  /** Read from the level's finalised snapshot. */
  fromSnapshot: boolean;
  currency: string;
  options: {
    formats: { code: string; name: string; version: number; isTaskFormat: boolean }[];
    units: { code: string; label: string }[];
  };
  selection: {
    format: string;
    formatName: string;
    unit: string;
    showNil: boolean;
    showEntities: boolean;
  };
  header: {
    legalName: string;
    periodLabel: string;
    comparativeLabel: string;
    comparativeSource: { kind: 'SNAPSHOT' | 'RECOMPUTED' | 'NONE'; label: string };
    currencyUnits: string;
  };
  columns: { code: string; label: string; kind: CfsColumnKind }[];
  balanceSheet: {
    title: string;
    rows: CfsStatementRowDto[];
    /** Equity attributable to owners / NCI / total, per CONSOLIDATED and COMPARATIVE. */
    equity: Record<string, CfsAttributionDto | null>;
  };
  profitAndLoss: {
    title: string;
    rows: CfsStatementRowDto[];
    /** Profit attributable to owners / NCI, per CONSOLIDATED and COMPARATIVE. */
    attribution: Record<string, CfsAttributionDto | null>;
  };
  /** "Exchange differences on translation of foreign operations (FCTR movement)", for information. */
  fctrMemo: {
    label: string;
    available: boolean;
    reason: string | null;
    movement: CfsAttributionDto | null;
  };
  fslis: {
    code: string;
    name: string;
    statement: 'BS' | 'PL';
    values: Record<string, string | null>;
    crossFoots: boolean;
  }[];
  ticks: {
    bsBalances: boolean;
    bsDifference: string;
    profitTies: boolean;
    crossFoots: boolean;
    attributionTies: boolean;
  };
  roundingNote: string | null;
  warnings: string[];
}

/** Consolidation sections of the review pack (CFS levels). */
export interface CfsReviewExtrasDto {
  icDifferences: { entryId: string; title: string; amount: string; explanation: string | null }[];
  manualAdjustments: {
    narration: string;
    reason: string;
    originLevel: number;
    by: string;
    total: string;
  }[];
  goodwill: { title: string; goodwill: string; capitalReserve: boolean }[];
  nci: { title: string; nciProfit: string; nciEquity: string }[];
  members: {
    code: string;
    shortName: string;
    taskNumber: string | null;
    snapshotVersion: string | null;
    hash: string | null;
  }[];
  membersChanged: string[];
}
