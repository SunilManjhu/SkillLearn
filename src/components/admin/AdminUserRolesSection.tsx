import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import {
  listUsersForAdmin,
  updateUserRoleAsAdmin,
  upsertUserRoleAsAdmin,
  type AdminUserRow,
} from '../../utils/adminUsersFirestore';
import type { UserRole } from '../../utils/userProfileFirestore';

interface AdminUserRolesSectionProps {
  currentAdminUid?: string;
}

export const AdminUserRolesSection: React.FC<AdminUserRolesSectionProps> = ({ currentAdminUid }) => {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [manualUid, setManualUid] = useState('');
  const [manualRole, setManualRole] = useState<UserRole>('user');

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

  const handleRoleChange = async (userId: string, nextRole: UserRole) => {
    const current = rows.find((r) => r.id === userId);
    if (!current || current.role === nextRole) return;

    if (currentAdminUid && currentAdminUid === userId && nextRole !== 'admin') {
      setMessage('You cannot remove your own admin role.');
      return;
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

  const handleManualUpdate = async () => {
    const uid = manualUid.trim();
    if (!uid) {
      setMessage('Enter a UID first.');
      return;
    }
    if (currentAdminUid && uid === currentAdminUid && manualRole !== 'admin') {
      setMessage('You cannot remove your own admin role.');
      return;
    }
    setSavingUserId(uid);
    setMessage(null);
    const ok = await upsertUserRoleAsAdmin(uid, manualRole);
    if (!ok) {
      setMessage('Could not update role for that UID.');
      setSavingUserId(null);
      return;
    }
    setMessage('Role updated for UID.');
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === uid);
      if (idx === -1) {
        return [
          { id: uid, displayName: 'Unnamed user', email: '', role: manualRole },
          ...prev,
        ];
      }
      return prev.map((r) => (r.id === uid ? { ...r, role: manualRole } : r));
    });
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
        <code className="text-orange-500/90">user</code> from this panel.
      </p>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name, email, role, or UID"
        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
      />

      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 space-y-2">
        <p className="text-xs text-[var(--text-muted)]">
          Missing someone? Set role directly by UID.
        </p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto]">
          <input
            type="text"
            value={manualUid}
            onChange={(e) => setManualUid(e.target.value)}
            placeholder="User UID"
            className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
          />
          <select
            value={manualRole}
            onChange={(e) => setManualRole(e.target.value as UserRole)}
            className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          <button
            type="button"
            disabled={savingUserId === manualUid.trim() && manualUid.trim().length > 0}
            onClick={() => void handleManualUpdate()}
            className="rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
          >
            Update UID
          </button>
        </div>
      </div>

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
