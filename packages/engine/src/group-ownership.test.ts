import { describe, expect, it } from 'vitest';
import {
  deriveConsolidationLevels,
  effectiveOwnership,
  type GroupEntity,
  nciPoints,
  ownershipAsAt,
} from './group';

const e = (
  code: string,
  parentCode: string | null,
  pct: string | null,
  currency = 'USD',
): GroupEntity => ({
  code,
  name: code,
  parentCode,
  heldByParentPct: pct,
  reportingCurrency: currency,
});
const GROUP = [
  e('US', null, null),
  e('IN', 'US', '58.49', 'INR'),
  e('AE', 'IN', '100'),
  e('UK', 'IN', '100'),
  e('UC', 'IN', '100'),
  e('VS', 'UC', '100', 'SGD'),
  e('VM', 'VS', '100'),
];

describe('effectiveOwnership', () => {
  it('multiplies % held up the chain: 58.49% × 100% × 100% = 58.49%', () => {
    expect(effectiveOwnership(GROUP)).toEqual({
      US: '100',
      IN: '58.49',
      AE: '58.49',
      UK: '58.49',
      UC: '58.49',
      VS: '58.49',
      VM: '58.49',
    });
  });
  it('a two-level partial holding: 80% × 60% = 48%', () => {
    expect(
      effectiveOwnership([e('P', null, null), e('A', 'P', '80'), e('B', 'A', '60')]),
    ).toMatchObject({ A: '80', B: '48' });
  });
  it('ignores inactive entities', () => {
    expect(
      effectiveOwnership([...GROUP, { ...e('OLD', 'US', '50'), isActive: false }]),
    ).not.toHaveProperty('OLD');
  });
});

describe('nciPoints', () => {
  it('L4 (US): NCI arises for the India group at 41.51%; L3 India has none', () => {
    const levels = deriveConsolidationLevels(GROUP);
    const l4 = levels.find((l) => l.parentCode === 'US')!;
    expect(nciPoints(l4, GROUP)).toEqual([
      { entityCode: 'IN', nciPct: '41.51', members: ['IN', 'AE', 'UK', 'UC', 'VS', 'VM'] },
    ]);
    expect(
      nciPoints(
        levels.find((l) => l.parentCode === 'IN')!,
        GROUP,
      ),
    ).toEqual([]);
  });
});

describe('ownershipAsAt', () => {
  const rows = [
    { entityCode: 'IN', parentCode: 'US', heldByParentPct: '58.49', effectiveFrom: '2025-04-01' },
    { entityCode: 'IN', parentCode: 'US', heldByParentPct: '75', effectiveFrom: '2026-09-01' },
    { entityCode: 'SG', parentCode: 'US', heldByParentPct: '100', effectiveFrom: '2026-10-01' },
  ];
  it('uses the latest row effective on or before the month', () => {
    expect(ownershipAsAt(rows, '2026-08-01').get('IN')!.heldByParentPct).toBe('58.49');
    expect(ownershipAsAt(rows, '2026-09-01').get('IN')!.heldByParentPct).toBe('75');
  });
  it('leaves out entities whose first row is later', () => {
    expect(ownershipAsAt(rows, '2026-09-01').has('SG')).toBe(false);
    expect(ownershipAsAt(rows, '2026-10-01').has('SG')).toBe(true);
  });
});
