import type { IsoDate } from './dates';
import {
  type Cell,
  parseTrialBalance,
  sameOrganisation,
  type TbColumnSettings,
  type TbIssue,
  type TbLayout,
  type TbParseResult,
  tbPeriodMatches,
} from './tb-parser';

/**
 * Every check on an uploaded trial balance (page 3), on top of parsing:
 *   - debits must equal credits (hard stop → status ERROR);
 *   - the period and organisation in the file header must match (warnings to acknowledge);
 *   - the same file uploaded elsewhere (warning);
 *   - accounts not in the chart of accounts (info: mapped on the next step).
 */
export type TbStatus = 'ERROR' | 'VALIDATED_WITH_WARNINGS' | 'VALIDATED';

/** Warnings the uploader must acknowledge before the version is saved. */
export const ACKNOWLEDGE_CODES = ['PERIOD_MISMATCH', 'ORGANISATION_MISMATCH'] as const;

export interface TbCheckInput {
  rows: readonly (readonly Cell[])[];
  settings: TbColumnSettings;
  layout: Pick<TbLayout, 'period' | 'organisation'>;
  period: { startDate: IsoDate; endDate: IsoDate; label: string };
  legalName: string;
  /** Account codes in the entity's chart of accounts. */
  knownAccounts: ReadonlySet<string>;
  /** Where the identical file (same SHA-256) was uploaded before, e.g. "UK · Aug-2026". */
  sameFileElsewhere: readonly string[];
}

export interface TbCheckResult extends TbParseResult {
  newAccounts: { code: string; name: string }[];
  /** Warnings that must be acknowledged (subset of `warnings`). */
  needsAcknowledgement: TbIssue[];
  status: TbStatus;
}

const fmtDate = (d: IsoDate) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export function checkTrialBalance(input: TbCheckInput): TbCheckResult {
  const parsed = parseTrialBalance(input.rows, input.settings);
  const errors = [...parsed.errors];
  const warnings = [...parsed.warnings];
  const info = [...parsed.info];

  if (!parsed.balanced && parsed.lines.length > 0) {
    errors.push({
      code: 'UNBALANCED',
      message: `Debits (${parsed.totals.debits}) and credits (${parsed.totals.credits}) differ by ${parsed.totals.difference}. The trial balance must balance before you can continue.`,
    });
  }

  const needsAcknowledgement: TbIssue[] = [];
  const { period, organisation } = input.layout;
  if (period && !tbPeriodMatches(period, input.period)) {
    const inFile =
      'asOf' in period
        ? `as of ${fmtDate(period.asOf)}`
        : `${fmtDate(period.from)} to ${fmtDate(period.to)}`;
    needsAcknowledgement.push({
      code: 'PERIOD_MISMATCH',
      message: `The file is for ${inFile}, but the task period is ${input.period.label} (${fmtDate(input.period.startDate)} to ${fmtDate(input.period.endDate)}).`,
    });
  }
  if (organisation && !sameOrganisation(organisation, input.legalName)) {
    needsAcknowledgement.push({
      code: 'ORGANISATION_MISMATCH',
      message: `The file names the organisation "${organisation}", but this entity is "${input.legalName}".`,
    });
  }
  warnings.push(...needsAcknowledgement);
  if (input.sameFileElsewhere.length > 0) {
    warnings.push({
      code: 'DUPLICATE_FILE',
      message: `This exact file was already uploaded for ${input.sameFileElsewhere.join('; ')}.`,
    });
  }

  const newAccounts = parsed.lines
    .filter((l) => !input.knownAccounts.has(l.accountCode))
    .map((l) => ({ code: l.accountCode, name: l.accountName }));
  if (newAccounts.length > 0) {
    info.push({
      code: 'NEW_ACCOUNTS',
      message: `${newAccounts.length} account${newAccounts.length === 1 ? ' is' : 's are'} not in the chart of accounts and will need mapping in the next step: ${newAccounts.map((a) => `${a.code} ${a.name}`).join(', ')}.`,
      accounts: newAccounts.map((a) => a.code),
    });
  }

  const status: TbStatus =
    errors.length > 0 ? 'ERROR' : warnings.length > 0 ? 'VALIDATED_WITH_WARNINGS' : 'VALIDATED';
  return { ...parsed, errors, warnings, info, newAccounts, needsAcknowledgement, status };
}
