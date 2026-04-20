import React, { useEffect, useMemo, useState } from 'react';
import { Copy, RefreshCw, ShieldCheck } from 'lucide-react';
import { subscribeUsersForAdmin, updateUserRoleAsAdmin, type AdminUserRow } from '../../utils/adminUsersFirestore';
import { countFirestoreAdminUsers, type UserRole } from '../../utils/userProfileFirestore';
import { useAdminActionToast } from './useAdminActionToast';
import { AdminLabelInfoTip } from './adminLabelInfoTip';

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
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'creator' | 'user'>('all');
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
    let list = rows;
    if (roleFilter === 'admin') list = list.filter((r) => r.role === 'admin');
    else if (roleFilter === 'creator') list = list.filter((r) => r.role === 'creator');
    else if (roleFilter === 'user') list = list.filter((r) => r.role === 'user');
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) =>
      [r.displayName, r.email, r.id, r.role].some((part) => part.toLowerCase().includes(q))
    );
  }, [rows, search, roleFilter]);

  const copyUid = async (uid: string) => {
    try {
      await navigator.clipboard.writeText(uid);
      showActionToast('UID copied to clipboard.');
    } catch {
      showActionToast('Could not copy UID.', 'danger');
    }
  };

  const roleStats = useMemo(() => {
    let admins = 0;
    let creators = 0;
    let users = 0;
    for (const r of rows) {
      if (r.role === 'admin') admins += 1;
      else if (r.role === 'creator') creators += 1;
      else users += 1;
    }
    return { total: rows.length, admins, creators, users };
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
    <div className="min-w-0 space-y-6 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 sm:p-6">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 pr-1">
          <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            <h2 className="m-0 flex items-center gap-1.5 text-base font-bold leading-none sm:text-lg">
              <ShieldCheck size={18} className="shrink-0 text-admin-icon" aria-hidden />
              Roles
            </h2>
            <AdminLabelInfoTip
              controlOnly
              tipId="admin-tip-user-roles"
              tipRegionAriaLabel="User roles tips"
              tipSubject="Roles"
            >
              <li>
                <code className="font-mono text-[0.7rem] text-[#616161] app-dark:text-[var(--tone-200)] sm:text-xs">users</code> docs: role{' '}
                <code className="text-[#616161] app-dark:text-[var(--tone-200)]">admin</code>, <code className="text-[#616161] app-dark:text-[var(--tone-200)]">creator</code>, or{' '}
                <code className="text-[#616161] app-dark:text-[var(--tone-200)]">user</code>.
              </li>
              <li>Live updates.</li>
              <li>Keep at least one admin.</li>
            </AdminLabelInfoTip>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSubscriptionKey((k) => k + 1)}
          disabled={loading}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] hover:bg-[var(--hover-bg)] disabled:opacity-50"
          title="Refresh list"
          aria-label="Refresh user list"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden />
        </button>
      </div>
      {listError && (
        <p className="text-sm text-[#616161]" role="alert">
          {listError}{' '}
          <button
            type="button"
            onClick={() => setSubscriptionKey((k) => k + 1)}
            className="font-semibold underline underline-offset-2 hover:text-[#a1a2a2]"
          >
            Retry
          </button>
        </p>
      )}

      <div
        className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-[var(--border-color)] pb-2 text-[11px] sm:text-xs"
        aria-live="polite"
      >
        <span className="text-[var(--text-muted)]">
          Total{' '}
          <strong className="tabular-nums text-[var(--text-primary)]">{loading ? '—' : roleStats.total}</strong>
        </span>
        <span className="text-[var(--border-color)]" aria-hidden>
          ·
        </span>
        <span className="text-[var(--text-muted)]">
          Admins{' '}
          <strong className="tabular-nums text-[#616161] app-dark:text-[var(--tone-100)]">{loading ? '—' : roleStats.admins}</strong>
        </span>
        <span className="text-[var(--border-color)]" aria-hidden>
          ·
        </span>
        <span className="text-[var(--text-muted)]">
          Creators{' '}
          <strong className="tabular-nums text-[var(--text-primary)]">{loading ? '—' : roleStats.creators}</strong>
        </span>
        <span className="text-[var(--border-color)]" aria-hidden>
          ·
        </span>
        <span className="text-[var(--text-muted)]">
          Learners{' '}
          <strong className="tabular-nums text-[var(--text-primary)]">{loading ? '—' : roleStats.users}</strong>
        </span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex shrink-0 flex-wrap gap-2" role="group" aria-label="Filter by role type">
          {(
            [
              { id: 'all' as const, label: 'All accounts' },
              { id: 'admin' as const, label: 'Admins' },
              { id: 'creator' as const, label: 'Creators' },
              { id: 'user' as const, label: 'Learners' },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setRoleFilter(id)}
              className={`min-h-9 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors sm:min-h-10 sm:px-3 sm:py-2 ${
                roleFilter === id
                  ? 'border-[#8b8c8c] bg-[#616161]/15 text-[#616161] app-dark:border-[var(--tone-400)] app-dark:bg-[var(--tone-800)] app-dark:text-[var(--tone-100)]'
                  : 'border-[var(--border-color)] bg-[var(--bg-primary)]/60 text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, role, or UID"
          autoComplete="off"
          className="min-h-10 w-full flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-base sm:text-sm"
        />
      </div>

      <div className="space-y-3 md:hidden">
        {filteredRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            {loading
              ? 'Loading users…'
              : rows.length === 0
                ? 'No user profiles yet.'
                : 'No users match this filter.'}
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
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">UID</p>
                    <code className="break-all text-xs text-[var(--text-muted)]">{row.id}</code>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyUid(row.id)}
                    className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
                  >
                    <Copy size={14} aria-hidden />
                    Copy
                  </button>
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
                    <option value="creator">creator</option>
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
          <thead className="sticky top-0 z-[1] bg-[var(--bg-primary)] text-[var(--text-secondary)] shadow-[0_1px_0_0_var(--border-color)]">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Name</th>
              <th className="px-3 py-2 text-left font-semibold">Email</th>
              <th className="px-3 py-2 text-left font-semibold">UID</th>
              <th className="w-[1%] whitespace-nowrap px-3 py-2 text-left font-semibold"> </th>
              <th className="px-3 py-2 text-left font-semibold">Role</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-[var(--text-muted)]">
                  {loading
                    ? 'Loading users…'
                    : rows.length === 0
                      ? 'No user profiles yet.'
                      : 'No users match this filter.'}
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const saving = savingUserId === row.id;
                return (
                  <tr key={row.id} className="border-t border-[var(--border-color)]">
                    <td className="px-3 py-2 text-[var(--text-primary)]">{row.displayName}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">{row.email || '—'}</td>
                    <td className="max-w-[12rem] px-3 py-2 text-[var(--text-muted)]">
                      <code className="block truncate text-xs" title={row.id}>
                        {row.id}
                      </code>
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => void copyUid(row.id)}
                        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
                        title="Copy UID"
                        aria-label={`Copy UID for ${row.displayName}`}
                      >
                        <Copy size={16} aria-hidden />
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={row.role}
                        disabled={saving}
                        onChange={(e) => void handleRoleChange(row.id, e.target.value as UserRole)}
                        className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm disabled:opacity-60"
                      >
                        <option value="user">user</option>
                        <option value="creator">creator</option>
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
