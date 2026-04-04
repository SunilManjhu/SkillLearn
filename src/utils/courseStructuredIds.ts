import type { Course, Lesson, Module } from '../data/courses';

/** C1, C12 — not C0. */
export const STRUCTURED_COURSE_ID_RE = /^C[1-9]\d*$/;

const CN_INDEX_RE = /^C([1-9]\d*)$/;

function bumpCourseIndexFromDocId(courseDocId: string, used: Set<number>): void {
  const m = CN_INDEX_RE.exec(courseDocId);
  if (m) used.add(parseInt(m[1], 10));
}

/**
 * Smallest C{n} (n >= 1) not used by any **document id** matching C[1-9]… (published + creator
 * Firestore doc ids, including unparsable courses), nor any extra reserved id string.
 */
export function firstAvailableStructuredCourseIdFromDocIds(
  documentIds: readonly string[],
  extraReservedIds: string[] = []
): string {
  const used = new Set<number>();
  for (const id of documentIds) bumpCourseIndexFromDocId(id, used);
  for (const id of extraReservedIds) bumpCourseIndexFromDocId(id, used);
  let n = 1;
  while (used.has(n)) n += 1;
  return `C${n}`;
}

/** Same as {@link firstAvailableStructuredCourseIdFromDocIds} but takes in-memory course rows. */
export function firstAvailableStructuredCourseId(
  courses: readonly { id: string }[],
  extraReservedIds: string[] = []
): string {
  return firstAvailableStructuredCourseIdFromDocIds(
    courses.map((c) => c.id),
    extraReservedIds
  );
}

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

/**
 * Remap module/lesson ids to C{n}M{m}L{l} for a given course id (new draft / duplicate / AI skeleton).
 * Preserves lesson fields; fills missing titles and videoUrl.
 */
export function remapCourseToStructuredIds(course: Course, newCourseId: string): Course {
  const modules: Module[] = Array.isArray(course.modules) ? course.modules : [];
  return {
    ...course,
    id: newCourseId,
    modules: modules.map((mod, mi) => {
      const newMid = `${newCourseId}M${mi + 1}`;
      const lessons: Lesson[] = Array.isArray(mod.lessons) ? mod.lessons : [];
      return {
        ...mod,
        id: newMid,
        title: typeof mod.title === 'string' ? mod.title : `Module ${mi + 1}`,
        lessons: lessons.map((les, li) => ({
          ...les,
          id: `${newMid}L${li + 1}`,
          title: typeof les.title === 'string' ? les.title : `Lesson ${li + 1}`,
          videoUrl: typeof les.videoUrl === 'string' ? les.videoUrl : '',
        })),
      };
    }),
  };
}
