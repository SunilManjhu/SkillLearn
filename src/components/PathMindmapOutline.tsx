import React, { useCallback, useMemo, useState } from 'react';
import { Check, ChevronDown, Circle, Play } from 'lucide-react';
import type { Course } from '../data/courses';
import type { MindmapTreeNode } from '../data/pathMindmap';
import { getPathOutlineRowStatus, type PathOutlineRowStatus } from '../utils/pathOutlineRowStatus';
import { computePathSectionProgress, countCatalogCoursesInSubtree } from '../utils/pathSectionProgress';

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
      ? 'min-h-10 px-2.5 text-[11px] sm:px-3 sm:text-xs'
      : 'min-h-10 px-3 text-xs';

  if (!canOpenCourse && !canOpenLesson && !missingCatalog) return null;

  return (
    <span className={`flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center ${className ?? ''}`}>
      {canOpenCourse && courseId ? (
        <button
          type="button"
          onClick={() => onOpenCourse(courseId)}
          className={`inline-flex w-full shrink-0 items-center justify-center rounded border border-orange-500 bg-transparent font-medium text-orange-500 hover:bg-orange-500/10 sm:w-[7.25rem] ${btn}`}
        >
          Open course
        </button>
      ) : null}
      {canOpenLesson && courseId && lessonId ? (
        <button
          type="button"
          onClick={() => onOpenLesson(courseId, lessonId)}
          className={`inline-flex w-full shrink-0 items-center justify-center rounded border border-[var(--border-light)] bg-transparent font-medium text-[var(--text-primary)] hover:bg-[var(--hover-bg)] sm:w-[7.25rem] ${btn}`}
        >
          Open lesson
        </button>
      ) : null}
      {missingCatalog ? (
        <span className="text-right text-xs text-[var(--text-muted)] sm:text-left">Not in catalog</span>
      ) : null}
    </span>
  );
}

function PathRowStatusLead({
  depth,
  status,
  compactIcon = false,
}: {
  depth: number;
  status: PathOutlineRowStatus | null;
  /** Tighter icons for deep nesting (mobile-first). */
  compactIcon?: boolean;
}) {
  const box = 'flex w-7 shrink-0 items-center justify-center self-stretch sm:w-8';
  const ic = compactIcon ? 17 : 20;
  const playSz = compactIcon ? 15 : 18;
  if (status === 'completed') {
    return (
      <div className={box} role="img" aria-label="Completed">
        <Check className="text-emerald-500" size={ic} strokeWidth={2.75} aria-hidden />
      </div>
    );
  }
  if (status === 'in_progress') {
    return (
      <div className={box} role="img" aria-label="In progress">
        <Play className="fill-orange-500 text-orange-500" size={playSz} aria-hidden />
      </div>
    );
  }
  if (status === 'not_started') {
    return (
      <div className={box} role="img" aria-label="Not started">
        <Circle className="text-[var(--text-muted)]" size={ic} strokeWidth={2} aria-hidden />
      </div>
    );
  }
  if (depth === 1) {
    return (
      <div className={box} aria-hidden>
        <span
          className={`shrink-0 rounded-full bg-[var(--text-muted)] ${compactIcon ? 'h-1 w-1' : 'h-1.5 w-1.5'}`}
        />
      </div>
    );
  }
  return (
    <div className={box} aria-hidden>
      <span
        className={`shrink-0 rounded-full border-2 border-[var(--text-muted)] bg-transparent ${compactIcon ? 'h-1.5 w-1.5' : 'h-2 w-2'}`}
      />
    </div>
  );
}

/** Vertical rail + rounded corner group; horizontal elbows on each `OutlineNestedBranchItem`. */
function OutlineNestedBranch({
  parentDepth,
  children,
}: {
  parentDepth: number;
  children: React.ReactNode;
}) {
  const outerPad =
    parentDepth === 1
      ? 'pl-10 sm:pl-12'
      : parentDepth === 2
        ? 'pl-8 sm:pl-10'
        : 'pl-6 sm:pl-8';
  const marginTop = parentDepth === 1 ? 'mt-4 sm:mt-5' : 'mt-3 sm:mt-3.5';
  return (
    <div className={`min-w-0 ${marginTop} ${outerPad}`}>
      <ul
        role="list"
        className="relative list-none space-y-4 rounded-bl-md rounded-tl-md border-l-2 border-[var(--border-color)]/70 bg-[var(--bg-primary)]/20 py-2 pl-4 sm:space-y-5 sm:rounded-bl-lg sm:rounded-tl-lg sm:py-3 sm:pl-5"
      >
        {children}
      </ul>
    </div>
  );
}

function OutlineNestedBranchItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="relative min-w-0 before:pointer-events-none before:absolute before:left-0 before:top-[1.15rem] before:z-0 before:h-px before:w-4 before:-translate-x-full before:bg-[var(--border-color)]/70 sm:before:top-5 sm:before:w-5">
      {children}
    </li>
  );
}

function OutlineNode({
  node,
  depth,
  sectionIndex = 0,
  catalogCourses,
  onOpenCourse,
  onOpenLesson,
  progressUserId,
  progressSnapshotVersion,
  isSectionExpanded,
  toggleSection,
}: {
  node: MindmapTreeNode;
  depth: number;
  /** Only used when `depth === 0` (top-level section number). */
  sectionIndex?: number;
  catalogCourses: readonly Course[];
  onOpenCourse: (courseId: string) => void;
  onOpenLesson: (courseId: string, lessonId: string) => void;
  progressUserId: string | null;
  progressSnapshotVersion: number;
  isSectionExpanded: (sectionId: string) => boolean;
  toggleSection: (sectionId: string) => void;
}) {
  const label = node.label.trim() || node.id;

  const sectionProgress = useMemo(() => {
    if (depth !== 0) return null;
    return computePathSectionProgress(node, catalogCourses, progressUserId);
  }, [depth, node, catalogCourses, progressUserId, progressSnapshotVersion]);

  const catalogCourseCount = useMemo(() => {
    if (depth !== 0) return 0;
    return countCatalogCoursesInSubtree(node, catalogCourses);
  }, [depth, node, catalogCourses]);

  const rowStatus = useMemo(() => {
    if (depth === 0) return null;
    return getPathOutlineRowStatus(node, catalogCourses, progressUserId);
  }, [depth, node, catalogCourses, progressUserId, progressSnapshotVersion]);

  if (depth === 0) {
    const showSectionProgress = sectionProgress != null && sectionProgress.totalLessons > 0;
    const childCount = node.children.length;
    const hasExpandableContent = childCount > 0;
    const expanded = isSectionExpanded(node.id);
    const panelId = `path-section-panel-${node.id}`;
    const courseCountLabel =
      !hasExpandableContent && childCount === 0
        ? 'Empty'
        : catalogCourseCount === 1
          ? '1 course'
          : `${catalogCourseCount} courses`;

    return (
      <section className="mt-8 scroll-mt-4 border-t border-[var(--border-color)] pt-8 first:mt-0 first:border-t-0 first:pt-0">
        <h3 className="min-w-0 pl-4 text-lg font-bold leading-snug text-[var(--text-primary)] sm:pl-8 sm:text-xl">
          {hasExpandableContent ? (
            <button
              type="button"
              className="flex min-h-11 w-full min-w-0 touch-manipulation items-center gap-x-2 rounded-lg py-1 text-left transition-colors hover:bg-[var(--hover-bg)]/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 sm:min-h-12 sm:gap-x-3"
              aria-expanded={expanded}
              aria-controls={panelId}
              id={`path-section-trigger-${node.id}`}
              onClick={() => toggleSection(node.id)}
            >
              <ChevronDown
                size={22}
                className={`shrink-0 text-[var(--text-muted)] transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`}
                aria-hidden
              />
              <span className="flex w-7 shrink-0 justify-end tabular-nums text-orange-500 sm:w-8">
                {sectionIndex + 1}.
              </span>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{label}</span>
              <span className="shrink-0 text-xs font-medium normal-case text-[var(--text-muted)] sm:text-sm">
                {courseCountLabel}
              </span>
            </button>
          ) : (
            <div className="flex min-w-0 items-center gap-x-2 py-1 sm:gap-x-3">
              <span className="flex w-[22px] shrink-0 sm:w-[22px]" aria-hidden />
              <span className="flex w-7 shrink-0 justify-end tabular-nums text-orange-500 sm:w-8">
                {sectionIndex + 1}.
              </span>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{label}</span>
              <span className="shrink-0 text-xs font-medium normal-case text-[var(--text-muted)] sm:text-sm">
                {courseCountLabel}
              </span>
              <span className="sr-only">Section has no expandable list.</span>
            </div>
          )}
        </h3>
        {showSectionProgress && sectionProgress ? (
          <div className="mt-2.5 min-w-0 max-w-2xl pl-[5.125rem] sm:mt-3 sm:pl-[6.875rem]">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)] sm:text-sm">
              <span>Section progress</span>
              <span className="font-mono tabular-nums text-[var(--text-muted)]">
                {sectionProgress.percent}% · {sectionProgress.completedLessons}/{sectionProgress.totalLessons}{' '}
                lessons
              </span>
            </div>
            <div
              className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[var(--border-color)]"
              role="progressbar"
              aria-valuenow={sectionProgress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Progress for ${label}: ${sectionProgress.percent} percent, ${sectionProgress.completedLessons} of ${sectionProgress.totalLessons} lessons complete`}
            >
              <div
                className="h-full rounded-full bg-orange-500 transition-[width] duration-300 ease-out"
                style={{ width: `${sectionProgress.percent}%` }}
              />
            </div>
          </div>
        ) : null}
        {expanded || !hasExpandableContent ? (
          <>
            <ActionChips
              node={node}
              catalogCourses={catalogCourses}
              onOpenCourse={onOpenCourse}
              onOpenLesson={onOpenLesson}
              className="mt-3 pl-[5.125rem] sm:mt-2 sm:pl-[6.875rem]"
            />
            {hasExpandableContent ? (
              <ul
                id={panelId}
                role="list"
                aria-labelledby={`path-section-trigger-${node.id}`}
                hidden={!expanded}
                className="ml-4 mt-6 min-w-0 max-w-full list-none space-y-5 rounded-xl border border-[var(--border-color)]/60 bg-[var(--bg-primary)]/25 py-4 pl-4 pr-3 ring-1 ring-[var(--border-color)]/25 sm:ml-8 sm:mt-7 sm:space-y-6 sm:py-5 sm:pl-7 sm:pr-5"
              >
                {node.children.map((ch) => (
                  <li key={ch.id} className="min-w-0">
                    <OutlineNode
                      node={ch}
                      depth={1}
                      catalogCourses={catalogCourses}
                      onOpenCourse={onOpenCourse}
                      onOpenLesson={onOpenLesson}
                      progressUserId={progressUserId}
                      progressSnapshotVersion={progressSnapshotVersion}
                      isSectionExpanded={isSectionExpanded}
                      toggleSection={toggleSection}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </section>
    );
  }

  if (depth === 1) {
    return (
      <div className="min-w-0">
        <div className="flex min-w-0 items-stretch gap-3 sm:gap-4">
          <PathRowStatusLead depth={1} status={rowStatus} compactIcon={false} />
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:min-h-10 sm:flex-row sm:items-stretch sm:justify-between sm:gap-4">
            <span className="flex min-w-0 flex-1 items-center text-base font-semibold leading-snug text-[var(--text-primary)] [overflow-wrap:anywhere]">
              {label}
            </span>
            <ActionChips
              node={node}
              catalogCourses={catalogCourses}
              onOpenCourse={onOpenCourse}
              onOpenLesson={onOpenLesson}
              compact
              className="shrink-0 sm:ml-2 sm:self-stretch"
            />
          </div>
        </div>
        {node.children.length > 0 ? (
          <OutlineNestedBranch parentDepth={1}>
            {node.children.map((ch) => (
              <OutlineNestedBranchItem key={ch.id}>
                <OutlineNode
                  node={ch}
                  depth={2}
                  catalogCourses={catalogCourses}
                  onOpenCourse={onOpenCourse}
                  onOpenLesson={onOpenLesson}
                  progressUserId={progressUserId}
                  progressSnapshotVersion={progressSnapshotVersion}
                  isSectionExpanded={isSectionExpanded}
                  toggleSection={toggleSection}
                />
              </OutlineNestedBranchItem>
            ))}
          </OutlineNestedBranch>
        ) : null}
      </div>
    );
  }

  const isNestedBranch = node.children.length > 0;
  const nestedLeafLabelClass =
    depth >= 4
      ? 'text-xs leading-relaxed text-[var(--text-secondary)] [overflow-wrap:anywhere] sm:text-sm'
      : 'text-sm leading-relaxed text-[var(--text-secondary)] [overflow-wrap:anywhere] sm:text-[15px]';
  const nestedBranchLabelClass =
    depth >= 4
      ? 'text-xs font-medium leading-snug text-[var(--text-primary)] [overflow-wrap:anywhere] sm:text-sm'
      : 'text-sm font-medium leading-snug text-[var(--text-primary)] [overflow-wrap:anywhere] sm:text-[15px]';
  const nestedLabelClass = isNestedBranch ? nestedBranchLabelClass : nestedLeafLabelClass;

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-stretch gap-3 sm:gap-4">
        <PathRowStatusLead
          depth={depth}
          status={rowStatus}
          compactIcon={depth >= 4}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:min-h-10 sm:flex-row sm:items-stretch sm:justify-between sm:gap-4">
          <span className={`flex min-w-0 flex-1 items-center ${nestedLabelClass}`}>{label}</span>
          <ActionChips
            node={node}
            catalogCourses={catalogCourses}
            onOpenCourse={onOpenCourse}
            onOpenLesson={onOpenLesson}
            compact
            className="shrink-0 sm:ml-2 sm:self-stretch"
          />
        </div>
      </div>
      {node.children.length > 0 ? (
        <OutlineNestedBranch parentDepth={depth}>
          {node.children.map((ch) => (
            <OutlineNestedBranchItem key={ch.id}>
              <OutlineNode
                node={ch}
                depth={depth + 1}
                catalogCourses={catalogCourses}
                onOpenCourse={onOpenCourse}
                onOpenLesson={onOpenLesson}
                progressUserId={progressUserId}
                progressSnapshotVersion={progressSnapshotVersion}
                isSectionExpanded={isSectionExpanded}
                toggleSection={toggleSection}
              />
            </OutlineNestedBranchItem>
          ))}
        </OutlineNestedBranch>
      ) : null}
    </div>
  );
}

export type PathMindmapOutlineProps = {
  pathTitle: string;
  branches: MindmapTreeNode[];
  catalogCourses: readonly Course[];
  onOpenCourse: (courseId: string) => void;
  onOpenLesson: (courseId: string, lessonId: string) => void;
  /** Logged-in user id, or null for device-local / guest progress keys. */
  progressUserId: string | null;
  /** Bumps when returning to the path view (or storage sync) so progress re-reads from localStorage. */
  progressSnapshotVersion: number;
};

export const PathMindmapOutline: React.FC<PathMindmapOutlineProps> = ({
  pathTitle,
  branches,
  catalogCourses,
  onOpenCourse,
  onOpenLesson,
  progressUserId,
  progressSnapshotVersion,
}) => {
  const [sectionExpanded, setSectionExpanded] = useState<Record<string, boolean>>({});

  const isSectionExpanded = useCallback(
    (sectionId: string) => sectionExpanded[sectionId] !== false,
    [sectionExpanded]
  );

  const toggleSection = useCallback((sectionId: string) => {
    setSectionExpanded((prev) => {
      const open = prev[sectionId] !== false;
      return { ...prev, [sectionId]: !open };
    });
  }, []);

  return (
    <div
      className="min-w-0 rounded-xl border border-[var(--border-color)]/90 bg-[var(--bg-primary)]/25 px-4 py-5 sm:px-6 sm:py-7"
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
              progressUserId={progressUserId}
              progressSnapshotVersion={progressSnapshotVersion}
              isSectionExpanded={isSectionExpanded}
              toggleSection={toggleSection}
            />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
