import type { AdminUserRow } from './adminUsersFirestore';

/** Label for who owns a creator-studio catalog row (admin browse only). */
export function formatAdminStudioOwnerAttribution(
  ownerUid: string,
  viewerUid: string | null | undefined,
  directory: AdminUserRow[] | null | undefined
): string {
  const uid = ownerUid.trim();
  if (!uid) return 'Unknown';
  if (viewerUid && uid === viewerUid) return 'You';
  const row = directory?.find((r) => r.id === uid);
  if (!row) return uid;
  return row.email ? `${row.displayName} (${row.email})` : row.displayName;
}
