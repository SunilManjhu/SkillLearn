import { getCachedCatalogSkillPresets } from './catalogSkillPresetsState';
import { getCachedTaxonomySkillLabels, mutateTaxonomyLabelLibrary } from './catalogTaxonomyLabelLibraryFirestore';

export { CATALOG_SKILL_EXTRAS_CHANGED } from './catalogTaxonomyPickerEvents';

function lower(s: string): string {
  return s.trim().toLowerCase();
}

/** Skill labels beyond Firestore presets — stored in Firestore (`catalogTaxonomyLabelLibrary`). */
export function readCatalogSkillExtras(): string[] {
  return getCachedTaxonomySkillLabels();
}

/** Adds a trimmed skill if new; updates Firestore when admin writes are enabled. */
export function addCatalogSkillExtra(name: string): void {
  const t = name.trim();
  if (!t) return;
  mutateTaxonomyLabelLibrary((prev) => {
    if (prev.skillLabels.some((c) => lower(c) === lower(t))) return prev;
    return { ...prev, skillLabels: [...prev.skillLabels, t] };
  });
}

export function removeCatalogSkillExtra(name: string): void {
  const k = lower(name.trim());
  if (!k) return;
  mutateTaxonomyLabelLibrary((prev) => ({
    ...prev,
    skillLabels: prev.skillLabels.filter((c) => lower(c) !== k),
  }));
}

export function replaceCatalogSkillExtra(oldName: string, newName: string): void {
  const o = oldName.trim();
  const n = newName.trim();
  if (!o || !n) return;
  const p = getCachedCatalogSkillPresets();
  const presetLower = new Set([...p.mainPills, ...p.moreSkills].map((x) => x.toLowerCase()));
  mutateTaxonomyLabelLibrary((prev) => {
    let next = prev.skillLabels.filter((c) => lower(c) !== o.toLowerCase());
    if (!presetLower.has(n.toLowerCase()) && !next.some((c) => lower(c) === n.toLowerCase())) {
      next = [...next, n];
    }
    return { ...prev, skillLabels: next };
  });
}
