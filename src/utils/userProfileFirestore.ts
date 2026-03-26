import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  where,
  type DocumentSnapshot,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../firebase';

export type UserRole = 'user' | 'admin';

/**
 * Creates or updates `users/{uid}` without overwriting an existing admin role on merge.
 */
export async function ensureUserProfile(user: User): Promise<void> {
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    const displayName = user.displayName ?? '';
    const email = user.email ?? '';
    if (!snap.exists()) {
      await setDoc(ref, {
        role: 'user' as UserRole,
        displayName,
        email,
      });
      return;
    }
    await setDoc(
      ref,
      {
        displayName,
        email,
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
  }
}

/** Derive role from a `users/{uid}` document snapshot (same rules as `fetchUserRole`). */
export function parseUserRoleFromUserDoc(snap: DocumentSnapshot): UserRole {
  if (!snap.exists()) return 'user';
  const r = snap.data().role;
  return r === 'admin' ? 'admin' : 'user';
}

export async function fetchUserRole(uid: string): Promise<UserRole> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return parseUserRoleFromUserDoc(snap);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${uid}`);
    return 'user';
  }
}

/**
 * Live updates when `users/{uid}.role` changes (e.g. another admin demotes this session).
 * On listener error, invokes `onError` after logging; caller should treat role as non-admin.
 */
export function subscribeUserRole(
  uid: string,
  onRole: (role: UserRole) => void,
  onError?: (error: unknown) => void
): () => void {
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      onRole(parseUserRoleFromUserDoc(snap));
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${uid}`);
      onError?.(error);
    }
  );
}

/** Count of `users` docs with `role == 'admin'`. Returns `-1` if the query fails. */
export async function countFirestoreAdminUsers(): Promise<number> {
  try {
    const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'admin')));
    return snap.size;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'users');
    return -1;
  }
}
