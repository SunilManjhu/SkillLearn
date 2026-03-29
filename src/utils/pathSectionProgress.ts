import type { Course } from '../data/courses';
import type { MindmapTreeNode } from '../data/pathMindmap';
import { isCourseComplete, loadLessonProgressMap } from './courseProgress';

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

/** `kind: 'link'` nodes with a non-empty `externalUrl` under this subtree (for learner-facing outline). */
export function countExternalLinksInSubtree(root: MindmapTreeNode): number {
  let n = 0;
  const walk = (node: MindmapTreeNode) => {
    if (node.kind === 'link' && node.externalUrl?.trim()) n++;
    for (const ch of node.children) walk(ch);
  };
  walk(root);
  return n;
}

export type PathSectionProgress = {
  totalCourses: number;
  completedCourses: number;
  percent: number;
};

/**
 * Course-level progress for catalog courses linked under this section: each course is either
 * complete or not (no partial credit by lesson). Uses `isCourseComplete` on the lesson map only,
 * matching the path row progress bar and status icons (not completion timestamps alone).
 */
export function computePathSectionProgress(
  sectionRoot: MindmapTreeNode,
  catalogCourses: readonly Course[],
  userId: string | null | undefined
): PathSectionProgress {
  const courseIds = collectCourseIdsInSubtree(sectionRoot);
  let totalCourses = 0;
  let completedCourses = 0;
  const uid = userId ?? null;

  for (const id of courseIds) {
    const course = catalogCourses.find((c) => c.id === id);
    if (!course) continue;
    const lessons = course.modules.flatMap((mod) => mod.lessons);
    if (lessons.length === 0) continue;
    totalCourses++;
    const m = loadLessonProgressMap(id, uid);
    if (isCourseComplete(course, m)) completedCourses++;
  }

  const percent =
    totalCourses > 0
      ? Math.min(100, Math.round((completedCourses / totalCourses) * 100))
      : 0;
  return { totalCourses, completedCourses, percent };
}
