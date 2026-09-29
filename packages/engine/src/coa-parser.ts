import { type Cell, cellText, HEADER_SCAN_ROWS, type TbIssue } from './tb-parser';

/**
 * Chart-of-accounts files (Zoho export: Account Name, Account Code, Account Type, optional
 * Parent Account), and the merge rule for an entity's chart of accounts.
 */
export interface CoaAccount {
  code: string;
  name: string;
  type: string | null;
  parent: string | null;
  /** 1-based spreadsheet row. */
  row: number;
}

export interface CoaParseResult {
  accounts: CoaAccount[];
  errors: TbIssue[];
  warnings: TbIssue[];
}

const norm = (c: Cell) =>
  cellText(c)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function parseChartOfAccounts(rows: readonly (readonly Cell[])[]): CoaParseResult {
  const errors: TbIssue[] = [];
  const warnings: TbIssue[] = [];
  let header = -1;
  let cols = { code: -1, name: -1, type: -1, parent: -1 };
  for (let r = 0; r < Math.min(rows.length, HEADER_SCAN_ROWS); r++) {
    const h = (rows[r] ?? []).map(norm);
    const code = h.findIndex((x) => /^account (code|no|number)$/.test(x));
    const name = h.findIndex((x) => x === 'account name' || x === 'account');
    if (code >= 0 && name >= 0) {
      header = r;
      cols = {
        code,
        name,
        type: h.findIndex((x) => x === 'account type' || x === 'type'),
        parent: h.findIndex((x) => x === 'parent account' || x === 'parent'),
      };
      break;
    }
  }
  if (header < 0) {
    return {
      accounts: [],
      errors: [
        {
          code: 'COLUMN_MISSING',
          message: `No header row with "Account Name" and "Account Code" in the first ${HEADER_SCAN_ROWS} rows.`,
        },
      ],
      warnings,
    };
  }

  const byCode = new Map<string, CoaAccount>();
  const duplicates = new Set<string>();
  const missingCode: number[] = [];
  for (let r = header + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const code = cellText(row[cols.code]);
    const name = cellText(row[cols.name]);
    if (!code && !name) continue;
    if (!code) {
      missingCode.push(r + 1);
      continue;
    }
    if (byCode.has(code)) duplicates.add(code);
    byCode.set(code, {
      code,
      name: name || code,
      type: cols.type >= 0 ? cellText(row[cols.type]) || null : null,
      parent: cols.parent >= 0 ? cellText(row[cols.parent]) || null : null,
      row: r + 1,
    });
  }
  if (missingCode.length > 0) {
    warnings.push({
      code: 'NO_ACCOUNT_CODE',
      message: `${missingCode.length} row(s) have an account name but no account code and were skipped: row ${missingCode.join(', ')}.`,
      rows: missingCode,
    });
  }
  if (duplicates.size > 0) {
    warnings.push({
      code: 'DUPLICATE_CODES',
      message: `Account code(s) listed more than once; the last row was used: ${[...duplicates].join(', ')}.`,
      accounts: [...duplicates],
    });
  }
  if (byCode.size === 0) errors.push({ code: 'NO_LINES', message: 'The file has no accounts.' });
  return { accounts: [...byCode.values()], errors, warnings };
}

export interface ExistingAccount {
  code: string;
  name: string;
  type: string | null;
  parent: string | null;
}

export interface CoaMergePlan {
  /** New codes: created with the default FSLI for their type (suggested). */
  added: CoaAccount[];
  /** Existing codes whose name / type / parent changed. FSLI and counterparty are never touched. */
  updated: { account: CoaAccount; before: ExistingAccount }[];
  unchanged: CoaAccount[];
}

export function planCoaMerge(
  existing: readonly ExistingAccount[],
  incoming: readonly CoaAccount[],
): CoaMergePlan {
  const current = new Map(existing.map((a) => [a.code, a]));
  const plan: CoaMergePlan = { added: [], updated: [], unchanged: [] };
  for (const a of incoming) {
    const before = current.get(a.code);
    if (!before) plan.added.push(a);
    else if (
      before.name !== a.name ||
      (a.type !== null && before.type !== a.type) ||
      (a.parent !== null && before.parent !== a.parent)
    )
      plan.updated.push({ account: a, before });
    else plan.unchanged.push(a);
  }
  return plan;
}
