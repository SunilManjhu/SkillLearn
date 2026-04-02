import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ChevronDown, Library, Route, RefreshCw } from 'lucide-react';
import type { Course } from '../../data/courses';
import type { LearningPath } from '../../data/learningPaths';
import { subscribeUsersForAdmin, type AdminUserRow } from '../../utils/adminUsersFirestore';
import { listCreatorCoursesForAdminByOwner } from '../../utils/creatorCoursesFirestore';
import { listCreatorLearningPathsForAdminByOwner } from '../../utils/creatorLearningPathsFirestore';
import { useAdminActionToast } from './useAdminActionToast';

const ALL_CREATORS_KEY = '__ALL__';

type CourseRow = { course: Course; ownerUid: string };
type PathRow = { path: LearningPath; ownerUid: string };

export type AdminCreatorInventorySectionProps = {
  /** Open a creator’s private course in the learner course overview (admin can start the player from there). */
  onPreviewCreatorCourse?: (ownerUid: string, course: Course) => void;
  /** Open a creator’s private path in Browse Catalog (path outline + courses as learners would see). */
  onPreviewCreatorPath?: (ownerUid: string, path: LearningPath) => void;
};

function creatorLabel(c: AdminUserRow): string {
  return `${c.displayName} (${c.email || c.id})`;
}

function optionMatches(query: string, primary: string, secondary: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return primary.toLowerCase().includes(q) || secondary.toLowerCase().includes(q);
}

/** Muted suffix after `filterQuery` when exactly one listbox row remains (inline “autofill”). */
function getInlineCompletionSuffix(
  rawQuery: string,
  opt: { primary: string; secondary: string }
): string | null {
  const qt = rawQuery;
  if (!qt) return null;

  let i = 0;
  while (i < qt.length && i < opt.primary.length && qt[i]!.toLowerCase() === opt.primary[i]!.toLowerCase()) {
    i++;
  }
  if (i === qt.length) {
    const rest = opt.primary.slice(qt.length);
    if (rest.length > 0) return rest;
    if (opt.secondary) return ` (${opt.secondary})`;
    return null;
  }

  i = 0;
  while (i < qt.length && i < opt.secondary.length && qt[i]!.toLowerCase() === opt.secondary[i]!.toLowerCase()) {
    i++;
  }
  if (i === qt.length) {
    const rest = opt.secondary.slice(qt.length);
    if (rest.length > 0) return rest;
    return null;
  }

  return ` → ${opt.primary}${opt.secondary ? ` (${opt.secondary})` : ''}`;
}

/** Full text to commit into the combobox when accepting the unique match (Tab). */
function fullInputLabelForOption(opt: { key: string; primary: string; secondary: string }): string {
  if (opt.key === '') return opt.primary;
  if (opt.key === ALL_CREATORS_KEY) return opt.primary;
  return opt.secondary ? `${opt.primary} (${opt.secondary})` : opt.primary;
}

/** Match filter against primary/secondary or the same full string we commit on Tab (`fullInputLabelForOption`). */
function rowMatchesFilter(query: string, opt: { key: string; primary: string; secondary: string }): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (optionMatches(query, opt.primary, opt.secondary)) return true;
  const full = fullInputLabelForOption(opt).toLowerCase();
  return full.includes(q);
}

