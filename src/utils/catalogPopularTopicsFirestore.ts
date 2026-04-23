import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { sortLabelsLocaleCi } from './catalogTaxonomyAdminOrder';

const COLLECTION = 'siteSettings';
export const CATALOG_POPULAR_TOPICS_DOC_ID = 'catalogPopularTopics';

export function parseCatalogPopularTopicsDoc(data: Record<string, unknown> | undefined): string[] {
  if (!data) return [];
  const raw = data.labels;
  if (!Array.isArray(raw)) return [];
  const labels = raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return sortLabelsLocaleCi(labels);
}

/** One-shot read (e.g. migration). Prefer `subscribeCatalogPopularTopics` for UI. */
export async function loadCatalogPopularTopicsFromFirestore(): Promise<string[]> {
  try {
    const snap = await getDoc(doc(db, COLLECTION, CATALOG_POPULAR_TOPICS_DOC_ID));
    if (!snap.exists()) return [];
    return parseCatalogPopularTopicsDoc(snap.data() as Record<string, unknown>);
  } catch (e) {
    handleFirestoreError(e, OperationType.GET, `${COLLECTION}/${CATALOG_POPULAR_TOPICS_DOC_ID}`);
    return [];
  }
}

/** Admin: persist curated Popular topic labels (site-wide). */
export async function saveCatalogPopularTopicsFirestore(topics: readonly string[]): Promise<boolean> {
  const labels = sortLabelsLocaleCi(
    topics.map((t) => t.trim()).filter((t) => t.length > 0)
  );
  try {
    await setDoc(doc(db, COLLECTION, CATALOG_POPULAR_TOPICS_DOC_ID), {
      labels,
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, `${COLLECTION}/${CATALOG_POPULAR_TOPICS_DOC_ID}`);
    return false;
  }
}

/**
 * Live Popular topics for the public catalog and admin UI (read: any signed-in or anonymous user with rules).
 */
export function subscribeCatalogPopularTopics(
  onLabels: (labels: readonly string[]) => void,
  onError?: () => void
): () => void {
  const ref = doc(db, COLLECTION, CATALOG_POPULAR_TOPICS_DOC_ID);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onLabels([]);
        return;
      }
      onLabels(parseCatalogPopularTopicsDoc(snap.data() as Record<string, unknown>));
    },
    (e) => {
      handleFirestoreError(e, OperationType.GET, `${COLLECTION}/${CATALOG_POPULAR_TOPICS_DOC_ID}`);
      onError?.();
      onLabels([]);
    }
  );
}
