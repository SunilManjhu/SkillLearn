import type { Course, Lesson, Module } from '../data/courses';
import { isDividerLesson } from './lessonContent';

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
 * After reordering modules or lessons in a structured course, reassign ids: playable lessons get
 * C{n}M{m}L{i} (i = 1,2,… in order); section dividers get C{n}M{m}D{j} (j = 1,2,… in order).
 */
export function remapStructuredCourseModuleLessonIdsByOrder(course: Course): Course {
  if (!isStructuredCourseId(course.id)) return course;
  const cid = course.id;
  return {
    ...course,
    modules: course.modules.map((mod, mi) => {
      const newMid = `${cid}M${mi + 1}`;
      let playableN = 0;
      let dividerN = 0;
      const lessons = mod.lessons.map((les) => {
        if (isDividerLesson(les)) {
          dividerN += 1;
          return { ...les, id: `${newMid}D${dividerN}` };
        }
        playableN += 1;
        return { ...les, id: `${newMid}L${playableN}` };
      });
      return { ...mod, id: newMid, lessons };
    }),
  };
}

/**
 * Remap module/lesson ids for a given course id (new draft / duplicate / AI skeleton).
 * Playable rows get C{n}M{m}L{i}; dividers get C{n}M{m}D{j}. Preserves lesson fields; fills missing titles and videoUrl.
 */
export function remapCourseToStructuredIds(course: Course, newCourseId: string): Course {
  const modules: Module[] = Array.isArray(course.modules) ? course.modules : [];
  return {
    ...course,
    id: newCourseId,
    modules: modules.map((mod, mi) => {
      const newMid = `${newCourseId}M${mi + 1}`;
      const lessons: Lesson[] = Array.isArray(mod.lessons) ? mod.lessons : [];
      let playableN = 0;
      let dividerN = 0;
      return {
        ...mod,
        id: newMid,
        title: typeof mod.title === 'string' ? mod.title : `Module ${mi + 1}`,
        lessons: lessons.map((les) => {
          if (isDividerLesson(les)) {
            dividerN += 1;
            return {
              ...les,
              id: `${newMid}D${dividerN}`,
              title: typeof les.title === 'string' ? les.title : `Section ${dividerN}`,
              videoUrl: '',
            };
          }
          playableN += 1;
          return {
            ...les,
            id: `${newMid}L${playableN}`,
            title: typeof les.title === 'string' ? les.title : `Lesson ${playableN}`,
            videoUrl: typeof les.videoUrl === 'string' ? les.videoUrl : '',
          };
        }),
      };
    }),
  };
}
