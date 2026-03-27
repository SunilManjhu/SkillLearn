import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, ShieldCheck, Users, UserCircle } from 'lucide-react';
import { subscribeUsersForAdmin, updateUserRoleAsAdmin, type AdminUserRow } from '../../utils/adminUsersFirestore';
import { countFirestoreAdminUsers, type UserRole } from '../../utils/userProfileFirestore';
import { useAdminActionToast } from './useAdminActionToast';

interface AdminUserRolesSectionProps {
  currentAdminUid?: string;
}

export const AdminUserRolesSection: React.FC<AdminUserRolesSectionProps> = ({ currentAdminUid }) => {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  /** Bumping this re-attaches the Firestore listener (used for Refresh / Retry after errors). */
  const [subscriptionKey, setSubscriptionKey] = useState(0);
  const { showActionToast, actionToast } = useAdminActionToast();
  const [search, setSearch] = useState('');
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setListError(null);
    const unsub = subscribeUsersForAdmin(
      (next) => {
        setRows(next);
        setLoading(false);
        setListError(null);
      },
      () => {
        setLoading(false);
        setListError('Could not load users. Check your connection and Firestore permissions.');
      }
    );
    return () => unsub();
  }, [subscriptionKey]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.displayName, r.email, r.id, r.role].some((part) => part.toLowerCase().includes(q))
    );
  }, [rows, search]);

  const roleStats = useMemo(() => {
    let admins = 0;
    let users = 0;
    for (const r of rows) {
      if (r.role === 'admin') admins += 1;
      else users += 1;
    }
    return { total: rows.length, admins, users };
  }, [rows]);

  const soleAdminSelfDemoteMsg =
    "You're the only admin. Promote another account to admin first, then you can set your role to user.";

  const handleRoleChange = async (userId: string, nextRole: UserRole) => {
    const current = rows.find((r) => r.id === userId);
    if (!current || current.role === nextRole) return;

    if (currentAdminUid && currentAdminUid === userId && nextRole !== 'admin') {
      const n = await countFirestoreAdminUsers();
      if (n < 0) {
        showActionToast('Could not verify admin count. Refresh the list and try again.', 'danger');
        return;
      }
      if (n < 2) {
        showActionToast(soleAdminSelfDemoteMsg, 'danger');
        return;
      }
    }

    setSavingUserId(userId);
    const ok = await updateUserRoleAsAdmin(userId, nextRole);
    if (!ok) {
      showActionToast('Role update failed. Check rules and console logs.', 'danger');
      setSavingUserId(null);
      return;
    }
    showActionToast('Role updated successfully.');
    setSavingUserId(null);
  };

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <ShieldCheck size={20} className="text-orange-500" />
          User roles
        </h2>
        <button
          type="button"
          onClick={() => setSubscriptionKey((k) => k + 1)}
          disabled={loading}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs font-semibold hover:bg-[var(--hover-bg)] disabled:opacity-50"
          title="Re-attach the live listener"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Update any user to <code className="text-orange-500/90">admin</code> or{' '}
        <code className="text-orange-500/90">user</code> from this panel. Counts reflect documents in
        the <code className="text-orange-500/80">users</code> collection and update live when profiles
        are added or removed.
      </p>
      {listError && (
        <p className="text-sm text-red-500" role="alert">
          {listError}{' '}
          <button
            type="button"
            onClick={() => setSubscriptionKey((k) => k + 1)}
            className="font-semibold underline underline-offset-2 hover:text-red-400"
          >
            Retry
          </button>
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 px-4 py-3.5">
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <UserCircle size={18} className="shrink-0 text-[var(--text-secondary)]" aria-hidden />
            <span className="text-[11px] font-semibold uppercase tracking-wide">Total profiles</span>
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums text-[var(--text-primary)]">
            {loading ? '—' : roleStats.total}
          </p>
        </div>
        <div className="rounded-xl border border-orange-500/25 bg-orange-500/[0.07] px-4 py-3.5">
          <div className="flex items-center gap-2 text-orange-500/90">
            <ShieldCheck size={18} className="shrink-0" aria-hidden />
            <span className="text-[11px] font-semibold uppercase tracking-wide">Admins</span>
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums text-orange-500">
            {loading ? '—' : roleStats.admins}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 px-4 py-3.5">
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <Users size={18} className="shrink-0 text-[var(--text-secondary)]" aria-hidden />
            <span className="text-[11px] font-semibold uppercase tracking-wide">Users</span>
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums text-[var(--text-primary)]">
            {loading ? '—' : roleStats.users}
          </p>
        </div>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name, email, role, or UID"
        className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
      />

      <div className="space-y-3 md:hidden">
        {filteredRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            {loading ? 'Loading users…' : 'No users found.'}
          </p>
        ) : (
          filteredRows.map((row) => {
            const saving = savingUserId === row.id;
            return (
              <div
                key={row.id}
                className="space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/60 p-4"
              >
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Name</p>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{row.displayName}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Email</p>
                  <p className="break-words text-sm text-[var(--text-secondary)]">{row.email || '—'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">UID</p>
                  <code className="break-all text-xs text-[var(--text-muted)]">{row.id}</code>
                </div>
                <div className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Role</span>
                  <select
                    value={row.role}
                    disabled={saving}
                    onChange={(e) => void handleRoleChange(row.id, e.target.value as UserRole)}
                    className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm disabled:opacity-60"
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="hidden max-h-[min(30rem,58vh)] overflow-auto rounded-xl border border-[var(--border-color)] md:block">
        <table className="w-full text-sm">
          <thead className="bg-[var(--bg-primary)] text-[var(--text-secondary)]">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Name</th>
              <th className="px-3 py-2 text-left font-semibold">Email</th>
              <th className="px-3 py-2 text-left font-semibold">UID</th>
              <th className="px-3 py-2 text-left font-semibold">Role</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-[var(--text-muted)]">
                  {loading ? 'Loading users...' : 'No users found.'}
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const saving = savingUserId === row.id;
                return (
                  <tr key={row.id} className="border-t border-[var(--border-color)]">
                    <td className="px-3 py-2 text-[var(--text-primary)]">{row.displayName}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">{row.email || '—'}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">
                      <code className="text-xs">{row.id}</code>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={row.role}
                        disabled={saving}
                        onChange={(e) => void handleRoleChange(row.id, e.target.value as UserRole)}
                        className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm disabled:opacity-60"
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {actionToast}
    </div>
  );
};
