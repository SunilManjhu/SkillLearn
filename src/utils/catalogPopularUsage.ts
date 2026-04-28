import type { Course } from '../data/courses';

function lower(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Display usage counts in taxonomy lists: exact for 1–10, then largest multiple-of-10 floor with “+” (e.g. 35 → 30+).
 */
export function formatTaxonomyUsageCountDisplay(count: number): string {
  const n = Math.max(0, Math.floor(count));
  if (n <= 10) return String(n);
  return `${Math.floor(n / 10) * 10}+`;
}

export type CategorySkillCountMaps = {
  /** Lowercase category label → number of courses listing that category (case-insensitive). */
  categoryByLower: ReadonlyMap<string, number>;
  /** Lowercase skill label → number of courses listing that skill (case-insensitive). */
  skillByLower: ReadonlyMap<string, number>;
};

/** Single pass over courses for category/skill usage counts. */
export function buildCategorySkillUsageMaps(courses: readonly Course[]): CategorySkillCountMaps {
  const categoryByLower = new Map<string, number>();
  const skillByLower = new Map<string, number>();
  for (const c of courses) {
    for (const raw of c.categories ?? []) {
      const k = lower(raw);
      if (!k) continue;
      categoryByLower.set(k, (categoryByLower.get(k) ?? 0) + 1);
    }
    for (const raw of c.skills ?? []) {
      const k = lower(raw);
      if (!k) continue;
      skillByLower.set(k, (skillByLower.get(k) ?? 0) + 1);
    }
  }
  return { categoryByLower, skillByLower };
}

export function courseCountForCategoryLabel(maps: CategorySkillCountMaps, label: string): number {
  return maps.categoryByLower.get(lower(label)) ?? 0;
}

export function courseCountForSkillLabel(maps: CategorySkillCountMaps, label: string): number {
  return maps.skillByLower.get(lower(label)) ?? 0;
}

type PopularCandidate = { label: string; kind: 'category' | 'skill'; count: number };

function firstCanonLabel(pool: readonly string[], k: string): string | null {
  for (const raw of pool) {
    const t = raw.trim();
    if (!t) continue;
    if (lower(t) === k) return t;
  }
  return null;
}

/**
 * Up to `limit` labels with highest course usage across both kinds.
 * Same spelling in both pools is one candidate: `max(category uses, skill uses)`; tie on max prefers category casing/kind.
 * Sort: count desc, then label locale, then kind.
 */
export function computeCrossKindPopularTopicLabels({
  courses,
  categoryPool,
  skillPool,
  limit = 3,
}: {
  courses: readonly Course[];
  categoryPool: readonly string[];
  skillPool: readonly string[];
  limit?: number;
}): string[] {
  const { categoryByLower, skillByLower } = buildCategorySkillUsageMaps(courses);
  const keys = new Set<string>();
  for (const raw of categoryPool) {
    const k = lower(raw);
    if (k) keys.add(k);
  }
  for (const raw of skillPool) {
    const k = lower(raw);
    if (k) keys.add(k);
  }

  const candidates: PopularCandidate[] = [];
  for (const k of keys) {
    const catC = categoryByLower.get(k) ?? 0;
    const skC = skillByLower.get(k) ?? 0;
    const count = Math.max(catC, skC);
    if (count <= 0) continue;

    const catLabel = firstCanonLabel(categoryPool, k);
    const skillLabel = firstCanonLabel(skillPool, k);
    const inCat = catLabel != null;
    const inSkill = skillLabel != null;
    const kind: 'category' | 'skill' =
      !inSkill ? 'category' : !inCat ? 'skill' : catC >= skC ? 'category' : 'skill';
    const label = kind === 'category' ? catLabel! : skillLabel!;

    candidates.push({ label, kind, count });
  }

  candidates.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const t = a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    if (t !== 0) return t;
    return a.kind.localeCompare(b.kind);
  });

  return candidates.slice(0, limit).map((c) => c.label);
}

const LEGACY_CATALOG_POPULAR_TOPICS_LS = 'skilllearn.catalogPopularTopics.v1';

/** Removes obsolete localStorage from the old pinned “popular topics” feature. Safe to call once at app boot. */
export function clearLegacyCatalogPopularTopicsLocalStorage(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(LEGACY_CATALOG_POPULAR_TOPICS_LS);
  } catch {
    /* ignore quota / private mode */
  }
}
