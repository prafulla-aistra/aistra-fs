import type { PeriodType, PrismaClient, StatementType } from '@prisma/client';

type RuleReader = Pick<PrismaClient, 'approvalRule'>;
type RuleRow = {
  entityCode: string | null;
  periodType: PeriodType | null;
  reviewLevels: number;
  reviewerIds: string[];
  approverIds: string[];
};

/**
 * The approval rule for an entity (SFS) or a level's parent entity (CFS) and period type
 * (decision round 1, Q6). Most specific first: entity + period type → entity → default + period
 * type → default. No rule at all = one review level, any reviewer.
 */
export function pickApprovalRule<T extends RuleRow>(
  rules: readonly T[],
  entityCode: string,
  periodType: PeriodType,
) {
  const order: [string | null, PeriodType | null][] = [
    [entityCode, periodType],
    [entityCode, null],
    [null, periodType],
    [null, null],
  ];
  for (const [e, p] of order) {
    const r = rules.find((x) => x.entityCode === e && x.periodType === p);
    if (r) return r;
  }
  return null;
}

export async function approvalRuleFor(
  prisma: RuleReader,
  statementType: StatementType,
  entityCode: string,
  periodType: PeriodType,
) {
  const rules = await prisma.approvalRule.findMany({
    where: { statementType, OR: [{ entityCode }, { entityCode: null }] },
  });
  return (
    pickApprovalRule(rules, entityCode, periodType) ?? {
      reviewLevels: 1,
      reviewerIds: [] as string[],
      approverIds: [] as string[],
    }
  );
}
