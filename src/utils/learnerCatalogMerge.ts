import type { Course } from '../data/courses';
import type { LearningPath } from '../data/learningPaths';

/** One Browse Catalog row: published snapshot or creator draft (same `course.id` may appear twice). */
export type CatalogCourseRow = {
  course: Course;
  fromCreatorDraft: boolean;
};

/**
 * Creator/admin catalog courses: **all** published rows, then **all** creator drafts (no id deduping).
 * Order guarantees `courses.find(id)` / history resolution prefer the published copy when both exist.
 */
export function mergeOwnerPreviewCourseRows(published: Course[], drafts: Course[]): CatalogCourseRow[] {
  const pubRows = published.map((course) => ({ course, fromCreatorDraft: false as const }));
  const draftRows = drafts.map((course) => ({ course, fromCreatorDraft: true as const }));
  return [...pubRows, ...draftRows];
}

/** Prefer published row when the same `courseId` exists twice (URL / deep links have no draft bit). */
export function pickPublishedFirstCourseRow(
  rows: readonly CatalogCourseRow[],
  courseId: string
): CatalogCourseRow | undefined {
  return (
    rows.find((r) => r.course.id === courseId && !r.fromCreatorDraft) ??
    rows.find((r) => r.course.id === courseId)
  );
}

/**
 * Signed-in **creator/admin** learning paths: drafts overlay same id (unchanged; path id collisions are rare).
 */
export function mergeOwnerPreviewPaths(published: LearningPath[], drafts: LearningPath[]): LearningPath[] {
  const byId = new Map<string, LearningPath>();
  for (const p of published) byId.set(p.id, p);
  for (const p of drafts) byId.set(p.id, p);
  return Array.from(byId.values()).sort((a, b) => a.title.localeCompare(b.title));
}
