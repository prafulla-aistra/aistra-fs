import type { Prisma } from '@prisma/client';
import { RATE_SOURCE_LABEL } from '@finance-close/shared';

type Db = Pick<Prisma.TransactionClient, 'appSetting'>;

/** Global settings (table app_setting), edited on Configuration → Exchange rates. */
export const SETTING = {
  RateSource: 'RATE_SOURCE',
  IcDiffThreshold: 'IC_DIFF_THRESHOLD',
  /** Stored as a fraction ("0.20"); shown and entered as a percent. */
  VariancePct: 'VARIANCE_PCT_THRESHOLD',
} as const;

export const SETTING_DEFAULTS: Record<string, string> = {
  [SETTING.RateSource]: '',
  [SETTING.IcDiffThreshold]: '1.00',
  [SETTING.VariancePct]: '0.20',
};

export async function readSettings(db: Db): Promise<Record<string, string>> {
  const rows = await db.appSetting.findMany();
  return { ...SETTING_DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

/** The rate-source text shown on rate panels ("To be confirmed – Open question 2" until set). */
export async function rateSourceLabel(db: Db): Promise<string> {
  const v = (await db.appSetting.findUnique({ where: { key: SETTING.RateSource } }))?.value?.trim();
  return v ? v : RATE_SOURCE_LABEL;
}
