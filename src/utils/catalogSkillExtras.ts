import { getCachedCatalogSkillPresets } from './catalogSkillPresetsState';

const STORAGE_KEY = 'skilllearn.catalogSkillExtras';

export const CATALOG_SKILL_EXTRAS_CHANGED = 'skilllearn-catalog-skill-extras-changed';

export function readCatalogSkillExtras(): string[] {
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

function persist(next: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CATALOG_SKILL_EXTRAS_CHANGED));
}

export function addCatalogSkillExtra(name: string): void {
  const t = name.trim();
  if (!t) return;
  const cur = readCatalogSkillExtras();
  if (cur.some((c) => c.toLowerCase() === t.toLowerCase())) return;
  const next = [...cur, t].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  persist(next);
}

export function removeCatalogSkillExtra(name: string): void {
  const t = name.trim();
  if (!t) return;
  const cur = readCatalogSkillExtras();
  const next = cur.filter((c) => c.toLowerCase() !== t.toLowerCase());
  if (next.length === cur.length) return;
  persist(next);
}

export function replaceCatalogSkillExtra(oldName: string, newName: string): void {
  const o = oldName.trim();
  const n = newName.trim();
  if (!o || !n) return;
  const p = getCachedCatalogSkillPresets();
  const presetLower = new Set([...p.mainPills, ...p.moreSkills].map((x) => x.toLowerCase()));
  let next = readCatalogSkillExtras().filter((c) => c.toLowerCase() !== o.toLowerCase());
  if (!presetLower.has(n.toLowerCase()) && !next.some((c) => c.toLowerCase() === n.toLowerCase())) {
    next.push(n);
  }
  next.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  persist(next);
}
