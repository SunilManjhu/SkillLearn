import type { Course } from '../data/courses';
import type { CatalogCategoryPresetsState } from './catalogCategoryPresets';
import type { CatalogSkillPresetsState } from './catalogSkillPresetsState';
import { readCatalogCategoryExtras } from './catalogCategoryExtras';
import { readCatalogSkillExtras } from './catalogSkillExtras';

export type CatalogTaxonomySection = {
  main: string[];
  more: string[];
  /** For diagnostics / admin UI. */
  discoveredOnly: string[];
};

export type CatalogTaxonomy = {
  topics: CatalogTaxonomySection;
  skills: CatalogTaxonomySection;
};

function normTag(s: string): string {
  return s.trim();
}

function lower(s: string): string {
  return s.trim().toLowerCase();
}

function uniqueCaseInsensitive(list: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const t = normTag(raw);
    if (!t) continue;
    const k = lower(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function alphaSort(list: string[]): string[] {
  return [...list].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function buildMorePool({
  presetMore,
  extras,
  discovered,
  excludeLower,
}: {
  presetMore: readonly string[];
  extras: readonly string[];
  discovered: readonly string[];
  excludeLower: Set<string>;
}): { more: string[]; discoveredOnly: string[] } {
  const presetMoreUnique = uniqueCaseInsensitive(presetMore);
  const extrasUnique = uniqueCaseInsensitive(extras);
  const discoveredUnique = uniqueCaseInsensitive(discovered);

  const discoveredOnly = alphaSort(
    discoveredUnique.filter((x) => !excludeLower.has(lower(x)) && !presetMoreUnique.some((p) => lower(p) === lower(x)))
  );

  const merged = uniqueCaseInsensitive([...presetMoreUnique, ...extrasUnique, ...discoveredUnique]).filter(
    (x) => !excludeLower.has(lower(x))
  );

  return { more: alphaSort(merged), discoveredOnly };
}

export function buildCatalogTaxonomy({
  courses,
  topicPresets,
  skillPresets,
}: {
  courses: readonly Course[];
  topicPresets: CatalogCategoryPresetsState;
  skillPresets: CatalogSkillPresetsState;
}): CatalogTaxonomy {
  const discoveredTopics: string[] = [];
  const discoveredSkills: string[] = [];
  for (const co of courses) {
    for (const c of co.categories ?? []) discoveredTopics.push(c);
    for (const s of co.skills ?? []) discoveredSkills.push(s);
  }

  const mainTopics = uniqueCaseInsensitive(topicPresets.mainPills);
  const mainSkills = uniqueCaseInsensitive(skillPresets.mainPills);

  const topicExclude = new Set(mainTopics.map(lower));
  const skillExclude = new Set(mainSkills.map(lower));

  const topicsMore = buildMorePool({
    presetMore: topicPresets.moreTopics,
    extras: readCatalogCategoryExtras(),
    discovered: discoveredTopics,
    excludeLower: topicExclude,
  });

  const skillsMore = buildMorePool({
    presetMore: skillPresets.moreSkills,
    extras: readCatalogSkillExtras(),
    discovered: discoveredSkills,
    excludeLower: skillExclude,
  });

  return {
    topics: { main: mainTopics, more: topicsMore.more, discoveredOnly: topicsMore.discoveredOnly },
    skills: { main: mainSkills, more: skillsMore.more, discoveredOnly: skillsMore.discoveredOnly },
  };
}

