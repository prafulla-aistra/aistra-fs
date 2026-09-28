import path from 'node:path';

/**
 * Repository root. This file sits two levels below apps/api in both src/ (tests, tsx) and
 * dist/ (compiled), so the relative hop is the same either way.
 */
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

/** Resolves a setting such as "./data/uploads" against the repo root (absolute paths unchanged). */
export function resolveFromRepoRoot(p: string): string {
  return path.resolve(REPO_ROOT, p);
}
