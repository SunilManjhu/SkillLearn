import React, { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, Loader2 } from 'lucide-react';
import type { Course } from '../data/courses';
import { filterOutlineBranchesForViewer, type MindmapTreeNode } from '../data/pathMindmap';
import { buildPathCourseRowLayoutBlocks } from '../utils/pathCourseOutlineGroups';
import { fetchPathMindmapFromFirestore } from '../utils/pathMindmapFirestore';
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
  /** When true, omit the in-panel title block (parent renders path chrome per docs/learning-path-course-list.md §7). */
  suppressPathHeader?: boolean;
  /** Ordered `courseIds` — themed flat rows; section titles and section dividers come from the mindmap when available. */
  pathCourseIds?: readonly string[];
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
  suppressPathHeader = false,
  pathCourseIds = [],
}) => {
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<MindmapTreeNode[] | null>(null);
  const [storageProgressTick, setStorageProgressTick] = useState(0);

  const filteredBranchesForViewer = useMemo(
    () => (branches === null ? [] : filterOutlineBranchesForViewer(branches, viewerIsAdmin)),
    [branches, viewerIsAdmin]
  );

  const courseRowBlocks = useMemo(() => {
    if (pathCourseIds.length === 0) return null;
    return buildPathCourseRowLayoutBlocks(pathCourseIds, filteredBranchesForViewer);
  }, [pathCourseIds, filteredBranchesForViewer]);

  /** Full mindmap outline only when the path has no `courseIds` (lessons, links, course-only outline). */
  const useOutlineLayout =
    !loading && branches !== null && pathCourseIds.length === 0 && filteredBranchesForViewer.length > 0;
  const useCourseRowLayout = !loading && branches !== null && pathCourseIds.length > 0;

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      const k = e.key ?? '';
      if (
        k.includes('skilllearn-progress') ||
        k.includes('skilllearn-course-completed-at') ||
        k.startsWith('skilllearn-progress:')
      ) {
        setStorageProgressTick((t) => t + 1);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const outlineProgressVersion = progressSnapshotVersion + storageProgressTick;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBranches(null);
    void (async () => {
      const doc = await fetchPathMindmapFromFirestore(pathId);
      if (cancelled) return;
      if (!doc || doc.root.children.length === 0) {
        setBranches([]);
      } else {
        setBranches(doc.root.children);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
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
          {courseRowBlocks.map((block, bIdx) => (
            <div
              key={`path-block-${bIdx}-${block.sectionLabel || 'sec'}-${
                block.segments[0]?.type === 'courses'
                  ? block.segments[0].courseIds[0]
                  : (block.segments[0]?.type === 'divider' ? block.segments[0].id : bIdx)
              }`}
              className={bIdx > 0 ? 'mt-6 min-w-0' : 'min-w-0'}
            >
              {block.sectionLabel ? (
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                  {block.sectionLabel}
                </h3>
              ) : null}
              <div className="min-w-0 space-y-0">
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
                  ) : (
                    <LearnerPathCourseRowList
                      key={`${bIdx}-lpcr-${sIdx}-${seg.courseIds.join('-')}`}
                      courseIds={seg.courseIds}
                      catalogCourses={catalogCourses}
                      progressUserId={progressUserId}
                      progressSnapshotVersion={outlineProgressVersion}
                      onOpenCourse={handleOpenCourseFromRow}
                    />
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      ) : branches === null ? null : useOutlineLayout ? (
        <PathMindmapOutline
          key={pathId}
          pathTitle={pathTitle}
          branches={branches}
          catalogCourses={catalogCourses}
          onOpenCourse={onOpenCourse}
          onOpenLesson={onOpenLesson}
          progressUserId={progressUserId}
          progressSnapshotVersion={outlineProgressVersion}
          viewerIsAdmin={viewerIsAdmin}
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
