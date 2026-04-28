/** Controls creator browse scope for both Course Library and Learning Paths in the shell nav. */
export type CreatorBrowseCatalogPreference = 'all' | 'mine' | 'both';

const KEY_PREFIX = 'skilllearn:creatorBrowseCatalogPreference:v1:';

/** Dispatched on this window after the preference is written (same-tab updates). */
export const CREATOR_BROWSE_CATALOG_PREFERENCE_CHANGED =
  'skilllearn:creatorBrowseCatalogPreferenceChanged';

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