/** Admin read-only inventory of `creatorCourses` + `creatorLearningPaths` per creator UID. */
export const AdminCreatorInventorySection: React.FC<AdminCreatorInventorySectionProps> = ({
  onPreviewCreatorCourse,
  onPreviewCreatorPath,
}) => {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [subscriptionKey, setSubscriptionKey] = useState(0);
  /** Empty = none; ALL_CREATORS_KEY = aggregate; else creator uid */
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  /** Keyboard highlight in the list (`null` = typing mode on input). */
  const [activeListIndex, setActiveListIndex] = useState<number | null>(null);
  const activeListIndexRef = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    activeListIndexRef.current = activeListIndex;
  }, [activeListIndex]);

  const [coursesLoading, setCoursesLoading] = useState(false);
  const [pathsLoading, setPathsLoading] = useState(false);
  const [courseRows, setCourseRows] = useState<CourseRow[]>([]);
  const [pathRows, setPathRows] = useState<PathRow[]>([]);
  const { showActionToast, actionToast } = useAdminActionToast();

  const creators = useMemo(() => rows.filter((r) => r.role === 'creator'), [rows]);

  const selectedCreator = creators.find((c) => c.id === selectedKey);
  const selectedInputDisplay = useMemo(() => {
    if (!selectedKey) return '';
    if (selectedKey === ALL_CREATORS_KEY) return 'All creators';
    return selectedCreator ? creatorLabel(selectedCreator) : '';
  }, [selectedKey, selectedCreator]);

  const listboxOptions = useMemo(() => {
    const q = filterQuery;
    const out: { key: string; primary: string; secondary: string }[] = [];
    const clearOpt = { key: '', primary: 'Select a creator…', secondary: 'Clear selection' };
    if (rowMatchesFilter(q, clearOpt)) {
      out.push(clearOpt);
    }
    const allOpt = {
      key: ALL_CREATORS_KEY,
      primary: 'All creators',
      secondary: 'Load courses and paths for every creator',
    };
    if (rowMatchesFilter(q, allOpt)) {
      out.push(allOpt);
    }
    for (const c of creators) {
      const primary = c.displayName;
      const secondary = c.email || c.id;
      const row = { key: c.id, primary, secondary };
      if (rowMatchesFilter(q, row)) {
        out.push(row);
      }
    }
    return out;
  }, [creators, filterQuery]);

  const uniqueInlineSuffix = useMemo(() => {
    if (!menuOpen || listboxOptions.length !== 1) return null;
    return getInlineCompletionSuffix(filterQuery, listboxOptions[0]!);
  }, [menuOpen, listboxOptions, filterQuery]);

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
      setSelectedKey('');
      return;
    }
    setSelectedKey((prev) => {
      if (prev === ALL_CREATORS_KEY) return ALL_CREATORS_KEY;
      if (prev && creators.some((c) => c.id === prev)) return prev;
      return '';
    });
  }, [creators]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setActiveListIndex(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  useEffect(() => {
    if (activeListIndex === null || !menuOpen) return;
    const el = document.getElementById(`admin-creator-opt-${activeListIndex}`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeListIndex, menuOpen]);

  useEffect(() => {
    if (activeListIndex === null) return;
    if (listboxOptions.length === 0) {
      setActiveListIndex(null);
      return;
    }
    setActiveListIndex((i) => (i === null ? null : Math.min(i, listboxOptions.length - 1)));
  }, [filterQuery, listboxOptions.length]);

  const loadInventory = useCallback(
    async (key: string, creatorList: AdminUserRow[]) => {
      if (!key) {
        setCourseRows([]);
        setPathRows([]);
        return;
      }
      setCoursesLoading(true);
      setPathsLoading(true);
      try {
        if (key === ALL_CREATORS_KEY) {
          const bundles = await Promise.all(
            creatorList.map(async (c) => {
              const [courses, paths] = await Promise.all([
                listCreatorCoursesForAdminByOwner(c.id),
                listCreatorLearningPathsForAdminByOwner(c.id),
              ]);
              return { ownerUid: c.id, courses, paths };
            })
          );
          const coursesAcc: CourseRow[] = [];
          const pathsAcc: PathRow[] = [];
          for (const b of bundles) {
            for (const course of b.courses) coursesAcc.push({ course, ownerUid: b.ownerUid });
            for (const path of b.paths) pathsAcc.push({ path, ownerUid: b.ownerUid });
          }
          coursesAcc.sort((a, b) => a.course.title.localeCompare(b.course.title));
          pathsAcc.sort((a, b) => a.path.title.localeCompare(b.path.title));
          setCourseRows(coursesAcc);
          setPathRows(pathsAcc);
        } else {
          const [courses, paths] = await Promise.all([
            listCreatorCoursesForAdminByOwner(key),
            listCreatorLearningPathsForAdminByOwner(key),
          ]);
          setCourseRows(courses.map((course) => ({ course, ownerUid: key })));
          setPathRows(paths.map((path) => ({ path, ownerUid: key })));
        }
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
    void loadInventory(selectedKey, creators);
  }, [selectedKey, creators, loadInventory]);

  const openMenu = () => {
    setFilterQuery('');
    setMenuOpen(true);
    setActiveListIndex(null);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [menuOpen]);

  const pickOption = (key: string) => {
    setSelectedKey(key);
    setMenuOpen(false);
    setFilterQuery('');
    setActiveListIndex(null);
    inputRef.current?.blur();
  };

  const showOwnerOnRows = selectedKey === ALL_CREATORS_KEY;

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
          <div className="space-y-1" ref={wrapRef}>
            <label htmlFor="admin-creator-inventory-combobox" className="text-xs font-semibold text-[var(--text-secondary)]">
              Created by
            </label>
            <div className="relative max-w-md">
              {menuOpen ? (
                <div className="relative rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]">
                  <div className="relative min-h-11 pr-10">
                    <input
                      ref={inputRef}
                      id="admin-creator-inventory-combobox"
                      type="text"
                      role="combobox"
                      aria-expanded
                      aria-controls="admin-creator-inventory-listbox"
                      aria-autocomplete="list"
                      autoComplete="off"
                      placeholder="Start typing to search creators…"
                      value={filterQuery}
                      onChange={(e) => {
                        setFilterQuery(e.target.value);
                        setActiveListIndex(null);
                      }}
                      onFocus={() => {
                        setActiveListIndex(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setMenuOpen(false);
                          setFilterQuery('');
                          setActiveListIndex(null);
                          inputRef.current?.blur();
                          return;
                        }
                        if (listboxOptions.length > 0) {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setActiveListIndex((i) =>
                              i === null ? 0 : Math.min(i + 1, listboxOptions.length - 1)
                            );
                            return;
                          }
                          if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setActiveListIndex((i) =>
                              i === null
                                ? listboxOptions.length - 1
                                : Math.max(i - 1, 0)
                            );
                            return;
                          }
                        }
                        if (e.key === 'Tab' && !e.shiftKey) {
                          if (listboxOptions.length === 1) {
                            e.preventDefault();
                            const opt = listboxOptions[0]!;
                            const full = fullInputLabelForOption(opt);
                            if (filterQuery === full) {
                              pickOption(opt.key);
                            } else {
                              setActiveListIndex(null);
                              setFilterQuery(full);
                              queueMicrotask(() => {
                                const el = inputRef.current;
                                if (el) el.setSelectionRange(full.length, full.length);
                              });
                            }
                            return;
                          }
                          if (listboxOptions.length > 1) {
                            e.preventDefault();
                            setActiveListIndex(0);
                            queueMicrotask(() => listRef.current?.focus());
                            return;
                          }
                        }
                        if (e.key === 'Enter') {
                          const len = listboxOptions.length;
                          if (len === 0) return;
                          const hi = activeListIndexRef.current;
                          if (hi !== null && hi >= 0 && hi < len) {
                            e.preventDefault();
                            pickOption(listboxOptions[hi]!.key);
                            return;
                          }
                          if (len === 1) {
                            e.preventDefault();
                            pickOption(listboxOptions[0]!.key);
                            return;
                          }
                          const t = filterQuery.trim();
                          if (!t) return;
                          const exactCreator = creators.find(
                            (c) =>
                              fullInputLabelForOption({
                                key: c.id,
                                primary: c.displayName,
                                secondary: c.email || c.id,
                              }).toLowerCase() === t.toLowerCase()
                          );
                          if (exactCreator) {
                            e.preventDefault();
                            pickOption(exactCreator.id);
                          }
                        }
                      }}
                      className="absolute inset-0 z-10 box-border h-full w-full border-0 bg-transparent py-2 pl-3 pr-2 text-sm text-transparent caret-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                    />
                    <div
                      className="pointer-events-none flex min-h-11 items-center gap-0 py-2 pl-3 pr-2 text-sm"
                      aria-hidden
                    >
                      {filterQuery.length > 0 || uniqueInlineSuffix ? (
                        <>
                          <span className="shrink-0 text-[var(--text-primary)]">{filterQuery}</span>
                          {uniqueInlineSuffix ? (
                            <span className="min-w-0 truncate text-[var(--text-muted)]">{uniqueInlineSuffix}</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-[var(--text-muted)]">Start typing to search creators…</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Close creator list"
                    className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setMenuOpen(false);
                      setFilterQuery('');
                      setActiveListIndex(null);
                    }}
                  >
                    <ChevronDown size={18} className="rotate-180 transition-transform" aria-hidden />
                  </button>
                </div>
              ) : (
                <>
                  <input
                    ref={inputRef}
                    id="admin-creator-inventory-combobox"
                    type="text"
                    role="combobox"
                    aria-expanded={false}
                    aria-controls="admin-creator-inventory-listbox"
                    aria-autocomplete="list"
                    autoComplete="off"
                    placeholder="Select a creator to view results"
                    value={selectedInputDisplay}
                    readOnly
                    onChange={() => {}}
                    onFocus={() => {
                      openMenu();
                    }}
                    onKeyDown={(e) => {
                      if (
                        e.key === 'Enter' ||
                        e.key === ' ' ||
                        e.key === 'ArrowDown' ||
                        e.key === 'ArrowUp'
                      ) {
                        e.preventDefault();
                        openMenu();
                      }
                    }}
                    className="box-border min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] py-2 pl-3 pr-10 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] read-only:cursor-pointer"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Open creator list"
                    className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      openMenu();
                    }}
                  >
                    <ChevronDown size={18} className="transition-transform" aria-hidden />
                  </button>
                </>
              )}
              {menuOpen && (
                <ul
                  ref={listRef}
                  id="admin-creator-inventory-listbox"
                  role="listbox"
                  tabIndex={-1}
                  aria-label="Creator options"
                  className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] py-1 shadow-lg outline-none ring-offset-2 ring-offset-[var(--bg-primary)] focus-visible:ring-2 focus-visible:ring-orange-500/50 [scrollbar-width:thin]"
                  onKeyDown={(e) => {
                    if (listboxOptions.length === 0) return;
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setActiveListIndex((i) =>
                        i === null ? 0 : Math.min(i + 1, listboxOptions.length - 1)
                      );
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setActiveListIndex((i) =>
                        i === null ? listboxOptions.length - 1 : Math.max(i - 1, 0)
                      );
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      const idx = activeListIndexRef.current ?? 0;
                      pickOption(listboxOptions[idx]!.key);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setActiveListIndex(null);
                      inputRef.current?.focus();
                    } else if (e.key === 'Tab') {
                      setActiveListIndex(null);
                      if (e.shiftKey) {
                        e.preventDefault();
                        inputRef.current?.focus();
                      }
                    }
                  }}
                >
                  {listboxOptions.length === 0 ? (
                    <li className="px-3 py-2 text-xs text-[var(--text-muted)]">No matches.</li>
                  ) : (
                    listboxOptions.map((opt, idx) => (
                      <li key={opt.key || '__clear__'} role="presentation">
                        <button
                          type="button"
                          id={`admin-creator-opt-${idx}`}
                          role="option"
                          aria-selected={activeListIndex === idx}
                          className={`flex w-full min-h-11 flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-[var(--hover-bg)] ${
                            activeListIndex === idx ? 'bg-[var(--hover-bg)] ring-2 ring-inset ring-orange-500/35' : ''
                          }`}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickOption(opt.key)}
                          onMouseEnter={() => setActiveListIndex(idx)}
                        >
                          <span className="font-medium text-[var(--text-primary)]">{opt.primary}</span>
                          {opt.secondary ? (
                            <span className="line-clamp-2 text-[11px] text-[var(--text-muted)]">{opt.secondary}</span>
                          ) : null}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
            {selectedCreator && (
              <p className="text-[11px] text-[var(--text-muted)]">
                UID: <code className="break-all">{selectedCreator.id}</code>
              </p>
            )}
            {selectedKey === ALL_CREATORS_KEY && (
              <p className="text-[11px] text-[var(--text-muted)]">
                Showing aggregated private content for {creators.length} creator
                {creators.length === 1 ? '' : 's'}.
              </p>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
                <BookOpen className="shrink-0 text-orange-500" size={16} aria-hidden />
                Private courses (
                {!selectedKey ? '—' : coursesLoading ? '…' : courseRows.length})
              </h3>
              {!selectedKey ? (
                <p className="text-xs text-[var(--text-muted)]">
                  Select a creator or <strong className="font-semibold text-[var(--text-secondary)]">All creators</strong>{' '}
                  above to load results.
                </p>
              ) : coursesLoading ? (
                <p className="text-xs text-[var(--text-muted)]">Loading…</p>
              ) : courseRows.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">No creator courses for this scope.</p>
              ) : (
                <ul className="max-h-72 space-y-0 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2 text-sm [scrollbar-width:thin] [scrollbar-color:var(--border-light)_var(--bg-secondary)] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-[var(--bg-secondary)] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--border-light)]">
                  {courseRows.map(({ course: c, ownerUid }) => (
                    <li
                      key={`${ownerUid}:${c.id}`}
                      className="flex flex-col gap-2 border-b border-[var(--border-color)] py-2.5 last:border-0 sm:flex-row sm:items-center sm:gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        {showOwnerOnRows ? (
                          <div className="mb-0.5 text-[11px] font-medium text-orange-500/90">
                            {creators.find((x) => x.id === ownerUid)?.displayName ?? ownerUid}
                          </div>
                        ) : null}
                        <div className="truncate font-medium text-[var(--text-primary)]">{c.title}</div>
                        <code className="break-all text-[11px] text-[var(--text-muted)]">{c.id}</code>
                      </div>
                      {onPreviewCreatorCourse ? (
                        <button
                          type="button"
                          onClick={() => onPreviewCreatorCourse(ownerUid, c)}
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
                Private paths (
                {!selectedKey ? '—' : pathsLoading ? '…' : pathRows.length})
              </h3>
              {!selectedKey ? (
                <p className="text-xs text-[var(--text-muted)]">
                  Select a creator or <strong className="font-semibold text-[var(--text-secondary)]">All creators</strong>{' '}
                  above to load results.
                </p>
              ) : pathsLoading ? (
                <p className="text-xs text-[var(--text-muted)]">Loading…</p>
              ) : pathRows.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">No creator paths for this scope.</p>
              ) : (
                <ul className="max-h-72 space-y-0 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2 text-sm [scrollbar-width:thin] [scrollbar-color:var(--border-light)_var(--bg-secondary)] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-[var(--bg-secondary)] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--border-light)]">
                  {pathRows.map(({ path: p, ownerUid }) => (
                    <li
                      key={`${ownerUid}:${p.id}`}
                      className="flex flex-col gap-2 border-b border-[var(--border-color)] py-2.5 last:border-0 sm:flex-row sm:items-center sm:gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        {showOwnerOnRows ? (
                          <div className="mb-0.5 text-[11px] font-medium text-orange-500/90">
                            {creators.find((x) => x.id === ownerUid)?.displayName ?? ownerUid}
                          </div>
                        ) : null}
                        <div className="truncate font-medium text-[var(--text-primary)]">{p.title}</div>
                        <code className="break-all text-[11px] text-[var(--text-muted)]">{p.id}</code>
                      </div>
                      {onPreviewCreatorPath ? (
                        <button
                          type="button"
                          onClick={() => onPreviewCreatorPath(ownerUid, p)}
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
