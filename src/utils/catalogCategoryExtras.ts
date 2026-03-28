import { allPresetCatalogCategories } from './catalogCategoryPresets';

const STORAGE_KEY = 'skilllearn.catalogCategoryExtras';

/** Same-tab listeners (e.g. App) refresh filter pills when admin adds a category. */
export const CATALOG_CATEGORY_EXTRAS_CHANGED = 'skilllearn-catalog-category-extras-changed';

function persist(next: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CATALOG_CATEGORY_EXTRAS_CHANGED));
}

export function readCatalogCategoryExtras(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    return p.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  } catch {
    return [];
  }
}

/** Adds a trimmed category if new; dispatches {@link CATALOG_CATEGORY_EXTRAS_CHANGED}. */
export function addCatalogCategoryExtra(name: string): void {
  const t = name.trim();
  if (!t) return;
  const cur = readCatalogCategoryExtras();
  if (cur.some((c) => c.toLowerCase() === t.toLowerCase())) return;
  const next = [...cur, t].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  persist(next);
}

/** Removes a name from the saved quick-pick list (does not change course documents). */
export function removeCatalogCategoryExtra(name: string): void {
  const t = name.trim();
  if (!t) return;
  const cur = readCatalogCategoryExtras();
  const next = cur.filter((c) => c.toLowerCase() !== t.toLowerCase());
  if (next.length === cur.length) return;
  persist(next);
}

/**
 * After renaming a category in Firestore: drop `oldName` from extras and ensure `newName` is pinned
 * when it is not a built-in preset (avoids duplicate entries).
 */
export function replaceCatalogCategoryExtra(oldName: string, newName: string): void {
  const o = oldName.trim();
  const n = newName.trim();
  if (!o || !n) return;
  const presetLower = new Set(allPresetCatalogCategories().map((x) => x.toLowerCase()));
  let next = readCatalogCategoryExtras().filter((c) => c.toLowerCase() !== o.toLowerCase());
  if (!presetLower.has(n.toLowerCase()) && !next.some((c) => c.toLowerCase() === n.toLowerCase())) {
    next.push(n);
  }
  next.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  persist(next);
}
