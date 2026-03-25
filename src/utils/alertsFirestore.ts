import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  limit,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

export type BroadcastAlertType = 'course_update' | 'topic_update' | 'video_update' | 'course_change';

export interface BroadcastAlert {
  id: string;
  type: BroadcastAlertType;
  title: string;
  message: string;
  courseId: string;
  moduleId?: string;
  lessonId?: string;
  createdAtMs: number;
  status: 'active' | 'archived';
}

export interface UserAlertState {
  readAlertIds: Record<string, boolean>;
  dismissedAlertIds: Record<string, boolean>;
}

function toMillis(v: unknown): number {
  if (v && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof v === 'number') return v;
  return Date.now();
}

export async function createBroadcastAlert(params: {
  type: BroadcastAlertType;
  title: string;
  message: string;
  courseId: string;
  moduleId?: string;
  lessonId?: string;
}): Promise<string | null> {
  try {
    const payload: Record<string, unknown> = {
      type: params.type,
      title: params.title,
      message: params.message,
      courseId: params.courseId,
      status: 'active',
      createdAt: serverTimestamp(),
    };
    if (params.moduleId) payload.moduleId = params.moduleId;
    if (params.lessonId) payload.lessonId = params.lessonId;
    const ref = await addDoc(collection(db, 'alerts'), payload);
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'alerts');
    return null;
  }
}

export async function fetchActiveAlertsForCourses(courseIds: string[]): Promise<BroadcastAlert[]> {
  if (courseIds.length === 0) return [];
  try {
    const chunks: string[][] = [];
    for (let i = 0; i < courseIds.length; i += 10) {
      chunks.push(courseIds.slice(i, i + 10));
    }
    const byId = new Map<string, BroadcastAlert>();
    for (const chunk of chunks) {
      const q = query(
        collection(db, 'alerts'),
        where('courseId', 'in', chunk),
        where('status', '==', 'active'),
        limit(50)
      );
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        const data = d.data();
        const type = data.type as BroadcastAlertType;
        if (
          !['course_update', 'topic_update', 'video_update', 'course_change'].includes(type) ||
          typeof data.title !== 'string' ||
          typeof data.message !== 'string' ||
          typeof data.courseId !== 'string'
        ) {
          continue;
        }
        byId.set(d.id, {
          id: d.id,
          type,
          title: data.title,
          message: data.message,
          courseId: data.courseId,
          moduleId: typeof data.moduleId === 'string' ? data.moduleId : undefined,
          lessonId: typeof data.lessonId === 'string' ? data.lessonId : undefined,
          createdAtMs: toMillis(data.createdAt),
          status: 'active',
        });
      }
    }
    return Array.from(byId.values()).sort((a, b) => b.createdAtMs - a.createdAtMs);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'alerts');
    return [];
  }
}

export async function loadUserAlertState(userId: string): Promise<UserAlertState> {
  try {
    const snap = await getDoc(doc(db, 'userAlertState', userId));
    if (!snap.exists()) return { readAlertIds: {}, dismissedAlertIds: {} };
    const data = snap.data();
    const readAlertIds =
      data.readAlertIds && typeof data.readAlertIds === 'object' && !Array.isArray(data.readAlertIds)
        ? (data.readAlertIds as Record<string, boolean>)
        : {};
    const dismissedAlertIds =
      data.dismissedAlertIds &&
      typeof data.dismissedAlertIds === 'object' &&
      !Array.isArray(data.dismissedAlertIds)
        ? (data.dismissedAlertIds as Record<string, boolean>)
        : {};
    return { readAlertIds, dismissedAlertIds };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `userAlertState/${userId}`);
    return { readAlertIds: {}, dismissedAlertIds: {} };
  }
}

export async function markAlertRead(userId: string, alertId: string): Promise<void> {
  try {
    const ref = doc(db, 'userAlertState', userId);
    await setDoc(
      ref,
      {
        readAlertIds: { [alertId]: true },
        lastUpdated: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `userAlertState/${userId}`);
  }
}

export async function markAlertDismissed(userId: string, alertId: string): Promise<void> {
  try {
    const ref = doc(db, 'userAlertState', userId);
    await setDoc(
      ref,
      {
        dismissedAlertIds: { [alertId]: true },
        lastUpdated: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `userAlertState/${userId}`);
  }
}
