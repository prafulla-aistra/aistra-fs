/**
 * Step 2 seed: currencies, entity master, historical rates, financial years, due-date rules
 * and holidays.
 *
 * Currencies are added if missing (never overwritten). Everything else is seeded ONCE:
 * afterwards the Configuration screens own the data, and re-running the seed (which
 * `npm run dev` does every time) must not undo a user's edits. The one-off run is recorded
 * in the audit log, which is also how later runs know it has happened.
 */
import type { PrismaClient } from '@prisma/client';
import { toDbDate } from '../src/common/db-dates';
import { financialYearCreateData } from '../src/configuration/calendar/financial-year-data';

const SEED_MARKER = { action: 'SEED_APPLIED', entityType: 'SEED', entityId: 'step2-configuration' };

export const CURRENCIES = [
  { code: 'USD', name: 'US dollar', symbol: '$' },
  { code: 'INR', name: 'Indian rupee', symbol: '₹' },
  { code: 'AED', name: 'UAE dirham', symbol: 'AED' },
  { code: 'GBP', name: 'Pound sterling', symbol: '£' },
  { code: 'SGD', name: 'Singapore dollar', symbol: 'S$' },
  { code: 'LKR', name: 'Sri Lankan rupee', symbol: 'Rs' },
];

type Erp = 'ZOHO' | 'XERO' | 'OTHER';
type Gaap = 'IND_AS' | 'IFRS' | 'US_GAAP' | 'UK_GAAP' | 'OTHER';

/** Group structure from CLAUDE.md. Historical rates are illustrative and flagged "to be confirmed". */
const ENTITIES: {
  code: string;
  legalName: string;
  shortName: string;
  country: string;
  currency: string;
  parentCode: string | null;
  heldByParentPct: string | null;
  erp: Erp;
  gaap: Gaap;
  toBeConfirmedNote?: string;
  rates: Record<string, string>;
}[] = [
  {
    code: 'US',
    legalName: 'Aistra Labs Inc (US)',
    shortName: 'US',
    country: 'United States',
    currency: 'USD',
    parentCode: null,
    heldByParentPct: null,
    erp: 'ZOHO',
    gaap: 'US_GAAP',
    rates: {},
  },
  {
    code: 'IN',
    legalName: 'Aistra GenAI India Pvt Ltd',
    shortName: 'India',
    country: 'India',
    currency: 'INR',
    parentCode: 'US',
    heldByParentPct: '58.49',
    erp: 'ZOHO',
    gaap: 'IND_AS',
    rates: { USD: '0.0133333333' },
  },
  {
    code: 'AE',
    legalName: 'Aistra Labs AI Software LLC (UAE)',
    shortName: 'UAE',
    country: 'United Arab Emirates',
    currency: 'AED',
    parentCode: 'IN',
    heldByParentPct: '100',
    erp: 'ZOHO',
    gaap: 'IFRS',
    rates: { INR: '22.5', USD: '0.272294' },
  },
  {
    code: 'UK',
    legalName: 'Aistra Labs UK Ltd',
    shortName: 'UK',
    country: 'United Kingdom',
    currency: 'GBP',
    parentCode: 'IN',
    heldByParentPct: '100',
    erp: 'ZOHO',
    gaap: 'UK_GAAP',
    rates: { INR: '100', USD: '1.27' },
  },
  {
    code: 'UC',
    legalName: 'Unconstrained INC',
    shortName: 'Unconstrained',
    country: 'United States',
    currency: 'USD',
    parentCode: 'IN',
    heldByParentPct: '100',
    erp: 'ZOHO',
    gaap: 'US_GAAP',
    rates: { INR: '82' },
  },
  {
    code: 'VS',
    legalName: 'Veracity Services Pte (Singapore)',
    shortName: 'Veracity Services',
    country: 'Singapore',
    currency: 'SGD',
    parentCode: 'UC',
    heldByParentPct: '100',
    erp: 'XERO',
    gaap: 'IFRS',
    toBeConfirmedNote: 'Functional currency SGD to be confirmed (As-Is §3).',
    rates: { USD: '0.74', INR: '62' },
  },
  {
    code: 'VM',
    legalName: 'Veracity Managed Services (Sri Lanka)',
    shortName: 'Veracity Sri Lanka',
    country: 'Sri Lanka',
    currency: 'LKR',
    parentCode: 'VS',
    heldByParentPct: '100',
    erp: 'XERO',
    gaap: 'IFRS',
    toBeConfirmedNote: 'Functional currency LKR to be confirmed (As-Is §3).',
    rates: { SGD: '0.0044', USD: '0.00333', INR: '0.275' },
  },
];

