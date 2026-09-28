/**
 * Old/new values restricted to the fields that actually changed, for the audit log.
 * Returns undefined when nothing changed (so no audit row is written for a no-op save).
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
): { oldValue: Partial<T>; newValue: Partial<T> } | undefined {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])] as (keyof T)[];
  const changed = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (changed.length === 0) return undefined;
  const pick = (o: T) => Object.fromEntries(changed.map((k) => [k, o[k] ?? null])) as Partial<T>;
  return { oldValue: pick(before), newValue: pick(after) };
}
