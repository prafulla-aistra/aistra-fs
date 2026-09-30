import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  type MonthlyRate,
  priorMonth,
  type RateBasisCode,
  type TranslateTbResult,
  type TranslationLineInput,
  translateTB,
} from '@finance-close/engine';
import { fromDbDate, toDbDate } from '../common/db-dates';

type Db = Prisma.TransactionClient;

/**
 * Loads what translateTB needs from the database. Shared by the translation step and the
 * demo seed (which stores the Jul-2026 snapshots), so both translate the same way.
 */

/** Mapped lines of the task entity's latest validated TB (null when there is none). */
export async function mappedLines(
  db: Db,
  taskId: string,
  entityCode: string,
): Promise<TranslationLineInput[] | null> {
  const version = await db.tbVersion.findFirst({
    where: { taskId, entityCode, purpose: 'CURRENT' },
    orderBy: { version: 'desc' },
    include: { lines: { orderBy: { accountCode: 'asc' } } },
  });
  if (!version || version.status === 'ERROR') return null;
  const [coa, fslis] = await Promise.all([
    db.entityAccount.findMany({ where: { entityCode } }),
    db.fsli.findMany(),
  ]);
  const acct = new Map(coa.map((a) => [a.accountCode, a]));
  const fsli = new Map(fslis.map((f) => [f.code, f]));
  return version.lines.map((l) => {
    const a = acct.get(l.accountCode);
    const f = a?.fsliCode ? fsli.get(a.fsliCode) : undefined;
    return {
      code: l.accountCode,
      name: l.accountName,
      fsliCode: f?.code ?? null,
      fsliClass: f?.class ?? null,
      statement: f?.statement ?? null,
      fsliRateBasis: (f?.rateBasis ?? null) as RateBasisCode | null,
      rateBasisOverride: (a?.rateBasisOverride ?? null) as RateBasisCode | null,
      counterpartyCode: a?.counterpartyCode ?? null,
      amount: l.amount.toFixed(2),
    };
  });
}

/** Monthly rates of the currencies over the period (plus the month before, for context). */
export async function monthlyRates(
  db: Db,
  currencies: string[],
  period: { startDate: string; endDate: string },
): Promise<MonthlyRate[]> {
  const rows = await db.exchangeRate.findMany({
    where: {
      currencyCode: { in: currencies.filter((c) => c !== 'USD') },
      month: { gte: toDbDate(priorMonth(period.startDate)), lte: toDbDate(period.endDate) },
    },
    orderBy: [{ currencyCode: 'asc' }, { month: 'asc' }],
  });
  return rows.map((r) => ({
    month: fromDbDate(r.month),
    currency: r.currencyCode,
    opening: r.opening?.toString() ?? null,
    closing: r.closing?.toString() ?? null,
    average: r.average?.toString() ?? null,
  }));
}

/** Changes whenever any of the rates change. */
export function ratesStamp(rates: MonthlyRate[], historical: string[]): string {
  return createHash('sha1')
    .update(JSON.stringify([rates, historical]))
    .digest('hex')
    .slice(0, 16);
}

/** The finalised translation snapshot of an entity for a period and currency, if any. */
export async function finalisedSnapshot(
  db: Db,
  entityCode: string,
  target: string,
  periodId: string | null,
) {
  if (!periodId) return null;
  return db.translationSnapshot.findFirst({
    where: {
      entityCode,
      targetCurrency: target,
      periodId,
      task: { type: 'SFS', entities: { some: { entityCode, status: 'FINALISED' } } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export function translateLines(input: {
  lines: TranslationLineInput[];
  functionalCurrency: string;
  target: string;
  period: { startDate: string; endDate: string; label: string };
  rates: MonthlyRate[];
  historicalRate: string | null;
  prior: { periodLabel: string; retained: string; profit: string } | null;
  priorPeriodLabel: string;
  rollForwardPassed: boolean;
}): TranslateTbResult {
  return translateTB({
    functionalCurrency: input.functionalCurrency,
    targetCurrency: input.target,
    period: input.period,
    rates: input.rates,
    historicalRate: input.historicalRate,
    lines: input.lines,
    prior: input.prior,
    priorPeriodLabel: input.priorPeriodLabel,
    rollForwardPassed: input.rollForwardPassed,
  });
}
