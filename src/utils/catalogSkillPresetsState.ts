/**
 * Skill presets: "Popular skills" + "More skills" bucket for Course Library filters and Browse menu.
 *
 * Live values load from Firestore; this module provides defaults, normalization, and a cached copy.
 */
import { dedupeLabelsPreserveOrder } from './courseTaxonomy';

export type CatalogSkillPresetsState = {
  mainPills: string[];
  moreSkills: string[];
};

/** Used when Firestore has no document yet or read fails. */
export const DEFAULT_CATALOG_SKILL_PRESETS: CatalogSkillPresetsState = {
  mainPills: [],
  moreSkills: [],
};

let cachedPresets: CatalogSkillPresetsState = normalizeCatalogSkillPresetsInternal(DEFAULT_CATALOG_SKILL_PRESETS);

function normalizeCatalogSkillPresetsInternal(input: CatalogSkillPresetsState): CatalogSkillPresetsState {
  const mainPills = dedupeLabelsPreserveOrder(input.mainPills);
  const moreSkills = dedupeLabelsPreserveOrder(input.moreSkills);
  return { mainPills, moreSkills };
}

export function normalizeCatalogSkillPresets(input: CatalogSkillPresetsState): CatalogSkillPresetsState {
  return normalizeCatalogSkillPresetsInternal(input);
}

export function getCachedCatalogSkillPresets(): CatalogSkillPresetsState {
  return cachedPresets;
}

export function setCachedCatalogSkillPresets(next: CatalogSkillPresetsState): void {
  cachedPresets = normalizeCatalogSkillPresetsInternal(next);
}

/** First preset skill for new-course defaults (mirrors {@link defaultNewCourseCategoryFromState}). */
export function defaultNewCourseSkillFromState(state: CatalogSkillPresetsState): string {
  const s = normalizeCatalogSkillPresetsInternal(state);
  return s.mainPills[0] ?? s.moreSkills[0] ?? 'General';
}

export const CATALOG_SKILL_PRESETS_CHANGED = 'skilllearn-catalog-skill-presets-changed';

