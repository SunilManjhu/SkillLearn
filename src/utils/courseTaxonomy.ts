import type { Course } from '../data/courses';

export const COURSE_LEVELS = [
  'Beginner',
  'Intermediate',
  'Advanced',
  'Proficient',
] as const satisfies readonly Course['level'][];

export type LibraryFilterState = {
  categoryTags: string[];
  skillTags: string[];
  /** `null` = any level (exclusive single-select in UI). */
  level: Course['level'] | null;
};

export function isCourseLevel(s: string): s is Course['level'] {
  return (COURSE_LEVELS as readonly string[]).includes(s);
}

/** Trim, drop empties, dedupe case-insensitively; keep first-seen casing. */
export function dedupeLabelsPreserveOrder(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const t = raw.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function normalizeCourseTaxonomy(c: Course): Course {
  return {
    ...c,
    categories: dedupeLabelsPreserveOrder(c.categories),
    skills: dedupeLabelsPreserveOrder(c.skills),
  };
}

export function formatCourseTaxonomyForSearch(course: Course): string {
  return [...course.categories, ...course.skills].join(' ');
}

/**
 * AND across dimensions: every selected category and skill must appear on the course;
 * if `level` is set it must match.
 */
export function courseMatchesLibraryFilters(course: Course, filters: LibraryFilterState): boolean {
  const cc = course.categories.map((c) => c.trim().toLowerCase());
  for (const t of filters.categoryTags) {
    if (!cc.includes(t.trim().toLowerCase())) return false;
  }

  const ss = course.skills.map((s) => s.trim().toLowerCase());
  for (const t of filters.skillTags) {
    if (!ss.includes(t.trim().toLowerCase())) return false;
  }

  if (filters.level != null && course.level !== filters.level) return false;

  return true;
}

/** Category/skill strings and levels that appear on at least one course (skills/categories compared case-insensitively). */
export type CatalogCourseTaxonomyUsage = {
  categoriesLower: Set<string>;
  skillsLower: Set<string>;
  levels: Set<Course['level']>;
};

export function catalogCourseTaxonomyUsage(courses: readonly Course[]): CatalogCourseTaxonomyUsage {
  const categoriesLower = new Set<string>();
  const skillsLower = new Set<string>();
  const levels = new Set<Course['level']>();
  for (const co of courses) {
    for (const c of co.categories ?? []) {
      const k = c.trim().toLowerCase();
      if (k) categoriesLower.add(k);
    }
    for (const s of co.skills ?? []) {
      const k = s.trim().toLowerCase();
      if (k) skillsLower.add(k);
    }
    levels.add(co.level);
  }
  return { categoriesLower, skillsLower, levels };
}

/**
 * Preserve `pool` order and display casing; keep only labels that appear on a course
 * (pass `usage.categoriesLower` or `usage.skillsLower` from {@link catalogCourseTaxonomyUsage}).
 */
export function filterTaxonomyPoolToUsedOnCourses(
  pool: readonly string[],
  usedLower: Set<string>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of pool) {
    const t = raw.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (!usedLower.has(k)) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function canonicalLabelFromPool(tag: string, pool: readonly string[]): string {
  const k = tag.trim().toLowerCase();
  return pool.find((p) => p.toLowerCase() === k) ?? tag.trim();
}

/** Add or remove a label in a multi-select filter; uses pool for canonical casing. */
export function toggleFilterTag(selected: string[], tag: string, pool: readonly string[]): string[] {
  const k = tag.trim().toLowerCase();
  const has = selected.some((s) => s.toLowerCase() === k);
  if (has) {
    return selected.filter((s) => s.toLowerCase() !== k);
  }
  const c = canonicalLabelFromPool(tag, pool);
  if (selected.some((s) => s.toLowerCase() === c.toLowerCase())) return selected;
  return [...selected, c];
}
