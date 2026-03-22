import { COURSES } from '../data/courses';
import { isCourseComplete, loadLessonProgressMap } from './courseProgress';
import { loadCompletionTimestamps } from './courseCompletionLog';

export function computeLearningStats(userId: string | null | undefined): {
  completedCourses: number;
  completedCourseIds: string[];
  skillPoints: number;
  certificates: number;
} {
  let completedCourses = 0;
  let completedCourseIds: string[] = [];
  let lessonsTouched = 0;
  const uid = userId ?? null;
  for (const course of COURSES) {
    const m = loadLessonProgressMap(course.id, uid);
    if (isCourseComplete(course, m)) {
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
  const completionTs = loadCompletionTimestamps(uid);
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
