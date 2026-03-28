import React from 'react';
import type { Course } from '../data/courses';
import type { MindmapTreeNode } from '../data/pathMindmap';

function nodeKind(n: MindmapTreeNode): 'label' | 'course' | 'lesson' {
  if (n.kind === 'course' && n.courseId) return 'course';
  if (n.kind === 'lesson' && n.courseId && n.lessonId) return 'lesson';
  return 'label';
}

function resolveActions(
  node: MindmapTreeNode,
  catalogCourses: readonly Course[]
): {
  canOpenCourse: boolean;
  canOpenLesson: boolean;
  missingCatalog: boolean;
  courseId?: string;
  lessonId?: string;
} {
  const k = nodeKind(node);
  const courseMeta =
    k === 'course' || k === 'lesson' ? catalogCourses.find((c) => c.id === node.courseId) : undefined;
  const canOpenCourse = k === 'course' && !!node.courseId && !!courseMeta;
  const canOpenLesson =
    k === 'lesson' &&
    !!node.courseId &&
    !!node.lessonId &&
    !!courseMeta &&
    courseMeta.modules.some((m) => m.lessons.some((l) => l.id === node.lessonId));
  const missingCatalog = (k === 'course' || k === 'lesson') && !courseMeta;
  return {
    canOpenCourse,
    canOpenLesson,
    missingCatalog,
    courseId: node.courseId,
    lessonId: node.lessonId,
  };
}

