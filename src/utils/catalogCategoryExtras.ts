import { allPresetCatalogCategoriesFromState, getCachedCatalogCategoryPresets } from './catalogCategoryPresets';
import { getCachedTaxonomyCategoryLabels, mutateTaxonomyLabelLibrary } from './catalogTaxonomyLabelLibraryFirestore';

export { CATALOG_CATEGORY_EXTRAS_CHANGED } from './catalogTaxonomyPickerEvents';

function lower(s: string): string {
  return s.trim().toLowerCase();
}

/** Category labels beyond Firestore presets — stored in Firestore (`catalogTaxonomyLabelLibrary`). */
export function readCatalogCategoryExtras(): string[] {
  return getCachedTaxonomyCategoryLabels();
}

/** Adds a trimmed category if new; updates Firestore when admin writes are enabled. */
export function addCatalogCategoryExtra(name: string): void {
  const t = name.trim();
  if (!t) return;
  mutateTaxonomyLabelLibrary((prev) => {
    if (prev.categoryLabels.some((c) => lower(c) === lower(t))) return prev;
    return { ...prev, categoryLabels: [...prev.categoryLabels, t] };
  });
}

/** Removes a name from the saved quick-pick list (does not change course documents). */
export function removeCatalogCategoryExtra(name: string): void {
  const k = lower(name.trim());
  if (!k) return;
  mutateTaxonomyLabelLibrary((prev) => ({
    ...prev,
    categoryLabels: prev.categoryLabels.filter((c) => lower(c) !== k),
  }));
}

/**
 * After renaming a category in Firestore: drop `oldName` from extras and ensure `newName` is pinned
 * when it is not a built-in preset (avoids duplicate entries).
 */
export function replaceCatalogCategoryExtra(oldName: string, newName: string): void {
  const o = oldName.trim();
  const n = newName.trim();
  if (!o || !n) return;
  const presetLower = new Set(
    allPresetCatalogCategoriesFromState(getCachedCatalogCategoryPresets()).map((x) => x.toLowerCase())
  );
  mutateTaxonomyLabelLibrary((prev) => {
    let next = prev.categoryLabels.filter((c) => lower(c) !== o.toLowerCase());
    if (!presetLower.has(n.toLowerCase()) && !next.some((c) => lower(c) === n.toLowerCase())) {
      next = [...next, n];
    }
    return { ...prev, categoryLabels: next };
  });
}
