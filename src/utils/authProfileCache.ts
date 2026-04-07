import type { User } from 'firebase/auth';

const STORAGE_KEY = 'igolden.auth.profile.v1';

export interface AuthProfileSnapshot {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

function snapshotFromUser(u: User): AuthProfileSnapshot {
  return {
    uid: u.uid,
    email: u.email ?? null,
    displayName: u.displayName ?? null,
    photoURL: u.photoURL ?? null,
  };
}

/** Synchronous read for first paint — Firebase restores session async; this avoids avatar/login flicker on refresh. */
export function readCachedAuthProfile(): AuthProfileSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as AuthProfileSnapshot).uid !== 'string'
    ) {
      return null;
    }
    const p = parsed as AuthProfileSnapshot;
    return {
      uid: p.uid,
      email: typeof p.email === 'string' || p.email === null ? p.email : null,
      displayName: typeof p.displayName === 'string' || p.displayName === null ? p.displayName : null,
      photoURL: typeof p.photoURL === 'string' || p.photoURL === null ? p.photoURL : null,
    };
  } catch {
    return null;
  }
}

export function writeCachedAuthProfile(u: User): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshotFromUser(u)));
  } catch {
    // ignore quota / private mode
  }
}

export function clearCachedAuthProfile(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
