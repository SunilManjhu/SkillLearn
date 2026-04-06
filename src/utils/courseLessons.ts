import type { Course, Lesson } from '../data/courses';
import { isPlayableCatalogLesson } from './lessonContent';

export function flattenLessons(course: Course): Lesson[] {
  const flat: Lesson[] = [];
  for (const mod of course.modules) {
    flat.push(...mod.lessons);
  }
  return flat;
}

export function firstPlayableLesson(course: Course): Lesson | undefined {
  for (const mod of course.modules) {
    for (const l of mod.lessons) {
      if (isPlayableCatalogLesson(l)) return l;
    }
  }
  return undefined;
}

/** Next playable lesson in catalog order after `currentId`, or null. */
export function nextPlayableLessonAfter(course: Course, currentId: string): Lesson | null {
  const flat = flattenLessons(course);
  const i = flat.findIndex((l) => l.id === currentId);
  if (i < 0) return null;
  for (let j = i + 1; j < flat.length; j++) {
    const l = flat[j]!;
    if (isPlayableCatalogLesson(l)) return l;
  }
  return null;
}

export function getLastLessonInCourse(course: Course): Lesson | undefined {
  const flat = flattenLessons(course);
  return flat.length ? flat[flat.length - 1] : undefined;
}

export function getNextLesson(course: Course, current: Lesson): Lesson | null {
  const flat = flattenLessons(course);
  const i = flat.findIndex((l) => l.id === current.id);
  if (i < 0 || i >= flat.length - 1) return null;
  return flat[i + 1];
}

/** Stable key for effect deps when only lesson ids matter (not object identity). */
export function courseLessonIdsKey(course: Course): string {
  return course.modules.map((m) => m.lessons.map((l) => l.id).join('.')).join('/');
}
