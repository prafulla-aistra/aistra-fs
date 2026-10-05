/**
 * Config C3: the control-check register and the default approval rules. Create-only: once a
 * check or rule exists, Configuration owns it. Every seeded check is "to be confirmed".
 */
import type { CheckSeverity, PrismaClient } from '@prisma/client';

interface CheckDef {
  code: string;
  name: string;
  description: string;
  severity: CheckSeverity;
  threshold?: string;
  thresholdUnit?: 'AMOUNT' | 'COUNT';
}

/** SFS checks (codes are what the engine evaluates; severities and thresholds come from here). */
export const SFS_CHECKS: CheckDef[] = [
  {
    code: 'TB_BALANCED',
    name: 'Trial balance nets to zero',
    description: 'Debits equal credits in the functional currency.',
    severity: 'BLOCKING',
    threshold: '0.00',
    thresholdUnit: 'AMOUNT',
  },
  {
    code: 'ALL_MAPPED',
    name: 'All accounts mapped',
    description: 'Every account in the trial balance has an FSLI.',
    severity: 'BLOCKING',
    threshold: '0',
    thresholdUnit: 'COUNT',
  },
  {
    code: 'IC_COUNTERPARTY',
    name: 'Intercompany accounts have a counterparty',
    description: 'Accounts on intercompany FSLIs name the counterparty entity.',
    severity: 'BLOCKING',
    threshold: '0',
    thresholdUnit: 'COUNT',
  },
  {
    code: 'TRANSLATION_COMPLETE',
    name: 'Translation complete',
    description: 'Every presentation currency translated (rates present, no failures).',
    severity: 'BLOCKING',
    threshold: '0',
    thresholdUnit: 'COUNT',
  },
  {
    code: 'TRANSLATED_TB_NETS',
    name: 'Translated trial balance nets to zero',
    description: 'After FCTR, the translated trial balance nets to zero in every currency.',
    severity: 'BLOCKING',
    threshold: '0.00',
    thresholdUnit: 'AMOUNT',
  },
  {
    code: 'BS_TIES',
    name: 'Balance sheet ties',
    description: 'Total equity and liabilities equals total assets, in every currency.',
    severity: 'BLOCKING',
    threshold: '0.00',
    thresholdUnit: 'AMOUNT',
  },
  {
    code: 'PROFIT_TIES',
    name: 'Profit ties to the balance sheet',
    description:
      'The P&L profit equals the profit carried to the balance sheet, in every currency.',
    severity: 'BLOCKING',
    threshold: '0.00',
    thresholdUnit: 'AMOUNT',
  },
  {
    code: 'RE_ROLL_FORWARD',
    name: 'Retained earnings roll forward',
    description: 'Opening retained earnings equal the prior period retained earnings plus profit.',
    severity: 'WARNING',
    threshold: '1.00',
    thresholdUnit: 'AMOUNT',
  },
  {
    code: 'NOTE_TOTALS_TIE',
    name: 'Note totals agree to the statements',
    description: 'Every line note totals to its statement line, in every currency.',
    severity: 'WARNING',
    threshold: '0.00',
    thresholdUnit: 'AMOUNT',
  },
  {
    code: 'VARIANCES_EXPLAINED',
    name: 'Flagged variances explained',
    description: 'Every flagged variance on the comparatives step has an explanation.',
    severity: 'WARNING',
    threshold: '0',
    thresholdUnit: 'COUNT',
  },
  {
    code: 'NOTES_REVIEWED',
    name: 'Notes reviewed',
    description: 'Every visible note is marked Reviewed by the preparer.',
    severity: 'WARNING',
    threshold: '0',
    thresholdUnit: 'COUNT',
  },
  {
    code: 'STALE_NUMBERS',
    name: 'No stale figures in note text',
    description: 'No typed number in the notes equals last period’s figure.',
    severity: 'WARNING',
    threshold: '0',
    thresholdUnit: 'COUNT',
  },
  {
    code: 'COMPARATIVE_PRESENT',
    name: 'Comparative available',
    description: 'A comparative trial balance is available for the period.',
    severity: 'INFO',
  },
  {
    code: 'HISTORICAL_RATES_CONFIRMED',
    name: 'Historical rates confirmed',
    description: 'Historical rates used are not marked "to be confirmed".',
    severity: 'INFO',
    threshold: '0',
    thresholdUnit: 'COUNT',
  },
];

