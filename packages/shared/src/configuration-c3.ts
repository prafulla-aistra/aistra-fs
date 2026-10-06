/** Config C3: approvals, the control-check register and edit-access requests. */

export type CheckSeverityCode = 'BLOCKING' | 'WARNING' | 'INFO';
export const CHECK_SEVERITY_LABELS: Record<CheckSeverityCode, string> = {
  BLOCKING: 'Blocking',
  WARNING: 'Warning',
  INFO: 'Information',
};

export interface ControlCheckDto {
  code: string;
  statementType: 'SFS' | 'CFS';
  name: string;
  description: string;
  severity: CheckSeverityCode;
  threshold: string | null;
  thresholdUnit: 'AMOUNT' | 'COUNT' | null;
  isActive: boolean;
  toBeConfirmed: boolean;
  sortOrder: number;
}

export interface ControlCheckInput {
  severity: CheckSeverityCode;
  threshold: string | null;
  isActive: boolean;
  toBeConfirmed: boolean;
}

export interface ApprovalRuleDto {
  id: string;
  statementType: 'SFS' | 'CFS';
  /** null = the default for all entities. */
  entityCode: string | null;
  entityName: string | null;
  /** null = any period type (decision round 1). */
  periodType: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | null;
  reviewLevels: 1 | 2;
  reviewers: { id: string; name: string }[];
  approvers: { id: string; name: string }[];
}

export interface ApprovalsDto {
  rules: ApprovalRuleDto[];
  /** Users who may review (SFS_REVIEW / CFS_REVIEW), for the pickers. */
  candidates: { id: string; name: string; email: string; permissions: string[] }[];
  segregation: string[];
  canEdit: boolean;
}

export interface ApprovalRuleInput {
  statementType: 'SFS' | 'CFS';
  entityCode: string | null;
  periodType?: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | null;
  reviewLevels: 1 | 2;
  reviewerIds: string[];
  approverIds: string[];
}

export const SEGREGATION_OF_DUTIES = [
  'Whoever prepared or last edited an entity cannot review or approve it.',
  'With two review levels, the reviewer and the approver must be different people.',
  'The approver cannot be the preparer.',
  'Nobody decides their own edit-access request, nor one for an entity or level they prepared or last edited.',
];

export type EditAccessStatusCode = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface EditAccessRequestDto {
  id: string;
  taskId: string;
  taskNumber: string;
  periodLabel: string;
  entityCode: string;
  entityName: string;
  reason: string;
  status: EditAccessStatusCode;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  /** The approver may decide (EDIT_ACCESS_APPROVE, not the requester). */
  canDecide: boolean;
  /** Why this user may not decide it (own request, prepared or last edited it). */
  cannotDecideReason: string | null;
  /** Reopening is blocked (e.g. by a finalised CFS level). */
  blockedReason: string | null;
}
