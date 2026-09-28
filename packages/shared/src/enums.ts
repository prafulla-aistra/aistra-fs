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
} as const;
export type ErpSystem = (typeof ErpSystem)[keyof typeof ErpSystem];

/** Accounting framework an entity reports under. */
export const Gaap = {
  UsGaap: 'US_GAAP',
  IndAs: 'IND_AS',
  Ifrs: 'IFRS',
  UkGaap: 'UK_GAAP',
} as const;
export type Gaap = (typeof Gaap)[keyof typeof Gaap];
