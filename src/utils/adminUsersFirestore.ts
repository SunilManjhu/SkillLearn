import { collection, doc, getDocs, query, setDoc, updateDoc } from 'firebase/firestore';
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

export async function listUsersForAdmin(): Promise<AdminUserRow[]> {
  try {
    const snap = await getDocs(query(collection(db, 'users')));
    return snap.docs
      .map((d) => toAdminUserRow(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));
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
