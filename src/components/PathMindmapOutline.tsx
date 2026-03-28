import React, { useCallback, useId, useMemo, useState } from 'react';
import { Check, ChevronDown, Circle, Info, Lock } from 'lucide-react';
import type { Course } from '../data/courses';
import type { MindmapTreeNode } from '../data/pathMindmap';
import { getCourseLessonProgressSummary, type CourseLessonProgressSummary } from '../utils/courseProgress';
import { getPathOutlineRowStatus, type PathOutlineRowStatus } from '../utils/pathOutlineRowStatus';
import { computePathSectionProgress, countCatalogCoursesInSubtree } from '../utils/pathSectionProgress';

/**
 * Toggle nested branch on row click; ignore links and non-chevron buttons (e.g. Open course / Continue / Review).
 * Chevron uses `data-outline-branch-chevron` so it is not treated as an unrelated button.
 */
function handleOutlineBranchHeaderClick(
  e: React.MouseEvent<HTMLDivElement>,
  hasNested: boolean,
  nodeId: string,
  toggleBranch: (id: string) => void
) {
  if (!hasNested) return;
  const el = e.target as HTMLElement;
  if (el.closest('a')) return;
  if (el.closest('[role="progressbar"]')) return;
  const btn = el.closest('button');
  if (btn != null && !btn.hasAttribute('data-outline-branch-chevron')) return;
  toggleBranch(nodeId);
}

function handleSectionHeaderClick(
  e: React.MouseEvent<HTMLDivElement>,
  hasExpandable: boolean,
  nodeId: string,
  toggleSection: (id: string) => void
) {
  if (!hasExpandable) return;
  const el = e.target as HTMLElement;
  if (el.closest('a')) return;
  if (el.closest('[role="progressbar"]')) return;
  const btn = el.closest('button');
  if (btn != null && !btn.hasAttribute('data-outline-section-chevron')) return;
  toggleSection(nodeId);
}

/**
 * For each outline node with nested children, the ids of its **siblings** (same parent)
 * that also have nested children. Accordion closes siblings only, not ancestors.
 */
function buildNestedBranchSiblingMap(sectionRoots: MindmapTreeNode[]): Map<string, string[]> {
  const map = new Map<string, string[]>();

  const registerUnderParent = (parent: MindmapTreeNode) => {
    const siblingToggleIds = parent.children.filter((c) => c.children.length > 0).map((c) => c.id);
    for (const ch of parent.children) {
      if (ch.children.length > 0) {
        map.set(ch.id, siblingToggleIds);
      }
      walk(ch);
    }
  };

  const walk = (n: MindmapTreeNode) => {
    if (n.children.length === 0) return;
    registerUnderParent(n);
  };

  for (const section of sectionRoots) {
    registerUnderParent(section);
  }
  return map;
}

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

/** Same layout as course rows: fixed `sm:w-[11rem]` column for label + bar. */
function PathOutlineProgressColumn({
  label,
  monoStats,
  percent,
  ariaLabel,
}: {
  label: string;
  monoStats: string;
  percent: number;
  ariaLabel: string;
}) {
  return (
    <div className="flex w-full min-w-0 shrink-0 flex-col justify-center gap-0.5 sm:w-[11rem] sm:flex-none">
      <div className="flex flex-nowrap items-center justify-between gap-x-2 text-[11px] leading-tight text-[var(--text-secondary)] sm:text-xs">
        <span className="min-w-0 shrink font-medium">{label}</span>
        <span className="shrink-0 font-mono tabular-nums text-[var(--text-muted)]">{monoStats}</span>
      </div>
      <div
        className="h-1.5 w-full min-w-0 overflow-hidden rounded-full bg-[var(--border-color)] sm:h-2"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel}
      >
        <div
          className="h-full rounded-full bg-orange-500 transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function OutlineCourseProgressBlock({
  rowLabel,
  summary,
}: {
  rowLabel: string;
  summary: CourseLessonProgressSummary;
}) {
  if (summary.totalLessons === 0) return null;
  return (
    <PathOutlineProgressColumn
      label="Course progress"
      monoStats={`${summary.percent}% · ${summary.completedLessons}/${summary.totalLessons}`}
      percent={summary.percent}
      ariaLabel={`Course progress for ${rowLabel}: ${summary.percent} percent, ${summary.completedLessons} of ${summary.totalLessons} lessons complete`}
    />
  );
}

