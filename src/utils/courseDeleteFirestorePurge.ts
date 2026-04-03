import {
  collection,
  getDocs,
  query,
  where,
  writeBatch,
  type DocumentReference,
} from 'firebase/firestore';
import type { Course } from '../data/courses';
import { db, handleFirestoreError, OperationType } from '../firebase';

const FIRESTORE_IN_QUERY_LIMIT = 30;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function collectLessonIdsFromCourse(course: Course): string[] {
  const ids: string[] = [];
  for (const m of course.modules) {
    for (const l of m.lessons) ids.push(l.id);
  }
  return ids;
}

async function commitDeletes(refs: DocumentReference[]): Promise<void> {
  if (refs.length === 0) return;
  const BATCH_SIZE = 400;
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const slice = refs.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    for (const r of slice) batch.delete(r);
    await batch.commit();
  }
}

async function deleteByFieldEquals(collName: string, field: string, value: string): Promise<void> {
  const q = query(collection(db, collName), where(field, '==', value));
  const snap = await getDocs(q);
  await commitDeletes(snap.docs.map((d) => d.ref));
}

async function deleteByLessonIdsIn(collName: string, lessonIds: string[]): Promise<void> {
  for (const group of chunk(lessonIds, FIRESTORE_IN_QUERY_LIMIT)) {
    if (group.length === 0) continue;
    const q = query(collection(db, collName), where('lessonId', 'in', group));
    const snap = await getDocs(q);
    await commitDeletes(snap.docs.map((d) => d.ref));
  }
}

/**
 * Removes learner- and engagement-related Firestore rows keyed by this course (and its lesson ids).
 * Intended when an admin deletes a published catalog course so reusing the same `courseId` does not
 * resurrect progress, certificates, quiz history, etc.
 */
export async function purgeLearnerFirestoreDataForCourse(course: Course): Promise<boolean> {
  const courseId = course.id;
  const lessonIds = collectLessonIdsFromCourse(course);
  console.debug('[debug:courseReuse]', 'purgeLearnerFirestoreDataForCourse start', {
    courseId,
    lessonCount: lessonIds.length,
  });
  try {
    await deleteByFieldEquals('progress', 'courseId', courseId);
    await deleteByFieldEquals('enrollments', 'courseId', courseId);
    await deleteByFieldEquals('certificates', 'courseId', courseId);
    await deleteByFieldEquals('courseRatings', 'courseId', courseId);
    await deleteByFieldEquals('quizAttempts', 'courseId', courseId);
    await deleteByFieldEquals('alerts', 'courseId', courseId);
    await deleteByFieldEquals('reports', 'courseId', courseId);

    if (lessonIds.length > 0) {
      await deleteByLessonIdsIn('votes', lessonIds);
      await deleteByLessonIdsIn('suggestions', lessonIds);
      await deleteByLessonIdsIn('customizations', lessonIds);
      await deleteByLessonIdsIn('reportNotices', lessonIds);
    }
    console.debug('[debug:courseReuse]', 'purgeLearnerFirestoreDataForCourse done', { courseId });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `purge learner data for course ${courseId}`);
    return false;
  }
}