function ActionChips({
  node,
  catalogCourses,
  onOpenCourse,
  onOpenLesson,
  compact,
  className,
}: {
  node: MindmapTreeNode;
  catalogCourses: readonly Course[];
  onOpenCourse: (courseId: string) => void;
  onOpenLesson: (courseId: string, lessonId: string) => void;
  compact?: boolean;
  className?: string;
}) {
  const { canOpenCourse, canOpenLesson, missingCatalog, courseId, lessonId } = resolveActions(
    node,
    catalogCourses
  );
  const btn =
    compact === true
      ? 'min-h-9 px-2.5 text-[11px] sm:min-h-10 sm:px-3 sm:text-xs'
      : 'min-h-10 px-3 text-xs';

  if (!canOpenCourse && !canOpenLesson && !missingCatalog) return null;

  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className ?? ''}`}>
      {canOpenCourse && courseId ? (
        <button
          type="button"
          onClick={() => onOpenCourse(courseId)}
          className={`inline-flex shrink-0 items-center justify-center rounded-lg border-2 border-orange-500/70 bg-transparent font-semibold text-orange-600 hover:bg-orange-500/10 dark:text-orange-400 ${btn}`}
        >
          Open course
        </button>
      ) : null}
      {canOpenLesson && courseId && lessonId ? (
        <button
          type="button"
          onClick={() => onOpenLesson(courseId, lessonId)}
          className={`inline-flex shrink-0 items-center justify-center rounded-lg border border-[var(--border-light)] bg-[var(--bg-secondary)] font-semibold text-[var(--text-primary)] hover:bg-[var(--hover-bg)] ${btn}`}
        >
          Open lesson
        </button>
      ) : null}
      {missingCatalog ? <span className="text-xs text-[var(--text-muted)]">Not in catalog</span> : null}
    </span>
  );
}

function OutlineNode({
  node,
  depth,
  sectionIndex = 0,
  catalogCourses,
  onOpenCourse,
  onOpenLesson,
}: {
  node: MindmapTreeNode;
  depth: number;
  /** Only used when `depth === 0` (top-level section number). */
  sectionIndex?: number;
  catalogCourses: readonly Course[];
  onOpenCourse: (courseId: string) => void;
  onOpenLesson: (courseId: string, lessonId: string) => void;
}) {
  const label = node.label.trim() || node.id;

  if (depth === 0) {
    return (
      <section className="mt-10 scroll-mt-4 first:mt-0">
        <h3 className="text-lg font-bold leading-snug text-[var(--text-primary)] sm:text-xl">
          <span className="tabular-nums text-orange-500/95">{sectionIndex + 1}.</span>{' '}
          <span className="[overflow-wrap:anywhere]">{label}</span>
        </h3>
        <ActionChips
          node={node}
          catalogCourses={catalogCourses}
          onOpenCourse={onOpenCourse}
          onOpenLesson={onOpenLesson}
          className="mt-2 block"
        />
        {node.children.length > 0 ? (
          <div className="mt-4 space-y-4 pl-0.5 sm:pl-1">
            {node.children.map((ch) => (
              <React.Fragment key={ch.id}>
                <OutlineNode
                  node={ch}
                  depth={1}
                  catalogCourses={catalogCourses}
                  onOpenCourse={onOpenCourse}
                  onOpenLesson={onOpenLesson}
                />
              </React.Fragment>
            ))}
          </div>
        ) : null}
      </section>
    );
  }

  if (depth === 1) {
    return (
      <div className="min-w-0">
        <div className="flex gap-3 sm:gap-4">
          <span
            className="mt-2 h-2 w-2 shrink-0 rounded-full bg-slate-400 dark:bg-slate-500"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-2">
              <span className="text-base font-bold leading-snug text-[var(--text-primary)] [overflow-wrap:anywhere]">
                {label}
              </span>
              <ActionChips
                node={node}
                catalogCourses={catalogCourses}
                onOpenCourse={onOpenCourse}
                onOpenLesson={onOpenLesson}
                compact
              />
            </div>
            {node.children.length > 0 ? (
              <div className="mt-3 space-y-3 border-l border-[var(--border-color)]/70 pl-4 sm:pl-5">
                {node.children.map((ch) => (
                  <React.Fragment key={ch.id}>
                    <OutlineNode
                      node={ch}
                      depth={2}
                      catalogCourses={catalogCourses}
                      onOpenCourse={onOpenCourse}
                      onOpenLesson={onOpenLesson}
                    />
                  </React.Fragment>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="flex gap-3 sm:gap-4">
        <span
          className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-[var(--text-muted)] bg-transparent"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-sm leading-relaxed text-[var(--text-secondary)] [overflow-wrap:anywhere] sm:text-[15px]">
              {label}
            </span>
            <ActionChips
              node={node}
              catalogCourses={catalogCourses}
              onOpenCourse={onOpenCourse}
              onOpenLesson={onOpenLesson}
              compact
            />
          </div>
          {node.children.length > 0 ? (
            <div className="ml-1 mt-3 space-y-3 border-l border-[var(--border-color)]/50 pl-3 sm:ml-2 sm:pl-4">
              {node.children.map((ch) => (
                <React.Fragment key={ch.id}>
                  <OutlineNode
                    node={ch}
                    depth={depth + 1}
                    catalogCourses={catalogCourses}
                    onOpenCourse={onOpenCourse}
                    onOpenLesson={onOpenLesson}
                  />
                </React.Fragment>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export type PathMindmapOutlineProps = {
  pathTitle: string;
  branches: MindmapTreeNode[];
  catalogCourses: readonly Course[];
  onOpenCourse: (courseId: string) => void;
  onOpenLesson: (courseId: string, lessonId: string) => void;
};

export const PathMindmapOutline: React.FC<PathMindmapOutlineProps> = ({
  pathTitle,
  branches,
  catalogCourses,
  onOpenCourse,
  onOpenLesson,
}) => {
  return (
    <div
      className="min-w-0 rounded-xl border border-[var(--border-color)]/90 bg-[var(--bg-primary)]/25 px-3 py-5 sm:px-6 sm:py-7"
      role="region"
      aria-label={`Path syllabus: ${pathTitle}`}
    >
      <div className="space-y-0">
        {branches.map((node, i) => (
          <React.Fragment key={node.id}>
            <OutlineNode
              node={node}
              depth={0}
              sectionIndex={i}
              catalogCourses={catalogCourses}
              onOpenCourse={onOpenCourse}
              onOpenLesson={onOpenLesson}
            />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
