import { describe, expect, it } from 'vitest';
import { checkSummary, type EntityCheckData, type RegisterEntry, runSfsChecks, segregationOfDuties } from './checks';

const reg = (code: string, severity: RegisterEntry['severity'], threshold: string | null = '0', unit: RegisterEntry['thresholdUnit'] = 'AMOUNT'): RegisterEntry => ({
  code,
  name: code,
  severity,
  threshold,
  thresholdUnit: unit,
  isActive: true,
});
const REGISTER = [
  reg('TB_BALANCED', 'BLOCKING'),
  reg('ALL_MAPPED', 'BLOCKING', '0', 'COUNT'),
  reg('BS_TIES', 'BLOCKING'),
  reg('PROFIT_TIES', 'BLOCKING'),
  reg('TRANSLATION_COMPLETE', 'BLOCKING', '0', 'COUNT'),
  reg('TRANSLATED_TB_NETS', 'BLOCKING'),
  reg('RE_ROLL_FORWARD', 'WARNING', '1.00'),
  reg('NOTES_REVIEWED', 'WARNING', '0', 'COUNT'),
  reg('COMPARATIVE_PRESENT', 'INFO', null, null),
];
const currency = (c: string, ta: string, tel: string, translated = false) => ({
  currency: c,
  translated,
  translationStatus: 'OK' as const,
  translationFailures: [],
  translatedTotal: translated ? '0.00' : null,
  totalAssets: ta,
  totalEquityLiabilities: tel,
  profit: '100.00',
  profitCarried: '100.00',
  noteDifferences: [],
});
const DATA: EntityCheckData = {
  tb: { debits: '8576724.39', credits: '8576724.39' },
  unmappedAccounts: [],
  icWithoutCounterparty: [],
  currencies: [currency('INR', '8576724.39', '8576724.39'), currency('USD', '98765.43', '98765.43', true)],
  rollForwardDifference: '0.40',
  unexplainedVariances: [],
  notes: { visible: 3, notReviewed: ['Cash'], staleFlags: 0 },
  comparativePresent: true,
  historicalRatesToBeConfirmed: [],
};

describe('runSfsChecks', () => {
  it('evaluates every active check, per currency where it applies, with the figures', () => {
    const r = runSfsChecks(DATA, REGISTER);
    const bs = r.filter((x) => x.code === 'BS_TIES');
    expect(bs.map((x) => [x.currency, x.result])).toEqual([
      ['INR', 'PASS'],
      ['USD', 'PASS'],
    ]);
    expect(bs[0]!.details).toBe('Total assets 8,576,724.39 · Total equity and liabilities 8,576,724.39 · difference 0.00 · tolerance 0.00');
    expect(r.find((x) => x.code === 'RE_ROLL_FORWARD')).toMatchObject({ result: 'PASS', severity: 'WARNING' });
    expect(r.find((x) => x.code === 'NOTES_REVIEWED')).toMatchObject({ result: 'FAIL', link: { step: 'NOTES', key: 'Cash' } });
    expect(r.find((x) => x.code === 'TRANSLATION_COMPLETE')).toMatchObject({ currency: 'USD', result: 'PASS' });
  });

  it('nothing is hard-coded: the register changes the result', () => {
    const broken = { ...DATA, currencies: [currency('INR', '100.00', '100.50')] };
    expect(checkSummary(runSfsChecks(broken, REGISTER)).blocking.map((x) => x.code)).toEqual(['BS_TIES']);
    // A tolerance of 1.00 makes it pass; as a warning it no longer blocks; inactive, it disappears.
    expect(runSfsChecks(broken, REGISTER.map((e) => (e.code === 'BS_TIES' ? { ...e, threshold: '1.00' } : e))).find((x) => x.code === 'BS_TIES')!.result).toBe('PASS');
    const asWarning = runSfsChecks(broken, REGISTER.map((e) => (e.code === 'BS_TIES' ? { ...e, severity: 'WARNING' as const } : e)));
    expect(checkSummary(asWarning).blocking).toEqual([]);
    expect(checkSummary(asWarning).warnings.map((x) => x.code)).toContain('BS_TIES');
    expect(runSfsChecks(broken, REGISTER.map((e) => (e.code === 'BS_TIES' ? { ...e, isActive: false } : e))).some((x) => x.code === 'BS_TIES')).toBe(false);
    // The roll-forward tolerance comes from the register too.
    expect(runSfsChecks(DATA, REGISTER.map((e) => (e.code === 'RE_ROLL_FORWARD' ? { ...e, threshold: '0.10' } : e))).find((x) => x.code === 'RE_ROLL_FORWARD')!.result).toBe('FAIL');
  });

  it('blocking failures: unmapped accounts and an unbalanced TB', () => {
    const r = runSfsChecks({ ...DATA, unmappedAccounts: ['1455', '6120'], tb: { debits: '10.00', credits: '9.00' } }, REGISTER);
    expect(checkSummary(r).blocking.map((x) => x.code)).toEqual(['TB_BALANCED', 'ALL_MAPPED']);
    expect(r.find((x) => x.code === 'ALL_MAPPED')!.details).toBe('2 not mapped: 1455, 6120');
  });
});

describe('segregationOfDuties', () => {
  const base = { stage: 1 as const, preparerIds: ['priya'], lastEditedById: 'priya', stageOneReviewerId: null };
  it('the preparer or last editor cannot approve; a different reviewer can', () => {
    expect(segregationOfDuties({ ...base, userId: 'priya' })).toContain('You prepared this entity');
    expect(segregationOfDuties({ ...base, userId: 'rahul', lastEditedById: 'rahul', preparerIds: ['priya'] })).toContain('You last edited this entity');
    expect(segregationOfDuties({ ...base, userId: 'rahul' })).toBeNull();
  });
  it('two levels need two different people', () => {
    expect(segregationOfDuties({ ...base, stage: 2, userId: 'rahul', stageOneReviewerId: 'rahul' })).toContain('must be a different person');
    expect(segregationOfDuties({ ...base, stage: 2, userId: 'anita', stageOneReviewerId: 'rahul' })).toBeNull();
  });
});