/** Working days after period end (requirement). */
const DUE_DATE_RULES = [
  { statementType: 'SFS', periodType: 'MONTHLY', workingDays: 7 },
  { statementType: 'SFS', periodType: 'QUARTERLY', workingDays: 10 },
  { statementType: 'SFS', periodType: 'ANNUAL', workingDays: 30 },
  { statementType: 'CFS', periodType: 'MONTHLY', workingDays: 12 },
  { statementType: 'CFS', periodType: 'QUARTERLY', workingDays: 15 },
  { statementType: 'CFS', periodType: 'ANNUAL', workingDays: 45 },
] as const;

/** Fixed-date national holidays in India for the seeded years. Edit the list in Configuration. */
const HOLIDAYS = [
  ['2025-08-15', 'Independence Day'],
  ['2025-10-02', 'Gandhi Jayanti'],
  ['2025-12-25', 'Christmas Day'],
  ['2026-01-26', 'Republic Day'],
  ['2026-08-15', 'Independence Day'],
  ['2026-10-02', 'Gandhi Jayanti'],
  ['2026-12-25', 'Christmas Day'],
  ['2027-01-26', 'Republic Day'],
] as const;

const SEEDED_FINANCIAL_YEARS = [2025, 2026];

export async function seedConfiguration(prisma: PrismaClient): Promise<void> {
  for (const c of CURRENCIES) {
    await prisma.currency.upsert({ where: { code: c.code }, create: c, update: {} });
  }

  if (await prisma.auditLog.findFirst({ where: SEED_MARKER })) return;

  await prisma.$transaction(async (tx) => {
    for (const [i, e] of ENTITIES.entries()) {
      const data = {
        legalName: e.legalName,
        shortName: e.shortName,
        country: e.country,
        functionalCurrency: e.currency,
        reportingCurrency: e.currency,
        erp: e.erp,
        gaap: e.gaap,
        sortOrder: i + 1,
        toBeConfirmed: Boolean(e.toBeConfirmedNote),
        toBeConfirmedNote: e.toBeConfirmedNote ?? null,
      };
      // Parents first (list order), so the parent always exists when a child is written.
      await tx.entity.upsert({
        where: { code: e.code },
        create: {
          code: e.code,
          ...data,
          parentCode: e.parentCode,
          heldByParentPct: e.heldByParentPct,
        },
        update: { ...data, parentCode: e.parentCode, heldByParentPct: e.heldByParentPct },
      });
      const targets = Object.keys(e.rates);
      await tx.entityTranslatedCurrency.createMany({
        data: targets.map((currencyCode) => ({ entityCode: e.code, currencyCode })),
        skipDuplicates: true,
      });
      await tx.entityHistoricalRate.createMany({
        data: Object.entries(e.rates).map(([targetCurrency, rate]) => ({
          entityCode: e.code,
          targetCurrency,
          rate,
          toBeConfirmed: true,
          note: 'Illustrative seed value',
        })),
        skipDuplicates: true,
      });
    }

    await tx.dueDateRule.createMany({ data: [...DUE_DATE_RULES], skipDuplicates: true });
    await tx.holiday.createMany({
      data: HOLIDAYS.map(([date, description]) => ({ date: toDbDate(date), description })),
      skipDuplicates: true,
    });
    for (const startYear of SEEDED_FINANCIAL_YEARS) {
      if (!(await tx.financialYear.findUnique({ where: { startYear } }))) {
        await tx.financialYear.create({ data: financialYearCreateData(startYear, null) });
      }
    }

    await tx.auditLog.create({
      data: {
        ...SEED_MARKER,
        newValue: {
          currencies: CURRENCIES.map((c) => c.code),
          entities: ENTITIES.map((e) => e.code),
          financialYears: SEEDED_FINANCIAL_YEARS,
          dueDateRules: DUE_DATE_RULES.length,
          holidays: HOLIDAYS.length,
        },
      },
    });
  });
  console.log(
    'Configuration seeded (entities, historical rates, FY 2025-26 and 2026-27, due dates, holidays).',
  );
}
