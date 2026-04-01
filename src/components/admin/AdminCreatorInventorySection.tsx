import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Library, Route, RefreshCw } from 'lucide-react';
import type { Course } from '../../data/courses';
import type { LearningPath } from '../../data/learningPaths';
import { subscribeUsersForAdmin, type AdminUserRow } from '../../utils/adminUsersFirestore';
import { listCreatorCoursesForAdminByOwner } from '../../utils/creatorCoursesFirestore';
import { listCreatorLearningPathsForAdminByOwner } from '../../utils/creatorLearningPathsFirestore';
import { useAdminActionToast } from './useAdminActionToast';

export type AdminCreatorInventorySectionProps = {
  /** Open a creator’s private course in the learner course overview (admin can start the player from there). */
  onPreviewCreatorCourse?: (ownerUid: string, course: Course) => void;
  /** Open a creator’s private path in Browse Catalog (path outline + courses as learners would see). */
  onPreviewCreatorPath?: (ownerUid: string, path: LearningPath) => void;
};

/** Admin read-only inventory of `creatorCourses` + `creatorLearningPaths` per creator UID. */
export const AdminCreatorInventorySection: React.FC<AdminCreatorInventorySectionProps> = ({
  onPreviewCreatorCourse,
  onPreviewCreatorPath,
}) => {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [subscriptionKey, setSubscriptionKey] = useState(0);
  const [selectedUid, setSelectedUid] = useState<string>('');
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [pathsLoading, setPathsLoading] = useState(false);
  const [creatorCoursesList, setCreatorCoursesList] = useState<Course[]>([]);
  const [creatorPathsList, setCreatorPathsList] = useState<LearningPath[]>([]);
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
        setCreatorCoursesList([]);
        setCreatorPathsList([]);
        return;
      }
      setCoursesLoading(true);
      setPathsLoading(true);
      try {
        const [courses, paths] = await Promise.all([
          listCreatorCoursesForAdminByOwner(uid),
          listCreatorLearningPathsForAdminByOwner(uid),
        ]);
        setCreatorCoursesList(courses);
        setCreatorPathsList(paths);
      } catch {
        showActionToast('Failed to load creator inventory.', 'danger');
        setCreatorCoursesList([]);
        setCreatorPathsList([]);
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
            <code className="text-orange-500/90">creatorLearningPaths</code>. Use{' '}
            <strong className="text-[var(--text-secondary)]">Open overview</strong> for a course or{' '}
            <strong className="text-[var(--text-secondary)]">Open in catalog</strong> for a path to view them in the
            learner experience.
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
                Private courses ({coursesLoading ? '…' : creatorCoursesList.length})
              </h3>
              {coursesLoading ? (
                <p className="text-xs text-[var(--text-muted)]">Loading…</p>
              ) : creatorCoursesList.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">No creator courses for this account.</p>
              ) : (
                <ul className="max-h-72 space-y-0 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2 text-sm [scrollbar-width:thin] [scrollbar-color:var(--border-light)_var(--bg-secondary)] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-[var(--bg-secondary)] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--border-light)]">
                  {creatorCoursesList.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-col gap-2 border-b border-[var(--border-color)] py-2.5 last:border-0 sm:flex-row sm:items-center sm:gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-[var(--text-primary)]">{c.title}</div>
                        <code className="break-all text-[11px] text-[var(--text-muted)]">{c.id}</code>
                      </div>
                      {onPreviewCreatorCourse && selectedUid ? (
                        <button
                          type="button"
                          onClick={() => onPreviewCreatorCourse(selectedUid, c)}
                          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:border-orange-500/40 hover:text-orange-500 sm:w-auto sm:min-w-[7.5rem]"
                          aria-label={`Open ${c.title} overview`}
                        >
                          <BookOpen size={14} aria-hidden />
                          Open overview
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="min-w-0 space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
                <Route className="shrink-0 text-orange-500" size={16} aria-hidden />
                Private paths ({pathsLoading ? '…' : creatorPathsList.length})
              </h3>
              {pathsLoading ? (
                <p className="text-xs text-[var(--text-muted)]">Loading…</p>
              ) : creatorPathsList.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">No creator paths for this account.</p>
              ) : (
                <ul className="max-h-72 space-y-0 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2 text-sm [scrollbar-width:thin] [scrollbar-color:var(--border-light)_var(--bg-secondary)] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-[var(--bg-secondary)] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--border-light)]">
                  {creatorPathsList.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-col gap-2 border-b border-[var(--border-color)] py-2.5 last:border-0 sm:flex-row sm:items-center sm:gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-[var(--text-primary)]">{p.title}</div>
                        <code className="break-all text-[11px] text-[var(--text-muted)]">{p.id}</code>
                      </div>
                      {onPreviewCreatorPath && selectedUid ? (
                        <button
                          type="button"
                          onClick={() => onPreviewCreatorPath(selectedUid, p)}
                          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:border-orange-500/40 hover:text-orange-500 sm:w-auto sm:min-w-[7.5rem]"
                          aria-label={`Open ${p.title} in catalog`}
                        >
                          <Route size={14} aria-hidden />
                          Open in catalog
                        </button>
                      ) : null}
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
