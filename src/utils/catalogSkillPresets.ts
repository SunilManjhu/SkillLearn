/**
 * Built-in skill tags for Course Library filters and admin (aligned with learner nav “Skills” names).
 * User-added names also live in localStorage via catalogSkillExtras.
 */
export const CATALOG_SKILL_PRESETS = [
  'React',
  'TypeScript',
  'Node.js',
  'Python',
  'Docker',
  'Kubernetes',
  'AWS',
] as const;

export function allPresetCatalogSkills(): string[] {
  return [...CATALOG_SKILL_PRESETS];
}
