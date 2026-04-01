import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

const COLLECTION = 'siteSettings';
export const NOTIFICATIONS_DOC_ID = 'notifications';

/** True when doc missing or `enabled` is not explicitly false (default on for existing deployments). */
export function parseNotificationsSiteEnabled(data: Record<string, unknown> | undefined): boolean {
  if (!data) return true;
  return data.enabled !== false;
}

export async function loadNotificationsSiteEnabled(): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, COLLECTION, NOTIFICATIONS_DOC_ID));
    if (!snap.exists()) return true;
    return parseNotificationsSiteEnabled(snap.data() as Record<string, unknown>);
  } catch (e) {
    handleFirestoreError(e, OperationType.GET, `${COLLECTION}/${NOTIFICATIONS_DOC_ID}`);
    return true;
  }
}

export async function saveNotificationsSiteEnabled(enabled: boolean): Promise<boolean> {
  try {
    await setDoc(doc(db, COLLECTION, NOTIFICATIONS_DOC_ID), {
      enabled,
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, `${COLLECTION}/${NOTIFICATIONS_DOC_ID}`);
    return false;
  }
}

export function subscribeNotificationsSiteEnabled(
  onValue: (enabled: boolean) => void,
  onError?: () => void
): () => void {
  const ref = doc(db, COLLECTION, NOTIFICATIONS_DOC_ID);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onValue(true);
        return;
      }
      onValue(parseNotificationsSiteEnabled(snap.data() as Record<string, unknown>));
    },
    (e) => {
      handleFirestoreError(e, OperationType.GET, `${COLLECTION}/${NOTIFICATIONS_DOC_ID}`);
      onError?.();
      onValue(true);
    }
  );
}

