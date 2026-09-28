import { describe, expect, it } from 'vitest';
import {
  deriveConsolidationLevels,
  type GroupEntity,
  GroupStructureError,
  missingHistoricalRates,
  validateGroupStructure,
} from './group';

/** The Aistra group from CLAUDE.md, in master-data order. */
const AISTRA: GroupEntity[] = [
  { code: 'US', name: 'US', parentCode: null, heldByParentPct: null, reportingCurrency: 'USD' },
  {
    code: 'IN',
    name: 'India',
    parentCode: 'US',
    heldByParentPct: '58.49',
    reportingCurrency: 'INR',
  },
  { code: 'AE', name: 'UAE', parentCode: 'IN', heldByParentPct: '100', reportingCurrency: 'AED' },
  { code: 'UK', name: 'UK', parentCode: 'IN', heldByParentPct: '100', reportingCurrency: 'GBP' },
  {
    code: 'UC',
    name: 'Unconstrained',
    parentCode: 'IN',
    heldByParentPct: '100',
    reportingCurrency: 'USD',
  },
  {
    code: 'VS',
    name: 'Veracity Services',
    parentCode: 'UC',
    heldByParentPct: '100',
    reportingCurrency: 'SGD',
  },
  {
    code: 'VM',
    name: 'Veracity Sri Lanka',
    parentCode: 'VS',
    heldByParentPct: '100',
    reportingCurrency: 'LKR',
  },
];

const summary = (entities: GroupEntity[]) =>
  deriveConsolidationLevels(entities).map(
    (l) => `L${l.level} ${l.name} (${l.members.join(', ')}) ${l.currency}`,
  );

describe('deriveConsolidationLevels', () => {
  it('derives the 4 Aistra levels, deepest first', () => {
    expect(summary(AISTRA)).toEqual([
      'L1 Veracity Services (VS, VM) SGD',
      'L2 Unconstrained (UC, VS, VM) USD',
      'L3 India (IN, AE, UK, UC, VS, VM) INR',
      'L4 US (US, IN, AE, UK, UC, VS, VM) USD',
    ]);
  });

  it('does not depend on the order entities are supplied in (except for tie-breaks)', () => {
    const levels = deriveConsolidationLevels([...AISTRA].reverse());
    expect(levels.map((l) => l.parentCode)).toEqual(['VS', 'UC', 'IN', 'US']);
    expect(levels[3]!.members).toHaveLength(7);
  });

  it('follows the parent tree when it changes', () => {
    // VM moved directly under UC: Veracity Services no longer has a subsidiary.
    const moved = AISTRA.map((e) => (e.code === 'VM' ? { ...e, parentCode: 'UC' } : e));
    expect(summary(moved)).toEqual([
      'L1 Unconstrained (UC, VS, VM) USD',
      'L2 India (IN, AE, UK, UC, VS, VM) INR',
      'L3 US (US, IN, AE, UK, UC, VS, VM) USD',
    ]);

    // A new subsidiary under UK makes UK a level at the same depth as Unconstrained.
    const withUkSub: GroupEntity[] = [
      ...AISTRA,
      {
        code: 'IE',
        name: 'Ireland',
        parentCode: 'UK',
        heldByParentPct: '75',
        reportingCurrency: 'EUR',
      },
    ];
    expect(summary(withUkSub)).toEqual([
      'L1 Veracity Services (VS, VM) SGD',
      'L2 UK (UK, IE) GBP',
      'L3 Unconstrained (UC, VS, VM) USD',
      'L4 India (IN, AE, UK, IE, UC, VS, VM) INR',
      'L5 US (US, IN, AE, UK, IE, UC, VS, VM) USD',
    ]);
  });

  it('uses the reporting currency as the default level currency', () => {
    const changed = AISTRA.map((e) => (e.code === 'IN' ? { ...e, reportingCurrency: 'USD' } : e));
    expect(deriveConsolidationLevels(changed).find((l) => l.parentCode === 'IN')!.currency).toBe(
      'USD',
    );
  });

  it('ignores inactive entities', () => {
    const inactive = AISTRA.map((e) => (e.code === 'VM' ? { ...e, isActive: false } : e));
    expect(summary(inactive)[0]).toBe('L1 Unconstrained (UC, VS) USD');
  });

  it('returns no levels for a single entity', () => {
    expect(deriveConsolidationLevels([AISTRA[0]!])).toEqual([]);
  });

  it('refuses an invalid structure', () => {
    const cyclic = AISTRA.map((e) =>
      e.code === 'US' ? { ...e, parentCode: 'VM', heldByParentPct: '1' } : e,
    );
    expect(() => deriveConsolidationLevels(cyclic)).toThrow(GroupStructureError);
  });
});

