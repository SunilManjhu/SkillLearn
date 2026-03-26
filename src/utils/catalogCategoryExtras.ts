const STORAGE_KEY = 'skilllearn.catalogCategoryExtras';

/** Same-tab listeners (e.g. App) refresh filter pills when admin adds a category. */
export const CATALOG_CATEGORY_EXTRAS_CHANGED = 'skilllearn-catalog-category-extras-changed';

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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CATALOG_CATEGORY_EXTRAS_CHANGED));
}
