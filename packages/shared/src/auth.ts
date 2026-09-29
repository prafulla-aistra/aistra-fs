/**
 * Authentication, users and permissions — shared by the API and the web app.
 *
 * Permissions are data (the `permission` table); these constants exist so code can refer
 * to them without typos. Adding a permission = add it here and to the seed.
 */
export const Permission = {
  UserAdmin: 'USER_ADMIN',
  ConfigManage: 'CONFIG_MANAGE',
  SfsPrepare: 'SFS_PREPARE',
  SfsReview: 'SFS_REVIEW',
  CfsPrepare: 'CFS_PREPARE',
  CfsReview: 'CFS_REVIEW',
  EditAccessApprove: 'EDIT_ACCESS_APPROVE',
  ReportsView: 'REPORTS_VIEW',
} as const;
export type PermissionCode = (typeof Permission)[keyof typeof Permission];

export const UserStatus = { Active: 'ACTIVE', Inactive: 'INACTIVE' } as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

// ---------------------------------------------------------------------------
// Password policy (checked by the API; shown as hints in the web app)
// ---------------------------------------------------------------------------

export const PASSWORD_MIN_LENGTH = 10;
/** bcrypt ignores bytes beyond 72, so longer passwords are rejected rather than truncated. */
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_RULES_TEXT =
  'At least 10 characters, including at least one letter and one number.';

/** Returns the list of broken rules (empty = acceptable). */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (!/\p{L}/u.test(password)) problems.push('must include a letter');
  if (!/\p{N}/u.test(password)) problems.push('must include a number');
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    problems.push(`must be at most ${PASSWORD_MAX_BYTES} bytes`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

/** The signed-in user as returned by POST /auth/login, POST /auth/refresh, GET /auth/me. */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  isMaster: boolean;
  mustChangePassword: boolean;
  /** Effective permissions (the master has all of them). */
  permissions: PermissionCode[];
  /** null = all entities. */
  entityScope: string[] | null;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SessionResponse {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: SessionUser;
}

/** A one-click account on the sign-in page (demo mode only). */
export interface DemoAccountDto {
  name: string;
  email: string;
  /** "Master admin", or the permission template name, e.g. "Preparer". */
  role: string;
  isMaster: boolean;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** Machine-readable error codes in error responses ({ statusCode, code, message }). */
export const ApiErrorCode = {
  InvalidCredentials: 'INVALID_CREDENTIALS',
  AccountLocked: 'ACCOUNT_LOCKED',
  AccountInactive: 'ACCOUNT_INACTIVE',
  NotAuthenticated: 'NOT_AUTHENTICATED',
  PasswordChangeRequired: 'PASSWORD_CHANGE_REQUIRED',
  PermissionDenied: 'PERMISSION_DENIED',
  ValidationFailed: 'VALIDATION_FAILED',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  NotAllowed: 'NOT_ALLOWED',
  InternalError: 'INTERNAL_ERROR',
  /** The task is Done (locked): nothing in it can change. */
  TaskLocked: 'TASK_LOCKED',
  /** The entity is finalised in this task: its data is read-only. */
  EntityFinalised: 'ENTITY_FINALISED',
  /** The month's exchange rates are locked (a report using the month is finalised). */
  RatesLocked: 'RATES_LOCKED',
  /** A warning must be acknowledged before the upload can be saved. */
  AcknowledgementRequired: 'ACKNOWLEDGEMENT_REQUIRED',
  /** The uploaded file is the wrong type, too large, or unreadable. */
  FileRejected: 'FILE_REJECTED',
  /** The API process is not reachable (not started yet, restarting, or stopped). */
  ApiUnavailable: 'API_UNAVAILABLE',
  /** The API is up but cannot reach its database. */
  DatabaseUnavailable: 'DATABASE_UNAVAILABLE',
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/** Shown whenever the browser cannot get an answer from the API. */
export const SERVER_UNREACHABLE_MESSAGE = "Can't reach the server. Check the app is running.";

/**
 * Header the development proxy adds to its own 503 answer when the API is down, so the web
 * app knows the request never reached the API and can safely retry it.
 */
export const PROXY_UNAVAILABLE_HEADER = 'x-finance-close-proxy';

export interface PermissionDto {
  code: PermissionCode;
  description: string;
  area: string;
}

export interface PermissionTemplateDto {
  code: string;
  name: string;
  description: string;
  permissions: PermissionCode[];
}

export interface EntityOptionDto {
  code: string;
  name: string;
}

export interface UserDto {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  isMaster: boolean;
  mustChangePassword: boolean;
  permissions: PermissionCode[];
  /** null = all entities. */
  entityScope: string[] | null;
  templateCode: string | null;
  /** Template name, suffixed " (adjusted)" when permissions no longer match it. */
  templateLabel: string | null;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

export interface CreateUserRequest {
  name: string;
  email: string;
  temporaryPassword: string;
  templateCode: string | null;
  permissions: PermissionCode[];
  /** null = all entities. */
  entityScope: string[] | null;
}

export interface UpdateUserRequest {
  name?: string;
  email?: string;
  templateCode?: string | null;
  permissions?: PermissionCode[];
  entityScope?: string[] | null;
}

export interface ResetPasswordRequest {
  temporaryPassword: string;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const AuditAction = {
  LoginSuccess: 'LOGIN_SUCCESS',
  LoginFailure: 'LOGIN_FAILURE',
  AccountLocked: 'ACCOUNT_LOCKED',
  Logout: 'LOGOUT',
  PasswordChange: 'PASSWORD_CHANGE',
  PasswordReset: 'PASSWORD_RESET',
  UserCreate: 'USER_CREATE',
  UserUpdate: 'USER_UPDATE',
  PermissionChange: 'PERMISSION_CHANGE',
  UserDeactivate: 'USER_DEACTIVATE',
  UserReactivate: 'USER_REACTIVATE',
  // Configuration (step 2)
  CurrencyCreate: 'CURRENCY_CREATE',
  CurrencyUpdate: 'CURRENCY_UPDATE',
  CurrencyDelete: 'CURRENCY_DELETE',
  EntityCreate: 'ENTITY_CREATE',
  EntityUpdate: 'ENTITY_UPDATE',
  FinancialYearCreate: 'FINANCIAL_YEAR_CREATE',
  PeriodClose: 'PERIOD_CLOSE',
  PeriodReopen: 'PERIOD_REOPEN',
  DueDateRuleUpdate: 'DUE_DATE_RULE_UPDATE',
  DueDateOverrideSet: 'DUE_DATE_OVERRIDE_SET',
  DueDateOverrideClear: 'DUE_DATE_OVERRIDE_CLEAR',
  TaskCreate: 'TASK_CREATE',
  HolidayCreate: 'HOLIDAY_CREATE',
  HolidayUpdate: 'HOLIDAY_UPDATE',
  HolidayDelete: 'HOLIDAY_DELETE',
  // Upload data (page 3)
  TbUpload: 'TB_UPLOAD',
  TbWarningAcknowledge: 'TB_WARNING_ACKNOWLEDGE',
  CoaUpload: 'COA_UPLOAD',
  DocumentUpload: 'DOCUMENT_UPLOAD',
  RatesUpload: 'RATES_UPLOAD',
  RatesUpdate: 'RATES_UPDATE',
  TaskStepContinue: 'TASK_STEP_CONTINUE',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditLogDto {
  id: string;
  timestamp: string;
  user: { id: string; name: string; email: string } | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  ip: string | null;
}

export interface AuditLogPage {
  items: AuditLogDto[];
  total: number;
  page: number;
  pageSize: number;
}
