import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ShieldCheck, Users, UserCircle } from 'lucide-react';
import {
  listUsersForAdmin,
  updateUserRoleAsAdmin,
  type AdminUserRow,
} from '../../utils/adminUsersFirestore';
import { countFirestoreAdminUsers, type UserRole } from '../../utils/userProfileFirestore';

interface AdminUserRolesSectionProps {
  currentAdminUid?: string;
}

export const AdminUserRolesSection: React.FC<AdminUserRolesSectionProps> = ({ currentAdminUid }) => {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    const next = await listUsersForAdmin();
    setRows(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
        setMessage('Could not verify admin count. Refresh the list and try again.');
        return;
      }
      if (n < 2) {
        setMessage(soleAdminSelfDemoteMsg);
        return;
      }
    }

    setSavingUserId(userId);
    setMessage(null);
    const ok = await updateUserRoleAsAdmin(userId, nextRole);
    if (!ok) {
      setMessage('Role update failed. Check rules and console logs.');
      setSavingUserId(null);
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === userId ? { ...r, role: nextRole } : r)));
    setMessage('Role updated successfully.');
    setSavingUserId(null);
  };

  return (
    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <ShieldCheck size={20} className="text-orange-500" />
          User roles
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--hover-bg)] disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Update any user to <code className="text-orange-500/90">admin</code> or{' '}
        <code className="text-orange-500/90">user</code> from this panel. Counts reflect documents in
        the <code className="text-orange-500/80">users</code> collection.
      </p>

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
        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
      />

      {message && <p className="text-xs text-[var(--text-secondary)]">{message}</p>}

      <div className="max-h-[min(30rem,58vh)] overflow-auto rounded-xl border border-[var(--border-color)]">
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
    </div>
  );
};