function ActionChips({
  node,
  catalogCourses,
  onOpenCourse,
  onOpenLesson,
  compact,
  className,
  courseLessonProgressSummary,
}: {
  node: MindmapTreeNode;
  catalogCourses: readonly Course[];
  onOpenCourse: (courseId: string) => void;
  onOpenLesson: (courseId: string, lessonId: string) => void;
  compact?: boolean;
  className?: string;
  /** When set for a course row: complete → “Review”, in progress → “Continue”, not started → “Open course”. */
  courseLessonProgressSummary?: CourseLessonProgressSummary | null;
}) {
  const { canOpenCourse, canOpenLesson, missingCatalog, courseId, lessonId } = resolveActions(
    node,
    catalogCourses
  );
  const btn =
    compact === true
      ? 'min-h-10 px-2.5 text-[11px] sm:px-3 sm:text-xs'
      : 'min-h-10 px-3 text-xs';

  const rowLabel = node.label.trim() || node.id;
  const summary = courseLessonProgressSummary;
  const coursePlaybackComplete =
    summary != null &&
    summary.totalLessons > 0 &&
    summary.completedLessons === summary.totalLessons;
  const courseInProgress =
    summary != null &&
    summary.totalLessons > 0 &&
    summary.completedLessons > 0 &&
    summary.completedLessons < summary.totalLessons;

  if (!canOpenCourse && !canOpenLesson && !missingCatalog) return null;

  const openCourseBtnClass = coursePlaybackComplete
    ? `inline-flex w-full shrink-0 items-center justify-center rounded-lg border border-[var(--path-review-btn-border)] bg-transparent font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 sm:w-[7.25rem] ${btn}`
    : courseInProgress
      ? `inline-flex w-full shrink-0 items-center justify-center rounded-lg border border-orange-500 bg-transparent font-medium text-orange-500 transition-colors hover:bg-orange-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 sm:w-[7.25rem] ${btn}`
      : `inline-flex w-full shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--path-open-course-border)] bg-transparent font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 sm:w-[7.25rem] ${btn}`;

  const courseCtaLabel = coursePlaybackComplete ? 'Review' : courseInProgress ? 'Continue' : 'Open course';
  const courseCtaAria = coursePlaybackComplete
    ? `Review completed course: ${rowLabel}`
    : courseInProgress
      ? `Continue course: ${rowLabel}`
      : `Open course: ${rowLabel}`;

  return (
    <span
      className={`flex flex-col items-stretch ${compact === true ? 'gap-1 sm:gap-1.5' : 'gap-2'} sm:flex-row sm:flex-wrap sm:items-center ${className ?? ''}`}
    >
      {canOpenCourse && courseId ? (
        <button
          type="button"
          onClick={() => onOpenCourse(courseId)}
          className={openCourseBtnClass}
          aria-label={courseCtaAria}
        >
          {courseCtaLabel}
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

/** Half-filled disk (right semicircle) inside a stroked ring — reads as partial progress vs empty ○ for not started. */
function OutlineInProgressLeadIcon({ size }: { size: number }) {
  const clipId = `path-outline-ip-${useId().replace(/:/g, '')}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      aria-hidden
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="12" y="0" width="12" height="24" />
        </clipPath>
      </defs>
      <circle
        cx="12"
        cy="12"
        r="9"
        className="stroke-[var(--text-muted)]"
        strokeWidth="2"
        fill="none"
      />
      <circle cx="12" cy="12" r="7" className="fill-orange-500" clipPath={`url(#${clipId})`} />
    </svg>
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
        <OutlineInProgressLeadIcon size={ic} />
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

/** Expandable rows use the chevron only; label rows are structural (no course/lesson status bullets). */
function OutlineBranchStatusLeadSlot({
  hasNested,
  isLabel,
  depth,
  status,
  compactIcon = false,
}: {
  hasNested: boolean;
  isLabel: boolean;
  depth: number;
  status: PathOutlineRowStatus | null;
  compactIcon?: boolean;
}) {
  const box = 'flex w-7 shrink-0 items-center justify-center self-stretch sm:w-8';
  if (hasNested || isLabel) {
    return <div className={box} aria-hidden />;
  }
  return <PathRowStatusLead depth={depth} status={status} compactIcon={compactIcon} />;
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
  const marginTop = parentDepth === 1 ? 'mt-0.5 sm:mt-1' : 'mt-0.5 sm:mt-1';
  return (
    <div className={`min-w-0 ${marginTop} ${outerPad}`}>
      <ul
        role="list"
        className="relative list-none space-y-1 rounded-bl-md rounded-tl-md border-l-2 border-[var(--border-color)]/70 bg-[var(--bg-primary)]/20 py-0.5 pl-3 sm:space-y-1 sm:rounded-bl-lg sm:rounded-tl-lg sm:py-1 sm:pl-4"
      >
        {children}
      </ul>
    </div>
  );
}

function OutlineNestedBranchItem({
  children,
}: {
  children: React.ReactNode;
  /** List `key` is valid on this component; not passed through to the DOM. */
  key?: React.Key;
}) {
  return (
    <li className="relative min-w-0 before:pointer-events-none before:absolute before:left-0 before:top-[0.95rem] before:z-0 before:h-px before:w-4 before:-translate-x-full before:bg-[var(--border-color)]/70 sm:before:top-4 sm:before:w-5">
      {children}
    </li>
  );
}

/** Chevron + spacer so nested rows with and without children stay aligned. */
function OutlineBranchExpandControl({
  nodeId,
  hasChildren,
  expanded,
}: {
  nodeId: string;
  hasChildren: boolean;
  expanded: boolean;
}) {
  const panelId = `path-branch-panel-${nodeId}`;
  if (!hasChildren) {
    return <span className="flex w-10 shrink-0 sm:w-11" aria-hidden />;
  }
  return (
    <button
      type="button"
      data-outline-branch-chevron=""
      className="flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-bg)]/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 touch-manipulation sm:min-h-11 sm:min-w-11"
      aria-expanded={expanded}
      aria-controls={panelId}
      aria-label={expanded ? 'Collapse nested items' : 'Expand nested items'}
    >
      <ChevronDown
        size={20}
        className={`shrink-0 transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`}
        aria-hidden
      />
    </button>
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
  isBranchExpanded,
  toggleBranch,
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
  isBranchExpanded: (nodeId: string) => boolean;
  toggleBranch: (nodeId: string) => void;
}) {
  const label = node.label.trim() || node.id;
  const isLabelRow = nodeKind(node) === 'label';

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

  const courseLessonProgressSummary = useMemo(() => {
    if (nodeKind(node) !== 'course' || !node.courseId) return null;
    const c = catalogCourses.find((x) => x.id === node.courseId);
    if (!c) return null;
    return getCourseLessonProgressSummary(c, progressUserId);
  }, [node, catalogCourses, progressUserId, progressSnapshotVersion]);

  if (depth === 0) {
    const showSectionProgress = sectionProgress != null && sectionProgress.totalCourses > 0;
    const childCount = node.children.length;
    const hasExpandableContent = childCount > 0;
    const expanded = isSectionExpanded(node.id);
    const panelId = `path-section-panel-${node.id}`;
    const isEmptySection = !hasExpandableContent && childCount === 0;
    /** Has subtree rows but nothing maps to the published catalog (shows “0 courses” otherwise). */
    const isZeroCatalogCourses = !isEmptySection && catalogCourseCount === 0;
    const showNoCoursesInSectionUx = isEmptySection || isZeroCatalogCourses;
    const courseCountLabel =
      showNoCoursesInSectionUx
        ? null
        : catalogCourseCount === 1
          ? '1 course'
          : `${catalogCourseCount} courses`;

    const sectionProgressColumn =
      showSectionProgress && sectionProgress ? (
        <PathOutlineProgressColumn
          label="Section Progress"
          monoStats={`${sectionProgress.percent}% · ${sectionProgress.completedCourses}/${sectionProgress.totalCourses}`}
          percent={sectionProgress.percent}
          ariaLabel={`Section progress for ${label}: ${sectionProgress.percent} percent, ${sectionProgress.completedCourses} of ${sectionProgress.totalCourses} courses complete`}
        />
      ) : null;

    return (
      <section className="mt-1.5 scroll-mt-2 border-t border-[var(--border-color)] pt-1.5 first:mt-0 first:border-t-0 first:pt-0">
        <h3 className="min-w-0 pl-3 leading-snug text-[var(--text-primary)] sm:pl-6">
          <div
            className={`flex min-w-0 items-center gap-0.5 sm:gap-1.5${
              hasExpandableContent
                ? ' cursor-pointer rounded-lg py-1 pl-0.5 pr-1 transition-colors hover:bg-[var(--hover-bg)]/80 sm:pl-1 sm:pr-1.5'
                : ' py-1'
            }`}
            onClick={
              hasExpandableContent
                ? (e) => handleSectionHeaderClick(e, hasExpandableContent, node.id, toggleSection)
                : undefined
            }
          >
            {hasExpandableContent ? (
              <button
                type="button"
                data-outline-section-chevron=""
                className="flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-bg)]/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 touch-manipulation sm:min-h-11 sm:min-w-11"
                aria-expanded={expanded}
                aria-controls={panelId}
                id={`path-section-trigger-${node.id}`}
                aria-label={expanded ? 'Collapse section' : 'Expand section'}
              >
                <ChevronDown
                  size={20}
                  className={`shrink-0 transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`}
                  aria-hidden
                />
              </button>
            ) : (
              <button
                type="button"
                disabled
                className="flex min-h-10 min-w-10 shrink-0 cursor-not-allowed items-center justify-center rounded-md text-[var(--text-muted)] opacity-45 sm:min-h-11 sm:min-w-11"
                aria-label="Nothing to expand. This section has no courses or topics in the list below."
              >
                <ChevronDown
                  size={20}
                  className="shrink-0 -rotate-90 transition-transform duration-200"
                  aria-hidden
                />
              </button>
            )}
            <div className="flex w-8 shrink-0 items-center justify-end text-lg font-bold leading-snug tabular-nums text-orange-500 sm:w-9 sm:text-xl">
              {sectionIndex + 1}.
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2.5">
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 sm:min-w-0 sm:flex-row sm:items-center sm:gap-2.5">
                <span
                  id={`path-section-title-${node.id}`}
                  className="flex min-w-0 items-center text-lg font-bold leading-snug [overflow-wrap:anywhere] sm:text-xl"
                  aria-describedby={
                    showNoCoursesInSectionUx
                      ? node.locked
                        ? `path-section-locked-hint-${node.id}`
                        : `path-section-empty-hint-${node.id}`
                      : undefined
                  }
                >
                  {label}
                </span>
                <div className="flex min-w-0 w-full flex-1 justify-end">
                  <div className="flex w-[18rem] max-w-full min-w-0 flex-col items-end justify-center sm:items-start">
                    {showNoCoursesInSectionUx ? (
                      node.locked ? (
                        <span className="inline-flex max-w-full items-center gap-1.5 text-xs font-medium normal-case text-[var(--text-muted)] sm:text-sm">
                          <Lock
                            size={15}
                            className="shrink-0 text-[var(--text-muted)]"
                            strokeWidth={2.25}
                            aria-hidden
                          />
                          <span className="[overflow-wrap:anywhere]">Content locked</span>
                        </span>
                      ) : (
                        <span className="inline-flex max-w-full items-center gap-0.5 text-xs font-medium normal-case text-[var(--text-muted)] sm:gap-1.5 sm:text-sm">
                          <span className="[overflow-wrap:anywhere]">No courses added yet</span>
                          <button
                            type="button"
                            title="No courses are linked to this section yet. Check back later—more content may be added."
                            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-bg)]/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 touch-manipulation sm:min-h-8 sm:min-w-8 sm:hover:bg-transparent"
                            aria-label="Details: No courses are linked to this section yet. Check back later—more content may be added."
                          >
                            <Info size={15} strokeWidth={2.25} aria-hidden />
                          </button>
                        </span>
                      )
                    ) : (
                      <span className="text-xs font-medium normal-case text-[var(--text-muted)] sm:text-sm">
                        {courseCountLabel}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div
                className={
                  showSectionProgress
                    ? 'w-full min-w-0 shrink-0 sm:w-[11rem] sm:flex-none'
                    : 'hidden min-h-0 w-full shrink-0 sm:block sm:w-[11rem] sm:flex-none'
                }
                aria-hidden={!showSectionProgress}
              >
                {sectionProgressColumn}
              </div>
            </div>
          </div>
          {showNoCoursesInSectionUx && node.locked ? (
            <span id={`path-section-locked-hint-${node.id}`} className="sr-only">
              This section is locked. You do not have access yet. Nothing is wrong with your account.
            </span>
          ) : null}
          {showNoCoursesInSectionUx && !node.locked ? (
            <span id={`path-section-empty-hint-${node.id}`} className="sr-only">
              No courses are linked to this section yet. Check back later—new content may be added.
            </span>
          ) : null}
        </h3>
        {expanded || !hasExpandableContent ? (
          <>
            <ActionChips
              node={node}
              catalogCourses={catalogCourses}
              onOpenCourse={onOpenCourse}
              onOpenLesson={onOpenLesson}
              className="mt-1 pl-[4.875rem] sm:mt-1 sm:pl-[6.375rem]"
            />
            {hasExpandableContent ? (
              <ul
                id={panelId}
                role="list"
                aria-labelledby={`path-section-title-${node.id}`}
                hidden={!expanded}
                className="ml-4 mt-1 min-w-0 max-w-full list-none space-y-1 rounded-xl border border-[var(--border-color)]/60 bg-[var(--bg-primary)]/25 py-1 pl-4 pr-3 ring-1 ring-[var(--border-color)]/25 sm:ml-8 sm:mt-1.5 sm:space-y-1 sm:py-1.5 sm:pl-7 sm:pr-5"
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
                      isBranchExpanded={isBranchExpanded}
                      toggleBranch={toggleBranch}
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
    const hasNested = node.children.length > 0;
    const nestedOpen = isBranchExpanded(node.id);
    return (
      <div className="min-w-0">
        <div
          className={`flex min-w-0 items-center gap-0.5 sm:gap-1.5${
            hasNested
              ? ' min-h-10 cursor-pointer rounded-lg py-0.5 pl-0.5 pr-1 transition-colors hover:bg-[var(--hover-bg)]/50 sm:min-h-11 sm:py-0.5 sm:pl-1 sm:pr-1.5'
              : ''
          }`}
          onClick={
            hasNested
              ? (e) => handleOutlineBranchHeaderClick(e, hasNested, node.id, toggleBranch)
              : undefined
          }
        >
          <OutlineBranchExpandControl
            nodeId={node.id}
            hasChildren={hasNested}
            expanded={nestedOpen}
          />
          <OutlineBranchStatusLeadSlot
            hasNested={hasNested}
            isLabel={isLabelRow}
            depth={1}
            status={rowStatus}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
              <span className="flex min-w-0 items-center text-base font-semibold leading-snug text-[var(--text-primary)] [overflow-wrap:anywhere]">
                {label}
              </span>
            </div>
            {courseLessonProgressSummary ? (
              <OutlineCourseProgressBlock rowLabel={label} summary={courseLessonProgressSummary} />
            ) : null}
            <ActionChips
              node={node}
              catalogCourses={catalogCourses}
              onOpenCourse={onOpenCourse}
              onOpenLesson={onOpenLesson}
              compact
              className="shrink-0 sm:ml-2"
              courseLessonProgressSummary={courseLessonProgressSummary}
            />
          </div>
        </div>
        {hasNested ? (
          <div id={`path-branch-panel-${node.id}`} hidden={!nestedOpen}>
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
                    isBranchExpanded={isBranchExpanded}
                    toggleBranch={toggleBranch}
                  />
                </OutlineNestedBranchItem>
              ))}
            </OutlineNestedBranch>
          </div>
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
  const hasNested = node.children.length > 0;
  const nestedOpen = isBranchExpanded(node.id);

  return (
    <div className="min-w-0">
      <div
        className={`flex min-w-0 items-center gap-0.5 sm:gap-1.5${
          hasNested
            ? ' min-h-10 cursor-pointer rounded-lg py-0.5 pl-0.5 pr-1 transition-colors hover:bg-[var(--hover-bg)]/50 sm:min-h-11 sm:py-0.5 sm:pl-1 sm:pr-1.5'
            : ''
        }`}
        onClick={
          hasNested
            ? (e) => handleOutlineBranchHeaderClick(e, hasNested, node.id, toggleBranch)
            : undefined
        }
      >
        <OutlineBranchExpandControl
          nodeId={node.id}
          hasChildren={hasNested}
          expanded={nestedOpen}
        />
        <OutlineBranchStatusLeadSlot
          hasNested={hasNested}
          isLabel={isLabelRow}
          depth={depth}
          status={rowStatus}
          compactIcon={depth >= 4}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
            <span className={`flex min-w-0 items-center ${nestedLabelClass}`}>{label}</span>
          </div>
          {courseLessonProgressSummary ? (
            <OutlineCourseProgressBlock rowLabel={label} summary={courseLessonProgressSummary} />
          ) : null}
          <ActionChips
            node={node}
            catalogCourses={catalogCourses}
            onOpenCourse={onOpenCourse}
            onOpenLesson={onOpenLesson}
            compact
            className="shrink-0 sm:ml-2"
            courseLessonProgressSummary={courseLessonProgressSummary}
          />
        </div>
      </div>
      {hasNested ? (
        <div id={`path-branch-panel-${node.id}`} hidden={!nestedOpen}>
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
                  isBranchExpanded={isBranchExpanded}
                  toggleBranch={toggleBranch}
                />
              </OutlineNestedBranchItem>
            ))}
          </OutlineNestedBranch>
        </div>
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
  const [branchExpanded, setBranchExpanded] = useState<Record<string, boolean>>({});

  const nestedBranchSiblingMap = useMemo(
    () => buildNestedBranchSiblingMap(branches),
    [branches]
  );

  const isSectionExpanded = useCallback(
    (sectionId: string) => sectionExpanded[sectionId] !== false,
    [sectionExpanded]
  );

  const toggleSection = useCallback(
    (sectionId: string) => {
      let openedThisSection = false;
      setSectionExpanded((prev) => {
        const wasOpen = prev[sectionId] !== false;
        if (wasOpen) {
          return { ...prev, [sectionId]: false };
        }
        openedThisSection = true;
        const next: Record<string, boolean> = {};
        for (const b of branches) {
          next[b.id] = b.id === sectionId;
        }
        return next;
      });
      if (openedThisSection) {
        setBranchExpanded({});
      }
    },
    [branches]
  );

  const isBranchExpanded = useCallback(
    (nodeId: string) => branchExpanded[nodeId] !== false,
    [branchExpanded]
  );

  const toggleBranch = useCallback(
    (nodeId: string) => {
      setBranchExpanded((prev) => {
        const wasOpen = prev[nodeId] !== false;
        if (wasOpen) {
          return { ...prev, [nodeId]: false };
        }
        const next = { ...prev };
        const siblingIds = nestedBranchSiblingMap.get(nodeId);
        if (siblingIds) {
          for (const sid of siblingIds) {
            if (sid !== nodeId) next[sid] = false;
          }
        }
        delete next[nodeId];
        return next;
      });
    },
    [nestedBranchSiblingMap]
  );

  return (
    <div
      className="min-w-0 rounded-xl border border-[var(--border-color)]/90 bg-[var(--bg-primary)]/25 px-4 py-2 sm:px-6 sm:py-2"
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
              isBranchExpanded={isBranchExpanded}
              toggleBranch={toggleBranch}
            />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
