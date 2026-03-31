import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { CatalogCategoryPresetsState } from './catalogCategoryPresets';
import {
  CATALOG_CATEGORY_PRESETS_CHANGED,
  DEFAULT_CATALOG_CATEGORY_PRESETS,
  normalizeCatalogCategoryPresets,
  setCachedCatalogCategoryPresets,
} from './catalogCategoryPresets';
import { db, handleFirestoreError, OperationType } from '../firebase';

const COLLECTION = 'siteSettings';
export const CATALOG_CATEGORY_PRESETS_DOC_ID = 'catalogCategoryPresets';

function coercePresets(data: Record<string, unknown> | undefined): CatalogCategoryPresetsState | null {
  if (!data) return null;
  const main = data.mainPills;
  const more = data.moreTopics;
  if (!Array.isArray(main) || !Array.isArray(more)) return null;
  const mainPills = main.filter((x): x is string => typeof x === 'string');
  const moreTopics = more.filter((x): x is string => typeof x === 'string');
  return normalizeCatalogCategoryPresets({ mainPills, moreTopics });
}

/** Public read: returns normalized presets (defaults if missing or invalid). */
export async function loadCatalogCategoryPresets(): Promise<CatalogCategoryPresetsState> {
  try {
    const snap = await getDoc(doc(db, COLLECTION, CATALOG_CATEGORY_PRESETS_DOC_ID));
    if (!snap.exists()) {
      const d = normalizeCatalogCategoryPresets(DEFAULT_CATALOG_CATEGORY_PRESETS);
      setCachedCatalogCategoryPresets(d);
      return d;
    }
    const parsed = coercePresets(snap.data() as Record<string, unknown>);
    const out = parsed ?? normalizeCatalogCategoryPresets(DEFAULT_CATALOG_CATEGORY_PRESETS);
    setCachedCatalogCategoryPresets(out);
    return out;
  } catch (e) {
    handleFirestoreError(e, OperationType.GET, `${COLLECTION}/${CATALOG_CATEGORY_PRESETS_DOC_ID}`);
    const d = normalizeCatalogCategoryPresets(DEFAULT_CATALOG_CATEGORY_PRESETS);
    setCachedCatalogCategoryPresets(d);
    return d;
  }
}

/** Admin: write presets document. */
export async function saveCatalogCategoryPresets(state: CatalogCategoryPresetsState): Promise<boolean> {
  const normalized = normalizeCatalogCategoryPresets(state);
  try {
    await setDoc(doc(db, COLLECTION, CATALOG_CATEGORY_PRESETS_DOC_ID), {
      mainPills: normalized.mainPills,
      moreTopics: normalized.moreTopics,
      updatedAt: serverTimestamp(),
    });
    setCachedCatalogCategoryPresets(normalized);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(CATALOG_CATEGORY_PRESETS_CHANGED));
    }
    return true;
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, `${COLLECTION}/${CATALOG_CATEGORY_PRESETS_DOC_ID}`);
    return false;
  }
}
