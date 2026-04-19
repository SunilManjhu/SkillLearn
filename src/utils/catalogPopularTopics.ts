/** Curated “Popular topics” list for admin (Categories & Skills tab). Persisted in localStorage. */

import { orderInsertBefore, orderWithoutLabel } from './catalogTaxonomyAdminOrder';

const STORAGE_KEY = 'skilllearn.catalogPopularTopics.v1';

function lower(s: string): string {
  return s.trim().toLowerCase();
}

export function readCatalogPopularTopics(): string[] {
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

export function writeCatalogPopularTopics(topics: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...topics]));
  } catch {
    return;
  }
}

/** Drop labels that no longer exist in the category ∪ skill universe (case-insensitive). */
export function filterPopularTopicsToUniverse(
  topics: readonly string[],
  universeLower: ReadonlySet<string>
): string[] {
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
