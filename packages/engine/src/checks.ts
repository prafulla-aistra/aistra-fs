import { Decimal } from './money';

/**
 * SFS control checks (Review step). The register (configuration) decides which checks run,
 * their severity and threshold; this module only evaluates them. Per-currency checks give one
 * result per presentation currency.
 */
export type CheckSeverity = 'BLOCKING' | 'WARNING' | 'INFO';
export type CheckResultCode = 'PASS' | 'FAIL' | 'NA';

export interface RegisterEntry {
  code: string;
  name: string;
  severity: CheckSeverity;
  /** Tolerance (amount) or limit (count). */
  threshold: string | null;
  thresholdUnit: 'AMOUNT' | 'COUNT' | null;
  isActive: boolean;
}

/** Where to fix a failure: a workspace step, and optionally a line, account or note. */
export interface CheckLink {
  step: 'UPLOAD_DATA' | 'MAPPING' | 'COMPARATIVES' | 'TRANSLATION' | 'STATEMENTS' | 'NOTES';
  key?: string;
}

export interface CurrencyData {
  currency: string;
  translated: boolean;
  /** Translated currencies: OK, or FAIL with the reasons. */
  translationStatus: 'OK' | 'FAIL';
  translationFailures: string[];
  /** Translated TB total after FCTR (null when it could not translate). */
  translatedTotal: string | null;
  totalAssets: string | null;
  totalEquityLiabilities: string | null;
  profit: string | null;
  profitCarried: string | null;
  /** Line notes whose total does not agree to the face: note title → difference. */
  noteDifferences: { note: string; difference: string }[];
}

export interface EntityCheckData {
  tb: { debits: string; credits: string } | null;
  unmappedAccounts: string[];
  icWithoutCounterparty: string[];
  currencies: CurrencyData[];
  /** Retained-earnings roll-forward: the difference, or null when not applicable. */
  rollForwardDifference: string | null;
  unexplainedVariances: string[];
  notes: { visible: number; notReviewed: string[]; staleFlags: number };
  comparativePresent: boolean;
  historicalRatesToBeConfirmed: string[];
}

export interface CheckResult {
  code: string;
  name: string;
  severity: CheckSeverity;
  /** Presentation currency for per-currency checks. */
  currency: string | null;
  result: CheckResultCode;
  /** The figures behind the result. */
  details: string;
  link: CheckLink;
}

