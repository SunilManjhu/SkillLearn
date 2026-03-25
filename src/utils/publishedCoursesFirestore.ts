import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import type { Course, Lesson, Module } from '../data/courses';
import { STATIC_CATALOG_FALLBACK } from '../data/courses';
import { db, handleFirestoreError, OperationType } from '../firebase';

function parseLesson(raw: unknown): Lesson | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.title !== 'string' || typeof o.videoUrl !== 'string') return null;
  const lesson: Lesson = {
    id: o.id,
    title: o.title,
    videoUrl: o.videoUrl,
  };
  if (typeof o.duration === 'string') lesson.duration = o.duration;
  if (typeof o.about === 'string') lesson.about = o.about;
  return lesson;
}

function parseModule(raw: unknown): Module | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.title !== 'string' || !Array.isArray(o.lessons)) return null;
  const lessons: Lesson[] = [];
  for (const l of o.lessons) {
    const pl = parseLesson(l);
    if (pl) lessons.push(pl);
  }
  if (lessons.length === 0) return null;
  return { id: o.id, title: o.title, lessons };
}

function docToCourse(id: string, data: Record<string, unknown>): Course | null {
  if (
    typeof data.title !== 'string' ||
    typeof data.author !== 'string' ||
    typeof data.thumbnail !== 'string' ||
    typeof data.description !== 'string' ||
    typeof data.duration !== 'string' ||
    typeof data.category !== 'string' ||
    typeof data.rating !== 'number' ||
    !['Beginner', 'Intermediate', 'Advanced'].includes(data.level as string) ||
    !Array.isArray(data.modules)
  ) {
    return null;
  }
  const modules: Module[] = [];
  for (const m of data.modules) {
    const pm = parseModule(m);
    if (pm) modules.push(pm);
  }
  if (modules.length === 0) return null;
  const course: Course = {
    id,
    title: data.title,
    author: data.author,
    thumbnail: data.thumbnail,
    description: data.description,
    level: data.level as Course['level'],
    duration: data.duration,
    rating: data.rating,
    category: data.category,
    modules,
  };
  if (typeof data.authorBio === 'string') course.authorBio = data.authorBio;
  return course;
}

/** Loads all documents from `publishedCourses`. Returns [] on error or empty collection. */
export async function loadPublishedCoursesFromFirestore(): Promise<Course[]> {
  try {
    const snap = await getDocs(collection(db, 'publishedCourses'));
    const out: Course[] = [];
    for (const d of snap.docs) {
      const c = docToCourse(d.id, d.data() as Record<string, unknown>);
      if (c) out.push(c);
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'publishedCourses');
    return [];
  }
}

export async function resolveCatalogCourses(): Promise<Course[]> {
  const remote = await loadPublishedCoursesFromFirestore();
  if (remote.length > 0) return remote;
  return STATIC_CATALOG_FALLBACK;
}

export function courseToFirestorePayload(course: Course): Record<string, unknown> {
  const { id: _id, ...rest } = course;
  return {
    ...rest,
    updatedAt: serverTimestamp(),
  };
}

/** Admin: replace entire published catalog from bundled fallback (idempotent-ish). */
export async function seedPublishedCoursesFromStaticCatalog(courses: Course[]): Promise<void> {
  try {
    const batch = writeBatch(db);
    for (const c of courses) {
      batch.set(doc(db, 'publishedCourses', c.id), courseToFirestorePayload(c));
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'publishedCourses');
    throw error;
  }
}

/** Admin: write or overwrite one published course (document id = course.id). */
export async function savePublishedCourse(course: Course): Promise<boolean> {
  try {
    await setDoc(doc(db, 'publishedCourses', course.id), courseToFirestorePayload(course));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `publishedCourses/${course.id}`);
    return false;
  }
}

/** Admin: remove a course from the live catalog. */
export async function deletePublishedCourse(courseId: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, 'publishedCourses', courseId));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `publishedCourses/${courseId}`);
    return false;
  }
}

