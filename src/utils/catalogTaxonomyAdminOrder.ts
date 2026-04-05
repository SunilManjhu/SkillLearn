/** Persisted display order for admin Categories & Skills (taxonomy tab). */

const STORAGE = {
  category: 'skilllearn.catalogTaxonomyAdminOrder.v1.categories',
  skill: 'skilllearn.catalogTaxonomyAdminOrder.v1.skills',
} as const;

export type TaxonomyAdminOrderKind = keyof typeof STORAGE;

function lower(s: string): string {
  return s.trim().toLowerCase();
}

export function readCatalogTaxonomyAdminOrder(kind: TaxonomyAdminOrderKind): string[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE[kind]);
    if (!raw) return null;
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return null;
    return p.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  } catch {
    return null;
  }
}

export function writeCatalogTaxonomyAdminOrder(kind: TaxonomyAdminOrderKind, order: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE[kind], JSON.stringify([...order]));
  } catch {
    return;
  }
}

/**
 * Apply saved order, then append any labels in `universe` that are missing (localeCompare sort).
 * `universe` order is ignored except for labels not in saved order.
 */
export function mergeUniverseWithAdminOrder(universe: readonly string[], saved: readonly string[] | null): string[] {
  const universeLower = new Map<string, string>();
  for (const u of universe) {
    const t = u.trim();
    if (!t) continue;
    const k = lower(t);
    if (!universeLower.has(k)) universeLower.set(k, t);
  }

  const used = new Set<string>();
  const out: string[] = [];

  for (const s of saved ?? []) {
    const t = s.trim();
    if (!t) continue;
    const k = lower(t);
    const canonical = universeLower.get(k);
    if (!canonical || used.has(k)) continue;
    out.push(canonical);
    used.add(k);
  }

  const rest: string[] = [];
  for (const k of universeLower.keys()) {
    if (!used.has(k)) rest.push(universeLower.get(k)!);
  }
  rest.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  out.push(...rest);
  return out;
}

/** Remove label (case-insensitive) from order list. */
export function orderWithoutLabel(order: readonly string[], label: string): string[] {
  const k = lower(label);
  return order.filter((x) => lower(x) !== k);
}

/** Insert `label` before `beforeLabel`, or append if `beforeLabel` is null / not found. */
export function orderInsertBefore(order: readonly string[], label: string, beforeLabel: string | null): string[] {
  const k = lower(label);
  const next = order.filter((x) => lower(x) !== k);
  const canonical = label.trim();
  if (!beforeLabel) {
    next.push(canonical);
    return next;
  }
  const bi = next.findIndex((x) => lower(x) === lower(beforeLabel));
  if (bi < 0) {
    next.push(canonical);
    return next;
  }
  next.splice(bi, 0, canonical);
  return next;
}
