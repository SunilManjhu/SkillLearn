import type { Course } from '../data/courses';

/** C1, C12 — not C0. */
export const STRUCTURED_COURSE_ID_RE = /^C[1-9]\d*$/;

export function isStructuredCourseId(courseId: string): boolean {
  return STRUCTURED_COURSE_ID_RE.test(courseId);
}

/**
 * After reordering modules or lessons in a structured course, reassign C{n}M{m}L{l} ids by position.
 */
export function remapStructuredCourseModuleLessonIdsByOrder(course: Course): Course {
  if (!isStructuredCourseId(course.id)) return course;
  const cid = course.id;
  return {
    ...course,
    modules: course.modules.map((mod, mi) => {
      const newMid = `${cid}M${mi + 1}`;
      const lessons = mod.lessons.map((les, li) => ({
        ...les,
        id: `${newMid}L${li + 1}`,
      }));
      return { ...mod, id: newMid, lessons };
    }),
  };
}
