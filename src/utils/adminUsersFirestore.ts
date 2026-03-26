import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { UserRole } from './userProfileFirestore';

export interface AdminUserRow {
  id: string;
  displayName: string;
  email: string;
  role: UserRole;
}

function toAdminUserRow(id: string, data: Record<string, unknown>): AdminUserRow {
  const role = data.role === 'admin' ? 'admin' : 'user';
  const displayName =
    typeof data.displayName === 'string' && data.displayName.trim().length > 0
      ? data.displayName.trim()
      : 'Unnamed user';
  const email = typeof data.email === 'string' ? data.email : '';
  return { id, displayName, email, role };
}

function adminUserRowsFromSnapshot(snap: QuerySnapshot): AdminUserRow[] {
  return snap.docs
    .map((d) => toAdminUserRow(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));
}

/** Live updates when `users` documents are created, updated, or removed. */
export function subscribeUsersForAdmin(
  onRows: (rows: AdminUserRow[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const q = query(collection(db, 'users'));
  return onSnapshot(
    q,
    (snap) => {
      onRows(adminUserRowsFromSnapshot(snap));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
      onError?.(error);
    }
  );
}

export async function listUsersForAdmin(): Promise<AdminUserRow[]> {
  try {
    const snap = await getDocs(query(collection(db, 'users')));
    return adminUserRowsFromSnapshot(snap);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'users');
    return [];
  }
}

export async function updateUserRoleAsAdmin(userId: string, role: UserRole): Promise<boolean> {
  try {
    await updateDoc(doc(db, 'users', userId), { role });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
    return false;
  }
}

export async function upsertUserRoleAsAdmin(userId: string, role: UserRole): Promise<boolean> {
  try {
    await setDoc(
      doc(db, 'users', userId),
      {
        role,
        displayName: '',
        email: '',
      },
      { merge: true }
    );
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
    return false;
  }
}
