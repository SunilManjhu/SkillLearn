import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { CatalogSkillPresetsState } from './catalogSkillPresetsState';
import {
  CATALOG_SKILL_PRESETS_CHANGED,
  DEFAULT_CATALOG_SKILL_PRESETS,
  normalizeCatalogSkillPresets,
  setCachedCatalogSkillPresets,
} from './catalogSkillPresetsState';
import { db, handleFirestoreError, OperationType } from '../firebase';

const COLLECTION = 'siteSettings';
export const CATALOG_SKILL_PRESETS_DOC_ID = 'catalogSkillPresets';

function coercePresets(data: Record<string, unknown> | undefined): CatalogSkillPresetsState | null {
  if (!data) return null;
  const main = data.mainPills;
  const more = data.moreSkills;
  if (!Array.isArray(main) || !Array.isArray(more)) return null;
  const mainPills = main.filter((x): x is string => typeof x === 'string');
  const moreSkills = more.filter((x): x is string => typeof x === 'string');
  return normalizeCatalogSkillPresets({ mainPills, moreSkills });
}

/** Public read: returns normalized presets (defaults if missing or invalid). */
export async function loadCatalogSkillPresets(): Promise<CatalogSkillPresetsState> {
  try {
    const snap = await getDoc(doc(db, COLLECTION, CATALOG_SKILL_PRESETS_DOC_ID));
    if (!snap.exists()) {
      const d = normalizeCatalogSkillPresets(DEFAULT_CATALOG_SKILL_PRESETS);
      setCachedCatalogSkillPresets(d);
      return d;
    }
    const parsed = coercePresets(snap.data() as Record<string, unknown>);
    const out = parsed ?? normalizeCatalogSkillPresets(DEFAULT_CATALOG_SKILL_PRESETS);
    setCachedCatalogSkillPresets(out);
    return out;
  } catch (e) {
    handleFirestoreError(e, OperationType.GET, `${COLLECTION}/${CATALOG_SKILL_PRESETS_DOC_ID}`);
    const d = normalizeCatalogSkillPresets(DEFAULT_CATALOG_SKILL_PRESETS);
    setCachedCatalogSkillPresets(d);
    return d;
  }
}

/** Admin: write presets document. */
export async function saveCatalogSkillPresets(state: CatalogSkillPresetsState): Promise<boolean> {
  const normalized = normalizeCatalogSkillPresets(state);
  try {
    await setDoc(doc(db, COLLECTION, CATALOG_SKILL_PRESETS_DOC_ID), {
      mainPills: normalized.mainPills,
      moreSkills: normalized.moreSkills,
      updatedAt: serverTimestamp(),
    });
    setCachedCatalogSkillPresets(normalized);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(CATALOG_SKILL_PRESETS_CHANGED));
    }
    return true;
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, `${COLLECTION}/${CATALOG_SKILL_PRESETS_DOC_ID}`);
    return false;
  }
}

