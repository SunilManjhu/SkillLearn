/**
 * Persisted ordering for admin Categories & Skills chip lists (localStorage).
 * Merged with the live “universe” of labels (presets + extras + discovered on courses).
 */

export type CatalogTaxonomyAdminOrderKind = 'category' | 'skill';

const STORAGE_PREFIX = 'skilllearn.catalogTaxonomyOrder';

function storageKey(kind: CatalogTaxonomyAdminOrderKind): string {
  return `${kind === 'category' ? `${STORAGE_PREFIX}.category` : `${STORAGE_PREFIX}.skill`}.v1`;
}

function lower(s: string): string {
  return s.trim().toLowerCase();
}

/** Remove every occurrence of label (case-insensitive); preserve order of the rest. */
export function orderWithoutLabel(list: readonly string[], label: string): string[] {
  const k = lower(label);
  return list.filter((x) => lower(x) !== k);
}

/**
 * Insert or move `label` so it sits immediately before `beforeLabel` (case-insensitive).
 * If `beforeLabel` is null, appends at the end. Removes any prior copy of `label` first.
 */
export function orderInsertBefore(
  list: readonly string[],
  label: string,
  beforeLabel: string | null
): string[] {
  const t = label.trim();
  if (!t) return [...list];
  const k = lower(t);
  const without = list.filter((x) => lower(x) !== k);
  const b = beforeLabel?.trim();
  if (!b) {
    return [...without, t];
  }
  const bk = lower(b);
  const idx = without.findIndex((x) => lower(x) === bk);
  if (idx < 0) {
    return [...without, t];
  }
  const next = [...without];
  next.splice(idx, 0, t);
  return next;
}

/** Saved admin order for this kind, or null if unset / invalid. */
export function readCatalogTaxonomyAdminOrder(kind: CatalogTaxonomyAdminOrderKind): string[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(kind));
    if (!raw) return null;
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return null;
    const out = p.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function writeCatalogTaxonomyAdminOrder(kind: CatalogTaxonomyAdminOrderKind, order: readonly string[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(kind), JSON.stringify([...order]));
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Apply saved drag order first (labels still in `universe`), then append any new universe
 * labels in stable source order.
 */
export function mergeUniverseWithAdminOrder(
  universe: readonly string[],
  adminOrder: readonly string[] | null
): string[] {
  if (!adminOrder || adminOrder.length === 0) {
    return [...universe];
  }
  const universeLower = new Set(universe.map((x) => lower(x)));
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of adminOrder) {
    const t = raw.trim();
    if (!t) continue;
    const k = lower(t);
    if (!universeLower.has(k) || seen.has(k)) continue;
    seen.add(k);
    const canonical = universe.find((u) => lower(u) === k) ?? t;
    out.push(canonical);
  }

  for (const raw of universe) {
    const t = raw.trim();
    if (!t) continue;
    const k = lower(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(raw);
  }

  return out;
}
