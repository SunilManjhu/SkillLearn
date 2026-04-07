export interface LearningPath {
  /** Document id: structured `P1`, `P2`, … (same pattern as course `C1`, `C2`). */
  id: string;
  title: string;
  description?: string;
  /** Display order; each id must exist in `publishedCourses`. */
  courseIds: string[];
  /**
   * Platform `learningPaths` visibility: when `false`, hidden from learner path pickers until published.
   * Omit or `undefined` = visible (legacy).
   */
  catalogPublished?: boolean;
}

/** True when the path appears in learner path chrome (`learningPaths` / merged rows with `fromCreatorDraft === false` only). */
export function isLearningPathCatalogPublished(path: LearningPath): boolean {
  return path.catalogPublished !== false;
}
