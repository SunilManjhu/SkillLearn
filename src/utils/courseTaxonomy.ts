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
