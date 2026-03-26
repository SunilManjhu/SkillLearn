import { collection, deleteDoc, doc, getDocs, onSnapshot, type QuerySnapshot } from 'firebase/firestore';
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

export interface AdminContactMessageRow {
  id: string;
  subject: string;
  message: string;
  userId: string;
  senderEmail: string;
  senderDisplayName: string;
  timestampMs: number;
}


function mapReportsSnapshot(snap: QuerySnapshot): AdminReportRow[] {
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
}

function mapSuggestionsSnapshot(snap: QuerySnapshot): AdminSuggestionRow[] {
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
}


function mapContactMessagesSnapshot(snap: QuerySnapshot): AdminContactMessageRow[] {
  const rows: AdminContactMessageRow[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    if (
      typeof data.subject !== 'string' ||
      typeof data.message !== 'string' ||
      typeof data.userId !== 'string'
    ) {
      continue;
    }
    rows.push({
      id: d.id,
      subject: data.subject,
      message: data.message,
      userId: data.userId,
      senderEmail: typeof data.senderEmail === 'string' ? data.senderEmail : '',
      senderDisplayName: typeof data.senderDisplayName === 'string' ? data.senderDisplayName : '',
      timestampMs: tsToMs(data.timestamp),
    });
  }
  rows.sort((a, b) => b.timestampMs - a.timestampMs);
  return rows;
}

export async function listReportsForAdmin(): Promise<AdminReportRow[]> {
  try {
    const snap = await getDocs(collection(db, 'reports'));
    return mapReportsSnapshot(snap);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'reports');
    return [];
  }
}

export async function listSuggestionsForAdmin(): Promise<AdminSuggestionRow[]> {
  try {
    const snap = await getDocs(collection(db, 'suggestions'));
    return mapSuggestionsSnapshot(snap);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'suggestions');
    return [];
  }
}


export async function listContactMessagesForAdmin(): Promise<AdminContactMessageRow[]> {
  try {
    const snap = await getDocs(collection(db, 'contactMessages'));
    return mapContactMessagesSnapshot(snap);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'contactMessages');
    return [];
  }
}

export function subscribeReportsForAdmin(
  onData: (rows: AdminReportRow[]) => void,
  onError?: (error: unknown) => void
): () => void {
  return onSnapshot(
    collection(db, 'reports'),
    (snap) => onData(mapReportsSnapshot(snap)),
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'reports');
      onError?.(error);
    }
  );
}

export function subscribeSuggestionsForAdmin(
  onData: (rows: AdminSuggestionRow[]) => void,
  onError?: (error: unknown) => void
): () => void {
  return onSnapshot(
    collection(db, 'suggestions'),
    (snap) => onData(mapSuggestionsSnapshot(snap)),
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'suggestions');
      onError?.(error);
    }
  );
}


export function subscribeContactMessagesForAdmin(
  onData: (rows: AdminContactMessageRow[]) => void,
  onError?: (error: unknown) => void
): () => void {
  return onSnapshot(
    collection(db, 'contactMessages'),
    (snap) => onData(mapContactMessagesSnapshot(snap)),
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'contactMessages');
      onError?.(error);
    }
  );
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


export async function deleteContactMessageAsAdmin(messageId: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, 'contactMessages', messageId));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `contactMessages/${messageId}`);
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
