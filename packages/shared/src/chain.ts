/** URS §4.3: a company needs at least this many default approvers (CFO not counted). */
export const MIN_DEFAULT_APPROVERS = 2;

export interface ChainEntry {
  employeeId: string;
  /** Step number. Entries sharing a step form a parallel group (decisions.md D1). */
  position: number;
}

export type ChainError =
  | { code: 'TOO_FEW_APPROVERS'; min: number }
  | { code: 'DUPLICATE_APPROVER'; employeeId: string }
  | { code: 'INVALID_POSITION'; employeeId: string };

/** Structural rules shared by the web form and the API (eligibility is checked server-side). */
export function validateChain(entries: readonly ChainEntry[]): ChainError[] {
  const errors: ChainError[] = [];
  if (entries.length < MIN_DEFAULT_APPROVERS) {
    errors.push({ code: 'TOO_FEW_APPROVERS', min: MIN_DEFAULT_APPROVERS });
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.employeeId)) {
      errors.push({ code: 'DUPLICATE_APPROVER', employeeId: entry.employeeId });
    }
    seen.add(entry.employeeId);
    if (!Number.isInteger(entry.position) || entry.position < 1) {
      errors.push({ code: 'INVALID_POSITION', employeeId: entry.employeeId });
    }
  }
  return errors;
}

/**
 * Renumbers steps densely from 1, keeping order and parallel groups:
 * positions [1, 1, 3, 7] become [1, 1, 2, 3]. Ties keep their input order.
 */
export function normalizePositions<T extends ChainEntry>(entries: readonly T[]): T[] {
  const sorted = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.position - b.entry.position || a.index - b.index);
  const result: T[] = [];
  let step = 0;
  let previous: number | undefined;
  for (const { entry } of sorted) {
    if (entry.position !== previous) {
      step += 1;
      previous = entry.position;
    }
    result.push({ ...entry, position: step });
  }
  return result;
}

/** Groups entries (already normalised) into steps, for display. */
export function groupBySteps<T extends ChainEntry>(entries: readonly T[]): T[][] {
  const steps = new Map<number, T[]>();
  for (const entry of entries) {
    const group = steps.get(entry.position) ?? [];
    group.push(entry);
    steps.set(entry.position, group);
  }
  return [...steps.entries()].sort(([a], [b]) => a - b).map(([, group]) => group);
}
