/**
 * Curated “Popular topics” helpers. Site-wide list lives in Firestore (`siteSettings/catalogPopularTopics`).
 * Creator studio taxonomy still uses localStorage so non-admin creators can experiment without writing siteSettings.
 */

import { orderInsertBefore, orderWithoutLabel, sortLabelsLocaleCi } from './catalogTaxonomyAdminOrder';

const LEGACY_LOCAL_STORAGE_KEY = 'skilllearn.catalogPopularTopics.v1';

function lower(s: string): string {
  return s.trim().toLowerCase();
}

/** Creator-studio taxonomy only: Popular pins stored on this device. */
export function readCatalogPopularTopicsLocal(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    const out = p.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    return sortLabelsLocaleCi(out);
  } catch {
    return [];
  }
}

/** Creator-studio taxonomy only. */
export function writeCatalogPopularTopicsLocal(topics: readonly string[]): void {
  try {
    localStorage.setItem(LEGACY_LOCAL_STORAGE_KEY, JSON.stringify(sortLabelsLocaleCi(topics)));
  } catch {
    return;
  }
}

/** Drop labels that no longer exist in the category ∪ skill universe (case-insensitive). */
export function filterPopularTopicsToUniverse(
  topics: readonly string[],
  universeLower: ReadonlySet<string>
): string[] {
  // While the universe is still empty (e.g. first paint before Firestore/presets hydrate), do not strip —
  // otherwise every pin is removed and a premature persist would wipe stored Popular topics on reload.
  if (universeLower.size === 0) return [...topics];
  return topics.filter((t) => universeLower.has(lower(t)));
}

export function popularTopicsHasLabel(topics: readonly string[], label: string): boolean {
  const k = lower(label);
  return topics.some((x) => lower(x) === k);
}

/** Insert copy; if label already present (CI), returns null (no-op). */
export function popularTopicsInsertCopyBefore(
  topics: readonly string[],
  label: string,
  beforeLabel: string | null
): string[] | null {
  if (popularTopicsHasLabel(topics, label)) return null;
  return orderInsertBefore([...topics], label, beforeLabel);
}

export function popularTopicsReorder(topics: readonly string[], label: string, beforeLabel: string | null): string[] {
  return orderInsertBefore([...topics], label, beforeLabel);
}

export function popularTopicsRemoveLabel(topics: readonly string[], label: string): string[] {
  return orderWithoutLabel(topics, label);
}

export function popularTopicsRenameLabel(topics: readonly string[], from: string, to: string): string[] {
  const fk = lower(from);
  const toT = to.trim();
  if (!toT) return [...topics];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of topics) {
    let next = raw;
    if (lower(raw) === fk) next = toT;
    const k = lower(next);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(next);
  }
  return out;
}
