import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Circle,
  FastForward,
  Info,
  Link2,
  ListVideo,
  Lock,
  Play,
  RotateCcw,
} from 'lucide-react';
import type { Course } from '../data/courses';
import { filterOutlineBranchesForViewer, type MindmapTreeNode } from '../data/pathMindmap';
import { getCourseLessonProgressSummary, type CourseLessonProgressSummary } from '../utils/courseProgress';
import { getPathOutlineRowStatus, type PathOutlineRowStatus } from '../utils/pathOutlineRowStatus';
import {
  computePathSectionProgress,
  countCatalogCoursesInSubtree,
  countExternalLinksInSubtree,
} from '../utils/pathSectionProgress';
import { normalizeExternalHref } from '../utils/externalUrl';
import {
  readPathMindmapOutlineExpand,
  writePathMindmapOutlineExpand,
} from '../utils/pathOutlineUiSession';

/** Matches Tailwind `md` (768px): flat path outline on small viewports. */
function useOutlineCompactMobile(): boolean {
  const [v, setV] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const run = () => setV(mq.matches);
    run();
    mq.addEventListener('change', run);
    return () => mq.removeEventListener('change', run);
  }, []);
  return v;
}

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

function nodeKind(n: MindmapTreeNode): 'label' | 'course' | 'lesson' | 'link' | 'divider' {
  if (n.kind === 'divider') return 'divider';
  if (n.kind === 'course' && n.courseId) return 'course';
  if (n.kind === 'lesson' && n.courseId && n.lessonId) return 'lesson';
  if (n.kind === 'link' && n.externalUrl) return 'link';
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
  if (k === 'divider') {
    return {
      canOpenCourse: false,
      canOpenLesson: false,
      missingCatalog: false,
      courseId: undefined,
      lessonId: undefined,
    };
  }
  if (k === 'link') {
    return {
      canOpenCourse: false,
      canOpenLesson: false,
      missingCatalog: false,
      courseId: undefined,
      lessonId: undefined,
    };
  }
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

function clampOutlinePercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function OutlineCourseTaxonomyChips({ course }: { course: Course }) {
  const level = course.level?.trim();
  const skills = (course.skills ?? []).map((s) => s.trim()).filter(Boolean);
  const cats = (course.categories ?? []).map((s) => s.trim()).filter(Boolean);
  const chips: string[] = [];
  if (level) chips.push(level);
  for (const s of skills) {
    if (chips.length >= 4) break;
    chips.push(s);
  }
  for (const c of cats) {
    if (chips.length >= 4) break;
    if (!chips.some((x) => x.toLowerCase() === c.toLowerCase())) chips.push(c);
  }
  if (chips.length === 0) return null;
  return (
    <div className="mt-1 flex min-w-0 max-w-full flex-wrap gap-1">
      {chips.map((text, i) => (
        <span
          key={`${i}-${text}`}
          className="max-w-[10rem] truncate rounded-md border border-[var(--border-color)]/80 bg-[var(--bg-primary)]/50 px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)] sm:text-[11px]"
          title={text}
        >
          {text}
        </span>
      ))}
    </div>
  );
}

/**
 * Compact circular progress for path rows (mobile / max-md only in layout).
 * Track reads as neutral/white; progress arc is emerald (full ring at 100%, empty at 0%).
 */
function PathOutlineProgressRingMobile({
  percent,
  ariaLabel,
  size = 40,
  strokeWidth = 3,
  className = '',
}: {
  percent: number;
  ariaLabel: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const p = clampOutlinePercent(percent);
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (p / 100) * circumference;

  return (
    <div
      className={`relative shrink-0 ${className}`}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={p}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      <svg width={size} height={size} className="block -rotate-90" aria-hidden>
        {/* Track: light ring (reads as “empty” / white-ish) */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          className="stroke-[var(--bg-primary)] dark:stroke-[var(--border-color)]"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          className="stroke-emerald-500 transition-[stroke-dashoffset] duration-300 ease-out"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums leading-none text-[var(--text-primary)]">
        {p}%
      </span>
    </div>
  );
}

/**
 * Desktop (`md+`): fixed two-column rail so “Section Progress” and “Course progress” start on the same
 * vertical line and stay aligned with the Open course / Continue button column (`7.25rem`).
 */
const PATH_OUTLINE_DESKTOP_PROGRESS_RAIL =
  'contents md:grid md:shrink-0 md:grid-cols-[11rem_7.25rem] md:gap-2 md:items-center';

/** Same layout as course rows: fixed `sm:w-[11rem]` column for label + bar (md+). */
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

function outlineCourseProgressAria(rowLabel: string, summary: CourseLessonProgressSummary) {
  return `Course progress for ${rowLabel}: ${summary.percent} percent, ${summary.completedLessons} of ${summary.totalLessons} lessons complete`;
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
    <div className="hidden min-w-0 w-full md:block">
      <PathOutlineProgressColumn
        label="Course progress"
        monoStats={`${summary.percent}% · ${summary.completedLessons}/${summary.totalLessons}`}
        percent={summary.percent}
        ariaLabel={outlineCourseProgressAria(rowLabel, summary)}
      />
    </div>
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
  /** Below `md`: icon-only primary CTA (play / continue / review); labels stay in `aria-label`. */
  iconOnlyMobile = false,
}: {
  node: MindmapTreeNode;
  catalogCourses: readonly Course[];
  onOpenCourse: (courseId: string) => void;
  onOpenLesson: (courseId: string, lessonId: string) => void;
  compact?: boolean;
  className?: string;
  /** When set for a course row: complete → “Review”, in progress → “Continue”, not started → “Open course”. */
  courseLessonProgressSummary?: CourseLessonProgressSummary | null;
  iconOnlyMobile?: boolean;
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

  const sizeMobileIcon =
    'h-10 w-10 min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg p-0 md:h-auto md:min-h-10 md:w-[7.25rem] md:px-3 md:py-2';
  const sizeDefault = `w-full shrink-0 sm:w-[7.25rem] ${btn}`;
  const sizeClass = iconOnlyMobile ? sizeMobileIcon : sizeDefault;

  const openCourseBtnClass = coursePlaybackComplete
    ? `inline-flex items-center justify-center border border-[var(--path-review-btn-border)] bg-transparent font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${sizeClass} ${iconOnlyMobile ? 'md:text-xs' : ''}`
    : courseInProgress
      ? `inline-flex items-center justify-center border border-orange-500 bg-transparent font-medium text-orange-500 transition-colors hover:bg-orange-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${sizeClass} ${iconOnlyMobile ? 'md:text-xs' : ''}`
      : `inline-flex items-center justify-center border border-dashed border-[var(--path-open-course-border)] bg-transparent font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${sizeClass} ${iconOnlyMobile ? 'md:text-xs' : ''}`;

  const courseCtaLabel = coursePlaybackComplete ? 'Review' : courseInProgress ? 'Continue' : 'Open course';
  const courseCtaAria = coursePlaybackComplete
    ? `Review completed course: ${rowLabel}`
    : courseInProgress
      ? `Continue course: ${rowLabel}`
      : `Open course: ${rowLabel}`;

  const courseCtaIcon =
    coursePlaybackComplete ? (
      <RotateCcw className="h-[18px] w-[18px] shrink-0 md:hidden" strokeWidth={2.25} aria-hidden />
    ) : courseInProgress ? (
      <FastForward className="h-[18px] w-[18px] shrink-0 md:hidden" strokeWidth={2.25} aria-hidden />
    ) : (
      <Play className="h-[18px] w-[18px] shrink-0 md:hidden" strokeWidth={2.25} aria-hidden />
    );

  const lessonBtnClass = iconOnlyMobile
    ? `inline-flex items-center justify-center rounded border border-[var(--border-light)] bg-transparent font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--hover-bg)] ${sizeMobileIcon} md:text-xs`
    : `inline-flex w-full shrink-0 items-center justify-center rounded border border-[var(--border-light)] bg-transparent font-medium text-[var(--text-primary)] hover:bg-[var(--hover-bg)] sm:w-[7.25rem] ${btn}`;

  const wrapClass = iconOnlyMobile
    ? `flex shrink-0 flex-row flex-nowrap items-center gap-1.5 ${className ?? ''}`
    : `flex flex-col items-stretch ${compact === true ? 'gap-1 sm:gap-1.5' : 'gap-2'} sm:flex-row sm:flex-wrap sm:items-center ${className ?? ''}`;

  return (
    <span className={wrapClass}>
      {canOpenCourse && courseId ? (
        <button type="button" onClick={() => onOpenCourse(courseId)} className={openCourseBtnClass} aria-label={courseCtaAria}>
          {iconOnlyMobile ? courseCtaIcon : null}
          <span className={iconOnlyMobile ? 'hidden md:inline' : undefined}>{courseCtaLabel}</span>
        </button>
      ) : null}
      {canOpenLesson && courseId && lessonId ? (
        <button
          type="button"
          onClick={() => onOpenLesson(courseId, lessonId)}
          className={lessonBtnClass}
          aria-label={`Open lesson for ${rowLabel}`}
        >
          {iconOnlyMobile ? (
            <ListVideo className="h-[18px] w-[18px] shrink-0 md:hidden" strokeWidth={2.25} aria-hidden />
          ) : null}
          <span className={iconOnlyMobile ? 'hidden md:inline' : undefined}>Open lesson</span>
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
  /** Same row as title (`items-center`); no `self-stretch` (mobile path outline). */
  inlineWithTitle = false,
  /** External web link row (blog, article) — not catalog progress. */
  externalLink = false,
}: {
  depth: number;
  status: PathOutlineRowStatus | null;
  /** Tighter icons for deep nesting (mobile-first). */
  compactIcon?: boolean;
  inlineWithTitle?: boolean;
  externalLink?: boolean;
}) {
  const box = inlineWithTitle
    ? 'flex w-7 shrink-0 items-center justify-center sm:w-8'
    : 'flex w-7 shrink-0 items-center justify-center self-stretch sm:w-8';
  const ic = compactIcon ? 17 : 20;
  if (externalLink) {
    return (
      <div className={box} role="img" aria-label="External web link">
        <Link2 className="text-violet-500" size={ic} strokeWidth={2.25} aria-hidden />
      </div>
    );
  }
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
  externalLink = false,
}: {
  hasNested: boolean;
  isLabel: boolean;
  depth: number;
  status: PathOutlineRowStatus | null;
  compactIcon?: boolean;
  externalLink?: boolean;
}) {
  const box = 'flex w-7 shrink-0 items-center justify-center self-stretch sm:w-8';
  if (hasNested || isLabel) {
    return <div className={box} aria-hidden />;
  }
  return (
    <PathRowStatusLead depth={depth} status={status} compactIcon={compactIcon} externalLink={externalLink} />
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
  /** Each nested list steps in by `pl-2` on mobile to match course-row inset (`max-md:pl-2` on row content). */
  const outerPad =
    parentDepth === 1
      ? 'pl-0 max-md:pl-2 md:pl-12'
      : parentDepth === 2
        ? 'pl-0 max-md:pl-2 md:pl-10'
        : 'pl-0 max-md:pl-2 md:pl-8';
  const marginTop = parentDepth === 1 ? 'mt-0.5 sm:mt-1' : 'mt-0.5 sm:mt-1';
  return (
    <div className={`min-w-0 ${marginTop} ${outerPad}`}>
      <ul
        role="list"
        className="relative list-none space-y-2 py-0 pl-0 md:space-y-1 md:rounded-bl-lg md:rounded-tl-md md:border-l-2 md:border-[var(--border-color)]/70 md:bg-[var(--bg-primary)]/20 md:py-1 md:pl-4"
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
    <li className="relative min-w-0 before:pointer-events-none before:absolute before:left-0 before:top-[0.95rem] before:z-0 before:hidden before:h-px before:w-4 before:-translate-x-full before:bg-[var(--border-color)]/70 md:before:block sm:before:top-4 sm:before:w-5">
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
    return <span className="hidden w-10 shrink-0 sm:w-11 md:inline-flex" aria-hidden />;
  }
  return (
    <button
      type="button"
      data-outline-branch-chevron=""
      className="hidden min-h-10 min-w-10 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-bg)]/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 touch-manipulation md:flex sm:min-h-11 sm:min-w-11"
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
  outlineCompactMobile,
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
  /** Below `md`: no chevrons / borders / indent; all sections & branches shown expanded. */
  outlineCompactMobile: boolean;
}) {
  const label = node.label.trim() || node.id;
  const nk = nodeKind(node);
  const isLabelRow = nk === 'label';
  const safeLinkHref =
    nk === 'link' && node.externalUrl ? normalizeExternalHref(node.externalUrl) : null;

  const sectionProgress = useMemo(() => {
    if (depth !== 0) return null;
    return computePathSectionProgress(node, catalogCourses, progressUserId);
  }, [depth, node, catalogCourses, progressUserId, progressSnapshotVersion]);

  const catalogCourseCount = useMemo(() => {
    if (depth !== 0) return 0;
    return countCatalogCoursesInSubtree(node, catalogCourses);
  }, [depth, node, catalogCourses]);

  const externalLinkCountInSection = useMemo(() => {
    if (depth !== 0) return 0;
    return countExternalLinksInSubtree(node);
  }, [depth, node]);

  const rowStatus = useMemo(() => {
    if (depth === 0) return null;
    return getPathOutlineRowStatus(node, catalogCourses, progressUserId);
  }, [depth, node, catalogCourses, progressUserId, progressSnapshotVersion]);

  const courseLessonProgressSummary = useMemo(() => {
    if (nk !== 'course' || !node.courseId) return null;
    const c = catalogCourses.find((x) => x.id === node.courseId);
    if (!c) return null;
    return getCourseLessonProgressSummary(c, progressUserId);
  }, [nk, node, catalogCourses, progressUserId, progressSnapshotVersion]);

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
    /** Catalog courses or external web links — without either, the section has nothing useful to expand into. */
    const sectionHasUsefulContent =
      catalogCourseCount > 0 || externalLinkCountInSection > 0;
    const canExpandSection = hasExpandableContent && sectionHasUsefulContent;
    /** Non-expandable sections stay fully visible; expandable ones use accordion (default collapsed). */
    const showSectionBody =
      !hasExpandableContent || !canExpandSection || expanded;
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
      <section className="mt-1.5 scroll-mt-2 border-t border-[var(--border-color)] pt-1.5 first:mt-0 first:border-t-0 first:pt-0 max-md:mt-3 max-md:border-0 max-md:pt-0 first:max-md:mt-0">
        <h3 className="min-w-0 max-w-full pl-0 leading-snug text-[var(--text-primary)] md:pl-6 md:pr-5">
          <div
            className={`flex min-w-0 max-w-full items-start gap-1 sm:items-center sm:gap-1.5${
              canExpandSection
                ? ' cursor-pointer rounded-lg py-1 pl-0.5 pr-1 transition-colors hover:bg-[var(--hover-bg)]/80 sm:pl-1 sm:pr-1.5'
                : ' py-1'
            }`}
            onClick={
              canExpandSection
                ? (e) => handleSectionHeaderClick(e, canExpandSection, node.id, toggleSection)
                : undefined
            }
          >
            <div className="flex shrink-0 items-start self-start md:contents">
              {canExpandSection ? (
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
                  aria-label={
                    hasExpandableContent
                      ? 'Nothing to expand. This section has no linked catalog courses or web links yet.'
                      : 'Nothing to expand. This section has no courses or topics in the list below.'
                  }
                >
                  <ChevronDown
                    size={20}
                    className="shrink-0 -rotate-90 transition-transform duration-200"
                    aria-hidden
                  />
                </button>
              )}
            </div>
            <div
              className={`flex w-8 shrink-0 items-center justify-start text-lg font-bold leading-snug tabular-nums max-md:min-h-10 max-md:w-9 md:justify-end sm:w-9 sm:text-xl ${
                sectionHasUsefulContent ? 'text-orange-500' : 'text-orange-500/45'
              }`}
            >
              {sectionIndex + 1}.
            </div>
            <div className="flex min-w-0 max-w-full flex-1 flex-col gap-1 md:flex-row md:items-center md:gap-2.5">
              <div className="flex min-w-0 max-w-full flex-1 flex-col justify-center gap-0.5 sm:min-w-0 sm:flex-row sm:items-center sm:gap-2.5 md:contents">
                <div className="flex min-w-0 w-full max-w-full flex-row items-center gap-2 md:min-w-0 md:flex-1 md:order-1">
                  <span
                    id={`path-section-title-${node.id}`}
                    className={`min-w-0 flex-1 text-lg font-bold leading-snug break-words sm:text-xl ${
                      sectionHasUsefulContent ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                    }`}
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
                  {showSectionProgress && sectionProgress ? (
                    <PathOutlineProgressRingMobile
                      className="shrink-0 md:hidden"
                      percent={sectionProgress.percent}
                      ariaLabel={`Section progress for ${label}: ${sectionProgress.percent} percent, ${sectionProgress.completedCourses} of ${sectionProgress.totalCourses} courses complete`}
                    />
                  ) : null}
                </div>
                <div
                  className={`flex min-w-0 w-full flex-1 flex-col justify-stretch sm:justify-end md:order-2 md:w-auto md:shrink-0 md:flex-none md:items-center ${
                    showSectionProgress ? 'md:grid md:grid-cols-[11rem_7.25rem] md:gap-2' : ''
                  }`}
                >
                  {showSectionProgress ? (
                    <div className="hidden min-w-0 md:block">{sectionProgressColumn}</div>
                  ) : null}
                  <div className="flex min-w-0 w-full flex-1 justify-stretch sm:justify-end md:w-auto md:min-w-0 md:justify-end">
                    <div className="flex w-full min-w-0 max-w-full flex-col items-stretch justify-center sm:max-w-[18rem] sm:items-start md:max-w-none md:items-end">
                      {showNoCoursesInSectionUx ? (
                        node.locked ? (
                          <span className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium normal-case text-[var(--text-muted)] sm:text-sm">
                            <Lock
                              size={15}
                              className="shrink-0 text-[var(--text-muted)]"
                              strokeWidth={2.25}
                              aria-hidden
                            />
                            <span className="min-w-0 flex-1 [overflow-wrap:anywhere] md:order-2 md:text-right">
                              Content locked
                            </span>
                          </span>
                        ) : (
                          <span className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium normal-case text-[var(--text-muted)] sm:gap-x-1.5 sm:text-sm md:justify-end">
                            <button
                              type="button"
                              title="No courses are linked to this section yet. Check back later—more content may be added."
                              className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-bg)]/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 touch-manipulation max-md:order-2 sm:min-h-8 sm:min-w-8 sm:hover:bg-transparent md:order-1"
                              aria-label="Details: No courses are linked to this section yet. Check back later—more content may be added."
                            >
                              <Info size={15} strokeWidth={2.25} aria-hidden />
                            </button>
                            <span className="min-w-0 flex-1 [overflow-wrap:anywhere] max-md:order-1 md:order-2 md:max-w-[min(18rem,100%)] md:flex-initial md:text-right">
                              No courses added yet
                            </span>
                          </span>
                        )
                      ) : (
                        <span className="text-xs font-medium normal-case text-[var(--text-muted)] sm:text-sm md:block md:w-full md:text-right">
                          {courseCountLabel}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
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
        {showSectionBody ? (
          <>
            <ActionChips
              node={node}
              catalogCourses={catalogCourses}
              onOpenCourse={onOpenCourse}
              onOpenLesson={onOpenLesson}
              className="mt-1 pl-0 sm:mt-1 md:pl-[6.375rem]"
            />
            {hasExpandableContent && sectionHasUsefulContent ? (
              <ul
                id={panelId}
                role="list"
                aria-labelledby={`path-section-title-${node.id}`}
                hidden={!showSectionBody}
                className="mt-2 min-w-0 max-w-full list-none space-y-2 border-0 bg-transparent p-0 ring-0 md:ml-8 md:mt-1.5 md:space-y-1 md:rounded-xl md:border md:border-[var(--border-color)]/60 md:bg-[var(--bg-primary)]/25 md:py-1 md:pl-7 md:pr-5 md:ring-1 md:ring-[var(--border-color)]/25"
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
                      outlineCompactMobile={outlineCompactMobile}
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

  if (depth === 1 && nk === 'divider') {
    return (
      <div
        className="min-w-0 border-t border-[var(--border-color)]/60 pt-2.5 mt-2 first:mt-0 first:border-t-0 first:pt-0"
        role="presentation"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] [overflow-wrap:anywhere]">
          {label}
        </p>
      </div>
    );
  }

  if (depth === 1) {
    const courseMetaForChips =
      (nk === 'course' || nk === 'lesson') && node.courseId
        ? (catalogCourses.find((x) => x.id === node.courseId) ?? null)
        : null;
    return (
      <div className="min-w-0">
        <div className="flex min-w-0 max-w-full items-start gap-1 py-0.5 pr-0 sm:items-center sm:gap-1.5 sm:py-0.5 sm:pl-0.5 sm:pr-1">
          <OutlineBranchExpandControl nodeId={node.id} hasChildren={false} expanded={false} />
          {!outlineCompactMobile ? (
            <OutlineBranchStatusLeadSlot
              hasNested={false}
              isLabel={isLabelRow}
              depth={1}
              status={rowStatus}
              externalLink={nk === 'link'}
            />
          ) : null}
          <div className="flex min-w-0 max-w-full flex-1 flex-row flex-wrap items-center gap-x-2 gap-y-1 max-md:pl-2 md:flex-nowrap md:items-center md:justify-between md:gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 md:min-w-0 md:flex-1">
              <div className="flex min-w-0 flex-1 flex-row items-center gap-2">
                {outlineCompactMobile && !isLabelRow ? (
                  <PathRowStatusLead
                    depth={1}
                    status={rowStatus}
                    inlineWithTitle
                    externalLink={nk === 'link'}
                  />
                ) : null}
                {safeLinkHref ? (
                  <a
                    href={safeLinkHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 text-base font-semibold leading-snug text-violet-600 underline-offset-2 hover:underline dark:text-violet-400 [overflow-wrap:anywhere]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {label}
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 text-base font-semibold leading-snug text-[var(--text-primary)] [overflow-wrap:anywhere]">
                    {label}
                  </span>
                )}
                {courseLessonProgressSummary && courseLessonProgressSummary.totalLessons > 0 ? (
                  <PathOutlineProgressRingMobile
                    className="shrink-0 md:hidden"
                    percent={courseLessonProgressSummary.percent}
                    ariaLabel={outlineCourseProgressAria(label, courseLessonProgressSummary)}
                  />
                ) : null}
              </div>
              {courseMetaForChips ? <OutlineCourseTaxonomyChips course={courseMetaForChips} /> : null}
            </div>
            <div
              className={courseLessonProgressSummary ? PATH_OUTLINE_DESKTOP_PROGRESS_RAIL : 'contents'}
            >
              {courseLessonProgressSummary ? (
                <OutlineCourseProgressBlock rowLabel={label} summary={courseLessonProgressSummary} />
              ) : null}
              <ActionChips
                node={node}
                catalogCourses={catalogCourses}
                onOpenCourse={onOpenCourse}
                onOpenLesson={onOpenLesson}
                compact
                iconOnlyMobile={outlineCompactMobile}
                className={
                  outlineCompactMobile
                    ? 'shrink-0 md:w-auto sm:ml-2'
                    : `w-full shrink-0 max-md:max-w-full md:w-auto sm:ml-2${courseLessonProgressSummary ? ' md:ml-0' : ''}`
                }
                courseLessonProgressSummary={courseLessonProgressSummary}
              />
            </div>
          </div>
        </div>
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
        className={`flex min-w-0 max-w-full items-start gap-1 sm:items-center sm:gap-1.5${
          hasNested
            ? outlineCompactMobile
              ? ' py-0.5 pr-0'
              : ' min-h-10 cursor-pointer rounded-lg py-0.5 pl-0.5 pr-1 transition-colors hover:bg-[var(--hover-bg)]/50 sm:min-h-11 sm:py-0.5 sm:pl-1 sm:pr-1.5'
            : ''
        }`}
        onClick={
          hasNested && !outlineCompactMobile
            ? (e) => handleOutlineBranchHeaderClick(e, hasNested, node.id, toggleBranch)
            : undefined
        }
      >
        <OutlineBranchExpandControl
          nodeId={node.id}
          hasChildren={hasNested}
          expanded={nestedOpen}
        />
        {!outlineCompactMobile ? (
          <OutlineBranchStatusLeadSlot
            hasNested={hasNested}
            isLabel={isLabelRow}
            depth={depth}
            status={rowStatus}
            compactIcon={depth >= 4}
            externalLink={!hasNested && nk === 'link'}
          />
        ) : null}
        <div className="flex min-w-0 max-w-full flex-1 flex-row flex-wrap items-center gap-x-2 gap-y-1 max-md:pl-2 md:flex-nowrap md:items-center md:justify-between md:gap-2">
          <div className="flex min-w-0 flex-1 flex-row items-center gap-2 md:min-w-0 md:flex-1">
            {outlineCompactMobile && !hasNested && !isLabelRow ? (
              <PathRowStatusLead
                depth={depth}
                status={rowStatus}
                compactIcon={depth >= 4}
                inlineWithTitle
                externalLink={nk === 'link'}
              />
            ) : null}
            {safeLinkHref ? (
              <a
                href={safeLinkHref}
                target="_blank"
                rel="noopener noreferrer"
                className={`min-w-0 flex-1 text-violet-600 underline-offset-2 hover:underline dark:text-violet-400 [overflow-wrap:anywhere] ${nestedLabelClass}`}
                onClick={(e) => e.stopPropagation()}
              >
                {label}
              </a>
            ) : (
              <span className={`min-w-0 flex-1 ${nestedLabelClass}`}>{label}</span>
            )}
            {courseLessonProgressSummary && courseLessonProgressSummary.totalLessons > 0 ? (
              <PathOutlineProgressRingMobile
                className="shrink-0 md:hidden"
                percent={courseLessonProgressSummary.percent}
                ariaLabel={outlineCourseProgressAria(label, courseLessonProgressSummary)}
              />
            ) : null}
          </div>
          <div
            className={courseLessonProgressSummary ? PATH_OUTLINE_DESKTOP_PROGRESS_RAIL : 'contents'}
          >
            {courseLessonProgressSummary ? (
              <OutlineCourseProgressBlock rowLabel={label} summary={courseLessonProgressSummary} />
            ) : null}
            <ActionChips
              node={node}
              catalogCourses={catalogCourses}
              onOpenCourse={onOpenCourse}
              onOpenLesson={onOpenLesson}
              compact
              iconOnlyMobile={outlineCompactMobile}
              className={
                outlineCompactMobile
                  ? 'shrink-0 md:w-auto sm:ml-2'
                  : `w-full shrink-0 max-md:max-w-full md:w-auto sm:ml-2${courseLessonProgressSummary ? ' md:ml-0' : ''}`
              }
              courseLessonProgressSummary={courseLessonProgressSummary}
            />
          </div>
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
                  outlineCompactMobile={outlineCompactMobile}
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
  /** When set, section/branch expansion is restored across navigation via sessionStorage. */
  pathId?: string;
  pathTitle: string;
  branches: MindmapTreeNode[];
  catalogCourses: readonly Course[];
  onOpenCourse: (courseId: string) => void;
  onOpenLesson: (courseId: string, lessonId: string) => void;
  /** Logged-in user id, or null for device-local / guest progress keys. */
  progressUserId: string | null;
  /** Bumps when returning to the path view (or storage sync) so progress re-reads from localStorage. */
  progressSnapshotVersion: number;
  /** When true, rows restricted to `admin` in the outline document are shown; non-admins only see `user` rows. */
  viewerIsAdmin?: boolean;
};

export const PathMindmapOutline: React.FC<PathMindmapOutlineProps> = ({
  pathId,
  pathTitle,
  branches,
  catalogCourses,
  onOpenCourse,
  onOpenLesson,
  progressUserId,
  progressSnapshotVersion,
  viewerIsAdmin = false,
}) => {
  const [sectionExpanded, setSectionExpanded] = useState<Record<string, boolean>>({});
  const [branchExpanded, setBranchExpanded] = useState<Record<string, boolean>>({});
  const outlineCompactMobile = useOutlineCompactMobile();
  /** Avoid writing previous path's expansion under a new pathId before layout hydration runs. */
  const outlineHydratedForPathIdRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!pathId) {
      outlineHydratedForPathIdRef.current = null;
      return;
    }
    outlineHydratedForPathIdRef.current = null;
    const snap = readPathMindmapOutlineExpand(pathId);
    if (snap) {
      setSectionExpanded(snap.sectionExpanded);
      setBranchExpanded(snap.branchExpanded);
    } else {
      setSectionExpanded({});
      setBranchExpanded({});
    }
    outlineHydratedForPathIdRef.current = pathId;
  }, [pathId]);

  useEffect(() => {
    if (!pathId || outlineHydratedForPathIdRef.current !== pathId) return;
    writePathMindmapOutlineExpand(pathId, { sectionExpanded, branchExpanded });
  }, [pathId, sectionExpanded, branchExpanded]);

  const branchesForViewer = useMemo(
    () => filterOutlineBranchesForViewer(branches, viewerIsAdmin),
    [branches, viewerIsAdmin]
  );

  const nestedBranchSiblingMap = useMemo(
    () => buildNestedBranchSiblingMap(branchesForViewer),
    [branchesForViewer]
  );

  /** Only `true` means expanded; default is collapsed (accordion: at most one open). */
  const isSectionExpanded = useCallback(
    (sectionId: string) => sectionExpanded[sectionId] === true,
    [sectionExpanded]
  );

  const toggleSection = useCallback(
    (sectionId: string) => {
      setSectionExpanded((prev) => {
        if (prev[sectionId] === true) {
          return {};
        }
        return { [sectionId]: true };
      });
      setBranchExpanded({});
    },
    []
  );

  const isBranchExpanded = useCallback(
    (nodeId: string) => outlineCompactMobile || branchExpanded[nodeId] !== false,
    [outlineCompactMobile, branchExpanded]
  );

  const toggleBranch = useCallback(
    (nodeId: string) => {
      if (outlineCompactMobile) return;
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
    [nestedBranchSiblingMap, outlineCompactMobile]
  );

  return (
    <div
      className="min-w-0 max-w-full overflow-x-hidden rounded-none border-0 bg-transparent px-0 py-1 md:rounded-xl md:border md:border-[var(--border-color)]/90 md:bg-[var(--bg-primary)]/25 md:px-6 md:py-2"
      role="region"
      aria-label={`Learning Path syllabus: ${pathTitle}`}
    >
      <div className="space-y-0">
        {branchesForViewer.map((node, i) => (
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
              outlineCompactMobile={outlineCompactMobile}
            />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
