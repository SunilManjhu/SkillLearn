export interface LearningPath {
  /** Document id: structured `P1`, `P2`, … (same pattern as course `C1`, `C2`). */
  id: string;
  title: string;
  description?: string;
  /** Display order; each id must exist in `publishedCourses`. */
  courseIds: string[];
}
