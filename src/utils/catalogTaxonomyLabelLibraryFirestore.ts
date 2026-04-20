import { doc, getDoc, onSnapshot, serverTimestamp, setDoc, type Unsubscribe } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { CATALOG_CATEGORY_EXTRAS_CHANGED, CATALOG_SKILL_EXTRAS_CHANGED } from './catalogTaxonomyPickerEvents';

const COLLECTION = 'siteSettings';
export const CATALOG_TAXONOMY_LABEL_LIBRARY_DOC_ID = 'catalogTaxonomyLabelLibrary';

/** Legacy localStorage keys (pre–Firestore library). */
const LS_CAT_KEY = 'skilllearn.catalogCategoryExtras';
const LS_SK_KEY = 'skilllearn.catalogSkillExtras';

export type CatalogTaxonomyLabelLibraryState = {
  categoryLabels: string[];
  skillLabels: string[];
};

const EMPTY: CatalogTaxonomyLabelLibraryState = { categoryLabels: [], skillLabels: [] };

let cache: CatalogTaxonomyLabelLibraryState = { ...EMPTY };
/** When false, mutations update in-memory cache only (creator studio); admins persist to Firestore. */
let persistWritesToFirestore = false;

export function setCatalogTaxonomyLabelLibraryWriteEnabled(enabled: boolean): void {
  persistWritesToFirestore = enabled;
}

function lower(s: string): string {
  return s.trim().toLowerCase();
}

function dedupeSortedLabels(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const t = raw.trim();
    if (!t) continue;
    const k = lower(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return out;
}

function coerceDoc(data: Record<string, unknown> | undefined): CatalogTaxonomyLabelLibraryState {
  if (!data) return { ...EMPTY };
  const cat = data.categoryLabels;
  const sk = data.skillLabels ?? data['skills'];
  const categoryLabels = Array.isArray(cat)
    ? cat.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
  const skillLabels = Array.isArray(sk)
    ? sk.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
  return {
    categoryLabels: dedupeSortedLabels(categoryLabels),
    skillLabels: dedupeSortedLabels(skillLabels),
  };
}

/**
 * If Firestore has categories but no skills (or vice versa), keep legacy localStorage for the empty side
 * so a partial cloud doc does not wipe the other axis after bootstrap.
 */
function mergeServerLabelLibraryWithLegacyFallback(server: CatalogTaxonomyLabelLibraryState): CatalogTaxonomyLabelLibraryState {
  const lsCat = readLegacyLocalStorageCategories();
  const lsSk = readLegacyLocalStorageSkills();
  return {
    categoryLabels: dedupeSortedLabels(
      server.categoryLabels.length > 0 ? [...server.categoryLabels] : [...lsCat]
    ),
    skillLabels: dedupeSortedLabels(server.skillLabels.length > 0 ? [...server.skillLabels] : [...lsSk]),
  };
}

function notifyListeners(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CATALOG_CATEGORY_EXTRAS_CHANGED));
  window.dispatchEvent(new Event(CATALOG_SKILL_EXTRAS_CHANGED));
}

function setCache(next: CatalogTaxonomyLabelLibraryState): void {
  cache = {
    categoryLabels: dedupeSortedLabels(next.categoryLabels),
    skillLabels: dedupeSortedLabels(next.skillLabels),
  };
}

export function getCachedTaxonomyLabelLibrary(): CatalogTaxonomyLabelLibraryState {
  return {
    categoryLabels: [...cache.categoryLabels],
    skillLabels: [...cache.skillLabels],
  };
}

export function getCachedTaxonomyCategoryLabels(): string[] {
  return [...cache.categoryLabels];
}

export function getCachedTaxonomySkillLabels(): string[] {
  return [...cache.skillLabels];
}

function readLegacyLocalStorageCategories(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_CAT_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    return p.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  } catch {
    return [];
  }
}

