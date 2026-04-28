import type { UserRole } from './userProfileFirestore';

const KEY = (uid: string) => `skilllearn:userRoleCache:v1:${uid}`;

function isUserRole(v: unknown): v is UserRole {
  return v === 'learner' || v === 'admin' || v === 'creator';
}

/** Last known Firestore role for this uid — used for first-paint shell visibility before `subscribeUserRole` fires. */
export function readCachedUserRole(uid: string): UserRole | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isUserRole(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCachedUserRole(uid: string, role: UserRole): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY(uid), JSON.stringify(role));
  } catch {
    // ignore quota / private mode
  }
}

export function clearCachedUserRole(uid: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY(uid));
  } catch {
    // ignore
  }
}
