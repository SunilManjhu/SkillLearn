import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  deleteUser,
  reauthenticateWithPopup,
  reauthenticateWithRedirect,
  User,
} from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

/**
 * Tries Google sign-in with a popup; falls back to full-page redirect when popups are blocked
 * or the environment disallows popups (common on some browsers and embedded previews).
 * `onBeforeRedirect` runs only when a full-page redirect is about to happen (e.g. stash UI context in sessionStorage).
 */
export async function signInWithGoogle(onBeforeRedirect?: () => void): Promise<void> {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (e: unknown) {
    const code =
      typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: string }).code) : '';
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment'
    ) {
      onBeforeRedirect?.();
      await signInWithRedirect(auth, googleProvider);
      return;
    }
    throw e;
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

/** True for rules rejections; callers may treat as empty reads instead of logging. */
export function isFirestorePermissionDenied(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'permission-denied'
  );
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // We don't necessarily want to crash the whole app, but we log it as required
}

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

/** Deletes the currently signed-in Firebase Auth user. Google users: re-authenticates in-app when Firebase requires a recent login. */
export async function deleteCurrentUserAccount(): Promise<DeleteAccountResult> {
  const u = auth.currentUser;
  if (!u) {
    return { ok: false, code: 'no-user', message: 'No signed-in user.' };
  }

  const tryDelete = async () => {
    await deleteUser(u);
  };

  try {
    await tryDelete();
    return { ok: true };
  } catch (e: unknown) {
    const code =
      typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: string }).code) : 'unknown';
    if (code !== 'auth/requires-recent-login') {
      const message = e instanceof Error ? e.message : 'Could not delete account.';
      return { ok: false, code, message };
    }

    const isGoogle = u.providerData.some((p) => p.providerId === 'google.com');
    if (!isGoogle) {
      const message = e instanceof Error ? e.message : 'Could not delete account.';
      return { ok: false, code, message };
    }

    try {
      await reauthenticateWithPopup(u, googleProvider);
    } catch (reErr: unknown) {
      const reCode =
        typeof reErr === 'object' && reErr !== null && 'code' in reErr
          ? String((reErr as { code: string }).code)
          : '';
      if (
        reCode === 'auth/popup-blocked' ||
        reCode === 'auth/operation-not-supported-in-this-environment'
      ) {
        await reauthenticateWithRedirect(u, googleProvider);
        return { ok: false, code: 'redirecting', message: '' };
      }
      const message = reErr instanceof Error ? reErr.message : 'Could not verify identity.';
      return { ok: false, code: reCode || 'unknown', message };
    }

    try {
      await tryDelete();
      return { ok: true };
    } catch (e2: unknown) {
      const code2 =
        typeof e2 === 'object' && e2 !== null && 'code' in e2 ? String((e2 as { code: string }).code) : 'unknown';
      const message2 = e2 instanceof Error ? e2.message : 'Could not delete account.';
      return { ok: false, code: code2, message: message2 };
    }
  }
}

export { getRedirectResult, signInWithPopup, signOut, onAuthStateChanged };
export type { User };
