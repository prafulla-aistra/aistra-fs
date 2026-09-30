/**
 * Page 3 seed: FSLI master, account-type defaults, each entity's chart of accounts and the
 * exchange rates Apr-26 to Aug-26.
 *
 * Create-only: rows that already exist are never changed, so edits made in the app survive
 * the seed that `npm run dev` runs every time.
 *
 * Charts of accounts come from each entity's Jul-26 sample TB, with the FSLI inferred from the
 * account name and type (engine inferMapping). The three accounts that first appear in the
 * Aug-26 TBs (IN 1455, IN 6120, UK 6390) are deliberately left out, so uploading the Aug TBs
 * shows them as new accounts to map.
 */
import {
  Prisma,
  type FsliClass,
  type FsliStatement,
  type PrismaClient,
  type RateBasis,
} from '@prisma/client';
import { ACCOUNT_TYPE_DEFAULTS, inferMapping } from '@finance-close/engine';
import { toDbDate } from '../src/common/db-dates';
import {
  AUG_ONLY_ACCOUNTS,
  SAMPLE_ENTITIES,
  SAMPLE_MATERIALITY,
  SAMPLE_RATES,
} from './sample-data';

type Flag = 'consolidationOnly' | 'needsCounterparty' | 'intercompany' | 'computed';
type FsliSeed = [
  code: string,
  name: string,
  statement: FsliStatement,
  cls: FsliClass,
  basis: RateBasis,
  flags?: Flag[],
];

export const FSLIS: FsliSeed[] = [
  // Balance sheet — assets (closing rate)
  ['PPE', 'Property, plant and equipment', 'BS', 'A', 'CLOSING'],
  ['CWIP', 'Capital work-in-progress', 'BS', 'A', 'CLOSING'],
  ['ROU', 'Right-of-use assets', 'BS', 'A', 'CLOSING'],
  ['INTANG', 'Other intangible assets', 'BS', 'A', 'CLOSING'],
  ['GOODWILL', 'Goodwill on consolidation', 'BS', 'A', 'CLOSING', ['consolidationOnly']],
  ['INV_SUB', 'Investment in subsidiaries', 'BS', 'A', 'CLOSING', ['needsCounterparty']],
  ['NC_FIN', 'Other non-current financial assets', 'BS', 'A', 'CLOSING'],
  ['DTA', 'Deferred tax assets (net)', 'BS', 'A', 'CLOSING'],
  ['NC_OTH', 'Other non-current assets', 'BS', 'A', 'CLOSING'],
  ['INVENTORY', 'Inventories', 'BS', 'A', 'CLOSING'],
  ['CUR_INV', 'Current investments', 'BS', 'A', 'CLOSING'],
  ['TRADE_REC', 'Trade receivables', 'BS', 'A', 'CLOSING'],
  [
    'IC_REC',
    'Intercompany receivables',
    'BS',
    'A',
    'CLOSING',
    ['needsCounterparty', 'intercompany'],
  ],
  ['CASH', 'Cash and cash equivalents', 'BS', 'A', 'CLOSING'],
  ['BANK_OTH', 'Other bank balances', 'BS', 'A', 'CLOSING'],
  ['CUR_FIN', 'Other current financial assets', 'BS', 'A', 'CLOSING'],
  ['TAX_ASSET', 'Current tax assets (net)', 'BS', 'A', 'CLOSING'],
  ['CUR_OTH', 'Other current assets', 'BS', 'A', 'CLOSING'],
  // Balance sheet — equity
  ['SHARE_CAP', 'Share capital', 'BS', 'E', 'HISTORICAL'],
  ['SEC_PREM', 'Securities premium / APIC', 'BS', 'E', 'HISTORICAL'],
  ['RETAINED', 'Retained earnings', 'BS', 'E', 'ROLL_FORWARD'],
  ['OTH_RES', 'Other reserves', 'BS', 'E', 'OPENING'],
  ['PROFIT', 'Profit for the period', 'BS', 'E', 'COMPUTED', ['computed']],
  ['FCTR', 'Foreign currency translation reserve', 'BS', 'E', 'COMPUTED', ['computed']],
  ['NCI', 'Non-controlling interests', 'BS', 'E', 'COMPUTED', ['consolidationOnly']],
  ['PL_NCI', 'Profit attributable to NCI', 'BS', 'E', 'COMPUTED', ['consolidationOnly']],
  // Balance sheet — liabilities (closing rate)
  ['LT_BORR', 'Borrowings – non-current', 'BS', 'L', 'CLOSING'],
  ['LEASE_NC', 'Lease liabilities – non-current', 'BS', 'L', 'CLOSING'],
  ['NC_PROV', 'Provisions – non-current', 'BS', 'L', 'CLOSING'],
  ['DTL', 'Deferred tax liabilities (net)', 'BS', 'L', 'CLOSING'],
  ['ST_BORR', 'Borrowings – current', 'BS', 'L', 'CLOSING'],
  ['LEASE_C', 'Lease liabilities – current', 'BS', 'L', 'CLOSING'],
  ['TRADE_PAY', 'Trade payables', 'BS', 'L', 'CLOSING'],
  ['IC_PAY', 'Intercompany payables', 'BS', 'L', 'CLOSING', ['needsCounterparty', 'intercompany']],
  ['CUR_FIN_LIAB', 'Other current financial liabilities', 'BS', 'L', 'CLOSING'],
  ['CUR_OTH_LIAB', 'Other current liabilities', 'BS', 'L', 'CLOSING'],
  ['CUR_PROV', 'Provisions – current', 'BS', 'L', 'CLOSING'],
  ['CUR_TAX_LIAB', 'Current tax liabilities (net)', 'BS', 'L', 'CLOSING'],
  [
    'IC_DIFF',
    'Intercompany difference – unreconciled',
    'BS',
    'L',
    'CLOSING',
    ['consolidationOnly'],
  ],
  // Profit and loss (average rate)
  ['REV_OPS', 'Revenue from operations', 'PL', 'I', 'AVERAGE'],
  ['IC_REV', 'Intercompany revenue', 'PL', 'I', 'AVERAGE', ['needsCounterparty', 'intercompany']],
  ['OTH_INC', 'Other income', 'PL', 'I', 'AVERAGE'],
  ['COST_SERV', 'Cost of services', 'PL', 'X', 'AVERAGE'],
  ['EMP', 'Employee benefits expense', 'PL', 'X', 'AVERAGE'],
  [
    'IC_EXP',
    'Intercompany service charges',
    'PL',
    'X',
    'AVERAGE',
    ['needsCounterparty', 'intercompany'],
  ],
  ['TRAVEL', 'Travelling and conveyance', 'PL', 'X', 'AVERAGE'],
  ['PROF', 'Legal and professional fees', 'PL', 'X', 'AVERAGE'],
  ['SOFTWARE', 'Software and subscriptions', 'PL', 'X', 'AVERAGE'],
  ['RENT', 'Rent and facilities', 'PL', 'X', 'AVERAGE'],
  ['OTH_EXP', 'Other expenses', 'PL', 'X', 'AVERAGE'],
  ['FIN_COST', 'Finance costs', 'PL', 'X', 'AVERAGE'],
  ['DEPR', 'Depreciation and amortisation', 'PL', 'X', 'AVERAGE'],
  ['TAX_CUR', 'Current tax', 'PL', 'X', 'AVERAGE'],
  ['TAX_DEF', 'Deferred tax', 'PL', 'X', 'AVERAGE'],
];