describe('validateGroupStructure', () => {
  const codes = (entities: GroupEntity[]) => validateGroupStructure(entities).map((i) => i.code);

  it('accepts the Aistra group', () => {
    expect(validateGroupStructure(AISTRA)).toEqual([]);
  });

  it('requires exactly one ultimate parent', () => {
    expect(
      codes(
        AISTRA.map((e) =>
          e.code === 'IN' ? { ...e, parentCode: null, heldByParentPct: null } : e,
        ),
      ),
    ).toContain('MULTIPLE_ULTIMATE_PARENTS');
  });

  it('detects circular parent chains', () => {
    const cyclic = AISTRA.map((e) => (e.code === 'UC' ? { ...e, parentCode: 'VM' } : e));
    const issues = validateGroupStructure(cyclic);
    expect(issues.map((i) => i.code)).toContain('CIRCULAR_PARENT');
    expect(issues.find((i) => i.code === 'CIRCULAR_PARENT')!.message).toMatch(/UC|VS|VM/);
    // A loop reachable from several entities is reported once.
    expect(issues.filter((i) => i.code === 'CIRCULAR_PARENT')).toHaveLength(1);

    const self = AISTRA.map((e) => (e.code === 'AE' ? { ...e, parentCode: 'AE' } : e));
    expect(codes(self)).toContain('CIRCULAR_PARENT');
  });

  it('checks % held by parent: 0.01 to 100, required for subsidiaries, absent for the root', () => {
    const withPct = (pct: string | null) =>
      AISTRA.map((e) => (e.code === 'IN' ? { ...e, heldByParentPct: pct } : e));
    expect(codes(withPct('0.01'))).toEqual([]);
    expect(codes(withPct('100'))).toEqual([]);
    expect(codes(withPct('0.009'))).toEqual(['HELD_PCT_OUT_OF_RANGE']);
    expect(codes(withPct('100.0001'))).toEqual(['HELD_PCT_OUT_OF_RANGE']);
    expect(codes(withPct('abc'))).toEqual(['HELD_PCT_OUT_OF_RANGE']);
    expect(codes(withPct(null))).toEqual(['HELD_PCT_REQUIRED']);

    const rootPct = AISTRA.map((e) => (e.code === 'US' ? { ...e, heldByParentPct: '100' } : e));
    expect(codes(rootPct)).toEqual(['ROOT_HAS_HELD_PCT']);
  });

  it('flags unknown and inactive parents', () => {
    expect(codes(AISTRA.map((e) => (e.code === 'AE' ? { ...e, parentCode: 'XX' } : e)))).toEqual([
      'UNKNOWN_PARENT',
    ]);
    expect(codes(AISTRA.map((e) => (e.code === 'VS' ? { ...e, isActive: false } : e)))).toEqual([
      'INACTIVE_PARENT',
    ]);
  });
});

describe('missingHistoricalRates', () => {
  const levels = deriveConsolidationLevels(AISTRA);
  const functional: Record<string, string> = {
    US: 'USD',
    IN: 'INR',
    AE: 'AED',
    UK: 'GBP',
    UC: 'USD',
    VS: 'SGD',
    VM: 'LKR',
  };
  const rates: Record<string, string[]> = {
    US: [],
    IN: ['USD'],
    AE: ['INR', 'USD'],
    UK: ['INR', 'USD'],
    UC: ['INR'],
    VS: ['USD', 'INR'],
    VM: ['SGD', 'USD', 'INR'],
  };
  const entities = AISTRA.map((e) => ({
    code: e.code,
    functionalCurrency: functional[e.code]!,
    parentCode: e.parentCode,
    translatedCurrencies: rates[e.code]!,
    historicalRateCurrencies: rates[e.code]!,
  }));

  it('finds nothing missing for the seeded rates', () => {
    for (const e of entities) expect(missingHistoricalRates(e, entities, levels)).toEqual([]);
  });

  it('reports each missing currency with the reasons it is needed', () => {
    const vm = { ...entities.find((e) => e.code === 'VM')!, historicalRateCurrencies: ['SGD'] };
    expect(missingHistoricalRates(vm, entities, levels)).toEqual([
      { currency: 'INR', reasons: ['translated currency', 'L3 India level currency'] },
      {
        currency: 'USD',
        reasons: ['translated currency', 'L2 Unconstrained level currency', 'L4 US level currency'],
      },
    ]);
  });

  it('never asks for a rate into the functional currency itself', () => {
    const uc = {
      ...entities.find((e) => e.code === 'UC')!,
      translatedCurrencies: [],
      historicalRateCurrencies: [],
    };
    // UC is USD; L2 and L4 are USD. Only INR (parent IN, L3) is needed.
    expect(missingHistoricalRates(uc, entities, levels).map((m) => m.currency)).toEqual(['INR']);
  });
});
