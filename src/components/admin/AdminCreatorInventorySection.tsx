import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Library, Route, RefreshCw } from 'lucide-react';
import { subscribeUsersForAdmin, type AdminUserRow } from '../../utils/adminUsersFirestore';
import { listCreatorCoursesForAdminByOwner } from '../../utils/creatorCoursesFirestore';
import { listCreatorLearningPathsForAdminByOwner } from '../../utils/creatorLearningPathsFirestore';
import { useAdminActionToast } from './useAdminActionToast';

/** Admin read-only inventory of `creatorCourses` + `creatorLearningPaths` per creator UID. */
export const AdminCreatorInventorySection: React.FC = () => {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [subscriptionKey, setSubscriptionKey] = useState(0);
  const [selectedUid, setSelectedUid] = useState<string>('');
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [pathsLoading, setPathsLoading] = useState(false);
  const [courseRows, setCourseRows] = useState<{ id: string; title: string }[]>([]);
  const [pathRows, setPathRows] = useState<{ id: string; title: string }[]>([]);
  const { showActionToast, actionToast } = useAdminActionToast();

  const creators = useMemo(() => rows.filter((r) => r.role === 'creator'), [rows]);

  useEffect(() => {
    setLoadingUsers(true);
    setListError(null);
    const unsub = subscribeUsersForAdmin(
      (next) => {
        setRows(next);
        setLoadingUsers(false);
        setListError(null);
      },
      () => {
        setLoadingUsers(false);
        setListError('Could not load users. Check your connection and Firestore permissions.');
      }
    );
    return () => unsub();
  }, [subscriptionKey]);

  useEffect(() => {
    if (creators.length === 0) {
      setSelectedUid('');
      return;
    }
    setSelectedUid((prev) => (prev && creators.some((c) => c.id === prev) ? prev : creators[0]!.id));
  }, [creators]);

  const loadInventory = useCallback(
    async (uid: string) => {
      if (!uid) {
        setCourseRows([]);
        setPathRows([]);
        return;
      }
      setCoursesLoading(true);
      setPathsLoading(true);
      try {
        const [courses, paths] = await Promise.all([
          listCreatorCoursesForAdminByOwner(uid),
          listCreatorLearningPathsForAdminByOwner(uid),
        ]);
        setCourseRows(courses.map((c) => ({ id: c.id, title: c.title })));
        setPathRows(paths.map((p) => ({ id: p.id, title: p.title })));
      } catch {
        showActionToast('Failed to load creator inventory.', 'danger');
        setCourseRows([]);
        setPathRows([]);
      } finally {
        setCoursesLoading(false);
        setPathsLoading(false);
      }
    },
    [showActionToast]
  );

  useEffect(() => {
    void loadInventory(selectedUid);
  }, [selectedUid, loadInventory]);

  const selectedCreator = creators.find((c) => c.id === selectedUid);

  return (
    <div className="min-w-0 space-y-6 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            <h2 className="m-0 flex items-center gap-2 text-lg font-bold leading-none">
              <Library size={20} className="shrink-0 text-orange-500" aria-hidden />
              Creator content
            </h2>
          </div>
          <p className="mt-1 max-w-xl text-xs text-[var(--text-muted)] sm:text-sm">
            Read-only list of private courses and paths stored under{' '}
            <code className="text-orange-500/90">creatorCourses</code> and{' '}
            <code className="text-orange-500/90">creatorLearningPaths</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSubscriptionKey((k) => k + 1)}
          disabled={loadingUsers}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] hover:bg-[var(--hover-bg)] disabled:opacity-50"
          title="Refresh user list"
          aria-label="Refresh user list"
        >
          <RefreshCw size={16} className={loadingUsers ? 'animate-spin' : ''} aria-hidden />
        </button>
      </div>

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

      {loadingUsers ? (
        <p className="text-sm text-[var(--text-muted)]">Loading accounts…</p>
      ) : creators.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          No accounts with role <code className="text-orange-500/90">creator</code> yet. Assign the role in
          Roles.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="admin-creator-inventory-select" className="text-xs font-semibold text-[var(--text-secondary)]">
              Creator account
            </label>
            <select
              id="admin-creator-inventory-select"
              value={selectedUid}
              onChange={(e) => setSelectedUid(e.target.value)}
              className="box-border min-h-11 w-full max-w-md rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              {creators.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName} ({c.email || c.id})
                </option>
              ))}
            </select>
            {selectedCreator && (
              <p className="text-[11px] text-[var(--text-muted)]">
                UID: <code className="break-all">{selectedCreator.id}</code>
              </p>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
                <BookOpen className="shrink-0 text-orange-500" size={16} aria-hidden />
                Private courses ({coursesLoading ? '…' : courseRows.length})
              </h3>
              {coursesLoading ? (
                <p className="text-xs text-[var(--text-muted)]">Loading…</p>
              ) : courseRows.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">No creator courses for this account.</p>
              ) : (
                <ul className="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2 text-sm">
                  {courseRows.map((r) => (
                    <li key={r.id} className="truncate border-b border-[var(--border-color)] py-1.5 last:border-0">
                      <span className="font-medium text-[var(--text-primary)]">{r.title}</span>{' '}
                      <code className="text-xs text-[var(--text-muted)]">{r.id}</code>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="min-w-0 space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
                <Route className="shrink-0 text-orange-500" size={16} aria-hidden />
                Private paths ({pathsLoading ? '…' : pathRows.length})
              </h3>
              {pathsLoading ? (
                <p className="text-xs text-[var(--text-muted)]">Loading…</p>
              ) : pathRows.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">No creator paths for this account.</p>
              ) : (
                <ul className="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2 text-sm">
                  {pathRows.map((r) => (
                    <li key={r.id} className="truncate border-b border-[var(--border-color)] py-1.5 last:border-0">
                      <span className="font-medium text-[var(--text-primary)]">{r.title}</span>{' '}
                      <code className="text-xs text-[var(--text-muted)]">{r.id}</code>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
      {actionToast}
    </div>
  );
};