function readLegacyLocalStorageSkills(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_SK_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    return p.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * Hydrate memory from legacy localStorage before the first Firestore read (instant picker),
 * then Firestore / subscribe replaces when available.
 */
export function bootstrapTaxonomyLabelLibraryFromLocalStorage(): void {
  if (cache.categoryLabels.length > 0 || cache.skillLabels.length > 0) return;
  const cat = readLegacyLocalStorageCategories();
  const sk = readLegacyLocalStorageSkills();
  if (cat.length === 0 && sk.length === 0) return;
  setCache({ categoryLabels: cat, skillLabels: sk });
  notifyListeners();
}

async function writeDoc(state: CatalogTaxonomyLabelLibraryState): Promise<boolean> {
  try {
    await setDoc(
      doc(db, COLLECTION, CATALOG_TAXONOMY_LABEL_LIBRARY_DOC_ID),
      {
        categoryLabels: state.categoryLabels,
        skillLabels: state.skillLabels,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, `${COLLECTION}/${CATALOG_TAXONOMY_LABEL_LIBRARY_DOC_ID}`);
    return false;
  }
}

async function persistIfAllowed(): Promise<void> {
  if (!persistWritesToFirestore) return;
  await writeDoc(cache);
}

function canonKey(s: CatalogTaxonomyLabelLibraryState): string {
  const c = [...s.categoryLabels].map(lower).sort().join('\u0001');
  const k = [...s.skillLabels].map(lower).sort().join('\u0001');
  return `${c}\u0002${k}`;
}

export function mutateTaxonomyLabelLibrary(mutator: (prev: CatalogTaxonomyLabelLibraryState) => CatalogTaxonomyLabelLibraryState): void {
  const prev = getCachedTaxonomyLabelLibrary();
  const raw = mutator(prev);
  const next: CatalogTaxonomyLabelLibraryState = {
    categoryLabels: dedupeSortedLabels(raw.categoryLabels),
    skillLabels: dedupeSortedLabels(raw.skillLabels),
  };
  if (canonKey(next) === canonKey(prev)) return;
  setCache(next);
  notifyListeners();
  void persistIfAllowed();
}

export async function loadCatalogTaxonomyLabelLibrary(): Promise<CatalogTaxonomyLabelLibraryState> {
  try {
    const snap = await getDoc(doc(db, COLLECTION, CATALOG_TAXONOMY_LABEL_LIBRARY_DOC_ID));
    if (!snap.exists()) {
      // Keep legacy bootstrap in memory until an admin creates the doc (see migrate helper).
      if (cache.categoryLabels.length === 0 && cache.skillLabels.length === 0) {
        setCache(EMPTY);
      }
      notifyListeners();
      return getCachedTaxonomyLabelLibrary();
    }
    const parsed = coerceDoc(snap.data() as Record<string, unknown>);
    setCache(mergeServerLabelLibraryWithLegacyFallback(parsed));
    notifyListeners();
    return getCachedTaxonomyLabelLibrary();
  } catch (e) {
    handleFirestoreError(e, OperationType.GET, `${COLLECTION}/${CATALOG_TAXONOMY_LABEL_LIBRARY_DOC_ID}`);
    return getCachedTaxonomyLabelLibrary();
  }
}

export function subscribeCatalogTaxonomyLabelLibrary(
  onNext?: (s: CatalogTaxonomyLabelLibraryState) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, COLLECTION, CATALOG_TAXONOMY_LABEL_LIBRARY_DOC_ID),
    (snap) => {
      if (!snap.exists()) {
        if (cache.categoryLabels.length === 0 && cache.skillLabels.length === 0) {
          setCache(EMPTY);
        }
      } else {
        setCache(mergeServerLabelLibraryWithLegacyFallback(coerceDoc(snap.data() as Record<string, unknown>)));
      }
      notifyListeners();
      onNext?.(getCachedTaxonomyLabelLibrary());
    },
    (e) => {
      handleFirestoreError(e, OperationType.LIST, `${COLLECTION}/${CATALOG_TAXONOMY_LABEL_LIBRARY_DOC_ID}`);
      onError?.(e as Error);
    }
  );
}

/**
 * Migrates legacy localStorage into Firestore per axis: if the cloud doc has categories but no skills (common
 * after a partial write), still upload skills from this browser when present.
 */
export async function migrateLegacyLocalStorageTaxonomyLabelsIfServerEmpty(): Promise<void> {
  if (!persistWritesToFirestore) return;
  try {
    const snap = await getDoc(doc(db, COLLECTION, CATALOG_TAXONOMY_LABEL_LIBRARY_DOC_ID));
    const server = snap.exists() ? coerceDoc(snap.data() as Record<string, unknown>) : EMPTY;
    const lsCat = readLegacyLocalStorageCategories();
    const lsSk = readLegacyLocalStorageSkills();
    const needCat = server.categoryLabels.length === 0 && lsCat.length > 0;
    const needSk = server.skillLabels.length === 0 && lsSk.length > 0;
    if (!needCat && !needSk) return;
    const merged: CatalogTaxonomyLabelLibraryState = {
      categoryLabels: needCat ? dedupeSortedLabels([...server.categoryLabels, ...lsCat]) : server.categoryLabels,
      skillLabels: needSk ? dedupeSortedLabels([...server.skillLabels, ...lsSk]) : server.skillLabels,
    };
    const ok = await writeDoc(merged);
    if (ok) {
      setCache(mergeServerLabelLibraryWithLegacyFallback(merged));
      notifyListeners();
    }
  } catch (e) {
    handleFirestoreError(e, OperationType.GET, `${COLLECTION}/${CATALOG_TAXONOMY_LABEL_LIBRARY_DOC_ID}`);
  }
}
