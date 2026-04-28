/** Controls creator browse scope for both Course Library and Learning Paths in the shell nav. */
export type CreatorBrowseCatalogPreference = 'all' | 'mine' | 'both';

const KEY_PREFIX = 'skilllearn:creatorBrowseCatalogPreference:v1:';

/** Dispatched on this window after the preference is written (same-tab updates). */
export const CREATOR_BROWSE_CATALOG_PREFERENCE_CHANGED =
  'skilllearn:creatorBrowseCatalogPreferenceChanged';

/** When browse pref is {@link CreatorBrowseCatalogPreference} `'both'`, Course Library uses this sub-scope. */
export type CreatorBothCatalogSubScope = 'mine' | 'all';

const BOTH_SUB_KEY_PREFIX = 'skilllearn:creatorBothCatalogSubScope:v1:';

export const CREATOR_BOTH_CATALOG_SUB_SCOPE_CHANGED =
  'skilllearn:creatorBothCatalogSubScopeChanged';

function bothSubStorageKey(uid: string): string {
  return `${BOTH_SUB_KEY_PREFIX}${uid}`;
}

export function readCreatorBothCatalogSubScope(uid: string): CreatorBothCatalogSubScope {
  if (typeof window === 'undefined') return 'mine';
  try {
    const v = window.localStorage.getItem(bothSubStorageKey(uid));
    if (v === 'mine' || v === 'all') return v;
    return 'mine';
  } catch {
    return 'mine';
  }
}

export function writeCreatorBothCatalogSubScope(uid: string, scope: CreatorBothCatalogSubScope): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(bothSubStorageKey(uid), scope);
    window.dispatchEvent(new Event(CREATOR_BOTH_CATALOG_SUB_SCOPE_CHANGED));
  } catch {
    /* ignore */
  }
}

function storageKey(uid: string): string {
  return `${KEY_PREFIX}${uid}`;
}

export function readCreatorBrowseCatalogPreference(uid: string): CreatorBrowseCatalogPreference {
  if (typeof window === 'undefined') return 'both';
  try {
    const v = window.localStorage.getItem(storageKey(uid));
    if (v === 'all' || v === 'mine' || v === 'both') return v;
    return 'both';
  } catch {
    return 'both';
  }
}

export function writeCreatorBrowseCatalogPreference(
  uid: string,
  pref: CreatorBrowseCatalogPreference
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(uid), pref);
    window.dispatchEvent(new Event(CREATOR_BROWSE_CATALOG_PREFERENCE_CHANGED));
  } catch {
    /* ignore quota / private mode */
  }
}

