import { collection, deleteDoc, doc, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

function tsToMs(v: unknown): number {
  if (v && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export interface AdminReportRow {
  id: string;
  lessonId: string;
  courseId?: string;
  courseTitle?: string;
  lessonTitle?: string;
  userId: string;
  reason: string;
  details: string;
  timestampMs: number;
}

export interface AdminSuggestionRow {
  id: string;
  lessonId: string;
  userId: string;
  suggestedUrl: string;
  timestampMs: number;
}

export async function listReportsForAdmin(): Promise<AdminReportRow[]> {
  try {
    const snap = await getDocs(collection(db, 'reports'));
    const rows: AdminReportRow[] = [];
    for (const d of snap.docs) {
      const data = d.data();
      if (
        typeof data.lessonId !== 'string' ||
        typeof data.userId !== 'string' ||
        typeof data.reason !== 'string'
      ) {
        continue;
      }
      rows.push({
        id: d.id,
        lessonId: data.lessonId,
        courseId: typeof data.courseId === 'string' ? data.courseId : undefined,
        courseTitle: typeof data.courseTitle === 'string' ? data.courseTitle : undefined,
        lessonTitle: typeof data.lessonTitle === 'string' ? data.lessonTitle : undefined,
        userId: data.userId,
        reason: data.reason,
        details: typeof data.details === 'string' ? data.details : '',
        timestampMs: tsToMs(data.timestamp),
      });
    }
    rows.sort((a, b) => b.timestampMs - a.timestampMs);
    return rows;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'reports');
    return [];
  }
}

export async function listSuggestionsForAdmin(): Promise<AdminSuggestionRow[]> {
  try {
    const snap = await getDocs(collection(db, 'suggestions'));
    const rows: AdminSuggestionRow[] = [];
    for (const d of snap.docs) {
      const data = d.data();
      if (
        typeof data.lessonId !== 'string' ||
        typeof data.userId !== 'string' ||
        typeof data.suggestedUrl !== 'string'
      ) {
        continue;
      }
      rows.push({
        id: d.id,
        lessonId: data.lessonId,
        userId: data.userId,
        suggestedUrl: data.suggestedUrl,
        timestampMs: tsToMs(data.timestamp),
      });
    }
    rows.sort((a, b) => b.timestampMs - a.timestampMs);
    return rows;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'suggestions');
    return [];
  }
}

export async function deleteReportAsAdmin(reportId: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, 'reports', reportId));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `reports/${reportId}`);
    return false;
  }
}

export async function deleteSuggestionAsAdmin(suggestionId: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, 'suggestions', suggestionId));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `suggestions/${suggestionId}`);
    return false;
  }
}
