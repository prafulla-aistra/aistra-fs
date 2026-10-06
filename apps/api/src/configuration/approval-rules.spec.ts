import { pickApprovalRule } from './approval-rules';

const r = (
  entityCode: string | null,
  periodType: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | null,
  reviewLevels: number,
) => ({
  entityCode,
  periodType,
  reviewLevels,
  reviewerIds: [],
  approverIds: [],
});

describe('pickApprovalRule (decisions round 1, Q6)', () => {
  const rules = [r(null, null, 1), r(null, 'QUARTERLY', 2), r('UK', null, 2), r('UK', 'ANNUAL', 1)];

  it('most specific first: entity + period type → entity → period type → default', () => {
    expect(pickApprovalRule(rules, 'UK', 'ANNUAL')?.reviewLevels).toBe(1);
    expect(pickApprovalRule(rules, 'UK', 'MONTHLY')?.reviewLevels).toBe(2);
    expect(pickApprovalRule(rules, 'IN', 'QUARTERLY')?.reviewLevels).toBe(2);
    expect(pickApprovalRule(rules, 'IN', 'MONTHLY')?.reviewLevels).toBe(1);
  });

  it('no rules → null (the caller uses one level)', () => {
    expect(pickApprovalRule([], 'IN', 'MONTHLY')).toBeNull();
  });
});