/** "8,576,724.39" (display only). */
export function amountText(v: string | Decimal): string {
  const d = new Decimal(v);
  const [int = '0', dec = '00'] = d.abs().toFixed(2).split('.');
  return `${d.isNegative() ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
}

const within = (difference: Decimal, e: RegisterEntry) => difference.abs().lte(e.threshold ?? '0');
const countOk = (n: number, e: RegisterEntry) => new Decimal(n).lte(e.threshold ?? '0');
const list = (xs: string[], max = 8) => (xs.length > max ? `${xs.slice(0, max).join(', ')} and ${xs.length - max} more` : xs.join(', '));

/** Every active check of the register with its result. */
export function runSfsChecks(data: EntityCheckData, register: readonly RegisterEntry[]): CheckResult[] {
  const out: CheckResult[] = [];
  const add = (e: RegisterEntry, r: Omit<CheckResult, 'code' | 'name' | 'severity'>) =>
    out.push({ code: e.code, name: e.name, severity: e.severity, ...r });
  const tolerance = (e: RegisterEntry) => (e.thresholdUnit === 'AMOUNT' ? ` · tolerance ${amountText(e.threshold ?? '0')}` : '');
  const limit = (e: RegisterEntry) => (e.thresholdUnit === 'COUNT' && new Decimal(e.threshold ?? '0').gt(0) ? ` · allowed ${e.threshold}` : '');

  for (const e of register.filter((x) => x.isActive)) {
    switch (e.code) {
      case 'TB_BALANCED': {
        if (!data.tb) {
          add(e, { currency: null, result: 'FAIL', details: 'No validated trial balance.', link: { step: 'UPLOAD_DATA' } });
          break;
        }
        const diff = new Decimal(data.tb.debits).minus(data.tb.credits);
        add(e, {
          currency: null,
          result: within(diff, e) ? 'PASS' : 'FAIL',
          details: `Debits ${amountText(data.tb.debits)} · Credits ${amountText(data.tb.credits)} · difference ${amountText(diff)}${tolerance(e)}`,
          link: { step: 'UPLOAD_DATA' },
        });
        break;
      }
      case 'ALL_MAPPED':
        add(e, {
          currency: null,
          result: countOk(data.unmappedAccounts.length, e) ? 'PASS' : 'FAIL',
          details: data.unmappedAccounts.length ? `${data.unmappedAccounts.length} not mapped: ${list(data.unmappedAccounts)}${limit(e)}` : 'Every account is mapped.',
          link: { step: 'MAPPING', key: data.unmappedAccounts[0] },
        });
        break;
      case 'IC_COUNTERPARTY':
        add(e, {
          currency: null,
          result: countOk(data.icWithoutCounterparty.length, e) ? 'PASS' : 'FAIL',
          details: data.icWithoutCounterparty.length ? `Without a counterparty: ${list(data.icWithoutCounterparty)}${limit(e)}` : 'Every intercompany account names its counterparty.',
          link: { step: 'MAPPING', key: data.icWithoutCounterparty[0] },
        });
        break;
      case 'TRANSLATION_COMPLETE': {
        const translated = data.currencies.filter((c) => c.translated);
        if (translated.length === 0) {
          add(e, { currency: null, result: 'NA', details: 'No translation: the entity presents in its functional currency only.', link: { step: 'TRANSLATION' } });
          break;
        }
        for (const c of translated)
          add(e, {
            currency: c.currency,
            result: c.translationStatus === 'OK' ? 'PASS' : 'FAIL',
            details: c.translationStatus === 'OK' ? `${c.currency}: translated.` : `${c.currency}: ${c.translationFailures.join(' ')}`,
            link: { step: 'TRANSLATION' },
          });
        break;
      }
      case 'TRANSLATED_TB_NETS': {
        const translated = data.currencies.filter((c) => c.translated);
        if (translated.length === 0) {
          add(e, { currency: null, result: 'NA', details: 'No translation.', link: { step: 'TRANSLATION' } });
          break;
        }
        for (const c of translated)
          add(e, {
            currency: c.currency,
            result: c.translatedTotal !== null && within(new Decimal(c.translatedTotal), e) ? 'PASS' : c.translatedTotal === null ? 'NA' : 'FAIL',
            details: c.translatedTotal === null ? `${c.currency}: not translated.` : `${c.currency}: translated TB total ${amountText(c.translatedTotal)}${tolerance(e)}`,
            link: { step: 'TRANSLATION' },
          });
        break;
      }
      case 'BS_TIES':
        for (const c of data.currencies) {
          if (c.totalAssets === null || c.totalEquityLiabilities === null) {
            add(e, { currency: c.currency, result: 'NA', details: `${c.currency}: no statements.`, link: { step: 'STATEMENTS' } });
            continue;
          }
          const diff = new Decimal(c.totalEquityLiabilities).minus(c.totalAssets);
          add(e, {
            currency: c.currency,
            result: within(diff, e) ? 'PASS' : 'FAIL',
            details: `Total assets ${amountText(c.totalAssets)} · Total equity and liabilities ${amountText(c.totalEquityLiabilities)} · difference ${amountText(diff)}${tolerance(e)}`,
            link: { step: 'STATEMENTS' },
          });
        }
        break;
      case 'PROFIT_TIES':
        for (const c of data.currencies) {
          if (c.profit === null || c.profitCarried === null) {
            add(e, { currency: c.currency, result: 'NA', details: `${c.currency}: no statements.`, link: { step: 'STATEMENTS' } });
            continue;
          }
          const diff = new Decimal(c.profit).minus(c.profitCarried);
          add(e, {
            currency: c.currency,
            result: within(diff, e) ? 'PASS' : 'FAIL',
            details: `Profit for the period ${amountText(c.profit)} · carried to the balance sheet ${amountText(c.profitCarried)} · difference ${amountText(diff)}${tolerance(e)}`,
            link: { step: 'STATEMENTS' },
          });
        }
        break;
      case 'RE_ROLL_FORWARD':
        add(e, {
          currency: null,
          result: data.rollForwardDifference === null ? 'NA' : within(new Decimal(data.rollForwardDifference), e) ? 'PASS' : 'FAIL',
          details: data.rollForwardDifference === null ? 'Not applicable (no previous period comparative).' : `Opening retained earnings less (prior RE + prior profit): ${amountText(data.rollForwardDifference)}${tolerance(e)}`,
          link: { step: 'COMPARATIVES' },
        });
        break;
      case 'NOTE_TOTALS_TIE':
        for (const c of data.currencies) {
          const bad = c.noteDifferences.filter((n) => !within(new Decimal(n.difference), e));
          add(e, {
            currency: c.currency,
            result: bad.length === 0 ? 'PASS' : 'FAIL',
            details: bad.length === 0 ? `${c.currency}: every note agrees to the face.` : `${c.currency}: ${bad.map((n) => `${n.note} (difference ${amountText(n.difference)})`).join('; ')}${tolerance(e)}`,
            link: { step: 'NOTES', key: bad[0]?.note },
          });
        }
        break;
      case 'VARIANCES_EXPLAINED':
        add(e, {
          currency: null,
          result: countOk(data.unexplainedVariances.length, e) ? 'PASS' : 'FAIL',
          details: data.unexplainedVariances.length ? `${data.unexplainedVariances.length} flagged variance(s) not explained: ${list(data.unexplainedVariances)}${limit(e)}` : 'Every flagged variance is explained.',
          link: { step: 'COMPARATIVES', key: data.unexplainedVariances[0] },
        });
        break;
      case 'NOTES_REVIEWED':
        add(e, {
          currency: null,
          result: countOk(data.notes.notReviewed.length, e) ? 'PASS' : 'FAIL',
          details: `${data.notes.visible - data.notes.notReviewed.length} of ${data.notes.visible} notes reviewed${data.notes.notReviewed.length ? `; not reviewed: ${list(data.notes.notReviewed, 5)}` : ''}${limit(e)}`,
          link: { step: 'NOTES', key: data.notes.notReviewed[0] },
        });
        break;
      case 'STALE_NUMBERS':
        add(e, {
          currency: null,
          result: countOk(data.notes.staleFlags, e) ? 'PASS' : 'FAIL',
          details: `${data.notes.staleFlags} possible stale figure(s) in note text${limit(e)}`,
          link: { step: 'NOTES' },
        });
        break;
      case 'COMPARATIVE_PRESENT':
        add(e, {
          currency: null,
          result: data.comparativePresent ? 'PASS' : 'FAIL',
          details: data.comparativePresent ? 'A comparative trial balance is available.' : 'No comparative: statements show "No comparative".',
          link: { step: 'COMPARATIVES' },
        });
        break;
      case 'HISTORICAL_RATES_CONFIRMED':
        add(e, {
          currency: null,
          result: countOk(data.historicalRatesToBeConfirmed.length, e) ? 'PASS' : 'FAIL',
          details: data.historicalRatesToBeConfirmed.length ? `To be confirmed: ${data.historicalRatesToBeConfirmed.join(', ')}` : 'Historical rates confirmed.',
          link: { step: 'TRANSLATION' },
        });
        break;
      default:
        add(e, { currency: null, result: 'NA', details: 'This check is not evaluated for standalone statements.', link: { step: 'STATEMENTS' } });
    }
  }
  return out;
}

/** Blocking failures and warnings that need an acknowledgement. */
export function checkSummary(results: readonly CheckResult[]) {
  const failing = results.filter((r) => r.result === 'FAIL');
  return {
    blocking: failing.filter((r) => r.severity === 'BLOCKING'),
    warnings: failing.filter((r) => r.severity === 'WARNING'),
    info: failing.filter((r) => r.severity === 'INFO'),
  };
}

/** Key of a check result (one per currency for per-currency checks). */
export const checkKey = (r: Pick<CheckResult, 'code' | 'currency'>) => (r.currency ? `${r.code}:${r.currency}` : r.code);

/**
 * Segregation of duties for a review decision. Whoever prepared (submitted) or last edited the
 * entity cannot review or approve it; at stage 2 the approver must differ from the reviewer who
 * approved at stage 1. Returns the reason the user may not decide, or null.
 */
export function segregationOfDuties(input: {
  userId: string;
  stage: 1 | 2;
  preparerIds: readonly string[];
  lastEditedById: string | null;
  stageOneReviewerId: string | null;
}): string | null {
  if (input.preparerIds.includes(input.userId))
    return 'You prepared this entity, so you cannot review or approve it (segregation of duties).';
  if (input.lastEditedById === input.userId)
    return 'You last edited this entity, so you cannot review or approve it (segregation of duties).';
  if (input.stage === 2 && input.stageOneReviewerId === input.userId)
    return 'You reviewed this entity at the first level; the approver must be a different person.';
  return null;
}
