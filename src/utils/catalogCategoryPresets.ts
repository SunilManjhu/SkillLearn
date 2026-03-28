/**
 * Course topic presets: "Popular topics" (main pills) + "More topics" bucket for the library filter,
 * Browse menu, and admin category pickers. Live values load from Firestore; {@link getCachedCatalogCategoryPresets}
 * mirrors the last fetch for sync helpers (e.g. category extras).
 */

import { dedupeLabelsPreserveOrder } from './courseTaxonomy';

export type CatalogCategoryPresetsState = {
  mainPills: string[];
  moreTopics: string[];
};

/** Used when Firestore has no document yet or read fails. */
export const DEFAULT_CATALOG_CATEGORY_PRESETS: CatalogCategoryPresetsState = {
  mainPills: [
    'Software Development',
    'Cloud Computing',
    'Data Science',
    'Cybersecurity',
    'AI & ML',
  ],
  moreTopics: ['Business', 'Design', 'Marketing', 'Personal Development'],
};

let cachedPresets: CatalogCategoryPresetsState = normalizeCatalogCategoryPresetsInternal(
  DEFAULT_CATALOG_CATEGORY_PRESETS
);

function normalizeCatalogCategoryPresetsInternal(input: CatalogCategoryPresetsState): CatalogCategoryPresetsState {
  const mainPills = dedupeLabelsPreserveOrder(input.mainPills);
  const moreTopics = dedupeLabelsPreserveOrder(input.moreTopics);
  const safeMain =
    mainPills.length > 0 ? mainPills : dedupeLabelsPreserveOrder(DEFAULT_CATALOG_CATEGORY_PRESETS.mainPills);
  return { mainPills: safeMain, moreTopics };
}

export function normalizeCatalogCategoryPresets(input: CatalogCategoryPresetsState): CatalogCategoryPresetsState {
  return normalizeCatalogCategoryPresetsInternal(input);
}

export function getCachedCatalogCategoryPresets(): CatalogCategoryPresetsState {
  return cachedPresets;
}

export function setCachedCatalogCategoryPresets(next: CatalogCategoryPresetsState): void {
  cachedPresets = normalizeCatalogCategoryPresetsInternal(next);
}

/** Browse / nav row: `All` + main pills (caller adds All). */
export function catalogCategoriesRowFromState(state: CatalogCategoryPresetsState): readonly string[] {
  const s = normalizeCatalogCategoryPresetsInternal(state);
  return ['All', ...s.mainPills] as const;
}

export function allPresetCatalogCategoriesFromState(state: CatalogCategoryPresetsState): string[] {
  const s = normalizeCatalogCategoryPresetsInternal(state);
  return [...s.mainPills, ...s.moreTopics];
}

export function defaultNewCourseCategoryFromState(state: CatalogCategoryPresetsState): string {
  const s = normalizeCatalogCategoryPresetsInternal(state);
  return s.mainPills[0] ?? 'Uncategorized';
}

export const CATALOG_CATEGORY_PRESETS_CHANGED = 'skilllearn-catalog-category-presets-changed';