/** CFS checks (page 10): evaluated per consolidation level by the engine runCfsChecks. */
export const CFS_CHECKS: CheckDef[] = [
  {
    code: 'CFS_MEMBERS_FINALISED',
    name: 'Every member’s SFS finalised',
    description: 'Each member entity has a finalised standalone snapshot for the period.',
    severity: 'BLOCKING',
  },
  {
    code: 'CFS_ELIMINATIONS_CURRENT',
    name: 'Eliminations up to date',
    description:
      'Generated from the members’ current snapshots and the current configuration (regenerate after a member changes).',
    severity: 'BLOCKING',
  },
  {
    code: 'CFS_GENERATION_COMPLETE',
    name: 'Every elimination generated',
    description:
      'No investment or adjustment could not be generated (missing register rows or rates).',
    severity: 'BLOCKING',
  },
  {
    code: 'CFS_ENTRIES_BALANCE',
    name: 'Every entry balances',
    description: 'Each elimination and adjustment nets to 0.00.',
    severity: 'BLOCKING',
  },
  {
    code: 'CFS_INVESTMENTS_ELIMINATED',
    name: 'Investments in subsidiaries eliminated',
    description: 'No investment in a member subsidiary remains.',
    severity: 'BLOCKING',
  },
  {
    code: 'CFS_IC_ELIMINATED',
    name: 'Intercompany fully eliminated',
    description:
      'No intercompany receivable, payable, revenue or charge between members remains (differences parked in IC suspense excluded).',
    severity: 'BLOCKING',
  },
  {
    code: 'CFS_BS_BALANCES',
    name: 'Consolidated balance sheet balances',
    description: 'Total assets equal total equity and liabilities.',
    severity: 'BLOCKING',
    threshold: '0.00',
    thresholdUnit: 'AMOUNT',
  },
  {
    code: 'CFS_PROFIT_TIES',
    name: 'Profit ties to the balance sheet',
    description: 'The P&L profit equals the profit carried to the balance sheet.',
    severity: 'BLOCKING',
    threshold: '0.00',
    thresholdUnit: 'AMOUNT',
  },
  {
    code: 'CFS_ATTRIBUTION_TIES',
    name: 'Owners + NCI = profit',
    description: 'Profit attributable to owners and NCI adds up to the profit for the period.',
    severity: 'BLOCKING',
    threshold: '0.00',
    thresholdUnit: 'AMOUNT',
  },
  {
    code: 'CFS_IC_DIFFERENCES_EXPLAINED',
    name: 'IC differences explained',
    description: 'Every intercompany difference parked in IC suspense has an explanation.',
    severity: 'WARNING',
    threshold: '0',
    thresholdUnit: 'COUNT',
  },
  {
    code: 'CFS_NOTES_REVIEWED',
    name: 'Notes reviewed',
    description: 'Every visible consolidation note is marked reviewed.',
    severity: 'WARNING',
    threshold: '0',
    thresholdUnit: 'COUNT',
  },
  {
    code: 'CFS_STALE_NUMBERS',
    name: 'No stale numbers in notes',
    description: 'No note text repeats last period’s figure.',
    severity: 'WARNING',
    threshold: '0',
    thresholdUnit: 'COUNT',
  },
  {
    code: 'CFS_ACQUISITIONS_CONFIRMED',
    name: 'Acquisitions register confirmed',
    description: 'No acquisitions register row used is flagged "to be confirmed".',
    severity: 'INFO',
    threshold: '0',
    thresholdUnit: 'COUNT',
  },
  {
    code: 'CFS_COMPARATIVE_PRESENT',
    name: 'Comparative available',
    description: 'A finalised or recomputed comparative exists.',
    severity: 'INFO',
  },
];

export async function seedControls(prisma: PrismaClient): Promise<void> {
  let created = 0;
  for (const [i, c] of [
    ...SFS_CHECKS.map((x) => ({ ...x, st: 'SFS' as const })),
    ...CFS_CHECKS.map((x) => ({ ...x, st: 'CFS' as const })),
  ].entries()) {
    if (await prisma.controlCheck.findUnique({ where: { code: c.code } })) continue;
    await prisma.controlCheck.create({
      data: {
        code: c.code,
        statementType: c.st,
        name: c.name,
        description: c.description,
        severity: c.severity,
        threshold: c.threshold ?? null,
        thresholdUnit: c.thresholdUnit ?? null,
        sortOrder: i + 1,
      },
    });
    created++;
  }
  for (const statementType of ['SFS', 'CFS'] as const) {
    const exists = await prisma.approvalRule.findFirst({
      where: { statementType, entityCode: null },
    });
    if (!exists) {
      await prisma.approvalRule.create({
        data: { statementType, entityCode: null, reviewLevels: 1 },
      });
      created++;
    }
  }
  if (created > 0) console.log(`Control checks and approval rules seeded: ${created}`);
}
