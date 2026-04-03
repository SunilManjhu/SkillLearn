import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  BookOpen,
  Copy,
  Info,
  Loader2,
  Plus,
  Route,
  Save,
  SlidersHorizontal,
  Tags,
  Trash2,
  RefreshCw,
  Sparkles,
  X,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronUp,
} from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import { useAdminActionToast } from './useAdminActionToast';
import {
  PathBuilderSection,
  type PathBuilderSectionHandle,
  type PathPersistenceMode,
} from './PathBuilderSection';
import { AdminCatalogCategoriesPanel } from './AdminCatalogCategoriesPanel';
import { AdminCatalogCategoryPresetsPanel } from './AdminCatalogCategoryPresetsPanel';
import { AdminCatalogSkillPresetsPanel } from './AdminCatalogSkillPresetsPanel';
import { AdminCatalogTaxonomyPanel } from './AdminCatalogTaxonomyPanel';
import type { Course, Lesson, Module, QuizQuestion, QuizQuestionMcq } from '../../data/courses';
import {
  MAX_QUIZ_CHOICES,
  MAX_QUIZ_QUESTIONS,
  createDefaultFreeformQuestion,
  createDefaultMcqQuestion,
} from '../../data/courses';
import {
  STRUCTURED_COURSE_ID_RE,
  firstAvailableStructuredCourseIdFromDocIds,
  isStructuredCourseId,
  remapStructuredCourseModuleLessonIdsByOrder,
} from '../../utils/courseStructuredIds';
import { validateCourseDraft, validateLessonQuiz } from '../../utils/courseDraftValidation';
import { lessonWebHref } from '../../utils/lessonContent';
import {
  listPublishedCourseDocumentIds,
  loadPublishedCoursesFromFirestore,
  savePublishedCourse,
  deletePublishedCourse,
} from '../../utils/publishedCoursesFirestore';
import {
  deleteCreatorCourse,
  listAllCreatorCourseDocumentIds,
  listCreatorCourseDocumentIdsForOwner,
  loadAllCreatorCoursesForAdmin,
  loadCreatorCoursesForOwner,
  saveCreatorCourse,
} from '../../utils/creatorCoursesFirestore';
import {
  findLearningPathReferencesToCourseId,
  removeCourseIdFromLearningPathDocument,
  type LearningPathCourseRefHit,
} from '../../utils/learningPathCourseDelete';
import { purgeLearnerFirestoreDataForCourse } from '../../utils/courseDeleteFirestorePurge';
import {
  findCourseSaveTitleConflict,
  loadPathTitlesForConflictCheck,
  type TitleConflictHit,
} from '../../utils/catalogDisplayNameConflicts';
import { AdminDisplayNameConflictDialog } from './AdminDisplayNameConflictDialog';
import {
  addCatalogCategoryExtra,
  CATALOG_CATEGORY_EXTRAS_CHANGED,
  readCatalogCategoryExtras,
  removeCatalogCategoryExtra,
} from '../../utils/catalogCategoryExtras';
import {
  addCatalogSkillExtra,
  CATALOG_SKILL_EXTRAS_CHANGED,
  readCatalogSkillExtras,
  removeCatalogSkillExtra,
} from '../../utils/catalogSkillExtras';
import {
  CATALOG_SKILL_PRESETS_CHANGED,
  DEFAULT_CATALOG_SKILL_PRESETS,
  normalizeCatalogSkillPresets,
  type CatalogSkillPresetsState,
} from '../../utils/catalogSkillPresetsState';
import { loadCatalogSkillPresets } from '../../utils/catalogSkillPresetsFirestore';
import {
  allPresetCatalogCategoriesFromState,
  CATALOG_CATEGORY_PRESETS_CHANGED,
  DEFAULT_CATALOG_CATEGORY_PRESETS,
  defaultNewCourseCategoryFromState,
  getCachedCatalogCategoryPresets,
  normalizeCatalogCategoryPresets,
  type CatalogCategoryPresetsState,
} from '../../utils/catalogCategoryPresets';
import { loadCatalogCategoryPresets } from '../../utils/catalogCategoryPresetsFirestore';
import { dedupeLabelsPreserveOrder, normalizeCourseTaxonomy } from '../../utils/courseTaxonomy';
import { getGeminiApiKey } from '../../utils/geminiClient';
import { resolveMcqCorrectIndex } from '../../utils/geminiQuiz';
import {
  applyReorderViewportScrollAndFocus,
  escapeSelectorAttrValue,
  queryElementInScopeOrDocument,
  REORDER_DATA_ATTR_SELECTORS,
} from '../../utils/reorderScrollViewport';
import { scrollDisclosureRowToTop } from '../../utils/scrollDisclosureRowToTop';
import { subscribeUsersForAdmin, type AdminUserRow } from '../../utils/adminUsersFirestore';

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Legacy: next module id m{n} from existing m1, m2, … */
function nextModuleIdLegacy(modules: Module[]): string {
  let maxN = 0;
  let found = false;
  for (const m of modules) {
    const mm = /^m(\d+)$/.exec(m.id);
    if (mm) {
      found = true;
      maxN = Math.max(maxN, parseInt(mm[1], 10));
    }
  }
  if (found) return `m${maxN + 1}`;
  return `m${modules.length + 1}`;
}

/** Structured: C1M1, C1M2, … */
function nextModuleIdForCourse(course: Course): string {
  const prefix = course.id;
  const re = new RegExp(`^${escapeRegex(prefix)}M(\\d+)$`);
  let maxN = 0;
  let found = false;
  for (const m of course.modules) {
    const mm = re.exec(m.id);
    if (mm) {
      found = true;
      maxN = Math.max(maxN, parseInt(mm[1], 10));
    }
  }
  if (found) return `${prefix}M${maxN + 1}`;
  return `${prefix}M${course.modules.length + 1}`;
}

/** Legacy: next l{n} unique across the whole course. */
function nextLessonIdLegacy(course: Course): string {
  let maxN = 0;
  let found = false;
  for (const m of course.modules) {
    for (const l of m.lessons) {
      const lm = /^l(\d+)$/.exec(l.id);
      if (lm) {
        found = true;
        maxN = Math.max(maxN, parseInt(lm[1], 10));
      }
    }
  }
  if (found) return `l${maxN + 1}`;
  const total = course.modules.reduce((acc, mo) => acc + mo.lessons.length, 0);
  return total === 0 ? 'l1' : `l${total + 1}`;
}

/** Structured: C1M1L1, C1M1L2 under that module only. */
function nextLessonIdInModule(course: Course, moduleIndex: number): string {
  const mod = course.modules[moduleIndex];
  if (!mod) return 'L1';
  const prefix = mod.id;
  const re = new RegExp(`^${escapeRegex(prefix)}L(\\d+)$`);
  let maxN = 0;
  let found = false;
  for (const l of mod.lessons) {
    const lm = re.exec(l.id);
    if (lm) {
      found = true;
      maxN = Math.max(maxN, parseInt(lm[1], 10));
    }
  }
  if (found) return `${prefix}L${maxN + 1}`;
  return `${prefix}L${mod.lessons.length + 1}`;
}

function emptyCourse(docId: string): Course {
  const structured = isStructuredCourseId(docId);
  const mid = structured ? `${docId}M1` : 'm1';
  const lid = structured ? `${docId}M1L1` : 'l1';
  return {
    id: docId,
    title: '',
    author: 'SkillStream Academy',
    thumbnail: 'https://picsum.photos/seed/course/800/450',
    description: '',
    level: 'Beginner',
    duration: '1h',
    rating: 4.5,
    categories: [defaultNewCourseCategoryFromState(getCachedCatalogCategoryPresets())],
    skills: [],
    modules: [
      {
        id: mid,
        title: '',
        lessons: [
          {
            id: lid,
            title: '',
            videoUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
          },
        ],
      },
    ],
  };
}

/** Remap module/lesson ids to C{n}M{m}L{l} for a duplicate (by order). Always assigns ids even if source omitted them. */
function remapCourseToStructuredIds(course: Course, newCourseId: string): Course {
  const modules = Array.isArray(course.modules) ? course.modules : [];
  return {
    ...course,
    id: newCourseId,
    modules: modules.map((mod, mi) => {
      const newMid = `${newCourseId}M${mi + 1}`;
      const lessons = Array.isArray(mod.lessons) ? mod.lessons : [];
      return {
        ...mod,
        id: newMid,
        title: typeof mod.title === 'string' ? mod.title : `Module ${mi + 1}`,
        lessons: lessons.map((les, li) => ({
          ...les,
          id: `${newMid}L${li + 1}`,
          title: typeof les.title === 'string' ? les.title : `Lesson ${li + 1}`,
          videoUrl: typeof les.videoUrl === 'string' ? les.videoUrl : '',
        })),
      };
    }),
  };
}

/** Ephemeral UI key for stable lesson row identity while reordering (not persisted). */
type LessonWithAdminKey = Lesson & { __adminRowKey?: string };

function stripAdminLessonRowKeys(course: Course): Course {
  return {
    ...course,
    modules: course.modules.map((m) => ({
      ...m,
      lessons: m.lessons.map((les) => {
        const { __adminRowKey: _, ...rest } = les as LessonWithAdminKey;
        return rest as Lesson;
      }),
    })),
  };
}

function ensureCourseLessonRowKeys(course: Course): Course {
  return {
    ...course,
    modules: course.modules.map((m) => ({
      ...m,
      lessons: m.lessons.map((les) => {
        const x = les as LessonWithAdminKey;
        if (x.__adminRowKey) return x;
        return { ...les, __adminRowKey: crypto.randomUUID() };
      }),
    })),
  };
}

function draftJsonForBaseline(course: Course): string {
  return JSON.stringify(stripAdminLessonRowKeys(course));
}

function lessonRowDomKey(lesson: Lesson, mi: number, li: number): string {
  return (lesson as LessonWithAdminKey).__adminRowKey ?? `lesson-${mi}-${li}`;
}

function findLessonIndexByDomKey(mod: Module, mi: number, rowKey: string): number {
  return mod.lessons.findIndex((l, li) => lessonRowDomKey(l, mi, li) === rowKey);
}

/** Pure, single evaluation — avoids React Strict Mode double-invoking functional setDraft (two swaps in dev). */
function computeLessonSwapDraft(
  d: Course,
  mi: number,
  lessonRowKey: string,
  delta: -1 | 1
): { next: Course; pair: { li: number; ni: number } } | null {
  const m = d.modules[mi];
  if (!m) return null;
  const li = findLessonIndexByDomKey(m, mi, lessonRowKey);
  if (li < 0) return null;
  const ni = li + delta;
  if (ni < 0 || ni >= m.lessons.length) return null;
  const modules = d.modules.map((mm, i) => {
    if (i !== mi) return mm;
    const lessons = [...mm.lessons];
    [lessons[li], lessons[ni]] = [lessons[ni]!, lessons[li]!];
    return { ...mm, lessons };
  });
  let next: Course = { ...d, modules };
  if (isStructuredCourseId(next.id)) {
    next = remapStructuredCourseModuleLessonIdsByOrder(next);
  }
  return { next, pair: { li, ni } };
}

/** Pure module swap — same rationale as {@link computeLessonSwapDraft}. */
function computeModuleSwapDraft(
  d: Course,
  mi: number,
  delta: -1 | 1
): { next: Course; pair: { a: number; b: number } } | null {
  const ni = mi + delta;
  if (ni < 0 || ni >= d.modules.length) return null;
  const modules = [...d.modules];
  [modules[mi], modules[ni]] = [modules[ni]!, modules[mi]!];
  let next: Course = { ...d, modules };
  if (isStructuredCourseId(next.id)) {
    next = remapStructuredCourseModuleLessonIdsByOrder(next);
  }
  return { next, pair: { a: mi, b: ni } };
}

/** Admin merged catalog: disambiguate published vs creator draft rows (same `course.id` can exist in both). */
const ADMIN_CATALOG_SEL_PUBLISHED_PREFIX = 'pub:';
const ADMIN_CATALOG_SEL_CREATOR_PREFIX = 'cre:';

type AdminCatalogCourseSelectorParsed =
  | { kind: 'empty' }
  | { kind: 'new' }
  | { kind: 'published'; courseId: string }
  | { kind: 'creator'; ownerUid: string; courseId: string };

type NewCourseSaveTarget = { kind: 'published' } | { kind: 'creator'; ownerUid: string };

function parseAdminCatalogCourseSelector(sel: string): AdminCatalogCourseSelectorParsed {
  if (!sel) return { kind: 'empty' };
  if (sel === '__new__') return { kind: 'new' };
  if (sel.startsWith(ADMIN_CATALOG_SEL_PUBLISHED_PREFIX)) {
    return { kind: 'published', courseId: sel.slice(ADMIN_CATALOG_SEL_PUBLISHED_PREFIX.length) };
  }
  if (sel.startsWith(ADMIN_CATALOG_SEL_CREATOR_PREFIX)) {
    const rest = sel.slice(ADMIN_CATALOG_SEL_CREATOR_PREFIX.length);
    const colon = rest.indexOf(':');
    if (colon <= 0) return { kind: 'empty' };
    return {
      kind: 'creator',
      ownerUid: rest.slice(0, colon),
      courseId: rest.slice(colon + 1),
    };
  }
  return { kind: 'empty' };
}

function buildAdminCatalogPublishedSelector(courseId: string): string {
  return `${ADMIN_CATALOG_SEL_PUBLISHED_PREFIX}${courseId}`;
}

function buildAdminCatalogCreatorSelector(ownerUid: string, courseId: string): string {
  return `${ADMIN_CATALOG_SEL_CREATOR_PREFIX}${ownerUid}:${courseId}`;
}

/** Short owner line for merged-catalog creator-draft options (matches Creators tab when profile exists). */
function creatorDraftOwnerShortLabel(ownerUid: string, row: AdminUserRow | undefined): string {
  if (row) {
    if (row.displayName.trim() && row.displayName !== 'Unnamed user') return row.displayName.trim();
    if (row.email.trim()) return row.email.trim();
  }
  return `${ownerUid.slice(0, 8)}…`;
}

/** Native option tooltip: full course id + owner (Document ID column also shows id when selected). */
function creatorDraftOptionTitleAttr(
  c: Course,
  ownerUid: string,
  row: AdminUserRow | undefined
): string {
  const idPart = `Course id: ${c.id}`;
  if (!row) return `${idPart} · Owner uid: ${ownerUid}`;
  const bits = [idPart, `Owner: ${row.displayName}`];
  if (row.email.trim()) bits.push(row.email.trim());
  bits.push(`uid ${ownerUid}`);
  return bits.join(' · ');
}

/** Sub-tabs inside Course catalog: course entries, learning paths, category management. */
type ContentCatalogSubTab = 'catalog' | 'paths' | 'taxonomy' | 'categories' | 'presets' | 'skillPresets';

/** Pending navigation while the course draft has unsaved edits. */
type CourseLeaveDialog =
  | { kind: 'select'; nextId: string }
  | { kind: 'duplicate' };

interface AdminCourseCatalogSectionProps {
  onCatalogChanged: () => void | Promise<void>;
  /** True while the course editor has unsaved edits (for admin portal navigation guard). */
  onDraftDirtyChange?: (dirty: boolean) => void;
  /** True while the learning path builder has unsaved edits (navigation guard + sub-tab switch). */
  onPathsDirtyChange?: (dirty: boolean) => void;
  /** Default: live `publishedCourses` / `learningPaths`. Creator: private collections for `ownerUid`. */
  catalogPersistence?: PathPersistenceMode;
  /** Overrides the section heading (creator portal). */
  catalogSectionTitle?: string;
  /**
   * Admin portal only: list and edit every `creatorCourses` doc alongside published (prefixed selectors).
   * Ignored when `catalogPersistence.kind === 'creator'`.
   */
  includeCreatorDraftCourses?: boolean;
}

interface RequiredFieldTarget {
  targetId: string;
  /** Course details vs modules — must match validateCourseDraft order. */
  scope: 'course' | 'module';
  moduleIndex: number;
  /** Lessons to expand (module errors include first lesson so lesson 1 is visible). */
  lessonKeys?: string[];
}

/** Matches Tailwind `sm` breakpoint (640px); tips use fixed + measured top below this width. */
const TIPS_NARROW_MAX_PX = 639;

function useTipsNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= TIPS_NARROW_MAX_PX : false
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${TIPS_NARROW_MAX_PX}px)`);
    const fn = () => setNarrow(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return narrow;
}

/** Fixed-position `top` (viewport px): strictly below the anchor — never overlaps the tab/button. User scrolls manually if the panel extends off-screen. */
function readFixedTipTopBelowAnchor(anchorEl: HTMLElement, gapPx = 8): number {
  return anchorEl.getBoundingClientRect().bottom + gapPx;
}

/** Narrow-only: `top` + CSS var for `max-h` so the panel shrink-wraps content up to remaining viewport. */
function narrowAdminTipPanelStyle(topPx: number): React.CSSProperties {
  return {
    top: topPx,
    ['--admin-tip-top' as string]: `${topPx}px`,
  };
}

export const AdminCourseCatalogSection: React.FC<AdminCourseCatalogSectionProps> = ({
  onCatalogChanged,
  onDraftDirtyChange,
  onPathsDirtyChange,
  catalogPersistence,
  catalogSectionTitle,
  includeCreatorDraftCourses = false,
}) => {
  const isCreatorCatalog = catalogPersistence?.kind === 'creator';
  const isAdminMergedCatalog = includeCreatorDraftCourses && !isCreatorCatalog;
  const [publishedList, setPublishedList] = useState<Course[]>([]);
  const [creatorDraftRows, setCreatorDraftRows] = useState<Array<{ course: Course; ownerUid: string }>>([]);
  /** `users` docs — for merged-catalog creator-draft dropdown labels (display name / email). */
  const [mergedCatalogAdminUsers, setMergedCatalogAdminUsers] = useState<AdminUserRow[]>([]);
  const newCourseSaveTargetRef = useRef<NewCourseSaveTarget>({ kind: 'published' });

  useEffect(() => {
    if (!isAdminMergedCatalog) {
      setMergedCatalogAdminUsers([]);
      return;
    }
    return subscribeUsersForAdmin(setMergedCatalogAdminUsers);
  }, [isAdminMergedCatalog]);
  /**
   * Creator studio only: published `publishedCourses` snapshot for category/skill pickers. Creator `publishedList`
   * is draft-only, so without this, labels admins add on published courses never appear in “add from list”.
   */
  const [publishedCoursesForPicker, setPublishedCoursesForPicker] = useState<Course[]>([]);
  /** '' = none selected; avoids loading Firestore until the user opens the Course dropdown. */
  const [selector, setSelector] = useState<string>('');
  const [draft, setDraft] = useState<Course | null>(null);
  const draftRef = useRef<Course | null>(null);
  draftRef.current = draft;
  const [busy, setBusy] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  /** True after first focus on Course select or explicit Reload list — then options include New Course + published. */
  const [catalogRequested, setCatalogRequested] = useState(false);
  const catalogRequestedRef = useRef(false);
  /** JSON snapshot of draft when last loaded / saved — for dirty detection. */
  const [baselineJson, setBaselineJson] = useState<string | null>(null);
  /** Turn on inline field errors after first failed save. */
  const [showValidationHints, setShowValidationHints] = useState(false);
  /** New Course (__new__) opens course details + first module/lesson; published picks start collapsed (see effect). */
  const [courseDetailsOpen, setCourseDetailsOpen] = useState(false);
  const [openModules, setOpenModules] = useState<Record<number, boolean>>({});
  const [openLessons, setOpenLessons] = useState<Record<string, boolean>>({});
  /** After adding a module, open that exact index once draft state is committed. */
  const pendingOpenNewModuleIndexRef = useRef<number | null>(null);
  /** After adding a lesson, open that exact lesson once draft state is committed. */
  const pendingOpenNewLessonKeyRef = useRef<string | null>(null);
  /** After adding a module, scroll/focus module title once the panel is open (same tab — not `storage`). */
  const pendingScrollToNewModuleTitleMiRef = useRef<number | null>(null);
  /** After adding a lesson, scroll/focus lesson title once the panel is open. */
  const pendingScrollToNewLessonTitleRef = useRef<{ mi: number; li: number } | null>(null);
  /** On failed save, scroll/focus the first invalid required field once it is rendered. */
  const pendingScrollTargetIdRef = useRef<string | null>(null);
  /** After lesson reorder: restore viewport Y of the control + focus (mouse stays on same arrow). */
  const pendingLessonReorderFocusRef = useRef<{
    lessonKey: string;
    control: 'up' | 'down';
    beforeTop: number;
  } | null>(null);
  /** Bumps after lesson reorder so layout/focus runs once, not on every draft edit. */
  const [lessonReorderLayoutTick, setLessonReorderLayoutTick] = useState(0);
  /** After module reorder: restore viewport Y of the control + focus. */
  const pendingModuleReorderFocusRef = useRef<{
    targetMiAfter: number;
    control: 'up' | 'down';
    beforeTop: number;
  } | null>(null);
  const [moduleReorderLayoutTick, setModuleReorderLayoutTick] = useState(0);
  const courseCatalogEditorRef = useRef<HTMLDivElement | null>(null);
  const courseDetailsDisclosureRef = useRef<HTMLDivElement | null>(null);
  /** After choosing New Course (or equivalent), focus Course title once details are expanded. */
  const pendingFocusCourseTitleRef = useRef(false);
  /** Avoid collapsing the editor when selector moves from __new__ to draft.id after first save (draft id unchanged). */
  const prevCatalogOpenStateRef = useRef<{ selector: string; draftId: string | undefined }>({
    selector: '',
    draftId: undefined,
  });
  const { showActionToast, actionToast } = useAdminActionToast();
  /** Per quiz question: AI “check MCQ key” in flight. */
  const [mcqAiKeyBusy, setMcqAiKeyBusy] = useState<Record<string, boolean>>({});
  /** Re-read category / skill option lists when extras change in localStorage (same tab). */
  const [categoryOptionsVersion, setCategoryOptionsVersion] = useState(0);
  const [skillOptionsVersion, setSkillOptionsVersion] = useState(0);

  const [contentCatalogSubTab, setContentCatalogSubTab] = useState<ContentCatalogSubTab>('catalog');
  const [subTabSwitchConfirmOpen, setSubTabSwitchConfirmOpen] = useState(false);
  const [pathSubTabSwitchConfirmOpen, setPathSubTabSwitchConfirmOpen] = useState(false);
  const [courseLeaveDialog, setCourseLeaveDialog] = useState<CourseLeaveDialog | null>(null);
  const [pathBuilderResetKey, setPathBuilderResetKey] = useState(0);
  const pathBuilderRef = useRef<PathBuilderSectionHandle | null>(null);
  const [pathsListLoading, setPathsListLoading] = useState(false);
  const [categoryPresetsState, setCategoryPresetsState] = useState<CatalogCategoryPresetsState>(() =>
    normalizeCatalogCategoryPresets(DEFAULT_CATALOG_CATEGORY_PRESETS)
  );
  const [skillPresetsState, setSkillPresetsState] = useState<CatalogSkillPresetsState>(() =>
    normalizeCatalogSkillPresets(DEFAULT_CATALOG_SKILL_PRESETS)
  );

  const tipsNarrowViewport = useTipsNarrowViewport();
  const catalogTipsWrapRef = useRef<HTMLSpanElement | null>(null);
  const catalogTipBtnRef = useRef<HTMLButtonElement | null>(null);
  const modulesTipsWrapRef = useRef<HTMLSpanElement | null>(null);
  const modulesTipBtnRef = useRef<HTMLButtonElement | null>(null);
  const categoriesTipsWrapRef = useRef<HTMLSpanElement | null>(null);
  const categoriesTipBtnRef = useRef<HTMLButtonElement | null>(null);
  const [catalogTipsOpen, setCatalogTipsOpen] = useState(false);
  const [modulesTipsOpen, setModulesTipsOpen] = useState(false);
  const [categoriesTipsOpen, setCategoriesTipsOpen] = useState(false);
  /** Narrow-only: fixed `top` for the catalog tips panel (anchor = info button). */
  const [catalogTipFixedTop, setCatalogTipFixedTop] = useState(-1);
  const [modulesTipFixedTop, setModulesTipFixedTop] = useState(-1);
  const [categoriesTipFixedTop, setCategoriesTipFixedTop] = useState(-1);

  const syncCatalogTipTop = useCallback(() => {
    if (!tipsNarrowViewport || !catalogTipsOpen || !catalogTipBtnRef.current) return;
    setCatalogTipFixedTop(readFixedTipTopBelowAnchor(catalogTipBtnRef.current));
  }, [tipsNarrowViewport, catalogTipsOpen]);

  const syncModulesTipTop = useCallback(() => {
    if (!tipsNarrowViewport || !modulesTipsOpen || !modulesTipBtnRef.current) return;
    setModulesTipFixedTop(readFixedTipTopBelowAnchor(modulesTipBtnRef.current));
  }, [tipsNarrowViewport, modulesTipsOpen]);

  const syncCategoriesTipTop = useCallback(() => {
    if (!tipsNarrowViewport || !categoriesTipsOpen || !categoriesTipBtnRef.current) return;
    setCategoriesTipFixedTop(readFixedTipTopBelowAnchor(categoriesTipBtnRef.current));
  }, [tipsNarrowViewport, categoriesTipsOpen]);

  useLayoutEffect(() => {
    if (!catalogTipsOpen) {
      setCatalogTipFixedTop(-1);
      return;
    }
    if (!tipsNarrowViewport || !catalogTipBtnRef.current) {
      setCatalogTipFixedTop(-1);
      return;
    }
    setCatalogTipFixedTop(readFixedTipTopBelowAnchor(catalogTipBtnRef.current));
  }, [catalogTipsOpen, tipsNarrowViewport]);

  useLayoutEffect(() => {
    if (!modulesTipsOpen) {
      setModulesTipFixedTop(-1);
      return;
    }
    if (!tipsNarrowViewport || !modulesTipBtnRef.current) {
      setModulesTipFixedTop(-1);
      return;
    }
    setModulesTipFixedTop(readFixedTipTopBelowAnchor(modulesTipBtnRef.current));
  }, [modulesTipsOpen, tipsNarrowViewport]);

  useLayoutEffect(() => {
    if (!categoriesTipsOpen) {
      setCategoriesTipFixedTop(-1);
      return;
    }
    if (!tipsNarrowViewport || !categoriesTipBtnRef.current) {
      setCategoriesTipFixedTop(-1);
      return;
    }
    setCategoriesTipFixedTop(readFixedTipTopBelowAnchor(categoriesTipBtnRef.current));
  }, [categoriesTipsOpen, tipsNarrowViewport]);

  useEffect(() => {
    if (!tipsNarrowViewport) {
      setCatalogTipFixedTop(-1);
      setModulesTipFixedTop(-1);
      setCategoriesTipFixedTop(-1);
    }
  }, [tipsNarrowViewport]);

  useEffect(() => {
    if (contentCatalogSubTab !== 'catalog') setCatalogTipsOpen(false);
  }, [contentCatalogSubTab]);

  useEffect(() => {
    if (!draft) {
      setModulesTipsOpen(false);
      setCategoriesTipsOpen(false);
    }
  }, [draft]);

  useEffect(() => {
    if (!courseDetailsOpen) setCategoriesTipsOpen(false);
  }, [courseDetailsOpen]);

  useEffect(() => {
    if (!catalogTipsOpen) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (catalogTipsWrapRef.current?.contains(t)) return;
      setCatalogTipsOpen(false);
    };
    document.addEventListener('pointerdown', onDoc, true);
    return () => document.removeEventListener('pointerdown', onDoc, true);
  }, [catalogTipsOpen]);

  useEffect(() => {
    if (!modulesTipsOpen) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (modulesTipsWrapRef.current?.contains(t)) return;
      setModulesTipsOpen(false);
    };
    document.addEventListener('pointerdown', onDoc, true);
    return () => document.removeEventListener('pointerdown', onDoc, true);
  }, [modulesTipsOpen]);

  useEffect(() => {
    if (!categoriesTipsOpen) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (categoriesTipsWrapRef.current?.contains(t)) return;
      setCategoriesTipsOpen(false);
    };
    document.addEventListener('pointerdown', onDoc, true);
    return () => document.removeEventListener('pointerdown', onDoc, true);
  }, [categoriesTipsOpen]);

  useEffect(() => {
    if (!catalogTipsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCatalogTipsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [catalogTipsOpen]);

  useEffect(() => {
    if (!modulesTipsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModulesTipsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modulesTipsOpen]);

  useEffect(() => {
    if (!categoriesTipsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCategoriesTipsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [categoriesTipsOpen]);

  useEffect(() => {
    if (!tipsNarrowViewport || !catalogTipsOpen || catalogTipFixedTop < 0) return;
    const onMove = () => syncCatalogTipTop();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [tipsNarrowViewport, catalogTipsOpen, catalogTipFixedTop, syncCatalogTipTop]);

  useEffect(() => {
    if (!tipsNarrowViewport || !modulesTipsOpen || modulesTipFixedTop < 0) return;
    const onMove = () => syncModulesTipTop();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [tipsNarrowViewport, modulesTipsOpen, modulesTipFixedTop, syncModulesTipTop]);

  useEffect(() => {
    if (!tipsNarrowViewport || !categoriesTipsOpen || categoriesTipFixedTop < 0) return;
    const onMove = () => syncCategoriesTipTop();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [tipsNarrowViewport, categoriesTipsOpen, categoriesTipFixedTop, syncCategoriesTipTop]);

  const courseRowsForTaxonomyPickers = useMemo(() => {
    if (isCreatorCatalog) return [...publishedList, ...publishedCoursesForPicker];
    if (isAdminMergedCatalog) return [...publishedList, ...creatorDraftRows.map((r) => r.course)];
    return publishedList;
  }, [
    isCreatorCatalog,
    isAdminMergedCatalog,
    publishedList,
    publishedCoursesForPicker,
    creatorDraftRows,
  ]);

  /** Full list for adding categories (presets, saved extras, labels from catalog courses in this editor + live published when creator). */
  const categorySelectOptions = useMemo(() => {
    const s = new Set<string>(allPresetCatalogCategoriesFromState(categoryPresetsState));
    for (const c of readCatalogCategoryExtras()) s.add(c);
    for (const co of courseRowsForTaxonomyPickers) {
      for (const cat of co.categories ?? []) {
        const t = cat?.trim();
        if (t) s.add(t);
      }
    }
    return [...s].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [courseRowsForTaxonomyPickers, categoryOptionsVersion, categoryPresetsState]);

  /** Full list for adding skills (presets, saved extras, labels from catalog courses + live published when creator). */
  const skillSelectOptions = useMemo(() => {
    const s = new Set<string>([...skillPresetsState.mainPills, ...skillPresetsState.moreSkills]);
    for (const x of readCatalogSkillExtras()) s.add(x);
    for (const co of courseRowsForTaxonomyPickers) {
      for (const sk of co.skills ?? []) {
        const t = sk?.trim();
        if (t) s.add(t);
      }
    }
    return [...s].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [courseRowsForTaxonomyPickers, skillOptionsVersion, skillPresetsState]);

  useEffect(() => {
    const h = () => setCategoryOptionsVersion((v) => v + 1);
    window.addEventListener(CATALOG_CATEGORY_EXTRAS_CHANGED, h);
    return () => window.removeEventListener(CATALOG_CATEGORY_EXTRAS_CHANGED, h);
  }, []);

  useEffect(() => {
    const h = () => setSkillOptionsVersion((v) => v + 1);
    window.addEventListener(CATALOG_SKILL_EXTRAS_CHANGED, h);
    return () => window.removeEventListener(CATALOG_SKILL_EXTRAS_CHANGED, h);
  }, []);

  const registerDraftTaxonomyExtras = () => {
    if (!draft || isCreatorCatalog) return;
    for (const c of draft.categories) {
      if (c.trim()) addCatalogCategoryExtra(c.trim());
    }
    for (const s of draft.skills) {
      if (s.trim()) addCatalogSkillExtra(s.trim());
    }
  };

  const categoriesNotOnDraft = useMemo(() => {
    if (!draft) return categorySelectOptions;
    const set = new Set(draft.categories.map((c) => c.trim().toLowerCase()));
    return categorySelectOptions.filter((o) => !set.has(o.toLowerCase()));
  }, [draft, categorySelectOptions]);

  const skillsNotOnDraft = useMemo(() => {
    if (!draft) return skillSelectOptions;
    const set = new Set(draft.skills.map((s) => s.trim().toLowerCase()));
    return skillSelectOptions.filter((o) => !set.has(o.toLowerCase()));
  }, [draft, skillSelectOptions]);

  const refreshList = useCallback(async (): Promise<Course[]> => {
    setListLoading(true);
    try {
      if (catalogPersistence?.kind === 'creator') {
        const [list, publishedForPicker] = await Promise.all([
          loadCreatorCoursesForOwner(catalogPersistence.ownerUid),
          loadPublishedCoursesFromFirestore(),
        ]);
        setPublishedList(list);
        setPublishedCoursesForPicker(publishedForPicker);
        return list;
      }
      if (includeCreatorDraftCourses) {
        const [list, creatorRows] = await Promise.all([
          loadPublishedCoursesFromFirestore(),
          loadAllCreatorCoursesForAdmin(),
        ]);
        setPublishedList(list);
        setCreatorDraftRows(creatorRows);
        setPublishedCoursesForPicker([]);
        return list;
      }
      setCreatorDraftRows([]);
      const list = await loadPublishedCoursesFromFirestore();
      setPublishedList(list);
      setPublishedCoursesForPicker([]);
      return list;
    } finally {
      setListLoading(false);
    }
  }, [catalogPersistence, includeCreatorDraftCourses]);

  /**
   * Creator studio: load picker data as soon as the page opens. Otherwise `catalogRequested` stays false until the
   * user focuses the course dropdown—`categoryPresetsState` never left DEFAULT and admin Firestore presets (and any
   * category only on published courses until refresh) were invisible in “Add category from list”.
   */
  useEffect(() => {
    if (!isCreatorCatalog) {
      setPublishedCoursesForPicker([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [pub, catPre, skPre] = await Promise.all([
        loadPublishedCoursesFromFirestore(),
        loadCatalogCategoryPresets(),
        loadCatalogSkillPresets(),
      ]);
      if (cancelled) return;
      setPublishedCoursesForPicker(pub);
      setCategoryPresetsState(catPre);
      setSkillPresetsState(skPre);
    })();
    return () => {
      cancelled = true;
    };
  }, [isCreatorCatalog]);

  const openCourseCatalogOnce = useCallback(() => {
    if (catalogRequestedRef.current) return;
    catalogRequestedRef.current = true;
    setCatalogRequested(true);
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (isCreatorCatalog) {
      if (
        contentCatalogSubTab === 'taxonomy' ||
        contentCatalogSubTab === 'categories' ||
        contentCatalogSubTab === 'presets' ||
        contentCatalogSubTab === 'skillPresets'
      ) {
        setContentCatalogSubTab('catalog');
      }
    }
  }, [isCreatorCatalog, contentCatalogSubTab]);

  useEffect(() => {
    if (contentCatalogSubTab !== 'paths') return;
    openCourseCatalogOnce();
    void refreshList();
  }, [contentCatalogSubTab, openCourseCatalogOnce, refreshList]);

  useEffect(() => {
    if (contentCatalogSubTab !== 'categories') return;
    catalogRequestedRef.current = true;
    setCatalogRequested(true);
    void refreshList();
  }, [contentCatalogSubTab, refreshList]);

  useEffect(() => {
    if (contentCatalogSubTab !== 'presets') return;
    catalogRequestedRef.current = true;
    setCatalogRequested(true);
    void loadCatalogCategoryPresets().then(setCategoryPresetsState);
  }, [contentCatalogSubTab]);

  useEffect(() => {
    if (contentCatalogSubTab !== 'taxonomy') return;
    catalogRequestedRef.current = true;
    setCatalogRequested(true);
    void refreshList();
    void loadCatalogCategoryPresets().then(setCategoryPresetsState);
    void loadCatalogSkillPresets().then(setSkillPresetsState);
  }, [contentCatalogSubTab, refreshList]);

  useEffect(() => {
    if (contentCatalogSubTab !== 'skillPresets') return;
    catalogRequestedRef.current = true;
    setCatalogRequested(true);
    void loadCatalogSkillPresets().then(setSkillPresetsState);
  }, [contentCatalogSubTab]);

  useEffect(() => {
    if (!catalogRequested) return;
    void loadCatalogCategoryPresets().then(setCategoryPresetsState);
  }, [catalogRequested]);

  useEffect(() => {
    if (!catalogRequested) return;
    void loadCatalogSkillPresets().then(setSkillPresetsState);
  }, [catalogRequested]);

  useEffect(() => {
    const h = () => void loadCatalogCategoryPresets().then(setCategoryPresetsState);
    window.addEventListener(CATALOG_CATEGORY_PRESETS_CHANGED, h);
    return () => window.removeEventListener(CATALOG_CATEGORY_PRESETS_CHANGED, h);
  }, []);

  useEffect(() => {
    const h = () => void loadCatalogSkillPresets().then(setSkillPresetsState);
    window.addEventListener(CATALOG_SKILL_PRESETS_CHANGED, h);
    return () => window.removeEventListener(CATALOG_SKILL_PRESETS_CHANGED, h);
  }, []);

  const onCategoryRenamedGlobally = useCallback((fromLower: string, newExact: string) => {
    setDraft((d) => {
      if (!d) return d;
      const next = d.categories.map((c) => (c.trim().toLowerCase() === fromLower ? newExact : c));
      if (next.every((c, i) => c === d.categories[i])) return d;
      return { ...d, categories: dedupeLabelsPreserveOrder(next) };
    });
    setBaselineJson((prev) => {
      if (prev === null) return prev;
      try {
        const b = JSON.parse(prev) as Course;
        const next = (b.categories ?? []).map((c) =>
          c.trim().toLowerCase() === fromLower ? newExact : c
        );
        if (next.every((c, i) => c === (b.categories ?? [])[i])) return prev;
        return JSON.stringify({ ...b, categories: dedupeLabelsPreserveOrder(next) });
      } catch {
        return prev;
      }
    });
  }, []);

  const sortedCatalogCourses = useMemo(
    () =>
      [...publishedList].sort((a, b) => {
        const byTitle = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
        return byTitle !== 0 ? byTitle : a.id.localeCompare(b.id);
      }),
    [publishedList]
  );

  const adminUsersByIdForMergedCatalog = useMemo(() => {
    const m = new Map<string, AdminUserRow>();
    for (const r of mergedCatalogAdminUsers) m.set(r.id, r);
    return m;
  }, [mergedCatalogAdminUsers]);

  /** Course dropdown rows (value + label + optional native tooltip). Admin merged mode uses prefixed values so published vs creator drafts stay distinct. */
  const catalogCourseMenuRows = useMemo(() => {
    if (!isAdminMergedCatalog) {
      return sortedCatalogCourses.map((c) => ({
        value: c.id,
        label: `${c.title} (${c.id})`,
        title: `Course id: ${c.id}`,
      }));
    }
    const pub = sortedCatalogCourses.map((c) => ({
      value: buildAdminCatalogPublishedSelector(c.id),
      label: `[Published] ${c.title} (${c.id})`,
      title: `Course id: ${c.id}`,
    }));
    const cre = [...creatorDraftRows]
      .sort((a, b) => {
        const byTitle = a.course.title.localeCompare(b.course.title, undefined, { sensitivity: 'base' });
        return byTitle !== 0 ? byTitle : a.course.id.localeCompare(b.course.id);
      })
      .map(({ course: c, ownerUid }) => {
        const profile = adminUsersByIdForMergedCatalog.get(ownerUid);
        return {
          value: buildAdminCatalogCreatorSelector(ownerUid, c.id),
          label: `[Creator draft] ${c.title} (${c.id}) · ${creatorDraftOwnerShortLabel(ownerUid, profile)}`,
          title: creatorDraftOptionTitleAttr(c, ownerUid, profile),
        };
      });
    return [...pub, ...cre];
  }, [
    isAdminMergedCatalog,
    sortedCatalogCourses,
    creatorDraftRows,
    adminUsersByIdForMergedCatalog,
  ]);

  const selectionIsExistingCatalogCourse = useMemo(() => {
    if (!selector || selector === '__new__') return false;
    if (!isAdminMergedCatalog) return publishedList.some((c) => c.id === selector);
    const p = parseAdminCatalogCourseSelector(selector);
    if (p.kind === 'published') return publishedList.some((c) => c.id === p.courseId);
    if (p.kind === 'creator')
      return creatorDraftRows.some((r) => r.ownerUid === p.ownerUid && r.course.id === p.courseId);
    return false;
  }, [selector, isAdminMergedCatalog, publishedList, creatorDraftRows]);

  /** Union Firestore course doc ids + in-memory list so new C{n} skips every occupied id. Creators also reserve published `publishedCourses` ids. */
  const courseDocumentIdsForAllocation = useCallback(async (): Promise<string[]> => {
    const fromState = publishedList.map((c) => c.id);
    if (catalogPersistence?.kind === 'creator') {
      const [ownCreatorIds, publishedIds] = await Promise.all([
        listCreatorCourseDocumentIdsForOwner(catalogPersistence.ownerUid),
        listPublishedCourseDocumentIds(),
      ]);
      // Cannot list all `creatorCourses` from the client: rules only allow per-owner list + admin full scan.
      return [...new Set([...ownCreatorIds, ...publishedIds, ...fromState])];
    }
    if (includeCreatorDraftCourses) {
      const [publishedIds, allCreatorIds] = await Promise.all([
        listPublishedCourseDocumentIds(),
        listAllCreatorCourseDocumentIds(),
      ]);
      return [...new Set([...publishedIds, ...allCreatorIds, ...fromState])];
    }
    const publishedIds = await listPublishedCourseDocumentIds();
    return [...new Set([...publishedIds, ...fromState])];
  }, [catalogPersistence, publishedList, includeCreatorDraftCourses]);

  /** First time draft appears (e.g. initial load) without baseline yet. */
  useEffect(() => {
    if (!draft || baselineJson !== null) return;
    setBaselineJson(draftJsonForBaseline(draft));
  }, [draft, baselineJson]);

  const applyPickCourse = useCallback(
    async (id: string) => {
      if (id === '') return;
      setSelector(id);
      if (id === '__new__') {
        newCourseSaveTargetRef.current =
          catalogPersistence?.kind === 'creator'
            ? { kind: 'creator', ownerUid: catalogPersistence.ownerUid }
            : { kind: 'published' };
        pendingFocusCourseTitleRef.current = true;
        const reserveIds =
          selector === '__new__' && draft && STRUCTURED_COURSE_ID_RE.test(draft.id) ? [draft.id] : [];
        const docIds = await courseDocumentIdsForAllocation();
        const newId = firstAvailableStructuredCourseIdFromDocIds(docIds, reserveIds);
        const fresh = emptyCourse(newId);
        const keyed = ensureCourseLessonRowKeys(fresh);
        setDraft(keyed);
        setBaselineJson(draftJsonForBaseline(keyed));
        return;
      }
      if (isAdminMergedCatalog) {
        const parsed = parseAdminCatalogCourseSelector(id);
        if (parsed.kind === 'published') {
          const c = publishedList.find((x) => x.id === parsed.courseId);
          if (c) {
            const clone = normalizeCourseTaxonomy(deepClone(c));
            const keyed = ensureCourseLessonRowKeys(clone);
            setDraft(keyed);
            setBaselineJson(draftJsonForBaseline(keyed));
          } else {
            setDraft(null);
            setBaselineJson(null);
          }
          return;
        }
        if (parsed.kind === 'creator') {
          const row = creatorDraftRows.find(
            (r) => r.ownerUid === parsed.ownerUid && r.course.id === parsed.courseId
          );
          if (row) {
            const clone = normalizeCourseTaxonomy(deepClone(row.course));
            const keyed = ensureCourseLessonRowKeys(clone);
            setDraft(keyed);
            setBaselineJson(draftJsonForBaseline(keyed));
          } else {
            setDraft(null);
            setBaselineJson(null);
          }
          return;
        }
        setDraft(null);
        setBaselineJson(null);
        return;
      }
      const c = publishedList.find((x) => x.id === id);
      if (c) {
        const clone = normalizeCourseTaxonomy(deepClone(c));
        const keyed = ensureCourseLessonRowKeys(clone);
        setDraft(keyed);
        setBaselineJson(draftJsonForBaseline(keyed));
      } else {
        setDraft(null);
        setBaselineJson(null);
      }
    },
    [
      publishedList,
      creatorDraftRows,
      selector,
      draft,
      courseDocumentIdsForAllocation,
      isAdminMergedCatalog,
      isCreatorCatalog,
      catalogPersistence,
    ]
  );

  const updateDraft = (patch: Partial<Course>) => {
    setDraft((d) => (d ? { ...d, ...patch } : null));
  };

  const addDraftCategory = useCallback(
    (raw: string) => {
      const t = raw.trim();
      if (!t) return;
      const canonical = categorySelectOptions.find((o) => o.toLowerCase() === t.toLowerCase()) ?? t;
      setDraft((d) => {
        if (!d) return d;
        if (d.categories.some((c) => c.toLowerCase() === canonical.toLowerCase())) return d;
        return { ...d, categories: [...d.categories, canonical] };
      });
      if (!isCreatorCatalog) addCatalogCategoryExtra(canonical);
    },
    [categorySelectOptions, isCreatorCatalog]
  );

  const removeDraftCategory = useCallback(
    (label: string) => {
      const low = label.toLowerCase();
      setDraft((d) => (d ? { ...d, categories: d.categories.filter((c) => c.toLowerCase() !== low) } : d));
      if (isCreatorCatalog) removeCatalogCategoryExtra(label);
    },
    [isCreatorCatalog]
  );

  const addDraftSkill = useCallback(
    (raw: string) => {
      const t = raw.trim();
      if (!t) return;
      const canonical = skillSelectOptions.find((o) => o.toLowerCase() === t.toLowerCase()) ?? t;
      setDraft((d) => {
        if (!d) return d;
        if (d.skills.some((s) => s.toLowerCase() === canonical.toLowerCase())) return d;
        return { ...d, skills: [...d.skills, canonical] };
      });
      if (!isCreatorCatalog) addCatalogSkillExtra(canonical);
    },
    [skillSelectOptions, isCreatorCatalog]
  );

  const removeDraftSkill = useCallback(
    (label: string) => {
      const low = label.toLowerCase();
      setDraft((d) => (d ? { ...d, skills: d.skills.filter((s) => s.toLowerCase() !== low) } : d));
      if (isCreatorCatalog) removeCatalogSkillExtra(label);
    },
    [isCreatorCatalog]
  );

  const updateModule = (mi: number, patch: Partial<Module>) => {
    setDraft((d) => {
      if (!d) return null;
      const modules = [...d.modules];
      modules[mi] = { ...modules[mi], ...patch };
      return { ...d, modules };
    });
  };

  const updateLesson = (mi: number, li: number, patch: Partial<Lesson>) => {
    setDraft((d) => {
      if (!d) return null;
      const modules = d.modules.map((m, i) => {
        if (i !== mi) return m;
        const lessons = m.lessons.map((lesson, j) => (j === li ? { ...lesson, ...patch } : lesson));
        return { ...m, lessons };
      });
      return { ...d, modules };
    });
  };

  const mapQuizQuestion = (mi: number, li: number, qi: number, updater: (q: QuizQuestion) => QuizQuestion) => {
    setDraft((d) => {
      if (!d) return null;
      const modules = d.modules.map((m, i) => {
        if (i !== mi) return m;
        const lessons = m.lessons.map((lesson, j) => {
          if (j !== li) return lesson;
          const qs = [...(lesson.quiz?.questions ?? [])];
          if (!qs[qi]) return lesson;
          qs[qi] = updater(qs[qi]);
          return { ...lesson, quiz: { questions: qs } };
        });
        return { ...m, lessons };
      });
      return { ...d, modules };
    });
  };

  const suggestMcqCorrectWithAi = async (mi: number, li: number, qi: number, qq: QuizQuestionMcq) => {
    const busyKey = `${mi}-${li}-${qi}`;
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      showActionToast('Set GEMINI_API_KEY in .env to check MCQ keys with AI.', 'danger');
      return;
    }
    const slots: { adminIndex: number; text: string }[] = [];
    for (let i = 0; i < qq.choices.length; i += 1) {
      const t = typeof qq.choices[i] === 'string' ? qq.choices[i].trim() : '';
      if (t) slots.push({ adminIndex: i, text: t });
    }
    if (slots.length < 2) {
      showActionToast('Add at least two non-empty choices before running AI check.', 'danger');
      return;
    }
    if (!qq.prompt.trim()) {
      showActionToast('Add a question prompt before running AI check.', 'danger');
      return;
    }
    setMcqAiKeyBusy((p) => ({ ...p, [busyKey]: true }));
    try {
      const res = await resolveMcqCorrectIndex({
        apiKey,
        questionPrompt: qq.prompt.trim(),
        choices: slots.map((s) => s.text),
      });
      if (!res.ok) {
        showActionToast(res.error, 'danger');
        return;
      }
      const chosen = slots[res.correctIndex];
      if (!chosen) {
        showActionToast('AI returned an invalid option index.', 'danger');
        return;
      }
      if (chosen.adminIndex === qq.correctIndex) {
        showActionToast('AI agrees with the marked correct answer.', 'success');
        return;
      }
      mapQuizQuestion(mi, li, qi, (prev) =>
        prev.type === 'mcq' ? { ...prev, correctIndex: chosen.adminIndex } : prev
      );
      const label = chosen.text.length > 48 ? `${chosen.text.slice(0, 48)}…` : chosen.text;
      showActionToast(`Marked correct updated to: ${label}. Save the course to publish.`, 'success');
    } finally {
      setMcqAiKeyBusy((p) => {
        const next = { ...p };
        delete next[busyKey];
        return next;
      });
    }
  };

  const addQuizQuestion = (mi: number, li: number, kind: 'mcq' | 'freeform') => {
    setDraft((d) => {
      if (!d) return null;
      const modules = d.modules.map((m, i) => {
        if (i !== mi) return m;
        const lessons = m.lessons.map((lesson, j) => {
          if (j !== li) return lesson;
          const qs = [...(lesson.quiz?.questions ?? [])];
          if (qs.length >= MAX_QUIZ_QUESTIONS) return lesson;
          const next = kind === 'mcq' ? createDefaultMcqQuestion() : createDefaultFreeformQuestion();
          return { ...lesson, quiz: { questions: [...qs, next] } };
        });
        return { ...m, lessons };
      });
      return { ...d, modules };
    });
  };

  const removeQuizQuestion = (mi: number, li: number, qi: number) => {
    setDraft((d) => {
      if (!d) return null;
      const modules = d.modules.map((m, i) => {
        if (i !== mi) return m;
        const lessons = m.lessons.map((lesson, j) => {
          if (j !== li) return lesson;
          const qs = [...(lesson.quiz?.questions ?? [])];
          if (qs.length <= 1) return lesson;
          qs.splice(qi, 1);
          return { ...lesson, quiz: { questions: qs } };
        });
        return { ...m, lessons };
      });
      return { ...d, modules };
    });
  };

  const moveQuizQuestion = (mi: number, li: number, qi: number, delta: number) => {
    setDraft((d) => {
      if (!d) return null;
      const modules = d.modules.map((m, i) => {
        if (i !== mi) return m;
        const lessons = m.lessons.map((lesson, j) => {
          if (j !== li) return lesson;
          const qs = [...(lesson.quiz?.questions ?? [])];
          const ni = qi + delta;
          if (ni < 0 || ni >= qs.length) return lesson;
          const t = qs[qi]!;
          qs[qi] = qs[ni]!;
          qs[ni] = t;
          return { ...lesson, quiz: { questions: qs } };
        });
        return { ...m, lessons };
      });
      return { ...d, modules };
    });
  };

  const addModule = () => {
    setDraft((d) => {
      if (!d) return null;
      const newModuleIndex = d.modules.length;
      pendingOpenNewModuleIndexRef.current = newModuleIndex;
      pendingOpenNewLessonKeyRef.current = `${newModuleIndex}:0`;
      pendingScrollToNewModuleTitleMiRef.current = newModuleIndex;
      const structured = isStructuredCourseId(d.id);
      const mid = structured ? nextModuleIdForCourse(d) : nextModuleIdLegacy(d.modules);
      const lid = structured ? `${mid}L1` : nextLessonIdLegacy(d);
      return {
        ...d,
        modules: [
          ...d.modules,
          {
            id: mid,
            title: '',
            lessons: [
              {
                id: lid,
                title: '',
                videoUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
                __adminRowKey: crypto.randomUUID(),
              } as LessonWithAdminKey,
            ],
          },
        ],
      };
    });
    // Focus editing on the newly added module.
    setCourseDetailsOpen(false);
  };

  const removeModule = (mi: number) => {
    if (!draft || draft.modules.length <= 1) return;
    setDraft((d) => {
      if (!d || d.modules.length <= 1) return d;
      return { ...d, modules: d.modules.filter((_, i) => i !== mi) };
    });
    showActionToast('Module deleted.');
  };

  const addLesson = (mi: number) => {
    setDraft((d) => {
      if (!d) return null;
      const targetModule = d.modules[mi];
      if (!targetModule) return d;
      const newLi = targetModule.lessons.length;
      pendingOpenNewLessonKeyRef.current = `${mi}:${newLi}`;
      pendingScrollToNewLessonTitleRef.current = { mi, li: newLi };
      const lid = isStructuredCourseId(d.id)
        ? nextLessonIdInModule(d, mi)
        : nextLessonIdLegacy(d);
      const modules = d.modules.map((m, i) => {
        if (i !== mi) return m;
        return {
          ...m,
          lessons: [
            ...m.lessons,
            {
              id: lid,
              title: '',
              videoUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
              __adminRowKey: crypto.randomUUID(),
            } as LessonWithAdminKey,
          ],
        };
      });
      return { ...d, modules };
    });
  };

  const removeLesson = (mi: number, li: number) => {
    if (!draft) return;
    const target = draft.modules[mi];
    if (!target || target.lessons.length <= 1) return;
    setDraft((d) => {
      if (!d) return null;
      const modules = d.modules.map((m, i) => {
        if (i !== mi) return m;
        if (m.lessons.length <= 1) return m;
        return { ...m, lessons: m.lessons.filter((_, j) => j !== li) };
      });
      return { ...d, modules };
    });
    showActionToast('Lesson deleted.');
  };

  const remapOpenLessonsAfterModuleSwap = (
    prev: Record<string, boolean>,
    a: number,
    b: number
  ): Record<string, boolean> => {
    const next: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(prev)) {
      if (!v) continue;
      const colon = k.indexOf(':');
      if (colon < 0) continue;
      const mi = Number(k.slice(0, colon));
      const rest = k.slice(colon + 1);
      if (!Number.isInteger(mi)) continue;
      let nmi = mi;
      if (mi === a) nmi = b;
      else if (mi === b) nmi = a;
      next[`${nmi}:${rest}`] = true;
    }
    return next;
  };

  const moveModule = (
    mi: number,
    delta: -1 | 1,
    scrollAnchor?: HTMLElement | null
  ) => {
    const d0 = draftRef.current;
    if (!d0) return;
    const computed = computeModuleSwapDraft(d0, mi, delta);
    if (!computed) return;

    if (scrollAnchor) {
      const ctrl = scrollAnchor.getAttribute('data-module-reorder');
      const ni = mi + delta;
      pendingModuleReorderFocusRef.current = {
        targetMiAfter: ni,
        control: ctrl === 'down' ? 'down' : 'up',
        beforeTop: scrollAnchor.getBoundingClientRect().top,
      };
    }

    const { a, b } = computed.pair;
    flushSync(() => setDraft(computed.next));

    setOpenModules((prev) => {
      const oa = prev[a];
      const ob = prev[b];
      if (!oa && !ob) return prev;
      const next: Record<number, boolean> = { ...prev };
      delete next[a];
      delete next[b];
      if (oa) next[b] = true;
      if (ob) next[a] = true;
      return next;
    });
    setOpenLessons((prev) => remapOpenLessonsAfterModuleSwap(prev, a, b));

    setModuleReorderLayoutTick((t) => t + 1);
  };

  const moveLesson = (
    mi: number,
    lessonRowKey: string,
    delta: -1 | 1,
    scrollAnchor?: HTMLElement | null
  ) => {
    if (!lessonRowKey.trim()) return;

    if (scrollAnchor) {
      const ctrl = scrollAnchor.getAttribute('data-lesson-reorder');
      pendingLessonReorderFocusRef.current = {
        lessonKey: lessonRowKey,
        control: ctrl === 'down' ? 'down' : 'up',
        beforeTop: scrollAnchor.getBoundingClientRect().top,
      };
    }

    const d0 = draftRef.current;
    if (!d0) return;
    const computed = computeLessonSwapDraft(d0, mi, lessonRowKey, delta);
    if (!computed) return;

    flushSync(() => setDraft(computed.next));

    const pair = computed.pair;
    if (pair) {
      const k1 = `${mi}:${pair.li}`;
      const k2 = `${mi}:${pair.ni}`;
      setOpenLessons((prev) => {
        const o1 = prev[k1];
        const o2 = prev[k2];
        if (!o1 && !o2) return prev;
        const next = { ...prev };
        delete next[k1];
        delete next[k2];
        if (o1) next[k2] = true;
        if (o2) next[k1] = true;
        return next;
      });
    }

    setLessonReorderLayoutTick((t) => t + 1);
  };

  useLayoutEffect(() => {
    const job = pendingLessonReorderFocusRef.current;
    if (!job) return;
    pendingLessonReorderFocusRef.current = null;
    const sel = `[data-admin-lesson-row="${escapeSelectorAttrValue(job.lessonKey)}"]`;
    const row = queryElementInScopeOrDocument(courseCatalogEditorRef.current, sel);
    applyReorderViewportScrollAndFocus(row, job, REORDER_DATA_ATTR_SELECTORS.lesson);
  }, [lessonReorderLayoutTick]);

  useLayoutEffect(() => {
    const job = pendingModuleReorderFocusRef.current;
    if (!job) return;
    pendingModuleReorderFocusRef.current = null;
    const sel = `[data-admin-module-index="${job.targetMiAfter}"]`;
    const row = queryElementInScopeOrDocument(courseCatalogEditorRef.current, sel);
    applyReorderViewportScrollAndFocus(row, job, REORDER_DATA_ATTR_SELECTORS.module);
  }, [moduleReorderLayoutTick]);

  const moveLessonToModule = (mi: number, li: number, targetMi: number) => {
    if (targetMi === mi) return;
    let opened: { targetMi: number; newLi: number } | null = null;
    setDraft((d) => {
      if (!d) return null;
      if (targetMi < 0 || targetMi >= d.modules.length) return d;
      const source = d.modules[mi];
      if (!source || source.lessons.length <= 1 || !source.lessons[li]) return d;

      const moved = { ...source.lessons[li]! };
      const modulesWithout = d.modules.map((m, i) => {
        if (i !== mi) return m;
        return { ...m, lessons: m.lessons.filter((_, j) => j !== li) };
      });

      let lessonToInsert = moved;
      if (!isStructuredCourseId(d.id)) {
        const tempCourse: Course = { ...d, modules: modulesWithout };
        lessonToInsert = { ...moved, id: nextLessonIdLegacy(tempCourse) };
      }

      const finalModules = modulesWithout.map((m, i) => {
        if (i !== targetMi) return m;
        return { ...m, lessons: [...m.lessons, lessonToInsert] };
      });

      let next: Course = { ...d, modules: finalModules };
      if (isStructuredCourseId(next.id)) {
        next = remapStructuredCourseModuleLessonIdsByOrder(next);
      }
      const newLi = next.modules[targetMi]!.lessons.length - 1;
      opened = { targetMi, newLi };
      return next;
    });
    if (!opened) {
      showActionToast(
        'Could not move lesson. Add another lesson to this module first—each module must keep at least one.',
        'danger'
      );
      return;
    }
    setOpenModules({ [opened.targetMi]: true });
    setOpenLessons({ [`${opened.targetMi}:${opened.newLi}`]: true });
    showActionToast('Lesson moved to the other module.');
  };

  const toggleModuleOpen = (mi: number) => {
    setOpenModules((prev) => {
      const nextOpen = !prev[mi];
      if (!nextOpen) return {};
      return { [mi]: true };
    });
    // Working in module editor should collapse the course details section.
    setCourseDetailsOpen(false);
    // When switching modules, collapse all lesson panels until the user picks one.
    setOpenLessons({});
  };

  const toggleLessonOpen = (mi: number, li: number) => {
    const key = `${mi}:${li}`;
    setOpenLessons((prev) => {
      const nextOpen = !prev[key];
      if (!nextOpen) return {};
      return { [key]: true };
    });
  };

  const catalogDisclosureLessonKey = useMemo(() => {
    const k = Object.keys(openLessons).find((key) => openLessons[key]);
    return k ?? null;
  }, [openLessons]);

  const catalogDisclosureModuleMi = useMemo(() => {
    const e = Object.entries(openModules).find(([, v]) => v);
    if (!e) return null;
    const mi = Number(e[0]);
    return Number.isInteger(mi) ? mi : null;
  }, [openModules]);

  /** Align expanded course details / module / lesson block to top of viewport (catalog has no inner scroll shell). */
  useLayoutEffect(() => {
    const root = courseCatalogEditorRef.current;
    if (!root) return;
    let el: HTMLElement | null = null;
    if (catalogDisclosureLessonKey) {
      const parts = catalogDisclosureLessonKey.split(':');
      const mi = Number(parts[0]);
      const li = Number(parts[1]);
      if (Number.isInteger(mi) && Number.isInteger(li)) {
        el = root.querySelector(`[data-lesson-mi="${mi}"][data-lesson-li="${li}"]`);
      }
    } else if (catalogDisclosureModuleMi != null) {
      el = root.querySelector(`[data-admin-module-index="${catalogDisclosureModuleMi}"]`);
    } else if (courseDetailsOpen) {
      el = courseDetailsDisclosureRef.current;
    }
    scrollDisclosureRowToTop(null, el);
  }, [catalogDisclosureLessonKey, catalogDisclosureModuleMi, courseDetailsOpen]);

  useLayoutEffect(() => {
    const miFocus = pendingScrollToNewModuleTitleMiRef.current;
    if (miFocus == null || !draft) return;
    if (!openModules[miFocus]) return;
    let frames = 0;
    const tryFocus = () => {
      const el = document.getElementById(`admin-module-title-${miFocus}`);
      if (el instanceof HTMLElement) {
        pendingScrollToNewModuleTitleMiRef.current = null;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus({ preventScroll: true });
        return;
      }
      frames += 1;
      if (frames < 24) requestAnimationFrame(tryFocus);
      else pendingScrollToNewModuleTitleMiRef.current = null;
    };
    requestAnimationFrame(tryFocus);
  }, [draft, openModules]);

  useLayoutEffect(() => {
    const pos = pendingScrollToNewLessonTitleRef.current;
    if (!pos || !draft) return;
    const { mi, li } = pos;
    if (!openModules[mi] || !openLessons[`${mi}:${li}`]) return;
    let frames = 0;
    const tryFocus = () => {
      const el = document.getElementById(`admin-lesson-title-${mi}-${li}`);
      if (el instanceof HTMLElement) {
        pendingScrollToNewLessonTitleRef.current = null;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus({ preventScroll: true });
        return;
      }
      frames += 1;
      if (frames < 24) requestAnimationFrame(tryFocus);
      else pendingScrollToNewLessonTitleRef.current = null;
    };
    requestAnimationFrame(tryFocus);
  }, [draft, openModules, openLessons]);

  const getFirstRequiredFieldTarget = (c: Course): RequiredFieldTarget | null => {
    if (!c.title.trim()) return { targetId: 'admin-course-title', scope: 'course', moduleIndex: 0 };
    if (!c.author.trim()) return { targetId: 'admin-course-author', scope: 'course', moduleIndex: 0 };
    if (!c.thumbnail.trim()) return { targetId: 'admin-course-thumbnail', scope: 'course', moduleIndex: 0 };
    if (!c.categories?.length || !c.categories.some((x) => x.trim())) {
      return { targetId: 'admin-course-categories', scope: 'course', moduleIndex: 0 };
    }
    if (!c.modules.length) return { targetId: 'admin-course-title', scope: 'course', moduleIndex: 0 };
    for (let mi = 0; mi < c.modules.length; mi += 1) {
      const m = c.modules[mi];
      if (!m.id.trim()) {
        return {
          targetId: `admin-module-id-${mi}`,
          scope: 'module',
          moduleIndex: mi,
          lessonKeys: [`${mi}:0`],
        };
      }
      if (!m.title.trim()) {
        return {
          targetId: `admin-module-title-${mi}`,
          scope: 'module',
          moduleIndex: mi,
          lessonKeys: [`${mi}:0`],
        };
      }
      const moduleTitleKey = m.title.trim().toLowerCase();
      for (let pj = 0; pj < mi; pj += 1) {
        const prev = c.modules[pj];
        if (prev.title.trim() && prev.title.trim().toLowerCase() === moduleTitleKey) {
          return {
            targetId: `admin-module-title-${mi}`,
            scope: 'module',
            moduleIndex: mi,
            lessonKeys: [`${mi}:0`],
          };
        }
      }
      if (!m.lessons.length) {
        return {
          targetId: `admin-module-title-${mi}`,
          scope: 'module',
          moduleIndex: mi,
          lessonKeys: [],
        };
      }
      for (let li = 0; li < m.lessons.length; li += 1) {
        const l = m.lessons[li];
        const lessonKey = `${mi}:${li}`;
        const openKeys = li === 0 ? [lessonKey] : [`${mi}:0`, lessonKey];
        if (!l.id.trim()) {
          return {
            targetId: `admin-lesson-id-${mi}-${li}`,
            scope: 'module',
            moduleIndex: mi,
            lessonKeys: openKeys,
          };
        }
        if (!l.title.trim()) {
          return {
            targetId: `admin-lesson-title-${mi}-${li}`,
            scope: 'module',
            moduleIndex: mi,
            lessonKeys: openKeys,
          };
        }
        const lessonTitleKey = l.title.trim().toLowerCase();
        for (let mi2 = 0; mi2 < c.modules.length; mi2 += 1) {
          for (let li2 = 0; li2 < c.modules[mi2].lessons.length; li2 += 1) {
            if (mi2 === mi && li2 === li) continue;
            if (mi2 > mi || (mi2 === mi && li2 > li)) continue;
            const other = c.modules[mi2].lessons[li2];
            if (other.title.trim() && other.title.trim().toLowerCase() === lessonTitleKey) {
              return {
                targetId: `admin-lesson-title-${mi}-${li}`,
                scope: 'module',
                moduleIndex: mi,
                lessonKeys: openKeys,
              };
            }
          }
        }
        if (l.contentKind === 'web') {
          if (!lessonWebHref(l)) {
            return {
              targetId: `admin-lesson-web-url-${mi}-${li}`,
              scope: 'module',
              moduleIndex: mi,
              lessonKeys: openKeys,
            };
          }
        } else if (l.contentKind === 'quiz') {
          if (validateLessonQuiz(l, mi, li)) {
            return {
              targetId: `admin-quiz-block-${mi}-${li}`,
              scope: 'module',
              moduleIndex: mi,
              lessonKeys: openKeys,
            };
          }
        } else if (!l.videoUrl.trim() || !l.videoUrl.startsWith('http')) {
          return {
            targetId: `admin-lesson-url-${mi}-${li}`,
            scope: 'module',
            moduleIndex: mi,
            lessonKeys: openKeys,
          };
        }
      }
    }
    if (c.rating < 0 || c.rating > 5) {
      return { targetId: 'admin-course-rating', scope: 'course', moduleIndex: 0 };
    }
    return null;
  };

  const fieldErrors = useMemo(() => {
    const out = {
      courseTitle: false,
      courseAuthor: false,
      courseThumbnail: false,
      courseRating: false,
      courseCategories: false,
      moduleId: new Set<number>(),
      moduleTitle: new Set<number>(),
      lessonId: new Set<string>(),
      lessonTitle: new Set<string>(),
      videoUrl: new Set<string>(),
      lessonWebUrl: new Set<string>(),
      lessonQuiz: new Set<string>(),
    };
    if (!draft) return out;
    if (!draft.title.trim()) out.courseTitle = true;
    if (!draft.author.trim()) out.courseAuthor = true;
    if (!draft.thumbnail.trim()) out.courseThumbnail = true;
    if (!draft.categories?.length || !draft.categories.some((x) => x.trim())) out.courseCategories = true;
    if (draft.rating < 0 || draft.rating > 5) out.courseRating = true;
    for (let mi = 0; mi < draft.modules.length; mi += 1) {
      const m = draft.modules[mi];
      if (!m.id.trim()) out.moduleId.add(mi);
      if (!m.title.trim()) out.moduleTitle.add(mi);
      const mt = m.title.trim().toLowerCase();
      if (mt) {
        for (let pj = 0; pj < mi; pj += 1) {
          const prev = draft.modules[pj];
          if (prev.title.trim() && prev.title.trim().toLowerCase() === mt) {
            out.moduleTitle.add(mi);
            out.moduleTitle.add(pj);
          }
        }
      }
      for (let li = 0; li < m.lessons.length; li += 1) {
        const l = m.lessons[li];
        const key = `${mi}:${li}`;
        if (!l.id.trim()) out.lessonId.add(key);
        if (!l.title.trim()) out.lessonTitle.add(key);
        if (l.contentKind === 'web') {
          if (!lessonWebHref(l)) out.lessonWebUrl.add(key);
        } else if (l.contentKind === 'quiz') {
          if (validateLessonQuiz(l, mi, li)) out.lessonQuiz.add(key);
        } else if (!l.videoUrl.trim() || !l.videoUrl.startsWith('http')) {
          out.videoUrl.add(key);
        }
      }
    }
    for (let mi = 0; mi < draft.modules.length; mi += 1) {
      for (let li = 0; li < draft.modules[mi].lessons.length; li += 1) {
        const l = draft.modules[mi].lessons[li];
        const key = `${mi}:${li}`;
        const lt = l.title.trim().toLowerCase();
        if (!lt) continue;
        for (let mi2 = 0; mi2 < draft.modules.length; mi2 += 1) {
          for (let li2 = 0; li2 < draft.modules[mi2].lessons.length; li2 += 1) {
            if (mi2 === mi && li2 === li) continue;
            if (mi2 > mi || (mi2 === mi && li2 > li)) continue;
            const o = draft.modules[mi2].lessons[li2];
            if (o.title.trim() && o.title.trim().toLowerCase() === lt) {
              out.lessonTitle.add(key);
              out.lessonTitle.add(`${mi2}:${li2}`);
            }
          }
        }
      }
    }
    return out;
  }, [draft]);

  const isDirty =
    !!draft &&
    baselineJson !== null &&
    draftJsonForBaseline(draft) !== baselineJson;

  useEffect(() => {
    onDraftDirtyChange?.(isDirty);
    return () => onDraftDirtyChange?.(false);
  }, [isDirty, onDraftDirtyChange]);

  /**
   * Bulk updates (Taxonomy “remove/rename everywhere”, etc.) refresh `publishedList` from Firestore while the
   * catalog editor `draft` can stay stale until a full page reload. Re-bind the selected course when there are no
   * unsaved local edits so categories/skills match the server immediately.
   */
  useEffect(() => {
    if (selector === '' || selector === '__new__') return;
    if (isDirty || !draft) return;
    if (isAdminMergedCatalog) {
      const p = parseAdminCatalogCourseSelector(selector);
      if (p.kind === 'published') {
        const fresh = publishedList.find((c) => c.id === p.courseId);
        if (!fresh || draft.id !== p.courseId) return;
        const keyed = ensureCourseLessonRowKeys(normalizeCourseTaxonomy(deepClone(fresh)));
        const nextBaseline = draftJsonForBaseline(keyed);
        if (nextBaseline === draftJsonForBaseline(draft)) return;
        setDraft(keyed);
        setBaselineJson(nextBaseline);
        return;
      }
      if (p.kind === 'creator') {
        const row = creatorDraftRows.find(
          (r) => r.ownerUid === p.ownerUid && r.course.id === p.courseId
        );
        if (!row || draft.id !== p.courseId) return;
        const keyed = ensureCourseLessonRowKeys(normalizeCourseTaxonomy(deepClone(row.course)));
        const nextBaseline = draftJsonForBaseline(keyed);
        if (nextBaseline === draftJsonForBaseline(draft)) return;
        setDraft(keyed);
        setBaselineJson(nextBaseline);
      }
      return;
    }
    const fresh = publishedList.find((c) => c.id === selector);
    if (!fresh || draft.id !== selector) return;
    const keyed = ensureCourseLessonRowKeys(normalizeCourseTaxonomy(deepClone(fresh)));
    const nextBaseline = draftJsonForBaseline(keyed);
    if (nextBaseline === draftJsonForBaseline(draft)) return;
    setDraft(keyed);
    setBaselineJson(nextBaseline);
  }, [publishedList, creatorDraftRows, selector, draft, isDirty, isAdminMergedCatalog]);

  const onCourseSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (id === '') return;
    if (isDirty && id !== selector) {
      setCourseLeaveDialog({ kind: 'select', nextId: id });
      return;
    }
    void applyPickCourse(id);
  };

  const handleSave = async () => {
    if (!draft) return;
    if (baselineJson !== null && draftJsonForBaseline(draft) === baselineJson) {
      showActionToast('No changes to save.', 'neutral');
      return;
    }
    const normalized = normalizeCourseTaxonomy(stripAdminLessonRowKeys(draft));
    const err = validateCourseDraft(normalized);
    if (err) {
      setShowValidationHints(true);
      const target = getFirstRequiredFieldTarget(normalized);
      if (target) {
        if (target.scope === 'course') {
          setCourseDetailsOpen(true);
          setOpenModules({});
          setOpenLessons({});
        } else {
          setCourseDetailsOpen(false);
          setOpenModules({ [target.moduleIndex]: true });
          const nextLessons: Record<string, boolean> = {};
          for (const k of target.lessonKeys ?? []) nextLessons[k] = true;
          setOpenLessons(nextLessons);
        }
        pendingScrollTargetIdRef.current = target.targetId;
      }
      showActionToast(err, 'danger');
      return;
    }
    try {
      const pathTitles = await loadPathTitlesForConflictCheck({
        mode: isCreatorCatalog ? 'creator' : 'admin',
        creatorOwnerUid: catalogPersistence?.kind === 'creator' ? catalogPersistence.ownerUid : undefined,
      });
      const courseRows =
        isCreatorCatalog
          ? [...publishedList, ...publishedCoursesForPicker].map((c) => ({ id: c.id, title: c.title }))
          : isAdminMergedCatalog
            ? [...publishedList, ...creatorDraftRows.map((r) => r.course)].map((c) => ({
                id: c.id,
                title: c.title,
              }))
            : publishedList.map((c) => ({ id: c.id, title: c.title }));
      const titleHit = findCourseSaveTitleConflict(
        normalized.title,
        normalized.id,
        pathTitles,
        courseRows
      );
      if (titleHit) {
        setCourseTitleConflict(titleHit);
        return;
      }
    } catch {
      showActionToast('Could not verify title uniqueness. Try again.', 'danger');
      return;
    }
    setBusy(true);
    let ok = false;
    if (catalogPersistence?.kind === 'creator') {
      ok = await saveCreatorCourse(normalized, catalogPersistence.ownerUid);
    } else if (isAdminMergedCatalog) {
      const ps = parseAdminCatalogCourseSelector(selector);
      if (ps.kind === 'new') {
        const t = newCourseSaveTargetRef.current;
        ok =
          t.kind === 'creator'
            ? await saveCreatorCourse(normalized, t.ownerUid, { allowNonOwnerWriter: true })
            : await savePublishedCourse(normalized);
      } else if (ps.kind === 'published') {
        ok = await savePublishedCourse(normalized);
      } else if (ps.kind === 'creator') {
        ok = await saveCreatorCourse(normalized, ps.ownerUid, { allowNonOwnerWriter: true });
      }
    } else {
      ok = await savePublishedCourse(normalized);
    }
    setBusy(false);
    if (ok) {
      setShowValidationHints(false);
      setDraft(ensureCourseLessonRowKeys(normalized));
      if (!isCreatorCatalog) {
        for (const cat of normalized.categories) {
          if (cat.trim()) addCatalogCategoryExtra(cat.trim());
        }
        for (const sk of normalized.skills) {
          if (sk.trim()) addCatalogSkillExtra(sk.trim());
        }
      }
      showActionToast('Course saved.');
      await refreshList();
      await onCatalogChanged();
      if (isAdminMergedCatalog) {
        if (selector === '__new__') {
          const t = newCourseSaveTargetRef.current;
          setSelector(
            t.kind === 'creator'
              ? buildAdminCatalogCreatorSelector(t.ownerUid, normalized.id)
              : buildAdminCatalogPublishedSelector(normalized.id)
          );
        } else {
          const ps = parseAdminCatalogCourseSelector(selector);
          if (ps.kind === 'creator') {
            setSelector(buildAdminCatalogCreatorSelector(ps.ownerUid, normalized.id));
          } else if (ps.kind === 'published') {
            setSelector(buildAdminCatalogPublishedSelector(normalized.id));
          }
        }
      } else {
        setSelector(normalized.id);
      }
      setBaselineJson(JSON.stringify(normalized));
    } else {
      showActionToast('Save failed (check console / rules).', 'danger');
    }
  };

  const duplicatePublishedAsDraft = async () => {
    if (!selector || selector === '__new__') {
      showActionToast('Select an existing course in the list, then duplicate.', 'danger');
      return;
    }
    let fromEditor: Course | null = null;
    if (isAdminMergedCatalog) {
      const p = parseAdminCatalogCourseSelector(selector);
      if (p.kind === 'published') {
        fromEditor =
          draft && draft.id === p.courseId ? draft : publishedList.find((c) => c.id === p.courseId) ?? null;
        if (fromEditor) newCourseSaveTargetRef.current = { kind: 'published' };
      } else if (p.kind === 'creator') {
        const row = creatorDraftRows.find(
          (r) => r.ownerUid === p.ownerUid && r.course.id === p.courseId
        );
        if (row) {
          fromEditor =
            draft && draft.id === row.course.id ? draft : deepClone(row.course);
          /** Admin merged catalog: copy saves to published catalog, not the source creator's private `creatorCourses`. */
          newCourseSaveTargetRef.current = { kind: 'published' };
        }
      }
    } else {
      fromEditor =
        draft && draft.id === selector ? draft : publishedList.find((c) => c.id === selector) ?? null;
      if (isCreatorCatalog && catalogPersistence?.kind === 'creator') {
        newCourseSaveTargetRef.current = { kind: 'creator', ownerUid: catalogPersistence.ownerUid };
      } else {
        newCourseSaveTargetRef.current = { kind: 'published' };
      }
    }
    if (!fromEditor) {
      showActionToast('Course not found. Reload the list and try again.', 'danger');
      return;
    }
    const reserveDraftCn =
      selector === '__new__' && draft && STRUCTURED_COURSE_ID_RE.test(draft.id) ? [draft.id] : [];
    const docIds = await courseDocumentIdsForAllocation();
    const newId = firstAvailableStructuredCourseIdFromDocIds(docIds, reserveDraftCn);
    const copy = remapCourseToStructuredIds(deepClone(fromEditor), newId);
    const t = fromEditor.title.trim();
    copy.title = t.endsWith(' (copy)') ? t : `${t} (copy)`;
    pendingFocusCourseTitleRef.current = true;
    setSelector('__new__');
    const keyed = ensureCourseLessonRowKeys(copy);
    setDraft(keyed);
    setBaselineJson(draftJsonForBaseline(keyed));
    showActionToast(
      isAdminMergedCatalog
        ? 'Copy loaded as a new draft — it will save to the live (published) catalog. IDs use C{n}M{m}L{l}. Adjust title if needed, then Save.'
        : 'Copy loaded as a new draft — IDs use C{n}M{m}L{l}. Adjust title if needed, then Save.'
    );
  };

  const requestDuplicateOrConfirm = () => {
    if (!isDirty) {
      void duplicatePublishedAsDraft();
      return;
    }
    setCourseLeaveDialog({ kind: 'duplicate' });
  };

  const closeCourseLeaveDialog = () => setCourseLeaveDialog(null);

  const confirmCourseLeaveDiscard = () => {
    if (!courseLeaveDialog) return;
    const pending = courseLeaveDialog;
    setCourseLeaveDialog(null);
    if (draft && baselineJson !== null) {
      try {
        const restored = JSON.parse(baselineJson) as Course;
        setDraft(ensureCourseLessonRowKeys(deepClone(restored)));
      } catch {
        showActionToast('Could not restore draft.', 'danger');
        return;
      }
    }
    if (pending.kind === 'select') {
      void applyPickCourse(pending.nextId);
    } else {
      void duplicatePublishedAsDraft();
    }
  };

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePathRefs, setDeletePathRefs] = useState<LearningPathCourseRefHit[]>([]);
  const [courseTitleConflict, setCourseTitleConflict] = useState<TitleConflictHit | null>(null);

  const closeDeleteDialog = useCallback(() => {
    setDeleteDialogOpen(false);
    setDeletePathRefs([]);
  }, []);

  const executeCourseDelete = useCallback(
    async (courseSnapshot: Course, pathHits: LearningPathCourseRefHit[]) => {
      const courseId = courseSnapshot.id;
      const parsed = isAdminMergedCatalog ? parseAdminCatalogCourseSelector(selector) : null;
      const deleteCreator =
        catalogPersistence?.kind === 'creator' || parsed?.kind === 'creator';
      const allowNonOwnerCreatorPathWrite = !isCreatorCatalog;

      setDeleteDialogOpen(false);
      setDeletePathRefs([]);
      setBusy(true);
      try {
        for (const hit of pathHits) {
          const ok = await removeCourseIdFromLearningPathDocument(hit, courseId, {
            allowNonOwnerCreatorPathWrite,
          });
          if (!ok) {
            showActionToast(
              `Could not update learning path “${hit.title}”. The course was not deleted.`,
              'danger'
            );
            return;
          }
        }
        if (!isCreatorCatalog) {
          console.debug('[debug:courseReuse]', 'admin delete: running learner Firestore purge', {
            courseId: courseSnapshot.id,
          });
          const purged = await purgeLearnerFirestoreDataForCourse(courseSnapshot);
          if (!purged) {
            showActionToast(
              'Could not clear all learner data for this course. The course was not deleted.',
              'danger'
            );
            return;
          }
        } else {
          console.debug('[debug:courseReuse]', 'creator delete: skipping full learner purge', {
            courseId: courseSnapshot.id,
          });
        }
        const ok = deleteCreator ? await deleteCreatorCourse(courseId) : await deletePublishedCourse(courseId);
        if (!ok) {
          showActionToast('Delete failed.', 'danger');
          return;
        }
        await refreshList();
        await onCatalogChanged();
        if (pathHits.length > 0) {
          await pathBuilderRef.current?.reloadPaths();
        }
        setDraft(null);
        setBaselineJson(null);
        setSelector('');
        const pathNote =
          pathHits.length > 0
            ? ` Removed from ${pathHits.length} learning path${pathHits.length === 1 ? '' : 's'}.`
            : '';
        showActionToast(`Course deleted.${pathNote}`);
      } finally {
        setBusy(false);
      }
    },
    [
      selector,
      isAdminMergedCatalog,
      catalogPersistence,
      isCreatorCatalog,
      refreshList,
      onCatalogChanged,
      showActionToast,
    ]
  );

  const requestDeleteCourse = useCallback(async () => {
    if (!draft || !selectionIsExistingCatalogCourse) return;
    const courseId = draft.id;

    const parsed = isAdminMergedCatalog ? parseAdminCatalogCourseSelector(selector) : null;
    const deleteCreator =
      catalogPersistence?.kind === 'creator' || parsed?.kind === 'creator';

    let scopedUid = '';
    if (deleteCreator) {
      scopedUid =
        catalogPersistence?.kind === 'creator'
          ? catalogPersistence.ownerUid.trim()
          : parsed?.kind === 'creator'
            ? parsed.ownerUid.trim()
            : '';
      if (!scopedUid) {
        showActionToast('Could not resolve creator for this course.', 'danger');
        return;
      }
    }

    setBusy(true);
    let hits: LearningPathCourseRefHit[] = [];
    try {
      hits = await findLearningPathReferencesToCourseId(
        courseId,
        deleteCreator ? { creatorOwnerUidForScopedScan: scopedUid } : undefined
      );
    } catch {
      showActionToast('Could not check learning paths. Try again.', 'danger');
      setBusy(false);
      return;
    }
    setBusy(false);

    if (hits.length === 0) {
      void executeCourseDelete(draft, []);
      return;
    }
    setDeletePathRefs(hits);
    setDeleteDialogOpen(true);
  }, [
    draft,
    selectionIsExistingCatalogCourse,
    isAdminMergedCatalog,
    selector,
    catalogPersistence,
    showActionToast,
    executeCourseDelete,
  ]);

  const confirmDeletePublished = useCallback(async () => {
    if (!draft) return;
    const refs = deletePathRefs;
    await executeCourseDelete(draft, refs);
  }, [draft, deletePathRefs, executeCourseDelete]);

  useBodyScrollLock(
    deleteDialogOpen ||
      subTabSwitchConfirmOpen ||
      pathSubTabSwitchConfirmOpen ||
      courseLeaveDialog !== null ||
      courseTitleConflict !== null
  );

  /** Ref updated by PathBuilder via onPathsDirtyChange — read before opening catalog tab confirm. */
  const pathBuilderDirtyRef = useRef(false);
  const courseDiscardTargetRef = useRef<'paths' | 'taxonomy' | 'categories' | 'catalog' | 'presets'>('paths');
  const pathDiscardTargetRef = useRef<'catalog' | 'taxonomy' | 'categories' | 'presets'>('catalog');
  const setPathBuilderDirty = useCallback(
    (dirty: boolean) => {
      pathBuilderDirtyRef.current = dirty;
      onPathsDirtyChange?.(dirty);
    },
    [onPathsDirtyChange]
  );

  const requestContentCatalogSubTab = useCallback(
    (next: ContentCatalogSubTab) => {
      if (next === contentCatalogSubTab) return;
      if (isCreatorCatalog && next !== 'catalog' && next !== 'paths') return;

      if (contentCatalogSubTab === 'paths') {
        if (next === 'catalog') {
          if (pathBuilderDirtyRef.current) {
            pathDiscardTargetRef.current = 'catalog';
            setPathSubTabSwitchConfirmOpen(true);
            return;
          }
          setContentCatalogSubTab('catalog');
          return;
        }
        if (next === 'taxonomy' || next === 'categories' || next === 'presets' || next === 'skillPresets') {
          if (pathBuilderDirtyRef.current) {
            pathDiscardTargetRef.current = next;
            setPathSubTabSwitchConfirmOpen(true);
            return;
          }
          setContentCatalogSubTab(next);
          return;
        }
        return;
      }

      if (contentCatalogSubTab === 'catalog') {
        if (next === 'paths') {
          if (!isDirty) {
            setContentCatalogSubTab('paths');
            return;
          }
          courseDiscardTargetRef.current = 'paths';
          setSubTabSwitchConfirmOpen(true);
          return;
        }
        if (next === 'taxonomy' || next === 'categories' || next === 'presets' || next === 'skillPresets') {
          if (!isDirty) {
            setContentCatalogSubTab(next);
            return;
          }
          courseDiscardTargetRef.current = next;
          setSubTabSwitchConfirmOpen(true);
          return;
        }
        return;
      }

      if (contentCatalogSubTab === 'taxonomy') {
        if (next === 'catalog') {
          if (!isDirty) {
            setContentCatalogSubTab('catalog');
            return;
          }
          courseDiscardTargetRef.current = 'catalog';
          setSubTabSwitchConfirmOpen(true);
          return;
        }
        if (next === 'paths') {
          if (!isDirty) {
            setContentCatalogSubTab('paths');
            return;
          }
          courseDiscardTargetRef.current = 'paths';
          setSubTabSwitchConfirmOpen(true);
          return;
        }
        if (next === 'categories') {
          setContentCatalogSubTab('categories');
          return;
        }
        if (next === 'presets') {
          setContentCatalogSubTab('presets');
          return;
        }
        if (next === 'skillPresets') {
          setContentCatalogSubTab('skillPresets');
          return;
        }
        return;
      }

      if (contentCatalogSubTab === 'categories') {
        if (next === 'catalog') {
          if (!isDirty) {
            setContentCatalogSubTab('catalog');
            return;
          }
          courseDiscardTargetRef.current = 'catalog';
          setSubTabSwitchConfirmOpen(true);
          return;
        }
        if (next === 'paths') {
          if (!isDirty) {
            setContentCatalogSubTab('paths');
            return;
          }
          courseDiscardTargetRef.current = 'paths';
          setSubTabSwitchConfirmOpen(true);
          return;
        }
        if (next === 'presets') {
          setContentCatalogSubTab('presets');
          return;
        }
        if (next === 'skillPresets') {
          setContentCatalogSubTab('skillPresets');
          return;
        }
        if (next === 'taxonomy') {
          setContentCatalogSubTab('taxonomy');
          return;
        }
        return;
      }

      if (contentCatalogSubTab === 'presets') {
        if (next === 'catalog') {
          if (!isDirty) {
            setContentCatalogSubTab('catalog');
            return;
          }
          courseDiscardTargetRef.current = 'catalog';
          setSubTabSwitchConfirmOpen(true);
          return;
        }
        if (next === 'paths') {
          if (!isDirty) {
            setContentCatalogSubTab('paths');
            return;
          }
          courseDiscardTargetRef.current = 'paths';
          setSubTabSwitchConfirmOpen(true);
          return;
        }
        if (next === 'categories') {
          setContentCatalogSubTab('categories');
          return;
        }
        if (next === 'taxonomy') {
          setContentCatalogSubTab('taxonomy');
          return;
        }
        if (next === 'skillPresets') {
          setContentCatalogSubTab('skillPresets');
          return;
        }
      }

      if (contentCatalogSubTab === 'skillPresets') {
        if (next === 'catalog') {
          if (!isDirty) {
            setContentCatalogSubTab('catalog');
            return;
          }
          courseDiscardTargetRef.current = 'catalog';
          setSubTabSwitchConfirmOpen(true);
          return;
        }
        if (next === 'paths') {
          if (!isDirty) {
            setContentCatalogSubTab('paths');
            return;
          }
          courseDiscardTargetRef.current = 'paths';
          setSubTabSwitchConfirmOpen(true);
          return;
        }
        if (next === 'categories') {
          setContentCatalogSubTab('categories');
          return;
        }
        if (next === 'taxonomy') {
          setContentCatalogSubTab('taxonomy');
          return;
        }
        if (next === 'presets') {
          setContentCatalogSubTab('presets');
          return;
        }
      }
    },
    [contentCatalogSubTab, isDirty, isCreatorCatalog]
  );

  const closeSubTabSwitchConfirm = useCallback(() => setSubTabSwitchConfirmOpen(false), []);

  const confirmDiscardCourseDraftAndSwitch = useCallback(() => {
    if (draft && baselineJson !== null) {
      try {
        const restored = JSON.parse(baselineJson) as Course;
        setDraft(ensureCourseLessonRowKeys(deepClone(restored)));
      } catch {
        showActionToast('Could not restore draft.', 'danger');
        return;
      }
    }
    setContentCatalogSubTab(courseDiscardTargetRef.current);
    setSubTabSwitchConfirmOpen(false);
  }, [draft, baselineJson, showActionToast]);

  const closePathSubTabSwitchConfirm = useCallback(() => setPathSubTabSwitchConfirmOpen(false), []);

  const confirmDiscardPathBuilderAndSwitch = useCallback(() => {
    setPathBuilderResetKey((k) => k + 1);
    pathBuilderDirtyRef.current = false;
    onPathsDirtyChange?.(false);
    setPathSubTabSwitchConfirmOpen(false);
    setContentCatalogSubTab(pathDiscardTargetRef.current);
  }, [onPathsDirtyChange]);

  useDialogKeyboard({
    open: subTabSwitchConfirmOpen,
    onClose: closeSubTabSwitchConfirm,
    onPrimaryAction: confirmDiscardCourseDraftAndSwitch,
  });

  useDialogKeyboard({
    open: courseLeaveDialog !== null,
    onClose: closeCourseLeaveDialog,
    onPrimaryAction: confirmCourseLeaveDiscard,
  });

  useDialogKeyboard({
    open: pathSubTabSwitchConfirmOpen,
    onClose: closePathSubTabSwitchConfirm,
    onPrimaryAction: confirmDiscardPathBuilderAndSwitch,
  });

  useDialogKeyboard({
    open: deleteDialogOpen,
    onClose: closeDeleteDialog,
    onPrimaryAction: () => void confirmDeletePublished(),
  });

  useEffect(() => {
    pendingOpenNewModuleIndexRef.current = null;
    pendingOpenNewLessonKeyRef.current = null;
    pendingScrollToNewModuleTitleMiRef.current = null;
    pendingScrollToNewLessonTitleRef.current = null;

    const prev = prevCatalogOpenStateRef.current;
    const did = draft?.id;

    if (!draft) {
      setCourseDetailsOpen(false);
      setOpenModules({});
      setOpenLessons({});
      prevCatalogOpenStateRef.current = { selector, draftId: undefined };
      return;
    }

    if (selector === '__new__') {
      setCourseDetailsOpen(true);
      setOpenModules({ 0: true });
      setOpenLessons({ '0:0': true });
      prevCatalogOpenStateRef.current = { selector, draftId: did };
      return;
    }

    // First save: selector __new__ → same id as draft; draft id did not change — keep expand/collapse as-is.
    const selMatchesDraftId =
      !isAdminMergedCatalog || !did
        ? selector === did
        : (() => {
            const p = parseAdminCatalogCourseSelector(selector);
            return (
              (p.kind === 'published' || p.kind === 'creator') && p.courseId === did
            );
          })();
    if (prev.selector === '__new__' && did && selMatchesDraftId && prev.draftId === did) {
      prevCatalogOpenStateRef.current = { selector, draftId: did };
      return;
    }

    setCourseDetailsOpen(false);
    setOpenModules({});
    setOpenLessons({});
    prevCatalogOpenStateRef.current = { selector, draftId: did };
  }, [draft?.id, selector, isAdminMergedCatalog]);

  useEffect(() => {
    const idx = pendingOpenNewModuleIndexRef.current;
    if (idx == null || !draft) return;
    if (idx < 0 || idx >= draft.modules.length) return;
    setOpenModules({ [idx]: true });
    pendingOpenNewModuleIndexRef.current = null;
  }, [draft?.modules.length, draft]);

  useEffect(() => {
    const key = pendingOpenNewLessonKeyRef.current;
    if (!key || !draft) return;
    const [miRaw, liRaw] = key.split(':');
    const mi = Number(miRaw);
    const li = Number(liRaw);
    if (!Number.isInteger(mi) || !Number.isInteger(li)) return;
    if (mi < 0 || mi >= draft.modules.length) return;
    if (li < 0 || li >= draft.modules[mi].lessons.length) return;
    setOpenLessons({ [key]: true });
    // Ensure the containing module is visible too.
    setOpenModules({ [mi]: true });
    pendingOpenNewLessonKeyRef.current = null;
  }, [draft?.modules, draft]);

  useEffect(() => {
    const id = pendingScrollTargetIdRef.current;
    if (!id) return;
    const rafId = requestAnimationFrame(() => {
      const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus({ preventScroll: true });
      pendingScrollTargetIdRef.current = null;
    });
    return () => cancelAnimationFrame(rafId);
  }, [openModules, openLessons, draft, showValidationHints, courseDetailsOpen]);

  useEffect(() => {
    if (!pendingFocusCourseTitleRef.current) return;
    if (selector !== '__new__' || baselineJson === null) {
      pendingFocusCourseTitleRef.current = false;
      return;
    }
    if (!courseDetailsOpen) return;
    const rafId = requestAnimationFrame(() => {
      const el = document.getElementById('admin-course-title') as HTMLInputElement | null;
      pendingFocusCourseTitleRef.current = false;
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(rafId);
  }, [selector, baselineJson, courseDetailsOpen]);

  return (
    <div className="min-w-0 space-y-6 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-bold">
          <BookOpen size={20} className="shrink-0 text-orange-500" />
          <span className="min-w-0">{catalogSectionTitle ?? 'Course catalog'}</span>
        </h2>
        {/* Keep a stable slot so the title row does not jump when switching tabs */}
        <div className="flex shrink-0 items-center justify-end">
          <button
            type="button"
            disabled={
              contentCatalogSubTab === 'catalog'
                ? listLoading
                : contentCatalogSubTab === 'paths'
                  ? listLoading || pathsListLoading
                : contentCatalogSubTab === 'taxonomy' ||
                    contentCatalogSubTab === 'categories' ||
                    contentCatalogSubTab === 'presets' ||
                    contentCatalogSubTab === 'skillPresets'
                    ? listLoading
                    : true
            }
            tabIndex={
              contentCatalogSubTab === 'catalog' ||
              contentCatalogSubTab === 'paths' ||
              contentCatalogSubTab === 'taxonomy' ||
              contentCatalogSubTab === 'categories' ||
              contentCatalogSubTab === 'presets' ||
              contentCatalogSubTab === 'skillPresets'
                ? undefined
                : -1
            }
            aria-hidden={
              contentCatalogSubTab !== 'catalog' &&
              contentCatalogSubTab !== 'paths' &&
              contentCatalogSubTab !== 'taxonomy' &&
              contentCatalogSubTab !== 'categories' &&
              contentCatalogSubTab !== 'presets' &&
              contentCatalogSubTab !== 'skillPresets'
            }
            onClick={() => {
              if (contentCatalogSubTab === 'catalog') {
                catalogRequestedRef.current = true;
                setCatalogRequested(true);
                void refreshList();
                return;
              }
              if (contentCatalogSubTab === 'paths') {
                void refreshList();
                void pathBuilderRef.current?.reloadPaths();
                return;
              }
              if (contentCatalogSubTab === 'taxonomy') {
                void refreshList();
                return;
              }
              if (contentCatalogSubTab === 'categories') {
                void refreshList();
                return;
              }
              if (contentCatalogSubTab === 'presets') {
                void refreshList();
                void loadCatalogCategoryPresets().then(setCategoryPresetsState);
                return;
              }
              if (contentCatalogSubTab === 'skillPresets') {
                void refreshList();
                return;
              }
            }}
            className={`inline-flex min-h-11 touch-manipulation items-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm font-semibold hover:bg-[var(--hover-bg)] active:opacity-90 disabled:opacity-50 sm:text-xs ${
              contentCatalogSubTab !== 'catalog' &&
              contentCatalogSubTab !== 'paths' &&
              contentCatalogSubTab !== 'taxonomy' &&
              contentCatalogSubTab !== 'categories' &&
              contentCatalogSubTab !== 'presets'
                ? 'invisible pointer-events-none'
                : ''
            }`}
          >
            <RefreshCw
              size={14}
              className={
                (contentCatalogSubTab === 'catalog' && listLoading) ||
              (contentCatalogSubTab === 'paths' && (listLoading || pathsListLoading)) ||
              (contentCatalogSubTab === 'taxonomy' && listLoading) ||
                ((contentCatalogSubTab === 'categories' ||
                  contentCatalogSubTab === 'presets' ||
                  contentCatalogSubTab === 'skillPresets') &&
                  listLoading)
                  ? 'animate-spin'
                  : ''
              }
              aria-hidden
            />
            Reload list
          </button>
        </div>
      </div>

      {isCreatorCatalog && (
        <p
          className="rounded-xl border border-orange-500/25 bg-orange-500/[0.07] px-3 py-2.5 text-xs leading-relaxed text-[var(--text-secondary)] sm:text-sm"
          role="note"
        >
          <span className="font-semibold text-[var(--text-primary)]">Finding your work:</span> switch to{' '}
          <strong className="text-[var(--text-primary)]">Catalog</strong> to create or edit courses, and to{' '}
          <strong className="text-[var(--text-primary)]">Paths</strong> to edit learning paths. Use{' '}
          <strong className="text-[var(--text-primary)]">Reload list</strong> if something you saved does not
          appear here. After saving, your drafts show in <strong className="text-[var(--text-primary)]">Browse Catalog</strong>{' '}
          for your account only (Draft label) until an admin publishes them for all learners.
        </p>
      )}

      <div className="-mx-1 flex min-h-11 flex-wrap items-center gap-2 border-b border-[var(--border-color)] px-1 pb-2">
        <button
          type="button"
          onClick={() => requestContentCatalogSubTab('catalog')}
          className={`inline-flex min-h-11 touch-manipulation shrink-0 items-center rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 active:opacity-90 ${
            contentCatalogSubTab === 'catalog' ? 'bg-orange-500/20 text-orange-500' : 'text-[var(--text-secondary)]'
          }`}
          aria-current={contentCatalogSubTab === 'catalog' ? 'page' : undefined}
        >
          Catalog
        </button>
        <div className="flex min-h-11 min-w-0 flex-1 gap-2 overflow-x-auto overflow-y-visible overscroll-x-contain pb-0.5 [scrollbar-width:none] [-webkit-overflow-scrolling:touch] sm:flex-wrap sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => requestContentCatalogSubTab('paths')}
            aria-current={contentCatalogSubTab === 'paths' ? 'page' : undefined}
            className={`inline-flex min-h-11 touch-manipulation shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold active:opacity-90 ${
              contentCatalogSubTab === 'paths' ? 'bg-orange-500/20 text-orange-500' : 'text-[var(--text-secondary)]'
            }`}
          >
            <Route size={15} aria-hidden />
            Paths
          </button>
          {!isCreatorCatalog && (
            <button
              type="button"
              onClick={() => requestContentCatalogSubTab('taxonomy')}
              className={`inline-flex min-h-11 touch-manipulation shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold active:opacity-90 ${
                contentCatalogSubTab === 'taxonomy' ? 'bg-orange-500/20 text-orange-500' : 'text-[var(--text-secondary)]'
              }`}
            >
              <Tags size={15} aria-hidden />
              Categories &amp; Skills
            </button>
          )}
        </div>
      </div>

      {contentCatalogSubTab === 'catalog' && (
        <>
      <div ref={courseCatalogEditorRef} className="space-y-4">
        <div className="space-y-3">
        <div className="min-w-0 overflow-x-auto overflow-y-visible [-webkit-overflow-scrolling:touch] pb-0.5">
        <div className="grid w-full min-w-[720px] grid-cols-[minmax(0,1.5fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_auto] items-start gap-x-3 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              <label
                htmlFor="admin-catalog-course-select"
                className="text-xs font-semibold leading-none text-[var(--text-secondary)]"
              >
                Course
              </label>
              <span ref={catalogTipsWrapRef} className="relative inline-flex shrink-0 items-center gap-1">
                <button
                  ref={catalogTipBtnRef}
                  type="button"
                  onClick={() => setCatalogTipsOpen((o) => !o)}
                  aria-expanded={catalogTipsOpen}
                  aria-controls="admin-catalog-editor-notes"
                  aria-label={catalogTipsOpen ? 'Close course field tips' : 'Open course field tips'}
                  className={`inline-flex size-6 shrink-0 touch-manipulation items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 active:opacity-90 ${
                    catalogTipsOpen ? 'border-orange-500/50 text-orange-500' : ''
                  }`}
                >
                  <Info size={14} className="text-orange-500/90" aria-hidden />
                </button>
                <div
                  id="admin-catalog-editor-notes"
                  role="region"
                  aria-label="Course field tips"
                  tabIndex={catalogTipsOpen && tipsNarrowViewport && catalogTipFixedTop >= 0 ? -1 : undefined}
                  onPointerDown={
                    catalogTipsOpen && tipsNarrowViewport && catalogTipFixedTop >= 0
                      ? (e) => (e.currentTarget as HTMLElement).focus({ preventScroll: true })
                      : undefined
                  }
                  className={
                    !catalogTipsOpen
                      ? 'hidden'
                      : tipsNarrowViewport
                        ? catalogTipFixedTop >= 0
                          ? 'fixed z-[120] left-3 right-3 w-auto max-w-none translate-x-0 overflow-y-auto overflow-x-hidden overscroll-y-contain [-webkit-overflow-scrolling:touch] touch-pan-y max-h-[calc(100dvh-var(--admin-tip-top)-env(safe-area-inset-bottom,0px)-0.75rem)] rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3.5 text-left text-sm leading-relaxed text-[var(--text-primary)] shadow-xl pointer-events-auto outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40'
                          : 'hidden'
                        : 'absolute left-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] max-w-sm rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-left text-xs leading-snug text-[var(--text-primary)] shadow-lg pointer-events-auto'
                  }
                  style={
                    catalogTipsOpen && tipsNarrowViewport && catalogTipFixedTop >= 0
                      ? narrowAdminTipPanelStyle(catalogTipFixedTop)
                      : undefined
                  }
                >
                  <ul className="list-disc space-y-1.5 pl-4 text-[var(--text-muted)] marker:text-orange-500/70 sm:space-y-1">
                    <li>
                      {isCreatorCatalog
                        ? 'Saves go to your private courses (Firestore) — only you and admins can see them.'
                        : isAdminMergedCatalog
                          ? 'Published rows save to the live catalog; creator drafts save to that owner’s private course (owner unchanged).'
                          : 'Saves go to the live catalog (Firestore).'}
                    </li>
                    {isAdminMergedCatalog ? (
                      <li>
                        Course list is prefixed: <strong className="font-semibold text-[var(--text-secondary)]">
                          [Published]
                        </strong>{' '}
                        vs{' '}
                        <strong className="font-semibold text-[var(--text-secondary)]">[Creator draft]</strong> (same
                        document ID can exist in both). Creator rows show title (id) · owner; hover for full uid details.
                      </li>
                    ) : null}
                    <li>
                      Open <strong className="font-semibold text-[var(--text-secondary)]">Course</strong> once to load
                      titles.
                    </li>
                    <li>
                      <strong className="font-semibold text-[var(--text-secondary)]">New Course</strong>: next id{' '}
                      <code className="text-orange-500/90">C1</code>, <code className="text-orange-500/90">C2</code>…;
                      list A–Z.
                    </li>
                    <li>
                      Ids: modules <code className="text-orange-500/90">C1M1</code>, lessons{' '}
                      <code className="text-orange-500/90">C1M1L1</code>.
                    </li>
                  </ul>
                </div>
              </span>
            </div>
            <div className="flex min-w-0 items-stretch gap-2">
            <select
              id="admin-catalog-course-select"
              value={selector}
              onFocus={openCourseCatalogOnce}
              onMouseDown={openCourseCatalogOnce}
              onChange={onCourseSelectChange}
              className="box-border min-h-11 min-w-0 flex-1 touch-manipulation rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-base text-[var(--text-primary)] sm:text-sm"
            >
              <option value="" disabled>
                {!catalogRequested
                  ? 'Select a course…'
                  : listLoading
                    ? 'Loading courses…'
                    : 'Select a course…'}
              </option>
              {catalogRequested && !listLoading && (
                <>
                  <option value="__new__">New Course</option>
                  {catalogCourseMenuRows.map((row) => (
                    <option key={row.value} value={row.value} title={row.title}>
                      {row.label}
                    </option>
                  ))}
                </>
              )}
            </select>
            {selector !== '__new__' && (
              <button
                type="button"
                disabled={listLoading || !selector || !selectionIsExistingCatalogCourse}
                onClick={requestDuplicateOrConfirm}
                title="Clone the selected course into a new draft with a new document ID"
                aria-label="Duplicate as new draft"
                className="inline-flex shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] px-2.5 min-h-[42px] min-w-[42px] hover:bg-[var(--hover-bg)] disabled:pointer-events-none disabled:opacity-40"
              >
                <Copy size={18} aria-hidden />
              </button>
            )}
            </div>
          </div>
          <div className="contents min-w-0">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex min-h-6 min-w-0 items-center">
                <span className="text-xs font-semibold leading-none text-[var(--text-secondary)]">
                  Document ID
                </span>
              </div>
              <div
                className="box-border flex min-h-[42px] w-full min-w-0 items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-2 text-sm font-mono text-[var(--text-primary)] md:px-3"
                aria-live="polite"
              >
                {draft ? (
                  <span className="truncate text-orange-500/90">{draft.id}</span>
                ) : (
                  <span className="text-[var(--text-muted)]">—</span>
                )}
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex min-h-6 min-w-0 items-center">
                <label
                  htmlFor="admin-catalog-course-level"
                  className="text-xs font-semibold leading-none text-[var(--text-secondary)]"
                >
                  Level
                </label>
              </div>
              <select
                id="admin-catalog-course-level"
                value={draft?.level ?? ''}
                disabled={!draft}
                onChange={(e) =>
                  draft && updateDraft({ level: e.target.value as Course['level'] })
                }
                className="box-border w-full min-w-0 min-h-[42px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-2 text-sm text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 md:px-3"
              >
                {!draft && (
                  <option value="" disabled>
                    —
                  </option>
                )}
                <option value="Beginner">Beginner</option>
                <option value="Intermediate">Intermediate</option>
                <option value="Advanced">Advanced</option>
                <option value="Proficient">Proficient</option>
              </select>
            </div>
          </div>

        <div className="flex min-w-0 w-full flex-col gap-1 md:w-auto md:max-w-full">
          <div className="flex min-h-6 min-w-0 items-center">
            <span className="text-xs font-semibold leading-none text-[var(--text-secondary)] max-md:sr-only">
              Actions
            </span>
          </div>
          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
            <button
              type="button"
              disabled={busy || !draft || (baselineJson !== null && !isDirty)}
              onClick={() => void handleSave()}
              aria-busy={busy}
              aria-label={busy ? 'Saving…' : 'Save course to catalog'}
              className="inline-flex min-h-11 shrink-0 touch-manipulation items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-40 sm:px-5"
            >
              {busy ? (
                <Loader2 size={18} className="shrink-0 animate-spin" aria-hidden />
              ) : (
                <Save size={18} className="shrink-0" aria-hidden />
              )}
              Save
            </button>
            <button
              type="button"
              disabled={busy || !draft || !selectionIsExistingCatalogCourse}
              onClick={() => void requestDeleteCourse()}
              aria-label="Delete course from catalog"
              className="inline-flex min-h-11 shrink-0 touch-manipulation items-center justify-center gap-2 rounded-xl border border-red-500/40 px-4 py-2 text-sm font-bold text-red-400 hover:bg-red-500/10 disabled:opacity-40 sm:px-5"
            >
              <Trash2 size={18} className="shrink-0" aria-hidden />
              Delete
            </button>
          </div>
          {draft && isDirty ? (
            <p className="text-xs font-medium text-amber-800 dark:text-amber-200" role="status">
              Unsaved changes
            </p>
          ) : draft && !isDirty && selector !== '__new__' ? (
            <p className="text-xs text-[var(--text-muted)]" role="status">
              All changes saved
            </p>
          ) : null}
        </div>
        </div>
        </div>
        </div>

        {draft && (
          <div className="space-y-4">
          <div
            ref={courseDetailsDisclosureRef}
            className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/20"
          >
            <button
              type="button"
              onClick={() => setCourseDetailsOpen((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
              aria-expanded={courseDetailsOpen}
            >
              <span className="text-sm font-bold text-[var(--text-primary)]">Course details</span>
              {courseDetailsOpen ? (
                <ChevronDown size={16} className="text-[var(--text-secondary)]" />
              ) : (
                <ChevronRight size={16} className="text-[var(--text-secondary)]" />
              )}
            </button>
            {courseDetailsOpen && (
              <div className="border-t border-[var(--border-color)] p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block min-w-0 space-y-1">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Course title</span>
              <input
                id="admin-course-title"
                value={draft.title}
                onChange={(e) => updateDraft({ title: e.target.value })}
                placeholder="e.g. Full-Stack Web Foundations — short name shown in the catalog"
                className={`w-full min-w-0 bg-[var(--bg-primary)] border rounded-lg px-3 py-2 text-sm ${
                  showValidationHints && fieldErrors.courseTitle
                    ? 'border-red-500'
                    : 'border-[var(--border-color)]'
                }`}
              />
            </label>
            <label className="block min-w-0 space-y-1">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Author</span>
              <input
                id="admin-course-author"
                value={draft.author}
                onChange={(e) => updateDraft({ author: e.target.value })}
                className={`w-full min-w-0 bg-[var(--bg-primary)] border rounded-lg px-3 py-2 text-sm ${
                  showValidationHints && fieldErrors.courseAuthor
                    ? 'border-red-500'
                    : 'border-[var(--border-color)]'
                }`}
              />
            </label>
            <div
              id="admin-course-categories"
              aria-labelledby="admin-course-categories-label"
              className={`space-y-2 sm:col-span-2 ${showValidationHints && fieldErrors.courseCategories ? 'rounded-lg ring-2 ring-red-500/60 p-2 -m-2' : ''}`}
            >
              <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                <span
                  id="admin-course-categories-label"
                  className="text-xs font-semibold leading-none text-[var(--text-secondary)]"
                >
                  Categories
                </span>
                <span ref={categoriesTipsWrapRef} className="relative inline-flex shrink-0 items-center gap-1">
                  <button
                    ref={categoriesTipBtnRef}
                    type="button"
                    onClick={() => setCategoriesTipsOpen((o) => !o)}
                    aria-expanded={categoriesTipsOpen}
                    aria-controls="admin-course-categories-tips"
                    aria-label={
                      categoriesTipsOpen ? 'Close categories field tips' : 'Open categories field tips'
                    }
                    className={`inline-flex size-6 shrink-0 touch-manipulation items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 active:opacity-90 ${
                      categoriesTipsOpen ? 'border-orange-500/50 text-orange-500' : ''
                    }`}
                  >
                    <Info size={14} className="text-orange-500/90" aria-hidden />
                  </button>
                  <div
                    id="admin-course-categories-tips"
                    role="region"
                    aria-label="Categories field tips"
                    tabIndex={
                      categoriesTipsOpen && tipsNarrowViewport && categoriesTipFixedTop >= 0
                        ? -1
                        : undefined
                    }
                    onPointerDown={
                      categoriesTipsOpen && tipsNarrowViewport && categoriesTipFixedTop >= 0
                        ? (e) => (e.currentTarget as HTMLElement).focus({ preventScroll: true })
                        : undefined
                    }
                    className={
                      !categoriesTipsOpen
                        ? 'hidden'
                        : tipsNarrowViewport
                          ? categoriesTipFixedTop >= 0
                            ? 'fixed z-[120] left-3 right-3 w-auto max-w-none translate-x-0 overflow-y-auto overflow-x-hidden overscroll-y-contain [-webkit-overflow-scrolling:touch] touch-pan-y max-h-[calc(100dvh-var(--admin-tip-top)-env(safe-area-inset-bottom,0px)-0.75rem)] rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3.5 text-left text-sm leading-relaxed text-[var(--text-primary)] shadow-xl pointer-events-auto outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40'
                            : 'hidden'
                          : 'absolute left-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] max-w-sm rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-left text-xs leading-snug text-[var(--text-primary)] shadow-lg pointer-events-auto'
                    }
                    style={
                      categoriesTipsOpen && tipsNarrowViewport && categoriesTipFixedTop >= 0
                        ? narrowAdminTipPanelStyle(categoriesTipFixedTop)
                        : undefined
                    }
                  >
                    <ul className="list-disc space-y-1.5 pl-4 text-[var(--text-muted)] marker:text-orange-500/70 sm:space-y-1">
                      <li>At least one category required.</li>
                      {isCreatorCatalog ? (
                        <>
                          <li>
                            Removing a category chip also drops it from your add-from-list suggestions when it is not
                            used on your other drafts or the live catalog.
                          </li>
                          <li>
                            “Add category from list” includes labels from the live published catalog and your drafts, not
                            only this browser’s saved list.
                          </li>
                        </>
                      ) : (
                        <li>Custom categories appear in library filters after save or when you leave these fields.</li>
                      )}
                    </ul>
                  </div>
                </span>
              </div>
              <div className="flex min-h-10 flex-wrap gap-2">
                {draft.categories.length === 0 ? (
                  <span className="text-xs text-[var(--text-muted)]">Add at least one category.</span>
                ) : (
                  draft.categories.map((cat) => (
                    <span
                      key={cat}
                      className="inline-flex max-w-full items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-2 py-1 text-xs font-medium text-[var(--text-primary)]"
                    >
                      <span className="truncate">{cat}</span>
                      <button
                        type="button"
                        onClick={() => removeDraftCategory(cat)}
                        className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)] min-h-8 min-w-8 inline-flex items-center justify-center"
                        aria-label={`Remove category ${cat}`}
                      >
                        <X size={14} aria-hidden />
                      </button>
                    </span>
                  ))
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <select
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) addDraftCategory(v);
                    e.target.value = '';
                  }}
                  onBlur={registerDraftTaxonomyExtras}
                  className="w-full min-h-11 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm sm:max-w-xs"
                  aria-label="Add category from list"
                >
                  <option value="">Add category from list…</option>
                  {categoriesNotOnDraft.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    placeholder="Custom category…"
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      const el = e.currentTarget;
                      addDraftCategory(el.value);
                      el.value = '';
                    }}
                    onBlur={registerDraftTaxonomyExtras}
                    className="w-full min-h-11 min-w-0 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      const prev = e.currentTarget.previousElementSibling;
                      if (prev instanceof HTMLInputElement) {
                        addDraftCategory(prev.value);
                        prev.value = '';
                      }
                    }}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] px-3 text-xs font-bold text-orange-500 hover:bg-[var(--hover-bg)]"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Skills</span>
              <div className="flex min-h-10 flex-wrap gap-2">
                {draft.skills.length === 0 ? (
                  <span className="text-xs text-[var(--text-muted)]">Optional — add skill tags for learners and filters.</span>
                ) : (
                  draft.skills.map((sk) => (
                    <span
                      key={sk}
                      className="inline-flex max-w-full items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-2 py-1 text-xs font-medium text-[var(--text-primary)]"
                    >
                      <span className="truncate">{sk}</span>
                      <button
                        type="button"
                        onClick={() => removeDraftSkill(sk)}
                        className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)] min-h-8 min-w-8 inline-flex items-center justify-center"
                        aria-label={`Remove skill ${sk}`}
                      >
                        <X size={14} aria-hidden />
                      </button>
                    </span>
                  ))
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <select
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) addDraftSkill(v);
                    e.target.value = '';
                  }}
                  onBlur={registerDraftTaxonomyExtras}
                  className="w-full min-h-11 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm sm:max-w-xs"
                  aria-label="Add skill from list"
                >
                  <option value="">Add skill from list…</option>
                  {skillsNotOnDraft.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    placeholder="Custom skill…"
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      const el = e.currentTarget;
                      addDraftSkill(el.value);
                      el.value = '';
                    }}
                    onBlur={registerDraftTaxonomyExtras}
                    className="w-full min-h-11 min-w-0 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      const prev = e.currentTarget.previousElementSibling;
                      if (prev instanceof HTMLInputElement) {
                        addDraftSkill(prev.value);
                        prev.value = '';
                      }
                    }}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] px-3 text-xs font-bold text-orange-500 hover:bg-[var(--hover-bg)]"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
            <div className="sm:col-span-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-x-3">
              <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
                <label className="inline-flex w-max max-w-full flex-col gap-1">
                  <span className="whitespace-nowrap text-xs font-semibold text-[var(--text-secondary)]">
                    Duration label
                  </span>
                  <input
                    value={draft.duration}
                    onChange={(e) => updateDraft({ duration: e.target.value })}
                    className="box-border w-full min-w-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
                  />
                </label>
                <label className="inline-flex w-max max-w-full flex-col gap-1">
                  <span className="whitespace-nowrap text-xs font-semibold text-[var(--text-secondary)]">
                    Rating (0–5)
                  </span>
                  <input
                    id="admin-course-rating"
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    value={draft.rating}
                    onChange={(e) => updateDraft({ rating: Number(e.target.value) })}
                    className={`box-border w-full min-w-0 rounded-lg border bg-[var(--bg-primary)] px-3 py-2 text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
                      showValidationHints && fieldErrors.courseRating
                        ? 'border-red-500'
                        : 'border-[var(--border-color)]'
                    }`}
                  />
                </label>
              </div>
              <label className="block min-w-0 flex-1 space-y-1">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">Thumbnail URL</span>
                <input
                  id="admin-course-thumbnail"
                  value={draft.thumbnail}
                  onChange={(e) => updateDraft({ thumbnail: e.target.value })}
                  className={`w-full min-w-0 bg-[var(--bg-primary)] border rounded-lg px-3 py-2 text-sm font-mono ${
                    showValidationHints && fieldErrors.courseThumbnail
                      ? 'border-red-500'
                      : 'border-[var(--border-color)]'
                  }`}
                />
              </label>
            </div>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Description</span>
              <textarea
                value={draft.description}
                onChange={(e) => updateDraft({ description: e.target.value })}
                rows={3}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm resize-y"
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Author bio (optional)</span>
              <textarea
                value={draft.authorBio ?? ''}
                onChange={(e) => updateDraft({ authorBio: e.target.value || undefined })}
                rows={2}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm resize-y"
              />
            </label>
          </div>
              </div>
            )}
          </div>

          <div className="space-y-2.5 sm:space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                <h3 className="text-xs font-semibold text-[var(--text-secondary)]">Modules and lessons</h3>
                <span ref={modulesTipsWrapRef} className="relative inline-flex shrink-0 items-center gap-1">
                  <button
                    ref={modulesTipBtnRef}
                    type="button"
                    onClick={() => setModulesTipsOpen((o) => !o)}
                    aria-expanded={modulesTipsOpen}
                    aria-controls="admin-modules-lessons-tips"
                    aria-label={modulesTipsOpen ? 'Close modules and lessons tips' : 'Open modules and lessons tips'}
                    className={`inline-flex size-6 shrink-0 touch-manipulation items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 active:opacity-90 ${
                      modulesTipsOpen ? 'border-orange-500/50 text-orange-500' : ''
                    }`}
                  >
                    <Info size={14} className="text-orange-500/90" aria-hidden />
                  </button>
                  <div
                    id="admin-modules-lessons-tips"
                    role="region"
                    aria-label="Modules and lessons tips"
                    tabIndex={modulesTipsOpen && tipsNarrowViewport && modulesTipFixedTop >= 0 ? -1 : undefined}
                    onPointerDown={
                      modulesTipsOpen && tipsNarrowViewport && modulesTipFixedTop >= 0
                        ? (e) => (e.currentTarget as HTMLElement).focus({ preventScroll: true })
                        : undefined
                    }
                    className={
                      !modulesTipsOpen
                        ? 'hidden'
                        : tipsNarrowViewport
                          ? modulesTipFixedTop >= 0
                            ? 'fixed z-[120] left-3 right-3 w-auto max-w-none translate-x-0 overflow-y-auto overflow-x-hidden overscroll-y-contain [-webkit-overflow-scrolling:touch] touch-pan-y max-h-[calc(100dvh-var(--admin-tip-top)-env(safe-area-inset-bottom,0px)-0.75rem)] rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3.5 text-left text-sm leading-relaxed text-[var(--text-primary)] shadow-xl pointer-events-auto outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40'
                            : 'hidden'
                          : 'absolute left-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] max-w-sm rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-left text-xs leading-snug text-[var(--text-primary)] shadow-lg pointer-events-auto'
                    }
                    style={
                      modulesTipsOpen && tipsNarrowViewport && modulesTipFixedTop >= 0
                        ? narrowAdminTipPanelStyle(modulesTipFixedTop)
                        : undefined
                    }
                  >
                    <ul className="list-disc space-y-1.5 pl-4 text-[var(--text-muted)] marker:text-orange-500/70 sm:space-y-1">
                      <li>Modules group lessons.</li>
                      <li>Reorder: row ↑/↓, or Arrow keys when a reorder control is focused.</li>
                      <li>
                        <strong className="font-semibold text-[var(--text-secondary)]">Move to module…</strong>: if it’s
                        the only lesson in that module, add another lesson there first.
                      </li>
                      <li>
                        Structured ids (<code className="text-orange-500/90">C1</code>…): ids renumber when you reorder.
                      </li>
                    </ul>
                  </div>
                </span>
              </div>
              <button
                type="button"
                onClick={addModule}
                className="inline-flex min-h-11 touch-manipulation items-center gap-1.5 rounded-lg px-2.5 text-sm font-bold text-orange-500 hover:bg-orange-500/10 hover:text-orange-400 active:opacity-90 sm:text-xs"
              >
                <Plus size={16} className="shrink-0" aria-hidden /> Add module
              </button>
            </div>

            {draft.modules.map((mod, mi) => (
              <div
                key={`module-slot-${mi}`}
                data-admin-module-index={mi}
                className="space-y-2.5 border-b border-[var(--border-color)]/40 pb-4 last:border-b-0 last:pb-0 sm:space-y-4 sm:pb-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border-color)]/40 pb-2 sm:pb-3">
                  <button
                    type="button"
                    onClick={() => toggleModuleOpen(mi)}
                    className="flex min-h-11 min-w-0 flex-1 items-start gap-1.5 rounded-lg py-0.5 text-left hover:bg-[var(--hover-bg)]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 sm:gap-2 sm:py-1"
                    aria-expanded={!!openModules[mi]}
                    aria-label={`Module ${mi + 1}: ${mod.id.trim() || 'no id'} - ${mod.title.trim() || 'Untitled module'}. ${openModules[mi] ? 'Collapse' : 'Expand'} module`}
                  >
                    <span className="mt-0.5 shrink-0" aria-hidden>
                      {openModules[mi] ? (
                        <ChevronDown size={14} className="text-[var(--text-secondary)]" />
                      ) : (
                        <ChevronRight size={14} className="text-[var(--text-secondary)]" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block min-w-0 truncate text-sm font-bold text-[var(--text-primary)]">
                        <span className="font-mono text-orange-500/90">{mod.id.trim() || '—'}</span>
                        <span> - {mod.title.trim() || 'Untitled module'}</span>
                      </span>
                      <span className="mt-0.5 block text-[11px] font-medium text-[var(--text-muted)] sm:text-xs sm:font-normal">
                        Module {mi + 1}
                      </span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      data-module-reorder="up"
                      onClick={(e) => moveModule(mi, -1, e.currentTarget)}
                      onKeyDown={(e) => {
                        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                        if (e.altKey || e.ctrlKey || e.metaKey) return;
                        const n = draftRef.current?.modules.length ?? 0;
                        e.preventDefault();
                        if (e.key === 'ArrowUp' && mi > 0) {
                          moveModule(mi, -1, e.currentTarget);
                        }
                        if (e.key === 'ArrowDown' && mi < n - 1) {
                          moveModule(mi, 1, e.currentTarget);
                        }
                      }}
                      disabled={mi === 0}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-30"
                      aria-label="Move module up"
                    >
                      <ArrowUp size={18} aria-hidden />
                    </button>
                    <button
                      type="button"
                      data-module-reorder="down"
                      onClick={(e) => moveModule(mi, 1, e.currentTarget)}
                      onKeyDown={(e) => {
                        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                        if (e.altKey || e.ctrlKey || e.metaKey) return;
                        const n = draftRef.current?.modules.length ?? 0;
                        e.preventDefault();
                        if (e.key === 'ArrowUp' && mi > 0) {
                          moveModule(mi, -1, e.currentTarget);
                        }
                        if (e.key === 'ArrowDown' && mi < n - 1) {
                          moveModule(mi, 1, e.currentTarget);
                        }
                      }}
                      disabled={mi >= draft.modules.length - 1}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-30"
                      aria-label="Move module down"
                    >
                      <ArrowDown size={18} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeModule(mi)}
                      disabled={draft.modules.length <= 1}
                      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg p-2 text-red-400 hover:bg-red-500/10 disabled:opacity-30"
                      aria-label="Remove module"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {openModules[mi] && (
                <>
                <div className="mt-1 space-y-2.5 border-l border-[var(--border-color)]/50 pl-3 sm:mt-2 sm:space-y-4 sm:pl-4">
                <div className="flex flex-row flex-wrap items-end gap-x-2 gap-y-2 sm:gap-x-3">
                  <label className="flex min-w-0 flex-[1_1_11rem] max-w-full flex-col gap-1 sm:max-w-[16rem]">
                    <span className="whitespace-nowrap text-xs font-semibold text-[var(--text-secondary)]">
                      Module ID
                    </span>
                    <input
                      id={`admin-module-id-${mi}`}
                      value={mod.id}
                      onChange={(e) => updateModule(mi, { id: e.target.value })}
                      className={`box-border w-full min-w-0 rounded-lg border bg-[var(--bg-primary)] px-2.5 py-1.5 font-mono text-sm sm:px-3 sm:py-2 ${
                        showValidationHints && fieldErrors.moduleId.has(mi)
                          ? 'border-red-500'
                          : 'border-[var(--border-color)]'
                      }`}
                    />
                    <span
                      className={`min-h-[16px] text-[11px] ${
                        showValidationHints && fieldErrors.moduleId.has(mi)
                          ? 'text-red-400'
                          : 'text-transparent'
                      }`}
                    >
                      Module ID is required.
                    </span>
                  </label>
                  <label className="flex min-w-0 flex-[3_1_12rem] flex-col gap-1">
                    <span className="text-xs font-semibold text-[var(--text-secondary)]">Module title</span>
                    <input
                      id={`admin-module-title-${mi}`}
                      value={mod.title}
                      onChange={(e) => updateModule(mi, { title: e.target.value })}
                      className={`w-full text-sm bg-[var(--bg-primary)] border rounded-lg px-2.5 py-1.5 sm:px-3 sm:py-2 ${
                        showValidationHints && fieldErrors.moduleTitle.has(mi)
                          ? 'border-red-500'
                          : 'border-[var(--border-color)]'
                      }`}
                      placeholder="e.g. HTML & CSS fundamentals — section title in the syllabus"
                    />
                    <span
                      className={`min-h-[16px] text-[11px] ${
                        showValidationHints && fieldErrors.moduleTitle.has(mi)
                          ? 'text-red-400'
                          : 'text-transparent'
                      }`}
                    >
                      {!mod.title.trim()
                        ? 'Module title is required.'
                        : showValidationHints && fieldErrors.moduleTitle.has(mi)
                          ? 'Module title must be unique in this course.'
                          : ''}
                    </span>
                  </label>
                </div>

                <div className="space-y-2 border-l border-[var(--border-color)]/40 pl-2 sm:space-y-3 sm:pl-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] sm:text-xs">
                    Lessons in this module
                  </p>
                  <div className="divide-y divide-[var(--border-color)]/40">
                  {mod.lessons.map((lesson, li) => {
                    const lessonRowKey = lessonRowDomKey(lesson, mi, li);
                    return (
                    <div
                      key={lessonRowKey}
                      data-admin-lesson-row={lessonRowKey}
                      data-lesson-mi={mi}
                      data-lesson-li={li}
                      className="space-y-2 py-3 first:pt-0 sm:space-y-3 sm:py-4 sm:first:pt-1"
                    >
                      <div className="flex w-full min-w-0 items-center gap-1.5 sm:gap-2">
                        <button
                          type="button"
                          onClick={() => toggleLessonOpen(mi, li)}
                          className="flex min-h-11 min-w-0 flex-1 items-start gap-1.5 rounded-lg py-0.5 text-left -mx-0.5 px-0.5 hover:bg-[var(--bg-primary)]/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 sm:gap-2 sm:py-1 sm:-mx-1 sm:px-1"
                          aria-expanded={!!openLessons[`${mi}:${li}`]}
                          aria-label={`Lesson ${li + 1}: ${lesson.id.trim() || 'no id'} - ${lesson.title.trim() || 'Untitled lesson'}. ${openLessons[`${mi}:${li}`] ? 'Collapse' : 'Expand'} lesson`}
                        >
                          <span className="mt-0.5 shrink-0" aria-hidden>
                            {openLessons[`${mi}:${li}`] ? (
                              <ChevronDown size={14} className="text-[var(--text-secondary)]" />
                            ) : (
                              <ChevronRight size={14} className="text-[var(--text-secondary)]" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block min-w-0 truncate text-sm font-bold text-[var(--text-primary)]">
                              <span className="font-mono text-orange-500/90">{lesson.id.trim() || '—'}</span>
                              <span> - {lesson.title.trim() || 'Untitled lesson'}</span>
                            </span>
                            <span className="mt-0.5 block text-[11px] font-medium text-[var(--text-muted)] sm:text-xs sm:font-normal">
                              Lesson {li + 1}
                            </span>
                          </span>
                        </button>
                        <div className="flex shrink-0 flex-col gap-0.5 sm:flex-row sm:gap-1">
                          <button
                            type="button"
                            data-lesson-reorder="up"
                            onClick={(e) => {
                              const row = e.currentTarget.closest<HTMLElement>('[data-admin-lesson-row]');
                              if (!row) return;
                              const key = row.getAttribute('data-admin-lesson-row');
                              const mIdx = Number(row.dataset.lessonMi);
                              if (!key || !Number.isInteger(mIdx)) return;
                              moveLesson(mIdx, key, -1, e.currentTarget);
                            }}
                            onKeyDown={(e) => {
                              if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                              if (e.altKey || e.ctrlKey || e.metaKey) return;
                              const row = e.currentTarget.closest<HTMLElement>('[data-admin-lesson-row]');
                              if (!row) return;
                              const key = row.getAttribute('data-admin-lesson-row');
                              const mIdx = Number(row.dataset.lessonMi);
                              if (!key || !Number.isInteger(mIdx)) return;
                              const modNow = draftRef.current?.modules[mIdx];
                              if (!modNow) return;
                              const curLi = findLessonIndexByDomKey(modNow, mIdx, key);
                              if (curLi < 0) return;
                              e.preventDefault();
                              if (e.key === 'ArrowUp' && curLi > 0) {
                                moveLesson(mIdx, key, -1, e.currentTarget);
                              }
                              if (e.key === 'ArrowDown' && curLi < modNow.lessons.length - 1) {
                                moveLesson(mIdx, key, 1, e.currentTarget);
                              }
                            }}
                            disabled={li === 0}
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]/40 disabled:opacity-30"
                            aria-label="Move lesson up"
                          >
                            <ArrowUp size={18} aria-hidden />
                          </button>
                          <button
                            type="button"
                            data-lesson-reorder="down"
                            onClick={(e) => {
                              const row = e.currentTarget.closest<HTMLElement>('[data-admin-lesson-row]');
                              if (!row) return;
                              const key = row.getAttribute('data-admin-lesson-row');
                              const mIdx = Number(row.dataset.lessonMi);
                              if (!key || !Number.isInteger(mIdx)) return;
                              moveLesson(mIdx, key, 1, e.currentTarget);
                            }}
                            onKeyDown={(e) => {
                              if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                              if (e.altKey || e.ctrlKey || e.metaKey) return;
                              const row = e.currentTarget.closest<HTMLElement>('[data-admin-lesson-row]');
                              if (!row) return;
                              const key = row.getAttribute('data-admin-lesson-row');
                              const mIdx = Number(row.dataset.lessonMi);
                              if (!key || !Number.isInteger(mIdx)) return;
                              const modNow = draftRef.current?.modules[mIdx];
                              if (!modNow) return;
                              const curLi = findLessonIndexByDomKey(modNow, mIdx, key);
                              if (curLi < 0) return;
                              e.preventDefault();
                              if (e.key === 'ArrowUp' && curLi > 0) {
                                moveLesson(mIdx, key, -1, e.currentTarget);
                              }
                              if (e.key === 'ArrowDown' && curLi < modNow.lessons.length - 1) {
                                moveLesson(mIdx, key, 1, e.currentTarget);
                              }
                            }}
                            disabled={li >= mod.lessons.length - 1}
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]/40 disabled:opacity-30"
                            aria-label="Move lesson down"
                          >
                            <ArrowDown size={18} aria-hidden />
                          </button>
                        </div>
                      </div>
                      {draft.modules.length > 1 && (
                        <div className="space-y-1 pt-0.5 sm:pt-1">
                          <label className="block min-w-0">
                            <span className="sr-only">Move lesson to another module</span>
                            <select
                              value=""
                              disabled={mod.lessons.length <= 1}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (!v) return;
                                const t = Number(v);
                                if (Number.isInteger(t)) moveLessonToModule(mi, li, t);
                                e.target.value = '';
                              }}
                              className="box-border min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40 sm:px-3 sm:py-2"
                              aria-label="Move lesson to another module"
                            >
                              <option value="">Move to module…</option>
                              {draft.modules.map((tm, mj) =>
                                mj === mi ? null : (
                                  <option key={mj} value={String(mj)}>
                                    Module {mj + 1}: {tm.id.trim() || '—'} - {tm.title.trim() || 'Untitled module'}
                                  </option>
                                )
                              )}
                            </select>
                          </label>
                          {mod.lessons.length <= 1 ? (
                            <p className="text-[11px] leading-snug text-[var(--text-muted)]">
                              Add another lesson here first—each module must keep at least one.
                            </p>
                          ) : null}
                        </div>
                      )}
                      {openLessons[`${mi}:${li}`] && (
                        <>
                      <div className="flex flex-row flex-wrap items-end gap-x-2 gap-y-2 sm:gap-x-3">
                        <label className="flex min-w-0 flex-[1_1_11rem] max-w-full flex-col gap-1 sm:max-w-[16rem]">
                          <span className="whitespace-nowrap text-xs font-semibold text-[var(--text-secondary)]">
                            Lesson ID
                          </span>
                          <input
                            id={`admin-lesson-id-${mi}-${li}`}
                            value={lesson.id}
                            onChange={(e) => updateLesson(mi, li, { id: e.target.value })}
                            className={`box-border w-full min-w-0 rounded-lg border bg-[var(--bg-primary)] px-2.5 py-1.5 font-mono text-sm sm:px-3 sm:py-2 ${
                              showValidationHints && fieldErrors.lessonId.has(`${mi}:${li}`)
                                ? 'border-red-500'
                                : 'border-[var(--border-color)]'
                            }`}
                          />
                          <span
                            className={`min-h-[16px] text-[11px] ${
                              showValidationHints && fieldErrors.lessonId.has(`${mi}:${li}`)
                                ? 'text-red-400'
                                : 'text-transparent'
                            }`}
                          >
                            Lesson ID is required.
                          </span>
                        </label>
                        <label className="flex min-w-0 flex-[3_1_12rem] flex-col gap-1">
                          <span className="text-xs font-semibold text-[var(--text-secondary)]">Lesson title</span>
                          <input
                            id={`admin-lesson-title-${mi}-${li}`}
                            value={lesson.title}
                            onChange={(e) => updateLesson(mi, li, { title: e.target.value })}
                            className={`w-full text-sm bg-[var(--bg-primary)] border rounded-lg px-2.5 py-1.5 sm:px-3 sm:py-2 ${
                              showValidationHints && fieldErrors.lessonTitle.has(`${mi}:${li}`)
                                ? 'border-red-500'
                                : 'border-[var(--border-color)]'
                            }`}
                            placeholder="e.g. Semantic HTML & page structure — lesson name under the module"
                          />
                          <span
                            className={`min-h-[16px] text-[11px] ${
                              showValidationHints && fieldErrors.lessonTitle.has(`${mi}:${li}`)
                                ? 'text-red-400'
                                : 'text-transparent'
                            }`}
                          >
                            {!lesson.title.trim()
                              ? 'Lesson title is required.'
                              : showValidationHints && fieldErrors.lessonTitle.has(`${mi}:${li}`)
                                ? 'Lesson title must be unique in this course.'
                                : ''}
                          </span>
                        </label>
                      </div>
                      <div className="space-y-1.5 border-t border-[var(--border-color)]/60 pt-2 sm:space-y-2 sm:pt-3">
                        <span className="text-xs font-semibold text-[var(--text-secondary)]">Lesson content</span>
                        <div
                          className="flex flex-wrap gap-x-3 gap-y-2 sm:gap-4"
                          role="radiogroup"
                          aria-label="Lesson content type"
                        >
                          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-primary)] sm:gap-2 sm:text-sm">
                            <input
                              type="radio"
                              name={`admin-lesson-kind-${mi}-${li}`}
                              checked={lesson.contentKind !== 'web' && lesson.contentKind !== 'quiz'}
                              onChange={() =>
                                updateLesson(mi, li, {
                                  contentKind: undefined,
                                  webUrl: undefined,
                                  quiz: undefined,
                                  videoUrl: lesson.videoUrl?.trim()
                                    ? lesson.videoUrl
                                    : 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
                                })
                              }
                              className="h-4 w-4 shrink-0 border-[var(--border-color)] text-orange-500"
                            />
                            Video
                          </label>
                          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-primary)] sm:gap-2 sm:text-sm">
                            <input
                              type="radio"
                              name={`admin-lesson-kind-${mi}-${li}`}
                              checked={lesson.contentKind === 'web'}
                              onChange={() =>
                                updateLesson(mi, li, {
                                  contentKind: 'web',
                                  webUrl: lesson.webUrl ?? '',
                                  videoUrl: '',
                                  quiz: undefined,
                                })
                              }
                              className="h-4 w-4 shrink-0 border-[var(--border-color)] text-orange-500"
                            />
                            External page
                          </label>
                          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-primary)] sm:gap-2 sm:text-sm">
                            <input
                              type="radio"
                              name={`admin-lesson-kind-${mi}-${li}`}
                              checked={lesson.contentKind === 'quiz'}
                              onChange={() =>
                                updateLesson(mi, li, {
                                  contentKind: 'quiz',
                                  webUrl: undefined,
                                  videoUrl: '',
                                  quiz: {
                                    questions:
                                      lesson.quiz?.questions?.length && lesson.contentKind === 'quiz'
                                        ? lesson.quiz.questions
                                        : [createDefaultMcqQuestion()],
                                  },
                                })
                              }
                              className="h-4 w-4 shrink-0 border-[var(--border-color)] text-orange-500"
                            />
                            Quiz
                          </label>
                        </div>
                        <p className="text-[11px] leading-snug text-[var(--text-muted)]">
                          Video uses the embedded player. External page opens in a new tab. Quiz: multiple-choice and
                          open-ended questions with AI grading in the player.
                        </p>
                      </div>
                      {lesson.contentKind === 'web' ? (
                        <label className="block space-y-1">
                          <span className="text-xs font-semibold text-[var(--text-secondary)]">Page URL</span>
                          <input
                            id={`admin-lesson-web-url-${mi}-${li}`}
                            type="url"
                            inputMode="url"
                            value={lesson.webUrl ?? ''}
                            onChange={(e) => updateLesson(mi, li, { webUrl: e.target.value })}
                            className={`w-full text-sm font-mono bg-[var(--bg-primary)] border rounded-lg px-2.5 py-1.5 sm:px-3 sm:py-2 ${
                              showValidationHints && fieldErrors.lessonWebUrl.has(`${mi}:${li}`)
                                ? 'border-red-500'
                                : 'border-[var(--border-color)]'
                            }`}
                            placeholder="https://example.com/article or example.com/path"
                          />
                          <span
                            className={`min-h-[16px] text-[11px] ${
                              showValidationHints && fieldErrors.lessonWebUrl.has(`${mi}:${li}`)
                                ? 'text-red-400'
                                : 'text-transparent'
                            }`}
                          >
                            Enter a valid https URL or domain.
                          </span>
                        </label>
                      ) : lesson.contentKind === 'quiz' ? (
                        <div
                          id={`admin-quiz-block-${mi}-${li}`}
                          className={`space-y-2 rounded-lg border p-2 sm:space-y-4 sm:p-3 ${
                            showValidationHints && fieldErrors.lessonQuiz.has(`${mi}:${li}`)
                              ? 'border-red-500'
                              : 'border-[var(--border-color)]'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-[var(--text-secondary)]">Quiz questions</span>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => addQuizQuestion(mi, li, 'mcq')}
                                disabled={(lesson.quiz?.questions.length ?? 0) >= MAX_QUIZ_QUESTIONS}
                                className="text-xs font-bold text-orange-500 hover:text-orange-400 disabled:opacity-40"
                              >
                                + Multiple choice
                              </button>
                              <button
                                type="button"
                                onClick={() => addQuizQuestion(mi, li, 'freeform')}
                                disabled={(lesson.quiz?.questions.length ?? 0) >= MAX_QUIZ_QUESTIONS}
                                className="text-xs font-bold text-orange-500 hover:text-orange-400 disabled:opacity-40"
                              >
                                + Open-ended
                              </button>
                            </div>
                          </div>
                          {(lesson.quiz?.questions ?? []).map((qq, qi) => (
                            <div
                              key={qq.id}
                              className="space-y-2 rounded-lg border border-[var(--border-color)]/80 bg-[var(--bg-primary)] p-2 sm:space-y-3 sm:p-3"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs font-bold text-[var(--text-muted)]">Question {qi + 1}</span>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    aria-label="Move question up"
                                    onClick={() => moveQuizQuestion(mi, li, qi, -1)}
                                    disabled={qi === 0}
                                    className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--hover-bg)] disabled:opacity-30"
                                  >
                                    <ChevronUp className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label="Move question down"
                                    onClick={() => moveQuizQuestion(mi, li, qi, 1)}
                                    disabled={qi >= (lesson.quiz?.questions.length ?? 0) - 1}
                                    className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--hover-bg)] disabled:opacity-30"
                                  >
                                    <ChevronDown className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeQuizQuestion(mi, li, qi)}
                                    disabled={(lesson.quiz?.questions.length ?? 0) <= 1}
                                    className="ml-1 text-xs font-semibold text-red-400 hover:underline disabled:opacity-30"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                              <label className="block space-y-1">
                                <span className="text-xs font-semibold text-[var(--text-secondary)]">Question ID</span>
                                <input
                                  value={qq.id}
                                  onChange={(e) =>
                                    mapQuizQuestion(mi, li, qi, (prev) => ({ ...prev, id: e.target.value }))
                                  }
                                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 font-mono text-xs"
                                />
                              </label>
                              <div className="flex flex-wrap gap-3 text-xs">
                                <label className="inline-flex cursor-pointer items-center gap-2">
                                  <input
                                    type="radio"
                                    name={`qq-type-${mi}-${li}-${qi}`}
                                    checked={qq.type === 'mcq'}
                                    onChange={() =>
                                      mapQuizQuestion(mi, li, qi, (prev) => ({
                                        ...createDefaultMcqQuestion(),
                                        id: prev.id,
                                        prompt: prev.prompt,
                                      }))
                                    }
                                    className="h-3.5 w-3.5 text-orange-500"
                                  />
                                  Multiple choice
                                </label>
                                <label className="inline-flex cursor-pointer items-center gap-2">
                                  <input
                                    type="radio"
                                    name={`qq-type-${mi}-${li}-${qi}`}
                                    checked={qq.type === 'freeform'}
                                    onChange={() =>
                                      mapQuizQuestion(mi, li, qi, (prev) => ({
                                        ...createDefaultFreeformQuestion(),
                                        id: prev.id,
                                        prompt: prev.prompt,
                                      }))
                                    }
                                    className="h-3.5 w-3.5 text-orange-500"
                                  />
                                  Open-ended
                                </label>
                              </div>
                              <label className="block space-y-1">
                                <span className="text-xs font-semibold text-[var(--text-secondary)]">Prompt</span>
                                <textarea
                                  id={`admin-quiz-prompt-${mi}-${li}-${qi}`}
                                  value={qq.prompt}
                                  onChange={(e) =>
                                    mapQuizQuestion(mi, li, qi, (prev) => ({ ...prev, prompt: e.target.value }))
                                  }
                                  rows={2}
                                  className="w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-sm"
                                />
                              </label>
                              {qq.type === 'mcq' ? (
                                <div className="space-y-2">
                                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                                    <span className="text-xs font-semibold text-[var(--text-secondary)]">Choices</span>
                                    <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
                                      <button
                                        type="button"
                                        disabled={!!mcqAiKeyBusy[`${mi}-${li}-${qi}`]}
                                        onClick={() => void suggestMcqCorrectWithAi(mi, li, qi, qq)}
                                        className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-1.5 rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2.5 text-xs font-bold text-orange-600 transition-colors hover:bg-orange-500/15 disabled:opacity-50 sm:w-auto dark:text-orange-300"
                                      >
                                        {mcqAiKeyBusy[`${mi}-${li}-${qi}`] ? (
                                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                                        ) : (
                                          <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                        )}
                                        Check key with AI
                                      </button>
                                      <span className="min-w-0 max-w-full text-[11px] leading-snug text-[var(--text-muted)] sm:max-w-[20rem]">
                                        Fixes wrong marked answers (same model as learner grading). Empty choice rows are
                                        skipped, matching the published quiz.
                                      </span>
                                    </div>
                                  </div>
                                  {qq.choices.map((ch, ci) => (
                                    <div key={ci} className="flex flex-wrap items-center gap-2">
                                      <input
                                        type="radio"
                                        name={`qq-correct-${mi}-${li}-${qi}`}
                                        checked={qq.correctIndex === ci}
                                        onChange={() =>
                                          mapQuizQuestion(mi, li, qi, (prev) =>
                                            prev.type === 'mcq' ? { ...prev, correctIndex: ci } : prev
                                          )
                                        }
                                        className="h-4 w-4 shrink-0 text-orange-500"
                                        title="Correct answer"
                                      />
                                      <input
                                        value={ch}
                                        onChange={(e) =>
                                          mapQuizQuestion(mi, li, qi, (prev) => {
                                            if (prev.type !== 'mcq') return prev;
                                            const next = [...prev.choices];
                                            next[ci] = e.target.value;
                                            let correctIndex = prev.correctIndex;
                                            if (correctIndex >= next.length) correctIndex = next.length - 1;
                                            return { ...prev, choices: next, correctIndex };
                                          })
                                        }
                                        className="min-w-0 flex-1 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-sm"
                                        placeholder={`Choice ${ci + 1}`}
                                      />
                                      <button
                                        type="button"
                                        onClick={() =>
                                          mapQuizQuestion(mi, li, qi, (prev) => {
                                            if (prev.type !== 'mcq') return prev;
                                            if (prev.choices.length <= 2) return prev;
                                            const next = prev.choices.filter((_, i) => i !== ci);
                                            let correctIndex = prev.correctIndex;
                                            if (ci === correctIndex) correctIndex = 0;
                                            else if (ci < correctIndex) correctIndex -= 1;
                                            if (correctIndex >= next.length) correctIndex = next.length - 1;
                                            return { ...prev, choices: next, correctIndex };
                                          })
                                        }
                                        disabled={qq.choices.length <= 2}
                                        className="text-xs text-red-400 hover:underline disabled:opacity-30"
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      mapQuizQuestion(mi, li, qi, (prev) => {
                                        if (prev.type !== 'mcq') return prev;
                                        if (prev.choices.length >= MAX_QUIZ_CHOICES) return prev;
                                        return { ...prev, choices: [...prev.choices, ''] };
                                      })
                                    }
                                    disabled={qq.choices.length >= MAX_QUIZ_CHOICES}
                                    className="text-xs font-bold text-orange-500 hover:text-orange-400 disabled:opacity-40"
                                  >
                                    + Add choice
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <label className="block space-y-1">
                                    <span className="text-xs font-semibold text-[var(--text-secondary)]">
                                      Grading rubric (for AI; not shown in hint tutor)
                                    </span>
                                    <textarea
                                      value={qq.rubric ?? ''}
                                      onChange={(e) =>
                                        mapQuizQuestion(mi, li, qi, (prev) =>
                                          prev.type === 'freeform'
                                            ? { ...prev, rubric: e.target.value }
                                            : prev
                                        )
                                      }
                                      rows={3}
                                      className="w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-sm"
                                      placeholder="What a strong answer should include…"
                                    />
                                  </label>
                                  <label className="block space-y-1">
                                    <span className="text-xs font-semibold text-[var(--text-secondary)]">
                                      Hint context (optional, for hint tutor only)
                                    </span>
                                    <textarea
                                      value={qq.hintContext ?? ''}
                                      onChange={(e) =>
                                        mapQuizQuestion(mi, li, qi, (prev) =>
                                          prev.type === 'freeform'
                                            ? { ...prev, hintContext: e.target.value }
                                            : prev
                                        )
                                      }
                                      rows={2}
                                      className="w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-sm"
                                    />
                                  </label>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <label className="block space-y-1">
                          <span className="text-xs font-semibold text-[var(--text-secondary)]">Video URL</span>
                          <input
                            id={`admin-lesson-url-${mi}-${li}`}
                            value={lesson.videoUrl}
                            onChange={(e) => updateLesson(mi, li, { videoUrl: e.target.value })}
                            className={`w-full text-sm font-mono bg-[var(--bg-primary)] border rounded-lg px-2.5 py-1.5 sm:px-3 sm:py-2 ${
                              showValidationHints && fieldErrors.videoUrl.has(`${mi}:${li}`)
                                ? 'border-red-500'
                                : 'border-[var(--border-color)]'
                            }`}
                            placeholder="https://www.youtube.com/watch?v=…"
                          />
                          <span
                            className={`min-h-[16px] text-[11px] ${
                              showValidationHints && fieldErrors.videoUrl.has(`${mi}:${li}`)
                                ? 'text-red-400'
                                : 'text-transparent'
                            }`}
                          >
                            Video URL is required and must start with http.
                          </span>
                        </label>
                      )}
                      <label className="block space-y-1">
                        <span className="text-xs font-semibold text-[var(--text-secondary)]">Duration label (optional)</span>
                        <input
                          value={lesson.duration ?? ''}
                          onChange={(e) => updateLesson(mi, li, { duration: e.target.value || undefined })}
                          className="w-full text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-2.5 py-1.5 sm:px-3 sm:py-2"
                          placeholder="Shown next to the lesson title when set"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs font-semibold text-[var(--text-secondary)]">About (optional)</span>
                        <textarea
                          value={lesson.about ?? ''}
                          onChange={(e) => updateLesson(mi, li, { about: e.target.value || undefined })}
                          rows={2}
                          className="w-full text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-2.5 py-1.5 resize-y sm:px-3 sm:py-2"
                          placeholder="Short description under the player"
                        />
                      </label>
                      <div className="flex justify-end pt-1">
                        <button
                          type="button"
                          onClick={() => removeLesson(mi, li)}
                          disabled={mod.lessons.length <= 1}
                          className="text-xs font-semibold text-red-400 hover:underline disabled:opacity-30"
                        >
                          Remove lesson
                        </button>
                      </div>
                        </>
                      )}
                    </div>
                  );
                  })}
                  </div>
                  <button
                    type="button"
                    onClick={() => addLesson(mi)}
                    className="min-h-11 touch-manipulation rounded-lg px-1 pt-1 text-left text-xs font-bold text-orange-500 hover:bg-orange-500/5 hover:text-orange-400 sm:min-h-0 sm:px-0 sm:pt-0 sm:hover:bg-transparent"
                  >
                    + Add lesson
                  </button>
                </div>
                </div>
                </>
                )}
              </div>
            ))}
          </div>
          </div>
        )}
      </div>
        </>
      )}

      {contentCatalogSubTab === 'categories' && (
        <AdminCatalogCategoriesPanel
          publishedList={publishedList}
          onRefreshList={refreshList}
          onCatalogChanged={onCatalogChanged}
          showActionToast={showActionToast}
          onCategoryRenamedGlobally={onCategoryRenamedGlobally}
          presetCategoriesList={allPresetCatalogCategoriesFromState(categoryPresetsState)}
          defaultPresetCategory={defaultNewCourseCategoryFromState(categoryPresetsState)}
        />
      )}

      {contentCatalogSubTab === 'presets' && (
        <AdminCatalogCategoryPresetsPanel showActionToast={showActionToast} onCatalogChanged={onCatalogChanged} />
      )}

      {contentCatalogSubTab === 'skillPresets' && (
        <AdminCatalogSkillPresetsPanel showActionToast={showActionToast} onCatalogChanged={onCatalogChanged} />
      )}

      {contentCatalogSubTab === 'taxonomy' && (
        <AdminCatalogTaxonomyPanel
          publishedList={publishedList}
          categoryPresets={categoryPresetsState}
          skillPresets={skillPresetsState}
          onPresetsChanged={(next) => {
            setCategoryPresetsState(next.categories);
            setSkillPresetsState(next.skills);
          }}
          onSaveCourse={(c) =>
            catalogPersistence?.kind === 'creator'
              ? saveCreatorCourse(c, catalogPersistence.ownerUid)
              : savePublishedCourse(c)
          }
          onRefreshList={refreshList}
          onCatalogChanged={onCatalogChanged}
          showActionToast={showActionToast}
        />
      )}

      {/* Keep mounted while Content is open so paths load in the background on Catalog; avoids remount + Firestore delay every time Paths is selected. */}
      <div
        className={contentCatalogSubTab === 'paths' ? 'min-w-0' : 'hidden'}
        aria-hidden={contentCatalogSubTab !== 'paths'}
      >
        <PathBuilderSection
          ref={pathBuilderRef}
          key={pathBuilderResetKey}
          publishedList={publishedList}
          coursesForPathTitleConflictCheck={courseRowsForTaxonomyPickers}
          onRefreshPublishedList={refreshList}
          onCatalogChanged={onCatalogChanged}
          onPathsDirtyChange={setPathBuilderDirty}
          onPathsLoadingChange={setPathsListLoading}
          pathPersistence={catalogPersistence}
        />
      </div>

      <AnimatePresence>
        {pathSubTabSwitchConfirmOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-path-subtab-switch-title"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-lg overflow-hidden rounded-3xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
            >
              <div className="flex items-center justify-between gap-4 border-b border-[var(--border-color)] p-6">
                <h2
                  id="admin-path-subtab-switch-title"
                  className="text-xl font-bold text-[var(--text-primary)]"
                >
                  Leave without saving?
                </h2>
                <button
                  type="button"
                  onClick={closePathSubTabSwitchConfirm}
                  className="shrink-0 rounded-full p-2 transition-colors hover:bg-[var(--hover-bg)]"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4 p-6">
                <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                  Leaving Paths will discard unsaved path or course edits. Save first if you need to keep them.
                </p>
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closePathSubTabSwitchConfirm}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-5 py-3 text-sm font-bold text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] sm:w-auto"
                  >
                    Keep editing
                  </button>
                  <button
                    type="button"
                    autoFocus
                    onClick={confirmDiscardPathBuilderAndSwitch}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-orange-600 sm:w-auto"
                  >
                    Discard and switch
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {subTabSwitchConfirmOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-catalog-subtab-switch-title"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-lg overflow-hidden rounded-3xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
            >
              <div className="flex items-center justify-between gap-4 border-b border-[var(--border-color)] p-6">
                <h2
                  id="admin-catalog-subtab-switch-title"
                  className="text-xl font-bold text-[var(--text-primary)]"
                >
                  Leave without saving?
                </h2>
                <button
                  type="button"
                  onClick={closeSubTabSwitchConfirm}
                  className="shrink-0 rounded-full p-2 transition-colors hover:bg-[var(--hover-bg)]"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4 p-6">
                <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                  Switching tabs will discard unsaved changes to this course draft.
                </p>
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeSubTabSwitchConfirm}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-5 py-3 text-sm font-bold text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] sm:w-auto"
                  >
                    Keep editing
                  </button>
                  <button
                    type="button"
                    autoFocus
                    onClick={confirmDiscardCourseDraftAndSwitch}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-orange-600 sm:w-auto"
                  >
                    Discard and switch
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {courseLeaveDialog && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-catalog-course-leave-title"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-lg overflow-hidden rounded-3xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
            >
              <div className="flex items-center justify-between gap-4 border-b border-[var(--border-color)] p-6">
                <h2
                  id="admin-catalog-course-leave-title"
                  className="text-xl font-bold text-[var(--text-primary)]"
                >
                  Unsaved changes?
                </h2>
                <button
                  type="button"
                  onClick={closeCourseLeaveDialog}
                  className="shrink-0 rounded-full p-2 transition-colors hover:bg-[var(--hover-bg)]"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4 p-6">
                <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                  {courseLeaveDialog.kind === 'select'
                    ? 'You have unsaved changes. Discard them to switch to another course, or keep editing.'
                    : 'You have unsaved changes. Discard them to duplicate from the last saved version, or keep editing.'}
                </p>
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
                  <button
                    type="button"
                    onClick={closeCourseLeaveDialog}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-5 py-3 text-sm font-bold text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] sm:w-auto"
                  >
                    Keep editing
                  </button>
                  <button
                    type="button"
                    autoFocus
                    onClick={confirmCourseLeaveDiscard}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-orange-600 sm:w-auto"
                  >
                    Discard and continue
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteDialogOpen && draft && (
          <div
            className="fixed inset-0 z-[101] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-catalog-delete-title"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-lg overflow-hidden rounded-3xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
            >
              <div className="flex items-center justify-between gap-4 border-b border-[var(--border-color)] p-6">
                <h2
                  id="admin-catalog-delete-title"
                  className="text-xl font-bold text-[var(--text-primary)]"
                >
                  {deletePathRefs.length > 0 ? 'Remove course from paths and catalog?' : 'Remove this course?'}
                </h2>
                <button
                  type="button"
                  onClick={closeDeleteDialog}
                  className="shrink-0 rounded-full p-2 transition-colors hover:bg-[var(--hover-bg)]"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4 p-6">
                <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                  <span className="font-semibold text-[var(--text-primary)]">{draft.title || draft.id}</span>
                  {' '}({draft.id}){' '}
                  {catalogPersistence?.kind === 'creator' ||
                  (isAdminMergedCatalog &&
                    parseAdminCatalogCourseSelector(selector).kind === 'creator')
                    ? 'will be removed as a creator draft. This cannot be undone.'
                    : 'will be removed from the live catalog. Learners will no longer see it. This cannot be undone.'}
                </p>
                {deletePathRefs.length > 0 && (
                  <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                      It appears on {deletePathRefs.length} learning path
                      {deletePathRefs.length === 1 ? '' : 's'}. It will be removed from those paths, then deleted.
                    </p>
                    <ul className="mt-3 max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-[var(--text-secondary)]">
                      {deletePathRefs.map((h) => (
                        <li key={`${h.persistence}-${h.pathId}`}>
                          <span className="text-[var(--text-primary)]">{h.title}</span>
                          <span className="text-[var(--text-secondary)]">
                            {' '}
                            ({h.persistence === 'published' ? 'published path' : 'creator path'})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeDeleteDialog}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-5 py-3 text-sm font-bold text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] sm:w-auto"
                  >
                    Keep editing
                  </button>
                  <button
                    type="button"
                    autoFocus
                    onClick={() => void confirmDeletePublished()}
                    aria-label={`Remove ${draft.id} permanently`}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-red-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-red-500 sm:w-auto"
                  >
                    Yes, remove
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AdminDisplayNameConflictDialog
        open={courseTitleConflict !== null}
        savingLabel="course"
        conflict={courseTitleConflict}
        renameFieldId="admin-course-title"
        onPrepareRenameField={() => setCourseDetailsOpen(true)}
        onClose={() => setCourseTitleConflict(null)}
      />

      {actionToast}
    </div>
  );
};
