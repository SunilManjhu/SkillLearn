import type { Course } from '../data/courses';
import type { LearningPath } from '../data/learningPaths';

/** Published path row, creator draft, or admin-injected preview of another creator’s path. */
export type CatalogLearningPathRow = LearningPath & {
  fromCreatorDraft: boolean;
  /** When set, admin is previewing this path from `creatorLearningPaths` for another owner. */
  adminPreviewOwnerUid?: string;
};

/** One Browse Catalog row: published snapshot or creator draft (same `course.id` may appear twice). */
export type CatalogCourseRow = {
  course: Course;
  fromCreatorDraft: boolean;
  /**
   * When set, this draft row was injected for **admin preview** of another creator’s `creatorCourses` doc
   * (not the signed-in user’s own draft). Disambiguates selection when multiple draft rows share `course.id`.
   */
  adminPreviewOwnerUid?: string;
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
 * Resolve catalog row for history / deep links. When the payload carries
 * `adminPreviewCourseOwnerUid`, match that admin preview row instead of preferring published.
 */
export function pickCourseRowForHistoryPayload(
  rows: readonly CatalogCourseRow[],
  courseId: string,
  adminPreviewCourseOwnerUid?: string | null
): CatalogCourseRow | undefined {
  const uid = adminPreviewCourseOwnerUid?.trim();
  if (uid) {
    const exact = rows.find(
      (r) => r.course.id === courseId && r.adminPreviewOwnerUid === uid
    );
    if (exact) return exact;
  }
  return pickPublishedFirstCourseRow(rows, courseId);
}

/**
 * Signed-in **creator/admin** catalog paths: **all** published, then **all** creator drafts (no id deduping).
 * Same `id` can appear twice so learners/creators can open the published path and their draft separately.
 */
export function mergeOwnerPreviewPathRows(
  published: LearningPath[],
  drafts: LearningPath[]
): CatalogLearningPathRow[] {
  const pubRows: CatalogLearningPathRow[] = published.map((path) => ({
    ...path,
    fromCreatorDraft: false,
  }));
  const draftRows: CatalogLearningPathRow[] = drafts.map((path) => ({
    ...path,
    fromCreatorDraft: true,
  }));
  return [...pubRows, ...draftRows].sort((a, b) => a.title.localeCompare(b.title));
}

export function pickPublishedFirstLearningPathRow(
  rows: readonly CatalogLearningPathRow[],
  pathId: string
): CatalogLearningPathRow | undefined {
  return (
    rows.find((r) => r.id === pathId && !r.fromCreatorDraft) ??
    rows.find((r) => r.id === pathId)
  );
}

export function pickLearningPathRowForSelection(
  rows: readonly CatalogLearningPathRow[],
  pathId: string,
  fromCreatorDraft: boolean,
  adminPreviewOwnerUid?: string | null
): CatalogLearningPathRow | undefined {
  const pv = adminPreviewOwnerUid?.trim();
  if (pv) {
    const adminRow = rows.find((r) => r.id === pathId && r.adminPreviewOwnerUid === pv);
    if (adminRow) return adminRow;
  }
  const exact = rows.find((r) => r.id === pathId && r.fromCreatorDraft === fromCreatorDraft);
  if (exact) return exact;
  return pickPublishedFirstLearningPathRow(rows, pathId);
}

export function learningPathStripDraftFlag(row: CatalogLearningPathRow): LearningPath {
  const { fromCreatorDraft: _f, adminPreviewOwnerUid: _a, ...path } = row;
  return path;
}
