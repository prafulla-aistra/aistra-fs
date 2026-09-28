import { Decimal, toDecimal } from './money';

/**
 * Group structure: the parent tree of entities, its validation, and the consolidation
 * levels derived from it (CLAUDE.md: levels are derived from the parent tree, never
 * hard-coded).
 */
export interface GroupEntity {
  code: string;
  /** Short name; used as the consolidation level's name. */
  name: string;
  parentCode: string | null;
  /** % of this entity held by its parent, as a decimal string ("58.49"); null for the root. */
  heldByParentPct: string | null;
  reportingCurrency: string;
  /** Inactive entities are ignored. Defaults to true. */
  isActive?: boolean;
}

export type GroupIssueCode =
  | 'NO_ULTIMATE_PARENT'
  | 'MULTIPLE_ULTIMATE_PARENTS'
  | 'UNKNOWN_PARENT'
  | 'INACTIVE_PARENT'
  | 'CIRCULAR_PARENT'
  | 'HELD_PCT_REQUIRED'
  | 'HELD_PCT_OUT_OF_RANGE'
  | 'ROOT_HAS_HELD_PCT';

export interface GroupIssue {
  code: GroupIssueCode;
  /** The entity the issue is about, when there is one. */
  entityCode?: string;
  message: string;
}

export const MIN_HELD_PCT = '0.01';
export const MAX_HELD_PCT = '100';

/** Entities that take part in the structure (active ones), in input order. */
function activeOnly(entities: readonly GroupEntity[]): GroupEntity[] {
  return entities.filter((e) => e.isActive !== false);
}

/**
 * Checks the rules of a valid group:
 *  - exactly one ultimate parent (an entity without a parent);
 *  - every parent exists and is active; no circular parent chains;
 *  - % held by parent between 0.01 and 100 for every subsidiary; none for the ultimate parent.
 * Returns every problem found (empty = valid).
 */
export function validateGroupStructure(entities: readonly GroupEntity[]): GroupIssue[] {
  const issues: GroupIssue[] = [];
  const active = activeOnly(entities);
  const all = new Map(entities.map((e) => [e.code, e]));
  const roots = active.filter((e) => e.parentCode === null);

  if (active.length > 0 && roots.length === 0) {
    issues.push({
      code: 'NO_ULTIMATE_PARENT',
      message: 'The group has no ultimate parent (an entity without a parent).',
    });
  }
  if (roots.length > 1) {
    issues.push({
      code: 'MULTIPLE_ULTIMATE_PARENTS',
      message: `There must be exactly one ultimate parent, but ${roots.map((r) => r.code).join(', ')} have no parent.`,
    });
  }

  const min = toDecimal(MIN_HELD_PCT);
  const max = toDecimal(MAX_HELD_PCT);

  for (const e of active) {
    if (e.parentCode === null) {
      if (e.heldByParentPct !== null) {
        issues.push({
          code: 'ROOT_HAS_HELD_PCT',
          entityCode: e.code,
          message: `${e.code} is the ultimate parent, so it cannot have a % held by parent.`,
        });
      }
      continue;
    }

    const parent = all.get(e.parentCode);
    if (!parent) {
      issues.push({
        code: 'UNKNOWN_PARENT',
        entityCode: e.code,
        message: `${e.code} has parent ${e.parentCode}, which does not exist.`,
      });
    } else if (parent.isActive === false) {
      issues.push({
        code: 'INACTIVE_PARENT',
        entityCode: e.code,
        message: `${e.code} has parent ${e.parentCode}, which is inactive.`,
      });
    }

    if (e.heldByParentPct === null || e.heldByParentPct.trim() === '') {
      issues.push({
        code: 'HELD_PCT_REQUIRED',
        entityCode: e.code,
        message: `${e.code} needs a % held by its parent.`,
      });
    } else {
      let pct: Decimal | null = null;
      try {
        pct = toDecimal(e.heldByParentPct);
      } catch {
        pct = null;
      }
      if (!pct || pct.lessThan(min) || pct.greaterThan(max)) {
        issues.push({
          code: 'HELD_PCT_OUT_OF_RANGE',
          entityCode: e.code,
          message: `${e.code}: % held by parent must be between ${MIN_HELD_PCT} and ${MAX_HELD_PCT} (got "${e.heldByParentPct}").`,
        });
      }
    }
  }

  // Circular chains: follow parents from every entity; revisiting one means a loop.
  const reported = new Set<string>();
  for (const start of active) {
    const seen: string[] = [];
    let current: GroupEntity | undefined = start;
    while (current && current.parentCode !== null) {
      if (seen.includes(current.code)) {
        const loop = seen.slice(seen.indexOf(current.code));
        const key = [...loop].sort().join('|');
        if (!reported.has(key)) {
          reported.add(key);
          issues.push({
            code: 'CIRCULAR_PARENT',
            entityCode: current.code,
            message: `Circular parent chain: ${[...loop, current.code].join(' → ')}.`,
          });
        }
        break;
      }
      seen.push(current.code);
      current = all.get(current.parentCode);
    }
  }

  return issues;
}

