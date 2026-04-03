import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
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

/** Admin Catalog: every `creatorCourses` doc with parseable `ownerUid` + course payload. */
export async function loadAllCreatorCoursesForAdmin(): Promise<Array<{ course: Course; ownerUid: string }>> {
  try {
    const snap = await getDocs(collection(db, 'creatorCourses'));
    const out: Array<{ course: Course; ownerUid: string }> = [];
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>;
      const ownerUid = typeof data.ownerUid === 'string' ? data.ownerUid.trim() : '';
      const c = docToCourse(d.id, data);
      if (c && ownerUid) out.push({ course: c, ownerUid });
    }
    out.sort((a, b) => a.course.title.localeCompare(b.course.title, undefined, { sensitivity: 'base' }));
    return out;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'creatorCourses');
    return [];
  }
}

export async function listAllCreatorCourseDocumentIds(): Promise<string[]> {
  try {
    const snap = await getDocs(collection(db, 'creatorCourses'));
    return snap.docs.map((d) => d.id);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'creatorCourses');
    return [];
  }
}

export type SaveCreatorCourseOptions = {
  /** When true, Firestore rules must allow the signed-in admin to write another user’s draft. */
  allowNonOwnerWriter?: boolean;
};

export async function saveCreatorCourse(
  course: Course,
  ownerUid: string,
  options?: SaveCreatorCourseOptions
): Promise<boolean> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    return false;
  }

  const isPrivilegedWriter = options?.allowNonOwnerWriter === true;
  const ref = doc(db, 'creatorCourses', course.id);
  let resolvedOwnerUid: string;

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      const raw = existing.data()?.ownerUid;
      const fromDb = typeof raw === 'string' ? raw.trim() : '';
      if (isPrivilegedWriter) {
        // Admin edits: never reassign ownership when the field is already set.
        resolvedOwnerUid = fromDb || ownerUid.trim() || uid;
      } else {
        // Creator / self-serve: doc must be theirs (or orphan id they are claiming).
        if (fromDb && fromDb !== uid) {
          return false;
        }
        // Always persist the signed-in uid — never trust `ownerUid` from props alone (stale UI / bugs).
        resolvedOwnerUid = uid;
      }
    } else {
      // New document
      if (isPrivilegedWriter) {
        const t = ownerUid.trim();
        if (!t) return false;
        resolvedOwnerUid = t;
      } else {
        resolvedOwnerUid = uid;
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `creatorCourses/${course.id}`);
    return false;
  }

  if (!isPrivilegedWriter && uid !== resolvedOwnerUid) {
    return false;
  }

  try {
    await setDoc(ref, {
      ...courseToFirestorePayload(course),
      ownerUid: resolvedOwnerUid,
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
