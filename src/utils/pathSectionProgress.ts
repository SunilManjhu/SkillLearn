import type { Course } from '../data/courses';
import type { MindmapTreeNode } from '../data/pathMindmap';
import { loadCompletionTimestamps } from './courseCompletionLog';
import { isCourseComplete, isLessonPlaybackComplete, loadLessonProgressMap } from './courseProgress';

/** All catalog `courseId`s referenced under a path section (course nodes and lesson nodes). */
export function collectCourseIdsInSubtree(root: MindmapTreeNode): Set<string> {
  const ids = new Set<string>();
  const walk = (n: MindmapTreeNode) => {
    if (n.kind === 'course' && n.courseId) ids.add(n.courseId);
    if (n.kind === 'lesson' && n.courseId) ids.add(n.courseId);
    for (const ch of n.children) walk(ch);
  };
  walk(root);
  return ids;
}

/** Unique courses under this section that exist in the published catalog (for labels like “4 courses”). */
export function countCatalogCoursesInSubtree(
  sectionRoot: MindmapTreeNode,
  catalogCourses: readonly { id: string }[]
): number {
  const ids = collectCourseIdsInSubtree(sectionRoot);
  const catalogSet = new Set(catalogCourses.map((c) => c.id));
  let n = 0;
  for (const id of ids) {
    if (catalogSet.has(id)) n++;
  }
  return n;
}

export type PathSectionProgress = {
  totalLessons: number;
  completedLessons: number;
  percent: number;
};

/**
 * Lesson-level progress for every catalog course linked under this section.
 * Matches overview semantics: completion timestamps and `isCourseComplete` count as fully done.
 */
export function computePathSectionProgress(
  sectionRoot: MindmapTreeNode,
  catalogCourses: readonly Course[],
  userId: string | null | undefined
): PathSectionProgress {
  const courseIds = collectCourseIdsInSubtree(sectionRoot);
  const completionTs = loadCompletionTimestamps(userId ?? null);
  let totalLessons = 0;
  let completedLessons = 0;
  const uid = userId ?? null;

  for (const id of courseIds) {
    const course = catalogCourses.find((c) => c.id === id);
    if (!course) continue;
    const m = loadLessonProgressMap(id, uid);
    const lessons = course.modules.flatMap((mod) => mod.lessons);
    const n = lessons.length;
    if (n === 0) continue;
    totalLessons += n;
    const fullyDone = isCourseComplete(course, m) || completionTs[id] != null;
    if (fullyDone) {
      completedLessons += n;
      continue;
    }
    for (const l of lessons) {
      if (isLessonPlaybackComplete(m[l.id])) completedLessons++;
    }
  }

  const percent =
    totalLessons > 0 ? Math.min(100, Math.round((completedLessons / totalLessons) * 100)) : 0;
  return { totalLessons, completedLessons, percent };
}
