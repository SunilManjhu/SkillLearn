import React, { useEffect, useState } from 'react';
import { LayoutGrid, Loader2 } from 'lucide-react';
import type { Course } from '../data/courses';
import type { MindmapTreeNode } from '../data/pathMindmap';
import { fetchPathMindmapFromFirestore } from '../utils/pathMindmapFirestore';
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
};

export const LearnerPathMindmapPanel: React.FC<LearnerPathMindmapPanelProps> = ({
  pathId,
  pathTitle,
  catalogCourses,
  onOpenCourse,
  onOpenLesson,
  progressUserId,
  progressSnapshotVersion,
}) => {
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<MindmapTreeNode[] | null>(null);
  const [storageProgressTick, setStorageProgressTick] = useState(0);

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
        setLoading(false);
        return;
      }
      setBranches(doc.root.children);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [pathId]);

  return (
    <section
      className="min-w-0 max-w-full rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/80 p-4 shadow-sm sm:p-6"
      aria-labelledby="learner-path-mindmap-heading"
    >
      <div className="mb-5 flex flex-wrap items-start gap-3 sm:mb-6">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-orange-500/35 bg-orange-500/10 text-orange-500">
          <LayoutGrid size={22} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-orange-500">
            Learning path
          </p>
          <h2
            id="learner-path-mindmap-heading"
            className="mt-1 text-xl font-bold tracking-tight text-[var(--text-primary)] sm:text-2xl"
          >
            {pathTitle}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
            Everything you need, in the right order. Go at your own pace.
          </p>
        </div>
      </div>

      {loading ? (
        <div
          className="min-h-[200px] space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/30 p-4"
          role="status"
          aria-busy="true"
          aria-label="Loading path outline"
        >
          <div className="space-y-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]/20 p-3">
            <div className="h-8 w-full animate-pulse rounded bg-[var(--hover-bg)]" />
            <div className="h-8 w-full animate-pulse rounded bg-[var(--hover-bg)]" />
            <div className="h-8 w-full max-w-[90%] animate-pulse rounded bg-[var(--hover-bg)]" />
            <div className="h-8 w-full max-w-[85%] animate-pulse rounded bg-[var(--hover-bg)]" />
          </div>
          <div className="flex items-center justify-center gap-2 pt-2 text-sm text-[var(--text-muted)]">
            <Loader2 size={18} className="shrink-0 animate-spin" aria-hidden />
            Loading path outline…
          </div>
        </div>
      ) : branches === null ? null : branches.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)]/40 px-4 py-8 text-center text-sm text-[var(--text-muted)]">
          No saved outline for this path yet. When an admin adds branches and saves the path, the outline will appear here.
        </p>
      ) : (
        <PathMindmapOutline
          key={pathId}
          pathTitle={pathTitle}
          branches={branches}
          catalogCourses={catalogCourses}
          onOpenCourse={onOpenCourse}
          onOpenLesson={onOpenLesson}
          progressUserId={progressUserId}
          progressSnapshotVersion={outlineProgressVersion}
        />
      )}
    </section>
  );
};
