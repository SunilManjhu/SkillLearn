import { doc, setDoc, getDocs, query, collection, where, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

export function enrollmentDocId(userId: string, courseId: string): string {
  return `${userId}__${courseId}`;
}

export async function enrollUserInCourse(userId: string, courseId: string): Promise<void> {
  try {
    const id = enrollmentDocId(userId, courseId);
    await setDoc(
      doc(db, 'enrollments', id),
      {
        userId,
        courseId,
        enrolledAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `enrollments/${userId}/${courseId}`);
  }
}

export async function fetchEnrolledCourseIds(userId: string): Promise<string[]> {
  try {
    const q = query(collection(db, 'enrollments'), where('userId', '==', userId));
    const snap = await getDocs(q);
    const ids: string[] = [];
    for (const d of snap.docs) {
      const cid = d.data().courseId;
      if (typeof cid === 'string') ids.push(cid);
    }
    return ids;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'enrollments');
    return [];
  }
}
