/**
 * Page 9 seed: intercompany pairs and the acquisitions register. Runs once (marker: audit_log
 * SEED_APPLIED page9-consolidation); after that Configuration owns the data.
 *
 *  - Intercompany pairs: every pair of entities linked by an intercompany account in a chart of
 *    accounts, tolerance = the IC difference threshold setting (default 1.00), "to be confirmed".
 *  - Acquisitions register (ILLUSTRATIVE, "to be confirmed"): one 100%-step row per subsidiary
 *    whose parent holds an investment in it in the finalised demo snapshots — cost from the
 *    parent's investment account, share capital and premium from the subsidiary's accounts,
 *    pre-acquisition reserves 0, acquisition-date rates from the entity master's historical
 *    rates. Replace with the acquisition documents.
 */
import type { PrismaClient } from '@prisma/client';
import { deriveConsolidationLevels, Decimal, type GroupEntity } from '@finance-close/engine';

const MARKER = { action: 'SEED_APPLIED', entityType: 'SEED', entityId: 'page9-consolidation' };
const NOTE =
  'Illustrative: cost, share capital and premium from the demo trial balances; rates from the entity master historical rates. Confirm with the acquisition documents.';

interface SnapshotAccount {
  fsliCode: string | null;
  counterpartyCode: string | null;
  amount: string;
}

export async function seedConsolidation(prisma: PrismaClient): Promise<void> {
  if (await prisma.auditLog.findFirst({ where: MARKER })) return;

  // Intercompany pairs from the charts of accounts.
  const accounts = await prisma.entityAccount.findMany({
    where: { counterpartyCode: { not: null }, fsli: { intercompany: true } },
    select: { entityCode: true, counterpartyCode: true },
  });
  const setting = await prisma.appSetting.findUnique({ where: { key: 'IC_DIFF_THRESHOLD' } });
  const tolerance = setting?.value ? new Decimal(String(setting.value)).toFixed(4) : '1.0000';
  const pairs = new Set(accounts.map((a) => [a.entityCode, a.counterpartyCode!].sort().join('|')));
  const created = await prisma.intercompanyPair.createMany({
    data: [...pairs].map((k) => {
      const [entityA, entityB] = k.split('|') as [string, string];
      return {
        entityA,
        entityB,
        tolerance,
        toBeConfirmed: true,
        note: 'Seeded from the intercompany accounts in the charts of accounts; confirm.',
      };
    }),
    skipDuplicates: true,
  });

  // Acquisitions register from the finalised demo snapshots.
  const entities = await prisma.entity.findMany({
    include: { historicalRates: true, levelCurrency: true },
  });
  const group: GroupEntity[] = entities.map((e) => ({
    code: e.code,
    name: e.shortName,
    parentCode: e.parentCode,
    heldByParentPct: e.heldByParentPct?.toString() ?? null,
    reportingCurrency: e.levelCurrency?.currency ?? e.reportingCurrency,
    isActive: e.isActive,
  }));
  let levels: ReturnType<typeof deriveConsolidationLevels> = [];
  try {
    levels = deriveConsolidationLevels(group);
  } catch {
    levels = [];
  }
  const accountsOf = async (code: string): Promise<SnapshotAccount[] | null> => {
    const s = await prisma.statementSnapshot.findFirst({
      where: {
        entityCode: code,
        task: { type: 'SFS', entities: { some: { entityCode: code, status: 'FINALISED' } } },
      },
      orderBy: { task: { period: { startDate: 'asc' } } },
    });
    const figures = s?.figures as
      | {
          functionalCurrency: string;
          currencies: { currency: string; current: { accounts: SnapshotAccount[] } }[];
        }
      | undefined;
    return (
      figures?.currencies.find((c) => c.currency === figures.functionalCurrency)?.current
        .accounts ?? null
    );
  };
  const sum = (rows: SnapshotAccount[], fsli: string, cp: string | null = null) =>
    rows
      .filter((a) => a.fsliCode === fsli && (cp === null || a.counterpartyCode === cp))
      .reduce((t, a) => t.plus(a.amount), new Decimal('0'));
  let acquisitions = 0;
  for (const sub of entities.filter((e) => e.parentCode && e.isActive)) {
    if ((await prisma.acquisition.count({ where: { subsidiaryCode: sub.code } })) > 0) continue;
    const parent = entities.find((e) => e.code === sub.parentCode)!;
    const [pa, sa] = [await accountsOf(parent.code), await accountsOf(sub.code)];
    if (!pa || !sa) continue;
    const cost = sum(pa, 'INV_SUB', sub.code);
    if (cost.isZero()) continue;
    const currencies = new Set<string>([parent.functionalCurrency]);
    for (const l of levels)
      if (l.members.includes(sub.code) && l.members.includes(parent.code))
        currencies.add(l.currency);
    currencies.delete(sub.functionalCurrency);
    const rates = [...currencies]
      .map((c) => ({
        currency: c,
        rate: sub.historicalRates.find((h) => h.targetCurrency === c)?.rate,
      }))
      .filter(
        (r): r is { currency: string; rate: NonNullable<typeof r.rate> } => r.rate !== undefined,
      );
    await prisma.acquisition.create({
      data: {
        subsidiaryCode: sub.code,
        parentCode: parent.code,
        acquiredOn: sub.incorporatedOn ?? new Date('2024-04-01T00:00:00.000Z'),
        pctAcquired: sub.heldByParentPct?.toString() ?? '100',
        cost: cost.toFixed(4),
        shareCapital: sum(sa, 'SHARE_CAP').negated().toFixed(4),
        premium: sum(sa, 'SEC_PREM').negated().toFixed(4),
        preAcquisitionReserves: '0',
        toBeConfirmed: true,
        note: NOTE,
        rates: {
          create: rates.map((r) => ({ currency: r.currency, rate: r.rate, toBeConfirmed: true })),
        },
      },
    });
    acquisitions++;
  }

  await prisma.auditLog.create({
    data: { ...MARKER, newValue: { intercompanyPairs: created.count, acquisitions } },
  });
  console.log(
    `Consolidation seeded: ${created.count} intercompany pairs, ${acquisitions} acquisitions (illustrative, to be confirmed).`,
  );
}
