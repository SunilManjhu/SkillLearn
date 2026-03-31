/**
 * Legacy compatibility shim.
 *
 * Skill presets are Firestore-backed via `catalogSkillPresetsState` + `catalogSkillPresetsFirestore`.
 * This file intentionally contains no hard-coded skill names.
 */

/** @deprecated Use Firestore-backed `CatalogSkillPresetsState` instead. */
export function allPresetCatalogSkills(): string[] {
  return [];
}
