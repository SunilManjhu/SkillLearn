import { readCachedAuthProfile } from './authProfileCache';

function storageKey(uid: string): string {
  return `skilllearn:uiTheme:${uid}`;
}

export function readPersistedUiThemeForUser(uid: string): 'dark' | 'light' | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(storageKey(uid));
    if (v === 'light' || v === 'dark') return v;
    return null;
  } catch {
    return null;
  }
}

export function writePersistedUiThemeForUser(uid: string, theme: 'dark' | 'light'): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(uid), theme);
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Synchronous first paint: if a cached signed-in session exists, restore that user’s theme before
 * `onAuthStateChanged` runs so reload does not flash the guest default.
 */
export function readInitialUiThemeForSession(): 'dark' | 'light' {
  const cached = readCachedAuthProfile();
  if (!cached?.uid) return 'dark';
  return readPersistedUiThemeForUser(cached.uid) ?? 'dark';
}
