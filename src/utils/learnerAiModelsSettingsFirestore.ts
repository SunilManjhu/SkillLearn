import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

const COLLECTION = 'siteSettings';
export const LEARNER_AI_MODELS_DOC_ID = 'learnerAiModels';

/** True when doc missing or `enabled` is not explicitly false (default on for existing deployments). */
export function parseLearnerAiModelsSiteEnabled(data: Record<string, unknown> | undefined): boolean {
  if (!data) return true;
  return data.enabled !== false;
}

export async function loadLearnerAiModelsSiteEnabled(): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, COLLECTION, LEARNER_AI_MODELS_DOC_ID));
    if (!snap.exists()) return true;
    return parseLearnerAiModelsSiteEnabled(snap.data() as Record<string, unknown>);
  } catch (e) {
    handleFirestoreError(e, OperationType.GET, `${COLLECTION}/${LEARNER_AI_MODELS_DOC_ID}`);
    return true;
  }
}

export async function saveLearnerAiModelsSiteEnabled(enabled: boolean): Promise<boolean> {
  try {
    await setDoc(doc(db, COLLECTION, LEARNER_AI_MODELS_DOC_ID), {
      enabled,
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, `${COLLECTION}/${LEARNER_AI_MODELS_DOC_ID}`);
    return false;
  }
}

export function subscribeLearnerAiModelsSiteEnabled(
  onValue: (enabled: boolean) => void,
  onError?: () => void
): () => void {
  const ref = doc(db, COLLECTION, LEARNER_AI_MODELS_DOC_ID);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onValue(true);
        return;
      }
      onValue(parseLearnerAiModelsSiteEnabled(snap.data() as Record<string, unknown>));
    },
    (e) => {
      handleFirestoreError(e, OperationType.GET, `${COLLECTION}/${LEARNER_AI_MODELS_DOC_ID}`);
      onError?.();
      onValue(true);
    }
  );
}
