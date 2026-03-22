import type { Course, Lesson } from '../data/courses';

export function flattenLessons(course: Course): Lesson[] {
  const flat: Lesson[] = [];
  for (const mod of course.modules) {
    flat.push(...mod.lessons);
  }
  return flat;
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
