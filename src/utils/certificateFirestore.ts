import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, doc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { mergeCompletionTimestampFromRemote } from './courseCompletionLog';

export function buildCertificateId(courseId: string, userId: string): string {
  return `CERT-${courseId.slice(0, 4)}-${userId.slice(0, 4)}`.toUpperCase();
}

export async function persistCertificateToFirestore(params: {
  courseId: string;
  userId: string;
  userName: string;
  certificateId: string;
}): Promise<void> {
  const { courseId, userId, userName, certificateId } = params;
  try {
    await setDoc(
      doc(db, 'certificates', certificateId),
      {
        courseId,
        userId,
        userName,
        date: serverTimestamp(),
        certificateId,
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'certificates');
  }
}

/** After site data is cleared, rebuild completion timestamps from stored certificate rows (survives in Firestore). */
export async function hydrateCompletionTimestampsFromCertificates(userId: string): Promise<void> {
  try {
    const q = query(collection(db, 'certificates'), where('userId', '==', userId));
    const snapshot = await getDocs(q);
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const courseId = data.courseId as string | undefined;
      const date = data.date as { toMillis?: () => number } | undefined;
      if (!courseId || !date || typeof date.toMillis !== 'function') continue;
      mergeCompletionTimestampFromRemote(courseId, userId, date.toMillis());
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'certificates');
  }
}
