import type { LearningPath } from '../data/learningPaths';

/** P1, P12 — not P0. Matches structured course ids (C1, C2, …). */
export const STRUCTURED_LEARNING_PATH_ID_RE = /^P[1-9]\d*$/;

const PN_INDEX_RE = /^P([1-9]\d*)$/;
/** Legacy admin ids before P-prefix; still reserve the same numeric sequence. */
const LEGACY_LP_INDEX_RE = /^lp([1-9]\d*)$/i;

export function isStructuredLearningPathId(pathId: string): boolean {
  return STRUCTURED_LEARNING_PATH_ID_RE.test(pathId);
}

function bumpPathIndex(pathId: string, used: Set<number>): void {
  let m = PN_INDEX_RE.exec(pathId);
  if (m) {
    used.add(parseInt(m[1], 10));
    return;
  }
  m = LEGACY_LP_INDEX_RE.exec(pathId);
  if (m) used.add(parseInt(m[1], 10));
}

/**
 * Smallest P{n} (n >= 1) not used by any learning path id matching P[1-9]… or legacy lp[1-9]…,
 * nor any extra reserved id string.
 */
export function firstAvailableStructuredLearningPathId(
  paths: LearningPath[],
  extraReservedIds: string[] = []
): string {
  const used = new Set<number>();
  for (const p of paths) bumpPathIndex(p.id, used);
  for (const id of extraReservedIds) bumpPathIndex(id, used);
  let n = 1;
  while (used.has(n)) n += 1;
  return `P${n}`;
}
