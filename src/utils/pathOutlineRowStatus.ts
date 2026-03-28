import type { Course } from '../data/courses';
import type { MindmapTreeNode } from '../data/pathMindmap';
import { loadCompletionTimestamps } from './courseCompletionLog';
import {
  isCourseComplete,
  isLessonPlaybackComplete,
  isTrivialLessonProgress,
  loadLessonProgressMap,
} from './courseProgress';
import { collectCourseIdsInSubtree } from './pathSectionProgress';

export type PathOutlineRowStatus = 'completed' | 'in_progress' | 'not_started';

function courseRowStatus(course: Course, userId: string | null): PathOutlineRowStatus {
  const m = loadLessonProgressMap(course.id, userId);
  const ts = loadCompletionTimestamps(userId ?? null);
  if (isCourseComplete(course, m) || ts[course.id] != null) return 'completed';
  for (const mod of course.modules) {
    for (const l of mod.lessons) {
      const p = m[l.id];
      if (isLessonPlaybackComplete(p)) return 'in_progress';
      if (p && !isTrivialLessonProgress(p)) return 'in_progress';
    }
  }
  return 'not_started';
}

function lessonRowStatus(course: Course, lessonId: string, userId: string | null): PathOutlineRowStatus {
  const m = loadLessonProgressMap(course.id, userId);
  const p = m[lessonId];
  if (isLessonPlaybackComplete(p)) return 'completed';
  if (p && !isTrivialLessonProgress(p)) return 'in_progress';
  return 'not_started';
}

function aggregateSubtreeStatus(
  courseIds: Set<string>,
  catalogCourses: readonly Course[],
  userId: string | null
): PathOutlineRowStatus | null {
  const statuses: PathOutlineRowStatus[] = [];
  for (const id of courseIds) {
    const c = catalogCourses.find((x) => x.id === id);
    if (!c) continue;
    statuses.push(courseRowStatus(c, userId));
  }
  if (statuses.length === 0) return null;
  const allDone = statuses.every((s) => s === 'completed');
  const anyStarted = statuses.some((s) => s !== 'not_started');
  if (allDone) return 'completed';
  if (anyStarted) return 'in_progress';
  return 'not_started';
}

/**
 * Progress state for a single outline row (course node, lesson node, or label whose subtree links to catalog courses).
 */
export function getPathOutlineRowStatus(
  node: MindmapTreeNode,
  catalogCourses: readonly Course[],
  userId: string | null | undefined
): PathOutlineRowStatus | null {
  const uid = userId ?? null;
  if (node.kind === 'course' && node.courseId) {
    const c = catalogCourses.find((x) => x.id === node.courseId);
    if (!c) return null;
    return courseRowStatus(c, uid);
  }
  if (node.kind === 'lesson' && node.courseId && node.lessonId) {
    const c = catalogCourses.find((x) => x.id === node.courseId);
    if (!c) return null;
    return lessonRowStatus(c, node.lessonId, uid);
  }
  const ids = collectCourseIdsInSubtree(node);
  return aggregateSubtreeStatus(ids, catalogCourses, uid);
}
