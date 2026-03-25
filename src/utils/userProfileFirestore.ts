import { doc, getDoc, setDoc } from 'firebase/firestore';
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

export async function fetchUserRole(uid: string): Promise<UserRole> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return 'user';
    const r = snap.data().role;
    return r === 'admin' ? 'admin' : 'user';
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${uid}`);
    return 'user';
  }
}