export class GroupStructureError extends Error {
  constructor(readonly issues: GroupIssue[]) {
    super(`Invalid group structure: ${issues.map((i) => i.message).join(' ')}`);
    this.name = 'GroupStructureError';
  }
}

export interface ConsolidationLevel {
  /** 1 = consolidated first (deepest). */
  level: number;
  /** Short name of the parent entity, e.g. "Veracity Services". */
  name: string;
  /** Entity at the top of this level. */
  parentCode: string;
  /** Distance of the parent from the ultimate parent (0 = ultimate parent). */
  depth: number;
  /** Default level currency: the parent's reporting currency. */
  currency: string;
  /** Parent first, then all descendants (depth-first, in input order). */
  members: string[];
}

/**
 * One consolidation level for every entity that has subsidiaries, ordered deepest first
 * (bottom-up, so each level only needs levels already run below it). Members are the
 * entity plus all its descendants. Ties at the same depth keep the input order.
 *
 * Throws GroupStructureError if the structure is invalid.
 */
export function deriveConsolidationLevels(entities: readonly GroupEntity[]): ConsolidationLevel[] {
  const issues = validateGroupStructure(entities);
  if (issues.length > 0) throw new GroupStructureError(issues);

  const active = activeOnly(entities);
  const children = new Map<string, GroupEntity[]>();
  for (const e of active) {
    if (e.parentCode !== null)
      children.set(e.parentCode, [...(children.get(e.parentCode) ?? []), e]);
  }

  const root = active.find((e) => e.parentCode === null);
  if (!root) return [];

  // Pre-order walk gives each entity its depth and a stable position.
  const order: { entity: GroupEntity; depth: number }[] = [];
  const walk = (e: GroupEntity, depth: number) => {
    order.push({ entity: e, depth });
    for (const c of children.get(e.code) ?? []) walk(c, depth + 1);
  };
  walk(root, 0);

  const descendants = (code: string): string[] =>
    (children.get(code) ?? []).flatMap((c) => [c.code, ...descendants(c.code)]);

  return order
    .map((o, position) => ({ ...o, position }))
    .filter((o) => (children.get(o.entity.code) ?? []).length > 0)
    .sort((a, b) => b.depth - a.depth || a.position - b.position)
    .map((o, i) => ({
      level: i + 1,
      name: o.entity.name,
      parentCode: o.entity.code,
      depth: o.depth,
      currency: o.entity.reportingCurrency,
      members: [o.entity.code, ...descendants(o.entity.code)],
    }));
}

export interface HistoricalRateEntity {
  code: string;
  functionalCurrency: string;
  parentCode: string | null;
  translatedCurrencies: readonly string[];
  /** Target currencies that have a historical rate. */
  historicalRateCurrencies: readonly string[];
}

export interface MissingHistoricalRate {
  currency: string;
  /** Why this currency needs a rate, e.g. "translated currency", "L3 India level currency". */
  reasons: string[];
}

/**
 * Historical rates (for share capital and premium) that an entity is missing. A rate is
 * needed for each translated currency, its parent's functional currency and the currency
 * of every consolidation level it belongs to — except its own functional currency.
 */
export function missingHistoricalRates(
  entity: HistoricalRateEntity,
  allEntities: readonly HistoricalRateEntity[],
  levels: readonly ConsolidationLevel[],
): MissingHistoricalRate[] {
  const needed = new Map<string, string[]>();
  const need = (currency: string, reason: string) => {
    if (currency === entity.functionalCurrency) return;
    needed.set(currency, [...(needed.get(currency) ?? []), reason]);
  };

  for (const c of entity.translatedCurrencies) need(c, 'translated currency');
  const parent = allEntities.find((e) => e.code === entity.parentCode);
  if (parent) need(parent.functionalCurrency, `parent ${parent.code}'s currency`);
  for (const l of levels) {
    if (l.members.includes(entity.code)) need(l.currency, `L${l.level} ${l.name} level currency`);
  }

  const have = new Set(entity.historicalRateCurrencies);
  return [...needed.entries()]
    .filter(([currency]) => !have.has(currency))
    .map(([currency, reasons]) => ({ currency, reasons }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
