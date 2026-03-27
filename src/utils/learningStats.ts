import type { Course } from '../data/courses';
import { STATIC_CATALOG_FALLBACK } from '../data/courses';
import { isCourseComplete, loadLessonProgressMap } from './courseProgress';
import { loadCompletionTimestamps } from './courseCompletionLog';

export function computeLearningStats(
  userId: string | null | undefined,
  courses: Course[] = STATIC_CATALOG_FALLBACK
): {
  completedCourses: number;
  completedCourseIds: string[];
  skillPoints: number;
  certificates: number;
} {
  let completedCourses = 0;
  let completedCourseIds: string[] = [];
  let lessonsTouched = 0;
  const uid = userId ?? null;
  const completionTs = loadCompletionTimestamps(uid);
  for (const course of courses) {
    const m = loadLessonProgressMap(course.id, uid);
    const finishedByProgress = isCourseComplete(course, m);
    const finishedByCompletionRecord = !!uid && completionTs[course.id] != null;
    if (finishedByProgress || finishedByCompletionRecord) {
      completedCourses++;
      completedCourseIds.push(course.id);
    }
    for (const mod of course.modules) {
      for (const l of mod.lessons) {
        const p = m[l.id];
        if (p && p.currentTime > 0) lessonsTouched++;
      }
    }
  }
  completedCourseIds.sort((a, b) => {
    const tb = completionTs[b] ?? 0;
    const ta = completionTs[a] ?? 0;
    if (tb !== ta) return tb - ta;
    return a.localeCompare(b);
  });
  return {
    completedCourses,
    completedCourseIds,
    skillPoints: completedCourses * 250 + lessonsTouched * 15,
    certificates: completedCourses,
  };
}

/** Per-course status for catalog courses (completed vs in-progress vs not started). */
export function computeCourseEnrollmentCounts(
  userId: string | null | undefined,
  courses: Course[] = STATIC_CATALOG_FALLBACK
): { completed: number; inProgress: number; notStarted: number } {
  let completed = 0;
  let inProgress = 0;
  let notStarted = 0;
  const uid = userId ?? null;
  const completionTs = loadCompletionTimestamps(uid);

  for (const course of courses) {
    const m = loadLessonProgressMap(course.id, uid);
    const finishedByProgress = isCourseComplete(course, m);
    const finishedByCompletionRecord = !!uid && completionTs[course.id] != null;
    if (finishedByProgress || finishedByCompletionRecord) {
      completed++;
      continue;
    }
    let hasAnyProgress = false;
    for (const mod of course.modules) {
      for (const l of mod.lessons) {
        const p = m[l.id];
        if (p && p.currentTime > 0) {
          hasAnyProgress = true;
          break;
        }
      }
      if (hasAnyProgress) break;
    }
    if (hasAnyProgress) inProgress++;
    else notStarted++;
  }

  return { completed, inProgress, notStarted };
}