export const RATE_SEED_SOURCE = 'Seed: Exchange_Rates_per_USD_sample.xlsx';

export async function seedAccounts(prisma: PrismaClient): Promise<void> {
  const fslis = await prisma.fsli.createMany({
    data: FSLIS.map(([code, name, statement, cls, rateBasis, flags = []], i) => ({
      code,
      name,
      statement,
      class: cls,
      rateBasis,
      consolidationOnly: flags.includes('consolidationOnly'),
      needsCounterparty: flags.includes('needsCounterparty'),
      intercompany: flags.includes('intercompany'),
      computed: flags.includes('computed'),
      sortOrder: i + 1,
    })),
    skipDuplicates: true,
  });

  const defaults = await prisma.accountTypeDefault.createMany({
    data: Object.entries(ACCOUNT_TYPE_DEFAULTS).map(([accountType, fsliCode]) => ({
      erp: 'ZOHO' as const,
      accountType,
      fsliCode,
    })),
    skipDuplicates: true,
  });

  const entities = await prisma.entity.findMany({
    select: { code: true, shortName: true, legalName: true },
  });
  const known = new Set(entities.map((e) => e.code));
  let accounts = 0;
  let revisedAccounts = 0;
  for (const e of SAMPLE_ENTITIES) {
    if (!known.has(e.code)) continue;
    const skip = new Set(AUG_ONLY_ACCOUNTS[e.code] ?? []);
    const res = await prisma.entityAccount.createMany({
      data: e.accounts
        .filter((a) => !skip.has(a.code))
        .map((a) => {
          const m = inferMapping({ name: a.name, type: a.type }, entities, e.code);
          return {
            entityCode: e.code,
            accountCode: a.code,
            accountName: a.name,
            accountType: a.type,
            fsliCode: m.fsliCode,
            counterpartyCode: m.counterpartyCode,
            source: 'SEED' as const,
            suggested: true,
          };
        }),
      skipDuplicates: true,
    });
    accounts += res.count;

    // Seeded accounts nobody has changed (source SEED, never updated by a user) follow
    // revisions of the sample data.
    const untouched = await prisma.entityAccount.findMany({
      where: { entityCode: e.code, source: 'SEED', updatedById: null },
    });
    for (const row of untouched) {
      const a = e.accounts.find((x) => x.code === row.accountCode);
      if (!a || skip.has(a.code)) continue;
      const m = inferMapping({ name: a.name, type: a.type }, entities, e.code);
      const next = {
        accountName: a.name,
        accountType: a.type,
        fsliCode: m.fsliCode,
        counterpartyCode: m.counterpartyCode,
      };
      if (
        row.accountName === next.accountName &&
        row.accountType === next.accountType &&
        row.fsliCode === next.fsliCode &&
        row.counterpartyCode === next.counterpartyCode
      )
        continue;
      await prisma.$transaction([
        prisma.entityAccount.update({ where: { id: row.id }, data: next }),
        prisma.auditLog.create({
          data: {
            action: 'ACCOUNT_MAP',
            entityType: 'ENTITY_ACCOUNT',
            entityId: `${e.code}:${row.accountCode}`,
            oldValue: {
              accountName: row.accountName,
              accountType: row.accountType,
              fsli: row.fsliCode,
              counterparty: row.counterpartyCode,
            },
            newValue: { ...next, source: 'seed (sample data revised)' },
          },
        }),
      ]);
      revisedAccounts++;
    }
  }
  if (revisedAccounts > 0)
    console.log(`Seeded accounts revised to the current sample data: ${revisedAccounts}.`);

  // Ownership history: every entity starts with its current parent and % held, from Apr-2025.
  const noHistory = await prisma.entity.findMany({ where: { ownership: { none: {} } } });
  if (noHistory.length > 0) {
    await prisma.entityOwnership.createMany({
      data: noHistory.map((e) => ({
        entityCode: e.code,
        parentCode: e.parentCode,
        heldByParentPct: e.heldByParentPct,
        effectiveFrom: toDbDate('2025-04-01'),
        reason: 'Initial group structure',
      })),
    });
    console.log(`Ownership history started (Apr-2025) for ${noHistory.length} entities.`);
  }

  // Materiality for variance flags (page 5), where not set yet.
  for (const [code, amount] of Object.entries(SAMPLE_MATERIALITY)) {
    await prisma.entity.updateMany({
      where: { code, materiality: null },
      data: { materiality: amount },
    });
  }

  const currencies = new Set(
    (await prisma.currency.findMany({ select: { code: true } })).map((c) => c.code),
  );
  const rates = await prisma.exchangeRate.createMany({
    data: SAMPLE_RATES.filter((r) => currencies.has(r.currency)).map((r) => ({
      month: toDbDate(r.month),
      currencyCode: r.currency,
      opening: r.opening,
      closing: r.closing,
      average: r.average,
      source: RATE_SEED_SOURCE,
    })),
    skipDuplicates: true,
  });

  // Rates still exactly as seeded (source unchanged) follow revisions of the sample data.
  // Anything entered or uploaded by a person has another source and is never touched.
  const seeded = await prisma.exchangeRate.findMany({ where: { source: RATE_SEED_SOURCE } });
  let revised = 0;
  for (const row of seeded) {
    const s = SAMPLE_RATES.find(
      (r) => r.currency === row.currencyCode && toDbDate(r.month).getTime() === row.month.getTime(),
    );
    if (!s) continue;
    const differs = (['opening', 'closing', 'average'] as const).some(
      (f) => row[f]?.toString() !== new Prisma.Decimal(s[f]).toString(),
    );
    if (!differs) continue;
    await prisma.$transaction([
      prisma.exchangeRate.update({
        where: { month_currencyCode: { month: row.month, currencyCode: row.currencyCode } },
        data: { opening: s.opening, closing: s.closing, average: s.average },
      }),
      prisma.auditLog.create({
        data: {
          action: 'RATES_UPDATE',
          entityType: 'EXCHANGE_RATE',
          entityId: `${row.currencyCode}:${s.month}`,
          oldValue: {
            opening: row.opening?.toString() ?? null,
            closing: row.closing?.toString() ?? null,
            average: row.average?.toString() ?? null,
          },
          newValue: {
            opening: s.opening,
            closing: s.closing,
            average: s.average,
            source: 'seed (sample data revised)',
          },
        },
      }),
    ]);
    revised++;
  }
  if (revised > 0)
    console.log(`Seeded exchange rates revised to the current sample data: ${revised}.`);

  if (fslis.count + defaults.count + accounts + rates.count > 0) {
    await prisma.auditLog.create({
      data: {
        action: 'SEED_APPLIED',
        entityType: 'SEED',
        entityId: 'page3-accounts-rates',
        newValue: {
          fslis: fslis.count,
          accountTypeDefaults: defaults.count,
          accounts,
          rates: rates.count,
        },
      },
    });
    console.log(
      `Seeded ${fslis.count} FSLIs, ${defaults.count} account-type defaults, ${accounts} accounts, ${rates.count} monthly rates.`,
    );
  }
}
