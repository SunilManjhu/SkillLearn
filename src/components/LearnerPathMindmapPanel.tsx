import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, LayoutGrid, Loader2 } from 'lucide-react';
import type { Course } from '../data/courses';
import {
  filterOutlineBranchesForViewer,
  filterPathCourseIdsBySavedMindmap,
  type MindmapTreeNode,
} from '../data/pathMindmap';
import { normalizeExternalHref } from '../utils/externalUrl';
import { buildPathCourseRowLayoutBlocks } from '../utils/pathCourseOutlineGroups';
import {
  readPathCourseRowExpandedBlockKey,
  writePathCourseRowExpandedBlockKey,
} from '../utils/pathOutlineUiSession';
import {
  alignLocalLearnerStateIfFirestoreProgressMissing,
  SKILLLEARN_LOCAL_LEARNER_CLEARED_EVENT,
} from '../utils/courseProgress';
import { LearnerPathCourseRowList } from './LearnerPathCourseRowList';
import { PathMindmapOutline } from './PathMindmapOutline';

export type LearnerPathMindmapPanelProps = {
  pathId: string;
  pathTitle: string;
  catalogCourses: readonly Course[];
  onOpenCourse: (courseId: string) => void;
  onOpenLesson: (courseId: string, lessonId: string) => void;
  progressUserId: string | null;
  /** From App when catalog/path is shown again so section bars re-read local progress. */
  progressSnapshotVersion: number;
  /** Firestore `users/{uid}.role === 'admin'` — controls outline rows restricted to admins only. */
  viewerIsAdmin?: boolean;
  /** Course ids visible in browse catalog; course-linked outline rows for other ids are hidden regardless of path “Show”. */
  catalogVisibleCourseIds?: ReadonlySet<string> | null;
  /** When true, omit the in-panel title block (parent renders path chrome per docs/learning-path-course-list.md §7). */
  suppressPathHeader?: boolean;
  /** Ordered `courseIds` — themed flat rows; section titles and section dividers come from the mindmap when available. */
  pathCourseIds?: readonly string[];
  /** Same `pathMindmap` children as in Firestore — parent loads once (catalog filter + outline). */
  mindmapOutlineChildren: MindmapTreeNode[] | null;
  mindmapOutlineLoading: boolean;
  /** After syncing path-linked courses with Firestore (purged id → clear local), bump so outline/rows re-read storage without full reload. */
  onPathLearnerFirestoreSynced?: () => void;
};

