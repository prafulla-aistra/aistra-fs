/**
 * Task steps "Review" and "Finalised" (page 8): the review pack, submission, review queries,
 * sign-offs, finalisation snapshots and notifications.
 */
import type { CheckSeverityCode, EditAccessRequestDto } from './configuration-c3';
import type { MappingTabDto } from './mapping-step';
import type { ItemStatus } from './tasks';
import type { UploadStepDto } from './upload-step';

export interface NotificationsDto {
  unread: number;
  items: {
    id: string;
    kind: string;
    title: string;
    body: string | null;
    link: string | null;
    read: boolean;
    createdAt: string;
  }[];
}

export type CheckStep =
  'UPLOAD_DATA' | 'MAPPING' | 'COMPARATIVES' | 'TRANSLATION' | 'STATEMENTS' | 'NOTES';

export interface CheckResultDto {
  /** Unique per currency ("BS_TIES:USD"). */
  key: string;
  code: string;
  name: string;
  severity: CheckSeverityCode;
  currency: string | null;
  result: 'PASS' | 'FAIL' | 'NA';
  details: string;
  link: { step: CheckStep; key?: string };
}

export type SignOffStatus =
  'NOT_STARTED' | 'SUBMITTED' | 'WAITING' | 'APPROVED' | 'RETURNED' | 'NOT_REQUIRED';
export interface SignOffDto {
  role: 'PREPARER' | 'REVIEWER' | 'APPROVER';
  name: string | null;
  status: SignOffStatus;
  at: string | null;
  comment: string | null;
}

export type QueryTargetType = 'LINE' | 'ACCOUNT' | 'NOTE' | 'CHECK' | 'ENTITY';
export const QUERY_TARGET_LABELS: Record<QueryTargetType, string> = {
  LINE: 'Statement line',
  ACCOUNT: 'Account',
  NOTE: 'Note',
  CHECK: 'Control check',
  ENTITY: 'The entity in general',
};

export interface QueryDto {
  id: string;
  targetType: QueryTargetType;
  targetKey: string | null;
  targetLabel: string;
  /** Where the linked item is shown (step and key), for the link and the markers. */
  link: { step: CheckStep | 'REVIEW'; key?: string } | null;
  text: string;
  status: 'OPEN' | 'ANSWERED' | 'CLOSED';
  raisedBy: string;
  raisedAt: string;
  messages: {
    kind: 'ANSWER' | 'CLOSE' | 'REOPEN';
    text: string;
    author: string;
    at: string;
    file: { id: string; name: string } | null;
  }[];
  canAnswer: boolean;
  canClose: boolean;
  canReopen: boolean;
}

/** A not-closed query, for the markers on statement lines, accounts and notes. */
export interface QueryMarkerDto {
  targetType: QueryTargetType;
  targetKey: string | null;
  status: 'OPEN' | 'ANSWERED';
  text: string;
}

export interface KeyFiguresDto {
  currency: string;
  rows: {
    label: string;
    current: string | null;
    comparative: string | null;
    variance: string | null;
    variancePct: string | null;
  }[];
}

export interface ReviewPackDto {
  entity: {
    code: string;
    legalName: string;
    shortName: string;
    functionalCurrency: string;
    erp: string;
    itemStatus: ItemStatus;
  };
  periodLabel: string;
  periodEnd: string;
  comparativeLabel: string;
  /** Read from the finalisation snapshot (finalised entities). */
  fromSnapshot: boolean;
  state: {
    stage: 1 | 2;
    reviewLevels: 1 | 2;
    submissionNumber: number | null;
    submittedAt: string | null;
    finalised: { at: string; by: string; version: number; hash: string } | null;
  };
  actions: {
    canSubmit: boolean;
    /** Why the preparer cannot submit (blocking checks, already submitted, permissions). */
    submitBlockedBy: string[];
    canDecide: boolean;
    /** Why this user cannot approve (segregation of duties, open queries, not a reviewer). */
    approveBlockedBy: string[];
    canReturn: boolean;
    canRaiseQuery: boolean;
    decidingAs: 'REVIEWER' | 'APPROVER' | null;
  };
  declaration: string;
  signOffs: SignOffDto[];
  checks: CheckResultDto[];
  /** Failing warnings: each needs an acknowledgement (10+ characters) to submit. */
  warningsToAcknowledge: string[];
  acknowledgements: { key: string; comment: string; by: string | null }[];
  keyFigures: KeyFiguresDto[];
  variances: {
    code: string;
    name: string;
    current: string;
    comparative: string;
    variance: string;
    variancePct: string | null;
    explanation: string | null;
  }[];
  notes: { visible: number; reviewed: number; staleFlags: number; notReviewed: string[] };
  translation: {
    currency: string;
    rates: {
      opening: string | null;
      closing: string | null;
      average: string | null;
      historical: string | null;
    };
    fctr: string | null;
    fctrMovement: string | null;
    reMethod: string;
  }[];
  intercompany: {
    counterpartyCode: string;
    counterpartyName: string;
    receivable: string;
    payable: string;
    revenue: string;
    charges: string;
  }[];
  files: {
    kind: string;
    name: string;
    version: number | null;
    uploadedBy: string;
    uploadedAt: string;
    sha256: string;
  }[];
  changes: { at: string; user: string | null; action: string; summary: string }[];
  queries: QueryDto[];
  queryTargets: Record<Exclude<QueryTargetType, 'ENTITY'>, { key: string; label: string }[]>;
}

export interface ReviewStepDto {
  task: UploadStepDto['task'];
  entities: (MappingTabDto & { openQueries: number })[];
}

export interface SubmitInput {
  declaration: boolean;
  acknowledgements: { key: string; comment: string }[];
}

export interface SnapshotVersionDto {
  version: number;
  state: 'FINAL' | 'WORKING';
  hash: string | null;
  createdBy: string;
  createdAt: string;
  finalisedAt: string | null;
  keyFigures: KeyFiguresDto[];
  signOffs: SignOffDto[];
  checks: CheckResultDto[];
}

export interface FinalisedViewDto {
  entity: ReviewPackDto['entity'];
  periodLabel: string;
  banner: string | null;
  finalised: { at: string; by: string; version: number; hash: string } | null;
  versions: SnapshotVersionDto[];
  canRequestEditAccess: boolean;
  pendingRequest: EditAccessRequestDto | null;
  reopenBlocked: string | null;
}

export const declarationText = (erp: string, periodEnd: string) =>
  `I confirm the trial balance agrees to ${erp} as at ${periodEnd}, and all accounts are mapped and reviewed.`;
