import { collection, deleteDoc, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import type { Course } from '../data/courses';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { courseToFirestorePayload, docToCourse } from './publishedCoursesFirestore';

/** Document ids for this owner (includes docs that fail `docToCourse`). */
export async function listCreatorCourseDocumentIdsForOwner(ownerUid: string): Promise<string[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'creatorCourses'), where('ownerUid', '==', ownerUid))
    );
    return snap.docs.map((d) => d.id);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'creatorCourses');
    return [];
  }
}

export async function loadCreatorCoursesForOwner(ownerUid: string): Promise<Course[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'creatorCourses'), where('ownerUid', '==', ownerUid))
    );
    const out: Course[] = [];
    for (const d of snap.docs) {
      const c = docToCourse(d.id, d.data() as Record<string, unknown>);
      if (c) out.push(c);
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'creatorCourses');
    return [];
  }
}

/** Admin: list private courses for a creator UID. */
export async function listCreatorCoursesForAdminByOwner(ownerUid: string): Promise<Course[]> {
  return loadCreatorCoursesForOwner(ownerUid);
}

export async function saveCreatorCourse(course: Course, ownerUid: string): Promise<boolean> {
  const uid = auth.currentUser?.uid;
  if (!uid || uid !== ownerUid) {
    return false;
  }
  try {
    await setDoc(doc(db, 'creatorCourses', course.id), {
      ...courseToFirestorePayload(course),
      ownerUid,
    });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `creatorCourses/${course.id}`);
    return false;
  }
}

export async function deleteCreatorCourse(courseId: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, 'creatorCourses', courseId));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `creatorCourses/${courseId}`);
    return false;
  }
}