export const LearnerPathMindmapPanel: React.FC<LearnerPathMindmapPanelProps> = ({
  pathId,
  pathTitle,
  catalogCourses,
  onOpenCourse,
  onOpenLesson,
  progressUserId,
  progressSnapshotVersion,
  viewerIsAdmin = false,
  catalogVisibleCourseIds = null,
  suppressPathHeader = false,
  pathCourseIds = [],
  mindmapOutlineChildren: branches,
  mindmapOutlineLoading: loading,
  onPathLearnerFirestoreSynced,
}) => {
  const [storageProgressTick, setStorageProgressTick] = useState(0);
  /** Which top-level block is open; `null` = all collapsed (accordion). Restored from localStorage per path. */
  const [expandedPathBlockKey, setExpandedPathBlockKey] = useState<string | null>(null);

  const filteredBranchesForViewer = useMemo(
    () =>
      branches === null
        ? []
        : filterOutlineBranchesForViewer(branches, viewerIsAdmin, catalogVisibleCourseIds),
    [branches, viewerIsAdmin, catalogVisibleCourseIds]
  );

  const pathCourseIdsForLayout = useMemo(
    () => filterPathCourseIdsBySavedMindmap(pathCourseIds, branches),
    [pathCourseIds, branches]
  );

  const courseRowBlocks = useMemo(() => {
    if (pathCourseIdsForLayout.length === 0) return null;
    const blocks = buildPathCourseRowLayoutBlocks(
      pathCourseIdsForLayout,
      filteredBranchesForViewer,
      branches ?? undefined
    );
    return blocks.length > 0 ? blocks : null;
  }, [pathCourseIdsForLayout, filteredBranchesForViewer, branches]);

  /** Full mindmap outline only when the path has no `courseIds` (lessons, links, course-only outline). */
  const useOutlineLayout =
    !loading && branches !== null && pathCourseIds.length === 0 && filteredBranchesForViewer.length > 0;
  const useCourseRowLayout = !loading && branches !== null && pathCourseIdsForLayout.length > 0;

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      const k = e.key ?? '';
      if (
        k.includes('skilllearn-progress') ||
        k.includes('skilllearn-course-completed-at') ||
        k.includes('skilllearn-course-rating') ||
        k.startsWith('skilllearn-progress:')
      ) {
        setStorageProgressTick((t) => t + 1);
      }
    };
    const onLocalLearnerCleared = () => setStorageProgressTick((t) => t + 1);
    window.addEventListener('storage', onStorage);
    window.addEventListener(SKILLLEARN_LOCAL_LEARNER_CLEARED_EVENT, onLocalLearnerCleared);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(SKILLLEARN_LOCAL_LEARNER_CLEARED_EVENT, onLocalLearnerCleared);
    };
  }, []);

  /** Catalog course ids on this path (flat list + outline nodes) — used to sync localStorage with purged Firestore before progress bars render. */
  const pathCatalogCourseIdsForAlign = useMemo(() => {
    const catalogSet = new Set(catalogCourses.map((c) => c.id));
    const out = new Set<string>();
    for (const id of pathCourseIdsForLayout) {
      if (catalogSet.has(id)) out.add(id);
    }
    const walk = (n: MindmapTreeNode) => {
      if (n.kind === 'course' && n.courseId && catalogSet.has(n.courseId)) out.add(n.courseId);
      if (n.kind === 'module' && n.courseId && catalogSet.has(n.courseId)) out.add(n.courseId);
      if (n.kind === 'lesson' && n.courseId && catalogSet.has(n.courseId)) out.add(n.courseId);
      for (const ch of n.children) walk(ch);
    };
    for (const sec of filteredBranchesForViewer) walk(sec);
    return [...out];
  }, [pathCourseIdsForLayout, filteredBranchesForViewer, catalogCourses]);

  const pathCatalogCourseIdsForAlignKey = pathCatalogCourseIdsForAlign.join('\0');

  useEffect(() => {
    if (!progressUserId || pathCatalogCourseIdsForAlign.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const courseId of pathCatalogCourseIdsForAlign) {
        if (cancelled) return;
        await alignLocalLearnerStateIfFirestoreProgressMissing(courseId, progressUserId);
      }
      if (!cancelled) {
        // CustomEvent from clearLocalLearnerStateForCourseId already bumps tick; still bump + notify App so
        // PathMindmapOutline useMemos tied to progressSnapshotVersion refresh even if batching missed one.
        setStorageProgressTick((t) => t + 1);
        onPathLearnerFirestoreSynced?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    pathId,
    progressUserId,
    pathCatalogCourseIdsForAlignKey,
    pathCatalogCourseIdsForAlign.length,
    onPathLearnerFirestoreSynced,
  ]);

  const outlineProgressVersion = progressSnapshotVersion + storageProgressTick;

  const pathSectionBlockKey = useCallback(
    (blockIndex: number, sectionLabel: string) => `${pathId}-b${blockIndex}-${sectionLabel || 'tail'}`,
    [pathId]
  );

  /**
   * Restore / validate expanded section only after mindmap data is stable. While `branches === null` or
   * `loading`, `courseRowBlocks` is built from provisional data and keys often differ from the saved key —
   * validating then would clear localStorage and break restore on full page reload.
   */
  useEffect(() => {
    if (loading || branches === null) {
      return;
    }
    const stored = readPathCourseRowExpandedBlockKey(pathId);
    if (!courseRowBlocks || courseRowBlocks.length === 0) {
      setExpandedPathBlockKey(stored);
      return;
    }
    if (!useCourseRowLayout) {
      return;
    }
    const valid = new Set(
      courseRowBlocks.map((block, bIdx) => pathSectionBlockKey(bIdx, block.sectionLabel))
    );
    const next = stored && valid.has(stored) ? stored : null;
    setExpandedPathBlockKey(next);
    if (next !== stored) {
      writePathCourseRowExpandedBlockKey(pathId, next);
    }
  }, [
    pathId,
    courseRowBlocks,
    pathSectionBlockKey,
    useCourseRowLayout,
    loading,
    branches,
  ]);

  const isPathSectionExpanded = useCallback(
    (key: string) => expandedPathBlockKey === key,
    [expandedPathBlockKey]
  );

  const togglePathSectionBlock = useCallback((key: string) => {
    setExpandedPathBlockKey((current) => {
      const next = current === key ? null : key;
      writePathCourseRowExpandedBlockKey(pathId, next);
      return next;
    });
  }, [pathId]);

  const handleOpenCourseFromRow = (course: Course) => {
    onOpenCourse(course.id);
  };

  const showInnerHeader = !suppressPathHeader && useOutlineLayout;

  return (
    <section
      className="min-w-0 max-w-full rounded-none border-0 bg-transparent p-0 shadow-none md:rounded-2xl md:border md:border-[var(--border-color)] md:bg-[var(--bg-secondary)]/80 md:p-5 md:shadow-sm"
      aria-labelledby="learner-path-mindmap-heading"
    >
      <h2 id="learner-path-mindmap-heading" className="sr-only">
        Learning Path: {pathTitle}
      </h2>
      {showInnerHeader ? (
        <div className="mb-2 hidden flex-wrap items-start gap-3 sm:mb-3 md:flex">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-orange-500/35 bg-orange-500/10 text-orange-500">
            <LayoutGrid size={22} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-orange-500">Learning Path</p>
            <p
              className="mt-1 text-xl font-bold tracking-tight text-[var(--text-primary)] sm:text-2xl"
              aria-hidden="true"
            >
              {pathTitle}
            </p>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
              Everything you need, in the right order. Go at your own pace.
            </p>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div
          className="min-h-[200px] space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/30 p-4"
          role="status"
          aria-busy="true"
          aria-label="Loading Learning Path outline"
        >
          <div className="space-y-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]/20 p-3">
            <div className="h-8 w-full animate-pulse rounded bg-[var(--hover-bg)]" />
            <div className="h-8 w-full animate-pulse rounded bg-[var(--hover-bg)]" />
            <div className="h-8 w-full max-w-[90%] animate-pulse rounded bg-[var(--hover-bg)]" />
            <div className="h-8 w-full max-w-[85%] animate-pulse rounded bg-[var(--hover-bg)]" />
          </div>
          <div className="flex items-center justify-center gap-2 pt-2 text-sm text-[var(--text-muted)]">
            <Loader2 size={18} className="shrink-0 animate-spin" aria-hidden />
            Loading Learning Path outline…
          </div>
        </div>
      ) : useCourseRowLayout && courseRowBlocks ? (
        <div className="min-w-0 space-y-0">
          {courseRowBlocks.map((block, bIdx) => {
            const blockKey = pathSectionBlockKey(bIdx, block.sectionLabel);
            const panelId = `path-course-panel-${pathId}-${bIdx}`;
            const expanded = isPathSectionExpanded(blockKey);
            const heading =
              block.sectionLabel.trim() ||
              (courseRowBlocks.length > 1 ? 'Other courses' : 'Courses');
            return (
              <div
                key={`path-block-${bIdx}-${block.sectionLabel || 'sec'}-${
                  block.segments[0]?.type === 'courses'
                    ? block.segments[0].courseIds[0]
                    : block.segments[0]?.type === 'divider' ||
                        block.segments[0]?.type === 'label' ||
                        block.segments[0]?.type === 'link'
                      ? block.segments[0].id
                      : bIdx
                }`}
                className={bIdx > 0 ? 'mt-6 min-w-0' : 'min-w-0'}
              >
                <div className="mb-2 min-w-0">
                  <button
                    type="button"
                    id={`${panelId}-trigger`}
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => togglePathSectionBlock(blockKey)}
                    className="flex w-full min-w-0 items-start gap-2 rounded-lg py-1 pl-0.5 pr-1 text-left transition-colors hover:bg-[var(--hover-bg)]/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 sm:items-center sm:gap-2.5 sm:pl-1"
                  >
                    <span className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center self-start text-[var(--text-muted)] sm:min-h-11 sm:min-w-11">
                      <ChevronDown
                        size={20}
                        className={`shrink-0 transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`}
                        aria-hidden
                      />
                    </span>
                    <h3 className="min-w-0 flex-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)] sm:pt-2">
                      {heading}
                    </h3>
                  </button>
                </div>
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={`${panelId}-trigger`}
                  hidden={!expanded}
                  className="min-w-0 space-y-0"
                >
                  {block.segments.map((seg, sIdx) =>
                    seg.type === 'divider' ? (
                      <div
                        key={seg.id}
                        className="min-w-0 border-t border-[var(--border-color)]/60 pt-2.5 mt-2 first:mt-0 first:border-t-0 first:pt-0"
                        role="presentation"
                      >
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] [overflow-wrap:anywhere]">
                          {seg.label}
                        </p>
                      </div>
                    ) : seg.type === 'label' ? (
                      <div
                        key={seg.id}
                        className="min-w-0 pt-3 first:pt-0"
                        role="presentation"
                      >
                        <p className="text-sm font-semibold leading-snug text-[var(--text-primary)] [overflow-wrap:anywhere]">
                          {seg.label}
                        </p>
                      </div>
                    ) : seg.type === 'link' ? (
                      <div key={seg.id} className="min-w-0 pt-3 first:pt-0" role="presentation">
                        {(() => {
                          const safeHref = normalizeExternalHref(seg.href);
                          return safeHref ? (
                            <a
                              href={safeHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-block text-base font-semibold leading-snug text-violet-600 underline-offset-2 hover:underline dark:text-violet-400 [overflow-wrap:anywhere]"
                            >
                              {seg.label}
                            </a>
                          ) : (
                            <p className="text-sm font-semibold text-[var(--text-primary)] [overflow-wrap:anywhere]">
                              {seg.label}
                            </p>
                          );
                        })()}
                      </div>
                    ) : (
                      <React.Fragment key={`${bIdx}-lpcr-${sIdx}-${seg.courseIds.join('-')}`}>
                        <LearnerPathCourseRowList
                          courseIds={seg.courseIds}
                          catalogCourses={catalogCourses}
                          progressUserId={progressUserId}
                          progressSnapshotVersion={outlineProgressVersion}
                          onOpenCourse={handleOpenCourseFromRow}
                        />
                      </React.Fragment>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : branches === null ? null : useOutlineLayout ? (
        <PathMindmapOutline
          key={pathId}
          pathId={pathId}
          pathTitle={pathTitle}
          branches={branches}
          catalogCourses={catalogCourses}
          onOpenCourse={onOpenCourse}
          onOpenLesson={onOpenLesson}
          progressUserId={progressUserId}
          progressSnapshotVersion={outlineProgressVersion}
          viewerIsAdmin={viewerIsAdmin}
          catalogVisibleCourseIds={catalogVisibleCourseIds}
        />
      ) : (
        <p className="rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)]/40 px-4 py-8 text-center text-sm text-[var(--text-muted)]">
          No saved outline for this path yet. When an admin adds branches and saves the path, the outline will appear
          here.
        </p>
      )}
    </section>
  );
};
