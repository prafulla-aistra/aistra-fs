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

export async function seedControls(prisma: PrismaClient): Promise<void> {
  let created = 0;
  for (const [i, c] of SFS_CHECKS.entries()) {
    if (await prisma.controlCheck.findUnique({ where: { code: c.code } })) continue;
    await prisma.controlCheck.create({
      data: {
        code: c.code,
        statementType: 'SFS',
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
