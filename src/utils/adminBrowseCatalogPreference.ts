/** Controls admin browse scope for Course Library and Learning Paths (separate from creator prefs). */
export type AdminBrowseCatalogPreference = 'other' | 'creator' | 'admin_only' | 'both';

const KEY_PREFIX = 'skilllearn:adminBrowseCatalogPreference:v1:';

export const ADMIN_BROWSE_CATALOG_PREFERENCE_CHANGED = 'skilllearn:adminBrowseCatalogPreferenceChanged';

function storageKey(uid: string): string {
  return `${KEY_PREFIX}${uid}`;
}

export function readAdminBrowseCatalogPreference(uid: string): AdminBrowseCatalogPreference {
  if (typeof window === 'undefined') return 'both';
  try {
    const v = window.localStorage.getItem(storageKey(uid));
    if (v === 'other' || v === 'creator' || v === 'admin_only' || v === 'both') return v;
    return 'both';
  } catch {
    return 'both';
  }
}

export function writeAdminBrowseCatalogPreference(uid: string, pref: AdminBrowseCatalogPreference): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(uid), pref);
    window.dispatchEvent(new Event(ADMIN_BROWSE_CATALOG_PREFERENCE_CHANGED));
  } catch {
    /* ignore quota / private mode */
  }
}

/** When admin browse pref is `'both'`, Course Library uses this sub-scope (learner shell vs creators + admin-only). */
export type AdminBothCatalogSubScope = 'learner' | 'staff';

const BOTH_SUB_KEY_PREFIX = 'skilllearn:adminBothCatalogSubScope:v1:';

export const ADMIN_BOTH_CATALOG_SUB_SCOPE_CHANGED = 'skilllearn:adminBothCatalogSubScopeChanged';

function bothSubStorageKey(uid: string): string {
  return `${BOTH_SUB_KEY_PREFIX}${uid}`;
}

export function readAdminBothCatalogSubScope(uid: string): AdminBothCatalogSubScope {
  if (typeof window === 'undefined') return 'learner';
  try {
    const v = window.localStorage.getItem(bothSubStorageKey(uid));
    if (v === 'learner' || v === 'staff') return v;
    return 'learner';
  } catch {
    return 'learner';
  }
}

export function writeAdminBothCatalogSubScope(uid: string, scope: AdminBothCatalogSubScope): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(bothSubStorageKey(uid), scope);
    window.dispatchEvent(new Event(ADMIN_BOTH_CATALOG_SUB_SCOPE_CHANGED));
  } catch {
    /* ignore */
  }
}
