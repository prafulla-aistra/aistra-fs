/**
 * Close tasks and the dashboard (page 1). Shapes shared by the API and the web app.
 * Every count and status is computed by the API; the web app only displays them.
 */
import type { PeriodStatus, PeriodType, StatementType } from './enums';

export const ItemStatus = {
  NotStarted: 'NOT_STARTED',
  InProgress: 'IN_PROGRESS',
  InReview: 'IN_REVIEW',
  Finalised: 'FINALISED',
} as const;
export type ItemStatus = (typeof ItemStatus)[keyof typeof ItemStatus];

export const TaskStatus = {
  NotStarted: 'NOT_STARTED',
  InProgress: 'IN_PROGRESS',
  InReview: 'IN_REVIEW',
  Done: 'DONE',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  FINALISED: 'Finalised',
};
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  DONE: 'Done',
};

/** Status filter of the task table: a task status, or one of the dashboard card filters. */
export const TaskFilterStatus = {
  ...TaskStatus,
  Overdue: 'OVERDUE',
  /** SFS tasks with an entity in scope that is Not started or In progress. */
  ToPrepare: 'TO_PREPARE',
  /** SFS tasks with an entity in scope that is In review. */
  AwaitingReview: 'AWAITING_REVIEW',
} as const;
export type TaskFilterStatus = (typeof TaskFilterStatus)[keyof typeof TaskFilterStatus];

export interface TaskItemDto {
  /** Entity code (SFS) or "L1" … (CFS). */
  code: string;
  label: string;
  status: ItemStatus;
}

export interface TaskRowDto {
  id: string;
  number: string;
  type: StatementType;
  periodId: string;
  periodLabel: string;
  periodType: PeriodType;
  fyLabel: string;
  description: string;
  format: string | null;
  dueDate: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  currentStep: string;
  status: TaskStatus;
  overdue: boolean;
  /** Done tasks are locked. */
  locked: boolean;
  /** "Continue" if permitted and an entity/level in scope is Not started or In progress; else "View". */
  action: 'CONTINUE' | 'VIEW';
  itemKind: 'ENTITY' | 'LEVEL';
  /** Entities / levels in the user's scope, each with its own status. */
  items: TaskItemDto[];
  /** All entities / levels in the task, including any outside the user's scope. */
  itemTotal: number;
}

export interface TaskListQuery {
  periodId?: string;
  fyId?: string;
  periodType?: PeriodType;
  type?: StatementType;
  status?: TaskFilterStatus;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface TaskListPage {
  items: TaskRowDto[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------- dashboard

export interface PeriodOptionDto {
  id: string;
  label: string;
  fyId: string;
  fyLabel: string;
  status: PeriodStatus;
  endDate: string;
}

export type DeadlineDto =
  | { kind: StatementType; dueDate: string; status: 'ON_TRACK'; workingDaysLeft: number }
  | { kind: StatementType; dueDate: string; status: 'OVERDUE'; overdueDays: number }
  | { kind: 'COMPLETE' };

export interface ItemCountsDto {
  NOT_STARTED: number;
  IN_PROGRESS: number;
  IN_REVIEW: number;
  FINALISED: number;
}

export interface DashboardDto {
  today: string;
  /** Demo tasks exist: the data is illustrative ("Demo data – not verified"). */
  demoData: boolean;
  /** Months for the period switcher (all financial years), oldest first. */
  periods: PeriodOptionDto[];
  /** null only when no financial year exists yet. */
  period: {
    id: string;
    label: string;
    fyLabel: string;
    sfsDueDate: string;
    cfsDueDate: string;
    deadline: DeadlineDto;
  } | null;
  standalone: { finalised: number; total: number; counts: ItemCountsDto };
  consolidation: {
    finalised: number;
    total: number;
    counts: ItemCountsDto;
    next: { level: number; name: string } | null;
  };
  lastPeriod: { id: string; label: string; done: boolean; openItems: number } | null;
  /** Lines appear only if they apply to the user's permissions (overdue always). */
  attention: {
    /** SFS_PREPARE: entities Not started or In progress in the selected period, in scope. */
    entitiesToPrepare?: number;
    /** SFS_REVIEW: entities In review in the selected period, in scope. */
    awaitingReview?: number;
    editAccessRequests?: number;
    /** Entities waiting for this user's review or approval decision. */
    awaitingYourReview?: number;
    /** Review queries that need this user: open ones to answer, answered ones to close. */
    openQueries?: number;
    overdue: number;
  };
}

/** Placeholder task page (the task workspace is built on the next page). */
export interface TaskDetailDto extends TaskRowDto {
  readOnly: boolean;
  reviewerNote: string | null;
}

export const DEMO_DATA_BANNER =
  'Demo data – not verified. Figures are illustrative until the verified sample files are loaded.';
