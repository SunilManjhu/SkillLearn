import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

const COLLECTION = 'siteSettings';
export const LEARNING_ASSISTANT_DOC_ID = 'learningAssistant';

/** True when doc missing or `enabled` is not explicitly false (default on for existing deployments). */
export function parseLearningAssistantSiteEnabled(data: Record<string, unknown> | undefined): boolean {
  if (!data) return true;
  return data.enabled !== false;
}

export async function loadLearningAssistantSiteEnabled(): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, COLLECTION, LEARNING_ASSISTANT_DOC_ID));
    if (!snap.exists()) return true;
    return parseLearningAssistantSiteEnabled(snap.data() as Record<string, unknown>);
  } catch (e) {
    handleFirestoreError(e, OperationType.GET, `${COLLECTION}/${LEARNING_ASSISTANT_DOC_ID}`);
    return true;
  }
}

export async function saveLearningAssistantSiteEnabled(enabled: boolean): Promise<boolean> {
  try {
    await setDoc(doc(db, COLLECTION, LEARNING_ASSISTANT_DOC_ID), {
      enabled,
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, `${COLLECTION}/${LEARNING_ASSISTANT_DOC_ID}`);
    return false;
  }
}

export function subscribeLearningAssistantSiteEnabled(
  onValue: (enabled: boolean) => void,
  onError?: () => void
): () => void {
  const ref = doc(db, COLLECTION, LEARNING_ASSISTANT_DOC_ID);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onValue(true);
        return;
      }
      onValue(parseLearningAssistantSiteEnabled(snap.data() as Record<string, unknown>));
    },
    (e) => {
      handleFirestoreError(e, OperationType.GET, `${COLLECTION}/${LEARNING_ASSISTANT_DOC_ID}`);
      onError?.();
      onValue(true);
    }
  );
}
