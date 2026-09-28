/**
 * Enums shared by the API and the web app.
 *
 * Declared as `as const` objects plus a union type (rather than TS `enum`) so they are
 * plain values at runtime, tree-shake cleanly in the web bundle, and serialise as strings.
 *
 * Entity codes and currencies are deliberately NOT enums: the group structure is seed
 * data that is editable in configuration (see CLAUDE.md).
 */

/** Reporting period granularity. Financial year runs April–March (e.g. "FY 2024-25"). */
export const PeriodType = {
  Monthly: 'MONTHLY',
  Quarterly: 'QUARTERLY',
  Annual: 'ANNUAL',
} as const;
export type PeriodType = (typeof PeriodType)[keyof typeof PeriodType];

/** Source ledger system an entity's trial balance is extracted from. */
export const ErpSystem = {
  Zoho: 'ZOHO',
  Xero: 'XERO',
  Other: 'OTHER',
} as const;
export type ErpSystem = (typeof ErpSystem)[keyof typeof ErpSystem];

/** Accounting framework an entity reports under. */
export const Gaap = {
  UsGaap: 'US_GAAP',
  IndAs: 'IND_AS',
  Ifrs: 'IFRS',
  UkGaap: 'UK_GAAP',
  Other: 'OTHER',
} as const;
export type Gaap = (typeof Gaap)[keyof typeof Gaap];

export const ERP_LABELS: Record<ErpSystem, string> = { ZOHO: 'Zoho', XERO: 'Xero', OTHER: 'Other' };
export const GAAP_LABELS: Record<Gaap, string> = {
  IND_AS: 'Ind AS',
  IFRS: 'IFRS',
  US_GAAP: 'US GAAP',
  UK_GAAP: 'UK GAAP',
  OTHER: 'Other',
};

/** Statements a task produces: standalone (per entity) or consolidated (per level). */
export const StatementType = { Sfs: 'SFS', Cfs: 'CFS' } as const;
export type StatementType = (typeof StatementType)[keyof typeof StatementType];

export const PeriodStatus = { Open: 'OPEN', Closed: 'CLOSED' } as const;
export type PeriodStatus = (typeof PeriodStatus)[keyof typeof PeriodStatus];
