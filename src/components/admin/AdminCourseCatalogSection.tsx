import React, { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Copy,
  Globe,
  Hash,
  Info,
  Layers,
  Loader2,
  Plus,
  Route,
  Save,
  SlidersHorizontal,
  Tags,
  Trash2,
  Minus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Video,
  X,
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronUp,
} from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import { useInsertStripRevealCursor } from '../../hooks/useInsertStripRevealCursor';
import { useLearningAssistantSiteEnabled } from '../../hooks/useLearningAssistantSiteEnabled';
import { useAdminActionToast } from './useAdminActionToast';
import { AdminLabelInfoTip } from './adminLabelInfoTip';
import {
  narrowAdminTipPanelStyle,
  readFixedTipTopBelowAnchor,
  useTipsNarrowViewport,
} from './adminTipPanelLayout';
import {
  PathBuilderSection,
  type PathBuilderSectionHandle,
  type PathPersistenceMode,
} from './PathBuilderSection';
import { AdminCatalogCategoriesPanel } from './AdminCatalogCategoriesPanel';
import { AdminCatalogCategoryPresetsPanel } from './AdminCatalogCategoryPresetsPanel';
import { AdminCatalogSkillPresetsPanel } from './AdminCatalogSkillPresetsPanel';
import { AdminCatalogTaxonomyPanel } from './AdminCatalogTaxonomyPanel';
import {
  ADMIN_INSERT_STRIP_CHIP_BTN_EXPAND_ROW as ADMIN_CATALOG_INSERT_CHIP_BTN_EXPAND_ROW,
  ADMIN_INSERT_STRIP_CHIP_BTN_EXPAND_ROW_PAIR as ADMIN_CATALOG_INSERT_CHIP_BTN_EXPAND_ROW_PAIR,
  ADMIN_INSERT_STRIP_CHIP_BTN_PERSIST as ADMIN_CATALOG_INSERT_CHIP_BTN_PERSIST,
  ADMIN_INSERT_STRIP_CHIP_BTN_PERSIST_PAIR as ADMIN_CATALOG_INSERT_CHIP_BTN_PERSIST_PAIR,
  ADMIN_INSERT_STRIP_OUTER_EXPAND_HOVER as CATALOG_INSERT_OUTER_EXPAND_HOVER,
} from './adminInsertStripClasses';
import { CatalogMiniRichEditor } from './CatalogMiniRichEditor';
import {
  catalogMiniRichIsEffectivelyEmpty,
  catalogMiniRichPlainText,
  focusCatalogMiniRichById,
} from '../../utils/catalogMiniRichHtml';
import type { Course, Lesson, Module, QuizQuestion, QuizQuestionMcq } from '../../data/courses';
import {
  MAX_QUIZ_CHOICES,
  MAX_QUIZ_QUESTIONS,
  createDefaultFreeformQuestion,
  createDefaultMcqQuestion,
  isCourseCatalogPublished,
} from '../../data/courses';
import {
  STRUCTURED_COURSE_ID_RE,
  firstAvailableStructuredCourseIdFromDocIds,
  isStructuredCourseId,
  remapCourseToStructuredIds,
  remapStructuredCourseModuleLessonIdsByOrder,
} from '../../utils/courseStructuredIds';
import { validateCourseDraft, validateLessonQuiz } from '../../utils/courseDraftValidation';
import { isPlayableCatalogLesson, lessonWebHref } from '../../utils/lessonContent';
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
import { AdminCourseAiAssistant } from './AdminCourseAiAssistant';
import { AdminLessonContentPreview } from './AdminLessonContentPreview';
import { AdminVideoOutlineNotesField } from './AdminVideoOutlineNotesField';
import { InsertStripWaitCursorPortal } from './InsertStripWaitCursorPortal';
import {
  addCatalogCategoryExtra,
  CATALOG_CATEGORY_EXTRAS_CHANGED,
  readCatalogCategoryExtras,
} from '../../utils/catalogCategoryExtras';
import {
  addCatalogSkillExtra,
  CATALOG_SKILL_EXTRAS_CHANGED,
  readCatalogSkillExtras,
} from '../../utils/catalogSkillExtras';
import {
  CATALOG_SKILL_PRESETS_CHANGED,
  DEFAULT_CATALOG_SKILL_PRESETS,
  defaultNewCourseSkillFromState,
  getCachedCatalogSkillPresets,
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
import { buildCatalogTaxonomy } from '../../utils/catalogTaxonomy';
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

/** Structured: C1M1D1, C1M1D2 for section dividers only (separate from L{n} lesson ids). */
function nextDividerIdInModule(course: Course, moduleIndex: number): string {
  const mod = course.modules[moduleIndex];
  if (!mod) return 'D1';
  const prefix = mod.id;
  const re = new RegExp(`^${escapeRegex(prefix)}D(\\d+)$`);
  let maxN = 0;
  let found = false;
  for (const l of mod.lessons) {
    const dm = re.exec(l.id);
    if (dm) {
      found = true;
      maxN = Math.max(maxN, parseInt(dm[1], 10));
    }
  }
  if (found) return `${prefix}D${maxN + 1}`;
  const dividerCount = mod.lessons.filter((x) => x.contentKind === 'divider').length;
  return `${prefix}D${dividerCount + 1}`;
}

/** Legacy: stable unique id for dividers (never uses l{n} lesson id space). */
function nextDividerIdLegacy(): string {
  return `divider-${crypto.randomUUID()}`;
}

function emptyCourse(docId: string): Course {
  const structured = isStructuredCourseId(docId);
  const mid = structured ? `${docId}M1` : 'm1';
  const lid = structured ? `${docId}M1L1` : 'l1';
  return {
    id: docId,
    title: '',
    author: 'i-Golden Academy',
    thumbnail: 'https://picsum.photos/seed/course/800/450',
    description: '',
    level: 'Beginner',
    duration: '1h',
    rating: 4.5,
    categories: [defaultNewCourseCategoryFromState(getCachedCatalogCategoryPresets())],
    skills: [defaultNewCourseSkillFromState(getCachedCatalogSkillPresets())],
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

function applyCopyModuleAt(
  course: Course,
  sourceMi: number,
  insertAt: number
): { next: Course; newModuleIndex: number } | null {
  const src = course.modules[sourceMi];
  if (!src) return null;
  const at = Math.max(0, Math.min(insertAt, course.modules.length));
  const clone = deepClone(src) as Module;
  const lessonsWithKeys = clone.lessons.map(
    (les) =>
      ({
        ...les,
        __adminRowKey: crypto.randomUUID(),
      }) as LessonWithAdminKey
  );
  const cloneWithKeys: Module = { ...clone, lessons: lessonsWithKeys as Lesson[] };
  const modules = [...course.modules.slice(0, at), cloneWithKeys, ...course.modules.slice(at)];
  let next: Course = { ...course, modules };
  if (isStructuredCourseId(next.id)) {
    next = remapStructuredCourseModuleLessonIdsByOrder(next);
  } else {
    const newMid = nextModuleIdLegacy(next.modules);
    next = {
      ...next,
      modules: next.modules.map((m, i) => (i === at ? { ...m, id: newMid } : m)),
    };
    for (let j = 0; j < next.modules[at]!.lessons.length; j += 1) {
      const les = next.modules[at]!.lessons[j]!;
      const newLid = isPlayableCatalogLesson(les) ? nextLessonIdLegacy(next) : nextDividerIdLegacy();
      next = {
        ...next,
        modules: next.modules.map((m, i) =>
          i !== at
            ? m
            : {
                ...m,
                lessons: m.lessons.map((l, jj) => (jj === j ? { ...l, id: newLid } : l)),
              }
        ),
      };
    }
  }
  return { next, newModuleIndex: at };
}

function applyMoveModuleAt(
  course: Course,
  sourceMi: number,
  insertAtInWithout: number
): { next: Course; moduleIndex: number } | null {
  if (course.modules.length <= 1) return null;
  if (sourceMi < 0 || sourceMi >= course.modules.length) return null;
  const extracted = course.modules[sourceMi]!;
  const without = course.modules.filter((_, i) => i !== sourceMi);
  const at = Math.max(0, Math.min(insertAtInWithout, without.length));
  const modules = [...without.slice(0, at), extracted, ...without.slice(at)];
  let next: Course = { ...course, modules };
  if (isStructuredCourseId(next.id)) {
    next = remapStructuredCourseModuleLessonIdsByOrder(next);
  }
  return { next, moduleIndex: at };
}

function applyCopyLessonAt(
  course: Course,
  sourceMi: number,
  sourceLi: number,
  targetMi: number,
  insertAt: number
): { next: Course; mi: number; li: number } | null {
  const src = course.modules[sourceMi]?.lessons[sourceLi];
  if (!src) return null;
  if (targetMi < 0 || targetMi >= course.modules.length) return null;
  const at = Math.max(0, Math.min(insertAt, course.modules[targetMi]!.lessons.length));
  const clone = deepClone(src) as LessonWithAdminKey;
  clone.__adminRowKey = crypto.randomUUID();
  const modules = course.modules.map((m, i) => {
    if (i !== targetMi) return m;
    const lessons = [...m.lessons];
    lessons.splice(at, 0, clone);
    return { ...m, lessons };
  });
  let next: Course = { ...course, modules };
  if (isStructuredCourseId(next.id)) {
    next = remapStructuredCourseModuleLessonIdsByOrder(next);
  } else {
    next = {
      ...next,
      modules: next.modules.map((m, i) => {
        if (i !== targetMi) return m;
        return {
          ...m,
          lessons: m.lessons.map((les, j) => {
            if (j !== at) return les;
            return {
              ...les,
              id: isPlayableCatalogLesson(les) ? nextLessonIdLegacy(next) : nextDividerIdLegacy(),
            };
          }),
        };
      }),
    };
  }
  return { next, mi: targetMi, li: at };
}

function applyMoveLessonAt(
  course: Course,
  fromMi: number,
  fromLi: number,
  toMi: number,
  toInsertAt: number
): { next: Course; mi: number; li: number } | null {
  if (toMi < 0 || toMi >= course.modules.length) return null;
  const sourceMod = course.modules[fromMi];
  if (!sourceMod || !sourceMod.lessons[fromLi]) return null;
  if (sourceMod.lessons.length <= 1) return null;
  const sourceAfterRemove = sourceMod.lessons.filter((_, j) => j !== fromLi);
  if (!sourceAfterRemove.some(isPlayableCatalogLesson)) return null;

  const moved = deepClone(sourceMod.lessons[fromLi]!) as LessonWithAdminKey;

  const modulesWithout = course.modules.map((m, i) => {
    if (i !== fromMi) return m;
    return { ...m, lessons: m.lessons.filter((_, j) => j !== fromLi) };
  });

  let insertAt = Math.max(0, Math.min(toInsertAt, modulesWithout[toMi]!.lessons.length));
  if (fromMi === toMi && fromLi < insertAt) {
    insertAt -= 1;
  }

  let lessonToInsert: Lesson = moved;
  if (!isStructuredCourseId(course.id) && fromMi !== toMi) {
    const tempCourse: Course = { ...course, modules: modulesWithout };
    lessonToInsert = {
      ...moved,
      id: isPlayableCatalogLesson(moved)
        ? nextLessonIdLegacy(tempCourse)
        : nextDividerIdLegacy(),
    };
  }

  const finalModules = modulesWithout.map((m, i) => {
    if (i !== toMi) return m;
    const lessons = [...m.lessons];
    lessons.splice(insertAt, 0, lessonToInsert);
    return { ...m, lessons };
  });

  let next: Course = { ...course, modules: finalModules };
  if (isStructuredCourseId(next.id)) {
    next = remapStructuredCourseModuleLessonIdsByOrder(next);
  }
  return { next, mi: toMi, li: insertAt };
}

function newSeededDefaultPlayableCatalogLesson(): LessonWithAdminKey {
  return {
    id: '',
    title: '',
    videoUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    __adminRowKey: crypto.randomUUID(),
  } as LessonWithAdminKey;
}

/**
 * Remove a section divider at `li`, keep rows above it plus rows from the **next** divider onward in this module, and
 * insert a new module at `insertNewModuleAt` in the module list. The new module title comes from the divider; its
 * lessons are only rows **under** that divider until the next divider (or end of module). Seeds a default video lesson
 * when either side would otherwise lack a playable row (same rules as adding a module / validation).
 */
function applySplitDividerIntoNewModule(
  course: Course,
  mi: number,
  li: number,
  insertNewModuleAt: number
): { next: Course; newModuleIndex: number } | null {
  const mod = course.modules[mi];
  if (!mod || !mod.lessons[li] || mod.lessons[li].contentKind !== 'divider') return null;

  const moduleTitleFromDivider = catalogMiniRichPlainText(mod.lessons[li]!.title);

  const nextDividerIdx = indexOfNextDividerOrEnd(mod, li + 1);
  const beforeSrc = mod.lessons.slice(0, li);
  const sectionSrc = mod.lessons.slice(li + 1, nextDividerIdx);
  const remainderSrc = mod.lessons.slice(nextDividerIdx);

  let currentCombined = [...beforeSrc, ...remainderSrc];
  let sectionForNew = [...sectionSrc];

  if (!sectionForNew.some(isPlayableCatalogLesson)) {
    sectionForNew = [newSeededDefaultPlayableCatalogLesson(), ...sectionForNew];
  }

  const currentWasCompletelyEmpty = currentCombined.length === 0;
  if (currentWasCompletelyEmpty) {
    currentCombined = [newSeededDefaultPlayableCatalogLesson()];
  } else if (!currentCombined.some(isPlayableCatalogLesson)) {
    return null;
  }

  const currentLessons: LessonWithAdminKey[] = currentCombined.map((les) => {
    const c = deepClone(les) as LessonWithAdminKey;
    if (!c.__adminRowKey) c.__adminRowKey = crypto.randomUUID();
    return c;
  });

  const newModuleLessons: LessonWithAdminKey[] = sectionForNew.map(
    (les) =>
      ({
        ...deepClone(les),
        __adminRowKey: crypto.randomUUID(),
      }) as LessonWithAdminKey
  );

  const updatedCurrent: Module = {
    ...mod,
    lessons: currentLessons as Lesson[],
  };
  const newModule: Module = {
    id: '',
    title: moduleTitleFromDivider,
    lessons: newModuleLessons as Lesson[],
  };

  const base = [...course.modules.slice(0, mi), updatedCurrent, ...course.modules.slice(mi + 1)];
  const insertPos = Math.max(0, Math.min(insertNewModuleAt, base.length));
  const modules = [...base.slice(0, insertPos), newModule, ...base.slice(insertPos)];
  const newModuleIndex = insertPos;
  const updatedModuleIndex = insertPos <= mi ? mi + 1 : mi;

  let next: Course = { ...course, modules };

  if (isStructuredCourseId(next.id)) {
    next = remapStructuredCourseModuleLessonIdsByOrder(next);
    return { next, newModuleIndex };
  }

  const newMid = nextModuleIdLegacy(next.modules);
  next = {
    ...next,
    modules: next.modules.map((m, i) => (i === newModuleIndex ? { ...m, id: newMid } : m)),
  };

  for (let j = 0; j < next.modules[newModuleIndex]!.lessons.length; j += 1) {
    const les = next.modules[newModuleIndex]!.lessons[j]!;
    const newLid = isPlayableCatalogLesson(les) ? nextLessonIdLegacy(next) : nextDividerIdLegacy();
    next = {
      ...next,
      modules: next.modules.map((m, i) =>
        i !== newModuleIndex
          ? m
          : {
              ...m,
              lessons: m.lessons.map((l, jj) => (jj === j ? { ...l, id: newLid } : l)),
            }
      ),
    };
  }

  if (currentWasCompletelyEmpty) {
    const newLid = nextLessonIdLegacy(next);
    next = {
      ...next,
      modules: next.modules.map((m, i) =>
        i !== updatedModuleIndex
          ? m
          : {
              ...m,
              lessons: m.lessons.map((l, jj) => (jj === 0 ? { ...l, id: newLid } : l)),
            }
      ),
    };
  }

  return { next, newModuleIndex };
}

/** First index at or after `from` that is a divider, or `L` if none (end of module). */
function indexOfNextDividerOrEnd(mod: Module, from: number): number {
  const L = mod.lessons.length;
  let j = from;
  while (j < L && mod.lessons[j]!.contentKind !== 'divider') j += 1;
  return j;
}

/** Lesson rows after divider `dividerLi` until the next divider or end (not counting the next divider). */
function countRowsUnderCatalogDivider(mod: Module, dividerLi: number): number {
  const end = indexOfNextDividerOrEnd(mod, dividerLi + 1);
  return Math.max(0, end - (dividerLi + 1));
}

function clearDividerCollapseKeysForModule(
  prev: Record<string, boolean>,
  mi: number
): Record<string, boolean> {
  const next = { ...prev };
  for (const k of Object.keys(next)) {
    if (k.startsWith(`${mi}:`)) delete next[k];
  }
  return next;
}

/** Remove section divider and every row until the next divider; module must still have a playable lesson. */
function removeCatalogDividerAndNestedLessonRows(
  course: Course,
  mi: number,
  dividerLi: number
): Course | null {
  const mod = course.modules[mi];
  if (!mod || !mod.lessons[dividerLi] || mod.lessons[dividerLi]!.contentKind !== 'divider') return null;
  const end = indexOfNextDividerOrEnd(mod, dividerLi + 1);
  const nextLessons = [...mod.lessons.slice(0, dividerLi), ...mod.lessons.slice(end)];
  if (!nextLessons.some(isPlayableCatalogLesson)) return null;
  let next: Course = {
    ...course,
    modules: course.modules.map((m, i) => (i !== mi ? m : { ...m, lessons: nextLessons })),
  };
  next = ensureCourseLessonRowKeys(normalizeCourseTaxonomy(next));
  if (isStructuredCourseId(next.id)) next = remapStructuredCourseModuleLessonIdsByOrder(next);
  return next;
}

/** Nearest section divider strictly above `lessonIndex`, or null if this row is before any divider in the module. */
function nearestSectionDividerIndexAbove(mod: Module, lessonIndex: number): number | null {
  for (let i = lessonIndex - 1; i >= 0; i -= 1) {
    if (mod.lessons[i]?.contentKind === 'divider') return i;
  }
  return null;
}

/** Playable rows under a collapsed section divider are omitted from the catalog list UI. */
function lessonRowHiddenUnderCollapsedDivider(
  mod: Module,
  mi: number,
  li: number,
  sectionsCollapsed: Record<string, boolean>
): boolean {
  const row = mod.lessons[li];
  if (!row || row.contentKind === 'divider') return false;
  const d = nearestSectionDividerIndexAbove(mod, li);
  if (d === null) return false;
  return !!sectionsCollapsed[`${mi}:${d}`];
}

/** Playable row sits in a subsection (nearest divider above in this module). */
function lessonRowInSectionUnderDivider(mod: Module, li: number): boolean {
  const row = mod.lessons[li];
  if (!row || row.contentKind === 'divider') return false;
  return nearestSectionDividerIndexAbove(mod, li) !== null;
}

/** Insert position `insertAt` is inside a subsection (after a divider, before the next divider). */
function lessonInsertSlotInSectionUnderDivider(mod: Module, insertAt: number): boolean {
  return nearestSectionDividerIndexAbove(mod, insertAt) !== null;
}

/** Indents catalog rows / gaps that belong under a section divider (mobile-first). */
const CATALOG_LESSON_SECTION_UNDER_DIVIDER_INDENT =
  'ml-0.5 min-w-0 border-l border-[var(--border-color)]/45 pl-1.5 sm:ml-1 sm:pl-2';

/**
 * Insert positions when merging a module into another as a section divider + that module’s lessons.
 * “After divider: …” means after that divider **and all lessons under it** (until the next divider or module end),
 * not immediately after the divider row.
 */
function moduleDividerMergePositionOptions(mod: Module): { insertAt: number; label: string }[] {
  const L = mod.lessons.length;
  if (L === 0) {
    return [{ insertAt: 0, label: 'Only position in this module' }];
  }
  const out: { insertAt: number; label: string }[] = [];
  out.push({ insertAt: 0, label: 'Start of module (before first row)' });
  for (let li = 0; li < L; li++) {
    const les = mod.lessons[li]!;
    if (les.contentKind === 'divider') {
      const t = catalogMiniRichPlainText(les.title ?? '') || 'Untitled divider';
      const insertAt = indexOfNextDividerOrEnd(mod, li + 1);
      out.push({
        insertAt,
        label: `After section “${t}” (after its lessons, before next divider)`,
      });
    }
  }
  if (!out.some((o) => o.insertAt === L)) {
    out.push({ insertAt: L, label: 'End of module (after last row)' });
  }
  return out;
}

/**
 * Turn `sourceModuleIndex` into a **section divider** (title = that module’s title) inserted at `insertAt` inside
 * `targetModuleIndex`, then append that module’s lessons. Removes the source module. `insertAt` is 0…target.lessons.length
 * (same semantics as lesson insert index). Requires `sourceModuleIndex !== targetModuleIndex` and a playable lesson in
 * the merged module afterward.
 */
function applyConvertModuleIntoDividerAt(
  course: Course,
  sourceModuleIndex: number,
  targetModuleIndex: number,
  insertAt: number
): Course | null {
  if (sourceModuleIndex === targetModuleIndex) return null;
  const src = course.modules[sourceModuleIndex];
  const tgt = course.modules[targetModuleIndex];
  if (!src || !tgt) return null;
  if (insertAt < 0 || insertAt > tgt.lessons.length) return null;

  const structured = isStructuredCourseId(course.id);
  const lid = structured ? nextDividerIdInModule(course, targetModuleIndex) : nextDividerIdLegacy();

  const dividerLesson: LessonWithAdminKey = {
    id: lid,
    title: src.title,
    videoUrl: '',
    contentKind: 'divider' as const,
    __adminRowKey: crypto.randomUUID(),
  };

  const tgtCloned: LessonWithAdminKey[] = tgt.lessons.map((les) => {
    const c = deepClone(les) as LessonWithAdminKey;
    if (!c.__adminRowKey) c.__adminRowKey = crypto.randomUUID();
    return c;
  });
  const srcCloned: LessonWithAdminKey[] = src.lessons.map((les) => {
    const c = deepClone(les) as LessonWithAdminKey;
    if (!c.__adminRowKey) c.__adminRowKey = crypto.randomUUID();
    return c;
  });

  const mergedLessons = [
    ...tgtCloned.slice(0, insertAt),
    dividerLesson,
    ...srcCloned,
    ...tgtCloned.slice(insertAt),
  ] as Lesson[];

  const newModules = course.modules.flatMap((m, i) => {
    if (i === sourceModuleIndex) return [];
    if (i === targetModuleIndex) return [{ ...tgt, lessons: mergedLessons }];
    return [m];
  });

  let next: Course = { ...course, modules: newModules };

  if (structured) {
    next = remapStructuredCourseModuleLessonIdsByOrder(next);
  }

  const mergedModuleIndex = sourceModuleIndex < targetModuleIndex ? targetModuleIndex - 1 : targetModuleIndex;
  const mergedMod = next.modules[mergedModuleIndex];
  if (!mergedMod || !mergedMod.lessons.some(isPlayableCatalogLesson)) return null;

  return next;
}

function catalogLessonRowSummary(lesson: Lesson): string {
  const t =
    catalogMiniRichPlainText(lesson.title ?? '') ||
    (lesson.contentKind === 'divider' ? 'Untitled divider' : 'Untitled lesson');
  return lesson.contentKind === 'divider' ? `Divider — ${t}` : `Lesson — ${t}`;
}

function catalogLessonInsertOptionLabel(mod: Module, insertAt: number): string {
  const L = mod.lessons.length;
  if (L === 0) return 'Only position in this module';
  if (insertAt === 0) {
    const first = mod.lessons[0]!;
    return `Before ${catalogLessonRowSummary(first)}`;
  }
  if (insertAt >= L) {
    const last = mod.lessons[L - 1]!;
    return `After ${catalogLessonRowSummary(last)}`;
  }
  const before = mod.lessons[insertAt - 1]!;
  const after = mod.lessons[insertAt]!;
  return `After ${catalogLessonRowSummary(before)} · before ${catalogLessonRowSummary(after)}`;
}

function catalogModuleTitleLine(mod: Module, indexOneBased: number): string {
  const id = mod.id.trim() || '—';
  const title = catalogMiniRichPlainText(mod.title) || 'Untitled module';
  return `Module ${indexOneBased}: ${id} — ${title}`;
}

/** Insert index for the new module (0…n) when splitting a divider inside module `mi` (`n` = current module count). */
function splitDividerIntoNewModuleInsertOptions(course: Course, mi: number): { insertAt: number; label: string }[] {
  const n = course.modules.length;
  if (!course.modules[mi]) return [{ insertAt: 0, label: 'Start of course' }];
  const cur = course.modules[mi]!;
  const curLabel = catalogModuleTitleLine(cur, mi + 1);
  const out: { insertAt: number; label: string }[] = [];
  for (let p = 0; p <= n; p += 1) {
    if (p === 0) {
      out.push({ insertAt: 0, label: 'Start of course' });
      continue;
    }
    const prev = p - 1;
    let label: string;
    if (prev < mi) {
      const ref = course.modules[prev]!;
      label = `After ${catalogModuleTitleLine(ref, prev + 1)}`;
    } else if (prev === mi) {
      label = `After ${curLabel} (this module after split)`;
    } else {
      const ref = course.modules[prev]!;
      label = `After ${catalogModuleTitleLine(ref, prev + 1)}`;
    }
    out.push({ insertAt: p, label });
  }
  return out;
}

const ADMIN_CATALOG_KIND_BADGE_BASE =
  'inline-flex min-h-11 min-w-[3.25rem] shrink-0 touch-manipulation items-center justify-center rounded-md px-3.5 text-[10px] font-bold uppercase leading-none transition-colors focus:outline-none sm:h-7 sm:min-h-0';

/** Neutral-only admin palette (no semantic color bands). */
const ADMIN_CATALOG_KIND_BADGE_NEUTRAL = `${ADMIN_CATALOG_KIND_BADGE_BASE} hover:ring-2 hover:ring-[#a1a2a2]/40 focus:ring-2 focus:ring-[#a1a2a2]/40 bg-[#757676]/15 text-[#393a3a] app-dark:text-[#cfcfcf]`;

const ADMIN_CATALOG_BRANCH_KIND_BADGE_CLASS = ADMIN_CATALOG_KIND_BADGE_NEUTRAL;
const ADMIN_CATALOG_MODULE_BADGE_CLASS = ADMIN_CATALOG_KIND_BADGE_NEUTRAL;
const ADMIN_CATALOG_LESSON_BADGE_CLASS = ADMIN_CATALOG_KIND_BADGE_NEUTRAL;

function catalogLessonBranchKindModalLabel(lesson: Lesson): string {
  if (lesson.contentKind === 'divider') return 'Divider';
  if (lesson.contentKind === 'web') return 'External page';
  if (lesson.contentKind === 'quiz') return 'Quiz';
  return 'Video';
}

/** Lesson list: `pl-3` aligns with module border-l. */
const CATALOG_LESSON_INSERT_OUTER_HOVER =
  `group/ins relative z-0 mb-0 min-w-0 min-h-0 ${CATALOG_INSERT_OUTER_EXPAND_HOVER}`;
const CATALOG_LESSON_INSERT_OUTER_PERSIST =
  'group/ins relative z-0 mb-0 min-w-0 overflow-visible py-0';
const CATALOG_LESSON_INSERT_INNER_HOVER =
  'flex w-full pl-3 max-md:!pl-0 items-center justify-center md:min-h-0 md:py-0.5';
const CATALOG_LESSON_INSERT_INNER_PERSIST = 'flex w-full pl-3 max-md:!pl-0 justify-center';

function CatalogLessonInsertSlot({
  persistVisibleOnMd,
  ariaLabel,
  onClick,
}: {
  persistVisibleOnMd: boolean;
  ariaLabel: string;
  onClick: () => void;
}) {
  const title = 'Adds a row inside this module at this position among its items.';
  const delayHoverReveal = !persistVisibleOnMd;
  const {
    stripOuterCursorClass,
    waitCursorOverlayOpen,
    waitCursorClientX,
    waitCursorClientY,
    onPointerEnter,
    onPointerMove,
    onPointerLeave,
    onFocusCapture,
    onBlurCapture,
  } = useInsertStripRevealCursor(delayHoverReveal);
  return (
    <>
      <InsertStripWaitCursorPortal
        open={waitCursorOverlayOpen}
        clientX={waitCursorClientX}
        clientY={waitCursorClientY}
      />
      <div
        className={`${persistVisibleOnMd ? CATALOG_LESSON_INSERT_OUTER_PERSIST : CATALOG_LESSON_INSERT_OUTER_HOVER} ${stripOuterCursorClass}`.trim()}
        title={persistVisibleOnMd ? undefined : title}
        onPointerEnter={onPointerEnter}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onFocusCapture={onFocusCapture}
        onBlurCapture={onBlurCapture}
      >
      <div className={persistVisibleOnMd ? CATALOG_LESSON_INSERT_INNER_PERSIST : CATALOG_LESSON_INSERT_INNER_HOVER}>
        <button
          type="button"
          title={persistVisibleOnMd ? title : undefined}
          onClick={onClick}
          aria-label={ariaLabel}
          className={persistVisibleOnMd ? ADMIN_CATALOG_INSERT_CHIP_BTN_PERSIST : ADMIN_CATALOG_INSERT_CHIP_BTN_EXPAND_ROW}
        >
          <Plus size={14} className="shrink-0 opacity-90" aria-hidden />
          <span>Add branch here</span>
        </button>
      </div>
    </div>
    </>
  );
}

/** Course-level module list: no extra indent (unlike lesson rows under border-l). */
const CATALOG_MODULE_INSERT_OUTER_HOVER =
  `group/ins relative z-0 mb-0 min-w-0 min-h-0 ${CATALOG_INSERT_OUTER_EXPAND_HOVER}`;
const CATALOG_MODULE_INSERT_OUTER_PERSIST =
  'group/ins relative z-0 mb-0 min-w-0 overflow-visible py-0';
const CATALOG_MODULE_INSERT_INNER_HOVER =
  'flex w-full max-md:!pl-0 items-center justify-center md:min-h-0 md:py-0.5';
const CATALOG_MODULE_INSERT_INNER_PERSIST = 'flex w-full max-md:!pl-0 justify-center';

const CATALOG_LESSON_MODULE_BOUNDARY_INNER_HOVER =
  'flex w-full min-w-0 flex-col gap-2 pl-3 max-md:!pl-0 md:flex-row md:flex-wrap md:items-stretch md:justify-center md:gap-2 md:py-0.5';
const CATALOG_LESSON_MODULE_BOUNDARY_INNER_PERSIST =
  'flex w-full min-w-0 flex-col gap-2 pl-3 max-md:!pl-0 md:flex-row md:flex-wrap md:items-stretch md:justify-center md:gap-2';

/** After the last lesson in an expanded module: “Add branch” and “Add module” share one hover strip on one row (md+). */
function CatalogLessonModuleBoundaryInsertRow({
  persistVisibleOnMd,
  onAddBranch,
  onAddModule,
  branchAriaLabel,
  moduleAriaLabel,
}: {
  persistVisibleOnMd: boolean;
  onAddBranch: () => void;
  onAddModule: () => void;
  branchAriaLabel: string;
  moduleAriaLabel: string;
}) {
  const branchTitle = 'Adds a row inside this module at this position among its items.';
  const moduleTitle = 'Adds a new module at this position in the course outline.';
  const gutterTitle = persistVisibleOnMd ? undefined : `${branchTitle} ${moduleTitle}`;
  const chipClass = persistVisibleOnMd
    ? ADMIN_CATALOG_INSERT_CHIP_BTN_PERSIST_PAIR
    : ADMIN_CATALOG_INSERT_CHIP_BTN_EXPAND_ROW_PAIR;
  const delayHoverReveal = !persistVisibleOnMd;
  const {
    stripOuterCursorClass,
    waitCursorOverlayOpen,
    waitCursorClientX,
    waitCursorClientY,
    onPointerEnter,
    onPointerMove,
    onPointerLeave,
    onFocusCapture,
    onBlurCapture,
  } = useInsertStripRevealCursor(delayHoverReveal);
  return (
    <>
      <InsertStripWaitCursorPortal
        open={waitCursorOverlayOpen}
        clientX={waitCursorClientX}
        clientY={waitCursorClientY}
      />
      <div
        className={`${persistVisibleOnMd ? CATALOG_LESSON_INSERT_OUTER_PERSIST : CATALOG_LESSON_INSERT_OUTER_HOVER} ${stripOuterCursorClass}`.trim()}
        title={gutterTitle}
        onPointerEnter={onPointerEnter}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onFocusCapture={onFocusCapture}
        onBlurCapture={onBlurCapture}
      >
      <div
        className={
          persistVisibleOnMd ? CATALOG_LESSON_MODULE_BOUNDARY_INNER_PERSIST : CATALOG_LESSON_MODULE_BOUNDARY_INNER_HOVER
        }
      >
        <button
          type="button"
          title={persistVisibleOnMd ? branchTitle : undefined}
          onClick={onAddBranch}
          aria-label={branchAriaLabel}
          className={chipClass}
        >
          <Plus size={14} className="shrink-0 opacity-90" aria-hidden />
          <span className="text-center">Add branch here</span>
        </button>
        <button
          type="button"
          title={persistVisibleOnMd ? moduleTitle : undefined}
          onClick={onAddModule}
          aria-label={moduleAriaLabel}
          className={chipClass}
        >
          <Plus size={14} className="shrink-0 opacity-90" aria-hidden />
          <span className="text-center">Add module here</span>
        </button>
      </div>
    </div>
    </>
  );
}

function CatalogModuleInsertSlot({
  persistVisibleOnMd,
  ariaLabel,
  onClick,
}: {
  persistVisibleOnMd: boolean;
  ariaLabel: string;
  onClick: () => void;
}) {
  const title = 'Adds a new module at this position in the course outline.';
  const delayHoverReveal = !persistVisibleOnMd;
  const {
    stripOuterCursorClass,
    waitCursorOverlayOpen,
    waitCursorClientX,
    waitCursorClientY,
    onPointerEnter,
    onPointerMove,
    onPointerLeave,
    onFocusCapture,
    onBlurCapture,
  } = useInsertStripRevealCursor(delayHoverReveal);
  return (
    <>
      <InsertStripWaitCursorPortal
        open={waitCursorOverlayOpen}
        clientX={waitCursorClientX}
        clientY={waitCursorClientY}
      />
      <div
        className={`${persistVisibleOnMd ? CATALOG_MODULE_INSERT_OUTER_PERSIST : CATALOG_MODULE_INSERT_OUTER_HOVER} ${stripOuterCursorClass}`.trim()}
        onPointerEnter={onPointerEnter}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onFocusCapture={onFocusCapture}
        onBlurCapture={onBlurCapture}
        title={persistVisibleOnMd ? undefined : title}
      >
        <div className={persistVisibleOnMd ? CATALOG_MODULE_INSERT_INNER_PERSIST : CATALOG_MODULE_INSERT_INNER_HOVER}>
          <button
            type="button"
            title={persistVisibleOnMd ? title : undefined}
            onClick={onClick}
            aria-label={ariaLabel}
            className={persistVisibleOnMd ? ADMIN_CATALOG_INSERT_CHIP_BTN_PERSIST : ADMIN_CATALOG_INSERT_CHIP_BTN_EXPAND_ROW}
          >
            <Plus size={14} className="shrink-0 opacity-90" aria-hidden />
            <span>Add module here</span>
          </button>
        </div>
      </div>
    </>
  );
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

/** Shorten native select option text on narrow viewports (picker width is limited; full detail stays in `title`). */
function truncateForNarrowCourseMenu(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  if (maxChars <= 1) return '…';
  return `${t.slice(0, maxChars - 1)}…`;
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
  /** Description + author bio: optional; collapsed by default to save space. */
  const [courseDescriptionBioOpen, setCourseDescriptionBioOpen] = useState(false);
  const [openModules, setOpenModules] = useState<Record<number, boolean>>({});
  const [openLessons, setOpenLessons] = useState<Record<string, boolean>>({});
  /** Divider row key `mi:li` → true hides playable rows under that divider until the next divider (default: expanded). */
  const [dividerSectionsCollapsed, setDividerSectionsCollapsed] = useState<Record<string, boolean>>({});
  /** After a successful save while a lesson was expanded: offer “add another” at this insert index. */
  const [addAnotherLessonAfterSave, setAddAnotherLessonAfterSave] = useState<{
    mi: number;
    insertAt: number;
  } | null>(null);
  /** Section divider row: “Change branch type” modal (same flow as Path builder). */
  const [changeLessonKindModal, setChangeLessonKindModal] = useState<{ mi: number; li: number } | null>(null);
  /** Merge source module into a chosen module as section divider + lessons (see modal fields). */
  const [changeModuleKindModal, setChangeModuleKindModal] = useState<{
    sourceMi: number;
    targetMi: number;
    insertAt: number;
  } | null>(null);
  /** Section divider → new module: choose where the new module appears in the course. */
  const [splitDividerNewModuleModal, setSplitDividerNewModuleModal] = useState<{
    mi: number;
    li: number;
    insertAt: number;
  } | null>(null);
  /** Deleting a section divider that still has rows under it (same choice as Path builder). */
  const [catalogDividerRemovePending, setCatalogDividerRemovePending] = useState<{
    mi: number;
    li: number;
    label: string;
    nestedCount: number;
  } | null>(null);
  /** Insert lesson or section divider after choosing in “Add branch” modal. */
  const [addLessonBranchModal, setAddLessonBranchModal] = useState<{ mi: number; insertAt: number } | null>(null);
  /** Copy/move placement for modules or lesson rows (Path builder–style). */
  const [catalogPlaceModal, setCatalogPlaceModal] = useState<
    { kind: 'module'; sourceMi: number } | { kind: 'lesson'; sourceMi: number; sourceLi: number } | null
  >(null);
  const [catalogPlaceMode, setCatalogPlaceMode] = useState<'copy' | 'move'>('copy');
  const [catalogLessonTargetMi, setCatalogLessonTargetMi] = useState(0);
  const [catalogLessonInsertIdx, setCatalogLessonInsertIdx] = useState(0);
  const [catalogModuleCopyInsertIdx, setCatalogModuleCopyInsertIdx] = useState(0);
  const [catalogModuleMoveInsertIdx, setCatalogModuleMoveInsertIdx] = useState(0);
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
  /** Which lesson row is expanded (`mi:li`) — updated whenever `openLessons` changes (safe to read after async save). */
  const openLessonKeyRef = useRef<string | null>(null);
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
  /** Tracks prior `courseDetailsOpen` so we only viewport-align when the user (or UI) expands the section. */
  const prevCourseDetailsOpenRef = useRef(false);
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
  const { siteAssistantEnabled, siteAssistantLoading } = useLearningAssistantSiteEnabled();
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
    if (!courseDetailsOpen) {
      setCategoriesTipsOpen(false);
      setCourseDescriptionBioOpen(false);
    }
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
    const tax = buildCatalogTaxonomy({
      courses: courseRowsForTaxonomyPickers,
      topicPresets: categoryPresetsState,
      skillPresets: skillPresetsState,
    });
    for (const lab of tax.topics.main) {
      const t = lab?.trim();
      if (t) s.add(t);
    }
    for (const lab of tax.topics.more) {
      const t = lab?.trim();
      if (t) s.add(t);
    }
    return [...s].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [courseRowsForTaxonomyPickers, categoryOptionsVersion, categoryPresetsState, skillPresetsState]);

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
    const tax = buildCatalogTaxonomy({
      courses: courseRowsForTaxonomyPickers,
      topicPresets: categoryPresetsState,
      skillPresets: skillPresetsState,
    });
    for (const lab of tax.skills.main) {
      const t = lab?.trim();
      if (t) s.add(t);
    }
    for (const lab of tax.skills.more) {
      const t = lab?.trim();
      if (t) s.add(t);
    }
    return [...s].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [courseRowsForTaxonomyPickers, skillOptionsVersion, skillPresetsState, categoryPresetsState]);

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

  /** Pins this course’s category/skill labels into the shared picker library (Firestore when admin writes are enabled). */
  const seedCatalogExtrasFromCourse = (course: Course) => {
    if (isCreatorCatalog) return;
    for (const c of course.categories ?? []) {
      if (c.trim()) addCatalogCategoryExtra(c.trim());
    }
    for (const s of course.skills ?? []) {
      if (s.trim()) addCatalogSkillExtra(s.trim());
    }
  };

  const registerDraftTaxonomyExtras = () => {
    if (!draft) return;
    seedCatalogExtrasFromCourse(draft);
  };

  const draftTaxonomySeedKey = useMemo(() => {
    if (!draft) return '';
    const cats = draft.categories
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join('\u001f');
    const sks = draft.skills
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join('\u001f');
    return `${draft.id}\u001e${cats}\u001e${sks}`;
  }, [draft]);

  useEffect(() => {
    if (!draftTaxonomySeedKey || !draft) return;
    seedCatalogExtrasFromCourse(draft);
  }, [draft, draftTaxonomySeedKey, isCreatorCatalog]);

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
    const narrow = tipsNarrowViewport;
    const tMax = 26;

    if (!isAdminMergedCatalog) {
      return sortedCatalogCourses.map((c) => ({
        value: c.id,
        label: narrow
          ? `${c.id} · ${truncateForNarrowCourseMenu(c.title, tMax)}`
          : `${c.title} (${c.id})`,
        title: `Course id: ${c.id}`,
      }));
    }
    const pub = sortedCatalogCourses.map((c) => ({
      value: buildAdminCatalogPublishedSelector(c.id),
      label: narrow
        ? `Pub ${c.id} · ${truncateForNarrowCourseMenu(c.title, tMax)}`
        : `[Published] ${c.title} (${c.id})`,
      title: `Course id: ${c.id}`,
    }));
    const cre = [...creatorDraftRows]
      .sort((a, b) => {
        const byTitle = a.course.title.localeCompare(b.course.title, undefined, { sensitivity: 'base' });
        return byTitle !== 0 ? byTitle : a.course.id.localeCompare(b.course.id);
      })
      .map(({ course: c, ownerUid }) => {
        const profile = adminUsersByIdForMergedCatalog.get(ownerUid);
        const ownerShort = creatorDraftOwnerShortLabel(ownerUid, profile);
        return {
          value: buildAdminCatalogCreatorSelector(ownerUid, c.id),
          label: narrow
            ? `Draft ${c.id} · ${truncateForNarrowCourseMenu(c.title, 20)}`
            : `[Creator draft] ${c.title} (${c.id}) · ${ownerShort}`,
          title: creatorDraftOptionTitleAttr(c, ownerUid, profile),
        };
      });
    return [...pub, ...cre];
  }, [
    isAdminMergedCatalog,
    sortedCatalogCourses,
    creatorDraftRows,
    adminUsersByIdForMergedCatalog,
    tipsNarrowViewport,
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

  /** Live-catalog (`publishedCourses`) rows only — not creator-studio drafts or merged “creator” selector rows. */
  const showPlatformCatalogPublishToggle = useMemo(() => {
    if (isCreatorCatalog) return false;
    if (!draft) return false;
    if (isAdminMergedCatalog) {
      if (selector === '__new__') return true;
      const p = parseAdminCatalogCourseSelector(selector);
      return p.kind === 'published';
    }
    return true;
  }, [isCreatorCatalog, draft, isAdminMergedCatalog, selector]);

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

  const draftOutlineCounts = useMemo(() => {
    if (!draft) return { moduleCount: 0, lessonCount: 0 };
    return {
      moduleCount: draft.modules.length,
      lessonCount: draft.modules.reduce((n, m) => n + m.lessons.length, 0),
    };
  }, [draft]);

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
        const withPublish =
          catalogPersistence?.kind === 'creator' ? fresh : { ...fresh, catalogPublished: false };
        const keyed = ensureCourseLessonRowKeys(withPublish);
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
    },
    []
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
    },
    []
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
      let next: Course = { ...d, modules };
      if (isStructuredCourseId(d.id) && patch.contentKind !== undefined) {
        next = remapStructuredCourseModuleLessonIdsByOrder(next);
      }
      return next;
    });
  };

  const applyAiGeneratedCourse = useCallback((c: Course) => {
    setDraft((d) => {
      if (!d) return null;
      const merged = normalizeCourseTaxonomy(remapCourseToStructuredIds(c, d.id));
      return ensureCourseLessonRowKeys(merged);
    });
  }, []);

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
      if (res.ok === false) {
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

  /** Insert a new module at `insertIndex` (0 = before the first module; `length` = append). */
  const addModuleAt = (insertIndex: number) => {
    setDraft((d) => {
      if (!d) return null;
      const idx = Math.max(0, Math.min(insertIndex, d.modules.length));
      pendingOpenNewModuleIndexRef.current = idx;
      pendingOpenNewLessonKeyRef.current = `${idx}:0`;
      pendingScrollToNewModuleTitleMiRef.current = idx;
      const structured = isStructuredCourseId(d.id);
      const mid = structured ? nextModuleIdForCourse(d) : nextModuleIdLegacy(d.modules);
      const lid = structured ? `${mid}L1` : nextLessonIdLegacy(d);
      const newModule = {
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
      };
      const modules = [...d.modules.slice(0, idx), newModule, ...d.modules.slice(idx)];
      let next: Course = { ...d, modules };
      if (structured) {
        next = remapStructuredCourseModuleLessonIdsByOrder(next);
      }
      return next;
    });
    setCourseDetailsOpen(false);
  };

  const openSplitDividerNewModuleModal = useCallback((mi: number, li: number) => {
    const d = draftRef.current;
    if (!d?.modules[mi]?.lessons[li] || d.modules[mi].lessons[li].contentKind !== 'divider') return;
    setSplitDividerNewModuleModal({ mi, li, insertAt: mi + 1 });
  }, []);

  const commitSplitDividerIntoNewModuleAt = useCallback(
    (mi: number, li: number, insertAt: number): boolean => {
      const d = draftRef.current;
      if (!d?.modules[mi]?.lessons[li] || d.modules[mi].lessons[li].contentKind !== 'divider') return false;
      const r = applySplitDividerIntoNewModule(d, mi, li, insertAt);
      if (!r) {
        showActionToast(
          'Cannot split here: this module needs at least one playable lesson outside this divider’s section (rows above the divider plus any rows from the next divider onward).',
          'danger'
        );
        return false;
      }
      setDraft(r.next);
      setCourseDetailsOpen(false);
      setOpenLessons({});
      pendingOpenNewModuleIndexRef.current = r.newModuleIndex;
      pendingScrollToNewModuleTitleMiRef.current = r.newModuleIndex;
      setOpenModules({ [r.newModuleIndex]: true });
      showActionToast(
        'New module created; lessons under this divider (until the next divider or end of module) moved into it.'
      );
      return true;
    },
    [showActionToast]
  );

  const removeModule = (mi: number) => {
    if (!draft || draft.modules.length <= 1) return;
    setDraft((d) => {
      if (!d || d.modules.length <= 1) return d;
      return { ...d, modules: d.modules.filter((_, i) => i !== mi) };
    });
    showActionToast('Module deleted.');
  };

  /** Insert a new lesson or section divider at `insertAt` (0 = before the first; default / `length` = append). */
  const addLesson = (mi: number, insertAt?: number, kind: 'lesson' | 'divider' = 'lesson') => {
    setDraft((d) => {
      if (!d) return null;
      const targetModule = d.modules[mi];
      if (!targetModule) return d;
      const len = targetModule.lessons.length;
      const at =
        insertAt === undefined ? len : Math.max(0, Math.min(insertAt, len));
      pendingOpenNewLessonKeyRef.current = `${mi}:${at}`;
      pendingScrollToNewLessonTitleRef.current = { mi, li: at };
      const structured = isStructuredCourseId(d.id);
      const lid =
        kind === 'divider'
          ? structured
            ? nextDividerIdInModule(d, mi)
            : nextDividerIdLegacy()
          : structured
            ? nextLessonIdInModule(d, mi)
            : nextLessonIdLegacy(d);
      const newLesson =
        kind === 'divider'
          ? ({
              id: lid,
              title: '',
              videoUrl: '',
              contentKind: 'divider' as const,
              __adminRowKey: crypto.randomUUID(),
            } as LessonWithAdminKey)
          : ({
              id: lid,
              title: '',
              videoUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
              __adminRowKey: crypto.randomUUID(),
            } as LessonWithAdminKey);
      const modules = d.modules.map((m, i) => {
        if (i !== mi) return m;
        const lessons = [...m.lessons];
        lessons.splice(at, 0, newLesson);
        return { ...m, lessons };
      });
      let next: Course = { ...d, modules };
      if (structured) {
        next = remapStructuredCourseModuleLessonIdsByOrder(next);
      }
      return next;
    });
  };

  const openCatalogPlaceForModule = useCallback((sourceMi: number) => {
    const d = draftRef.current;
    if (!d?.modules[sourceMi]) return;
    const len = d.modules.length;
    setCatalogPlaceMode('copy');
    setCatalogModuleCopyInsertIdx(Math.min(sourceMi + 1, len));
    const wo = len - 1;
    setCatalogModuleMoveInsertIdx(Math.min(sourceMi, Math.max(0, wo)));
    setCatalogPlaceModal({ kind: 'module', sourceMi });
  }, []);

  const openCatalogPlaceForLesson = useCallback((sourceMi: number, sourceLi: number) => {
    const d = draftRef.current;
    if (!d?.modules[sourceMi]?.lessons[sourceLi]) return;
    setCatalogPlaceMode('copy');
    setCatalogLessonTargetMi(sourceMi);
    setCatalogLessonInsertIdx(d.modules[sourceMi].lessons.length);
    setCatalogPlaceModal({ kind: 'lesson', sourceMi, sourceLi });
  }, []);

  const closeCatalogPlaceModal = useCallback(() => setCatalogPlaceModal(null), []);

  const commitCatalogPlace = useCallback(() => {
    const d = draftRef.current;
    if (!d || !catalogPlaceModal) return;
    if (catalogPlaceModal.kind === 'module') {
      const smi = catalogPlaceModal.sourceMi;
      if (catalogPlaceMode === 'copy') {
        const r = applyCopyModuleAt(d, smi, catalogModuleCopyInsertIdx);
        if (!r) {
          showActionToast('Could not copy module.', 'danger');
          return;
        }
        setDraft(r.next);
        setOpenLessons({});
        pendingOpenNewModuleIndexRef.current = r.newModuleIndex;
        pendingScrollToNewModuleTitleMiRef.current = r.newModuleIndex;
        setOpenModules({ [r.newModuleIndex]: true });
        showActionToast('Module copied.');
      } else {
        const r = applyMoveModuleAt(d, smi, catalogModuleMoveInsertIdx);
        if (!r) {
          showActionToast('Could not move module.', 'danger');
          return;
        }
        setDraft(r.next);
        setOpenLessons({});
        setOpenModules({ [r.moduleIndex]: true });
        showActionToast('Module moved.');
      }
    } else {
      const { sourceMi, sourceLi } = catalogPlaceModal;
      if (catalogPlaceMode === 'copy') {
        const r = applyCopyLessonAt(
          d,
          sourceMi,
          sourceLi,
          catalogLessonTargetMi,
          catalogLessonInsertIdx
        );
        if (!r) {
          showActionToast('Could not copy branch.', 'danger');
          return;
        }
        setDraft(r.next);
        pendingOpenNewLessonKeyRef.current = `${r.mi}:${r.li}`;
        pendingScrollToNewLessonTitleRef.current = { mi: r.mi, li: r.li };
        setOpenModules({ [r.mi]: true });
        setOpenLessons({ [`${r.mi}:${r.li}`]: true });
        showActionToast('Branch copied.');
      } else {
        const r = applyMoveLessonAt(
          d,
          sourceMi,
          sourceLi,
          catalogLessonTargetMi,
          catalogLessonInsertIdx
        );
        if (!r) {
          showActionToast(
            'Could not move branch. Each module must keep at least one playable lesson (video, page, or quiz).',
            'danger'
          );
          return;
        }
        setDraft(r.next);
        pendingOpenNewLessonKeyRef.current = `${r.mi}:${r.li}`;
        pendingScrollToNewLessonTitleRef.current = { mi: r.mi, li: r.li };
        setOpenModules({ [r.mi]: true });
        setOpenLessons({ [`${r.mi}:${r.li}`]: true });
        showActionToast('Branch moved.');
      }
    }
    setCatalogPlaceModal(null);
  }, [
    catalogPlaceModal,
    catalogPlaceMode,
    catalogLessonTargetMi,
    catalogLessonInsertIdx,
    catalogModuleCopyInsertIdx,
    catalogModuleMoveInsertIdx,
    showActionToast,
  ]);

  const closeCatalogDividerRemoveDialog = useCallback(() => setCatalogDividerRemovePending(null), []);

  const removeLesson = (mi: number, li: number) => {
    if (!draft) return;
    const target = draft.modules[mi];
    if (!target || target.lessons.length <= 1) return;
    const row = target.lessons[li];
    if (row?.contentKind === 'divider') {
      const under = countRowsUnderCatalogDivider(target, li);
      if (under > 0) {
        const raw = catalogMiniRichPlainText(row.title ?? '') || 'Divider';
        const label = raw.length > 72 ? `${raw.slice(0, 70)}…` : raw;
        setCatalogDividerRemovePending({ mi, li, label, nestedCount: under });
        return;
      }
    }
    const wouldRemain = target.lessons.filter((_, j) => j !== li);
    if (!wouldRemain.some(isPlayableCatalogLesson)) return;
    setDraft((d) => {
      if (!d) return null;
      const modules = d.modules.map((m, i) => {
        if (i !== mi) return m;
        if (m.lessons.length <= 1) return m;
        const nextLessons = m.lessons.filter((_, j) => j !== li);
        if (!nextLessons.some(isPlayableCatalogLesson)) return m;
        return { ...m, lessons: nextLessons };
      });
      return { ...d, modules };
    });
    showActionToast('Lesson deleted.');
  };

  const confirmCatalogDividerRemoveKeepRows = useCallback(() => {
    const pending = catalogDividerRemovePending;
    if (!pending || !draft) return;
    const before = deepClone(draft);
    const { mi, li, nestedCount } = pending;
    setDraft((d) => {
      if (!d) return null;
      const modules = d.modules.map((m, i) => {
        if (i !== mi) return m;
        if (m.lessons.length <= 1) return m;
        const nextLessons = m.lessons.filter((_, j) => j !== li);
        if (!nextLessons.some(isPlayableCatalogLesson)) return m;
        return { ...m, lessons: nextLessons };
      });
      return { ...d, modules };
    });
    setDividerSectionsCollapsed((prev) => clearDividerCollapseKeysForModule(prev, mi));
    setCatalogDividerRemovePending(null);
    showActionToast(`Divider removed; ${nestedCount} row(s) kept in this module.`, {
      variant: 'neutral',
      undo: () => setDraft(before),
      undoLabel: 'Undo',
    });
  }, [catalogDividerRemovePending, draft, showActionToast]);

  const confirmCatalogDividerRemoveDeleteAll = useCallback(() => {
    const pending = catalogDividerRemovePending;
    if (!pending || !draft) return;
    const before = deepClone(draft);
    const { mi, li, label } = pending;
    const next = removeCatalogDividerAndNestedLessonRows(draft, mi, li);
    if (!next) {
      showActionToast(
        'Each module must keep at least one playable lesson (video, page, or quiz). Remove or move lessons first.',
        'danger'
      );
      setCatalogDividerRemovePending(null);
      return;
    }
    setDraft(next);
    setDividerSectionsCollapsed((prev) => clearDividerCollapseKeysForModule(prev, mi));
    setCatalogDividerRemovePending(null);
    showActionToast(`“${label}” and all rows under it removed.`, {
      variant: 'neutral',
      undo: () => setDraft(before),
      undoLabel: 'Undo',
    });
  }, [catalogDividerRemovePending, draft, showActionToast]);

  const baselineCourseSnapshot = useMemo((): Course | null => {
    if (!baselineJson) return null;
    try {
      return JSON.parse(baselineJson) as Course;
    } catch {
      return null;
    }
  }, [baselineJson]);

  const resetModuleFromBaseline = useCallback(
    (mi: number) => {
      const base = baselineCourseSnapshot;
      if (!base) {
        showActionToast('Save the course once to enable reset.', 'neutral');
        return;
      }
      const src = base.modules[mi];
      if (!src) {
        showActionToast('No last-saved version for this module slot.', 'neutral');
        return;
      }
      setDraft((d) => {
        if (!d) return null;
        const modules = [...d.modules];
        modules[mi] = deepClone(src);
        let next: Course = { ...d, modules };
        next = ensureCourseLessonRowKeys(normalizeCourseTaxonomy(next));
        return next;
      });
      showActionToast('Module reset to last saved.');
    },
    [baselineCourseSnapshot, showActionToast]
  );

  const resetLessonFromBaseline = useCallback(
    (mi: number, li: number) => {
      const base = baselineCourseSnapshot;
      if (!base) {
        showActionToast('Save the course once to enable reset.', 'neutral');
        return;
      }
      const srcLesson = base.modules[mi]?.lessons[li];
      if (!srcLesson) {
        showActionToast('No last-saved version for this lesson slot.', 'neutral');
        return;
      }
      setDraft((d) => {
        if (!d) return null;
        const modules = d.modules.map((m, i) => {
          if (i !== mi) return m;
          const lessons = [...m.lessons];
          lessons[li] = deepClone(srcLesson);
          return { ...m, lessons };
        });
        let next: Course = { ...d, modules };
        next = ensureCourseLessonRowKeys(normalizeCourseTaxonomy(next));
        return next;
      });
      showActionToast('Lesson reset to last saved.');
    },
    [baselineCourseSnapshot, showActionToast]
  );

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

  const remapDividerSectionsCollapsedAfterModuleSwap = (
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
    setDividerSectionsCollapsed((prev) => remapDividerSectionsCollapsedAfterModuleSwap(prev, a, b));

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
      setDividerSectionsCollapsed((prev) => {
        const c1 = prev[k1];
        const c2 = prev[k2];
        if (!c1 && !c2) return prev;
        const next = { ...prev };
        delete next[k1];
        delete next[k2];
        if (c1) next[k2] = true;
        if (c2) next[k1] = true;
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

  const toggleDividerSection = useCallback((mi: number, li: number) => {
    const k = `${mi}:${li}`;
    setDividerSectionsCollapsed((prev) => {
      const next = { ...prev };
      if (next[k]) delete next[k];
      else next[k] = true;
      return next;
    });
  }, []);

  const catalogDisclosureLessonKey = useMemo(() => {
    const k = Object.keys(openLessons).find((key) => openLessons[key]);
    return k ?? null;
  }, [openLessons]);

  useEffect(() => {
    openLessonKeyRef.current = Object.keys(openLessons).find((k) => openLessons[k]) ?? null;
  }, [openLessons]);

  const catalogDisclosureModuleMi = useMemo(() => {
    const e = Object.entries(openModules).find(([, v]) => v);
    if (!e) return null;
    const mi = Number(e[0]);
    return Number.isInteger(mi) ? mi : null;
  }, [openModules]);

  /** Align expanded lesson or module to top when those disclosures change (catalog has no inner scroll shell). */
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
    }
    scrollDisclosureRowToTop(null, el);
  }, [catalogDisclosureLessonKey, catalogDisclosureModuleMi]);

  /** Whenever Course details goes from collapsed → expanded, scroll it to the top (even if a module/lesson is open). */
  useLayoutEffect(() => {
    const wasOpen = prevCourseDetailsOpenRef.current;
    prevCourseDetailsOpenRef.current = courseDetailsOpen;
    if (!courseDetailsOpen || wasOpen) return;
    scrollDisclosureRowToTop(null, courseDetailsDisclosureRef.current);
  }, [courseDetailsOpen]);

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
        focusCatalogMiniRichById(`admin-module-title-${miFocus}`, { preventScroll: true });
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
    const rowLesson = draft.modules[mi]?.lessons[li];
    const lessonBodyOpen =
      !!openLessons[`${mi}:${li}`] || rowLesson?.contentKind === 'divider';
    if (!openModules[mi] || !lessonBodyOpen) return;
    let frames = 0;
    const tryFocus = () => {
      const el = document.getElementById(`admin-lesson-title-${mi}-${li}`);
      if (el instanceof HTMLElement) {
        pendingScrollToNewLessonTitleRef.current = null;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        focusCatalogMiniRichById(`admin-lesson-title-${mi}-${li}`, { preventScroll: true });
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
    if (!c.skills?.length || !c.skills.some((x) => x.trim())) {
      return { targetId: 'admin-course-skills', scope: 'course', moduleIndex: 0 };
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
      if (catalogMiniRichIsEffectivelyEmpty(m.title)) {
        return {
          targetId: `admin-module-title-${mi}`,
          scope: 'module',
          moduleIndex: mi,
          lessonKeys: [`${mi}:0`],
        };
      }
      const moduleTitleKey = catalogMiniRichPlainText(m.title).toLowerCase();
      for (let pj = 0; pj < mi; pj += 1) {
        const prev = c.modules[pj];
        const prevPlain = catalogMiniRichPlainText(prev.title);
        if (prevPlain && prevPlain.toLowerCase() === moduleTitleKey) {
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
        if (!l.id.trim() && l.contentKind !== 'divider') {
          return {
            targetId: `admin-lesson-id-${mi}-${li}`,
            scope: 'module',
            moduleIndex: mi,
            lessonKeys: openKeys,
          };
        }
        if (catalogMiniRichIsEffectivelyEmpty(l.title)) {
          return {
            targetId: `admin-lesson-title-${mi}-${li}`,
            scope: 'module',
            moduleIndex: mi,
            lessonKeys: openKeys,
          };
        }
        const lessonTitleKey = catalogMiniRichPlainText(l.title).toLowerCase();
        for (let mi2 = 0; mi2 < c.modules.length; mi2 += 1) {
          for (let li2 = 0; li2 < c.modules[mi2].lessons.length; li2 += 1) {
            if (mi2 === mi && li2 === li) continue;
            if (mi2 > mi || (mi2 === mi && li2 > li)) continue;
            const other = c.modules[mi2].lessons[li2];
            const otherPlain = catalogMiniRichPlainText(other.title);
            if (otherPlain && otherPlain.toLowerCase() === lessonTitleKey) {
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
        } else if (l.contentKind === 'divider') {
          /* heading only */
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
      courseSkills: false,
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
    if (!draft.skills?.length || !draft.skills.some((x) => x.trim())) out.courseSkills = true;
    if (draft.rating < 0 || draft.rating > 5) out.courseRating = true;
    for (let mi = 0; mi < draft.modules.length; mi += 1) {
      const m = draft.modules[mi];
      if (!m.id.trim()) out.moduleId.add(mi);
      if (catalogMiniRichIsEffectivelyEmpty(m.title)) out.moduleTitle.add(mi);
      const mt = catalogMiniRichPlainText(m.title).toLowerCase();
      if (mt) {
        for (let pj = 0; pj < mi; pj += 1) {
          const prev = draft.modules[pj];
          const prevPlain = catalogMiniRichPlainText(prev.title);
          if (prevPlain && prevPlain.toLowerCase() === mt) {
            out.moduleTitle.add(mi);
            out.moduleTitle.add(pj);
          }
        }
      }
      for (let li = 0; li < m.lessons.length; li += 1) {
        const l = m.lessons[li];
        const key = `${mi}:${li}`;
        if (!l.id.trim() && l.contentKind !== 'divider') out.lessonId.add(key);
        if (catalogMiniRichIsEffectivelyEmpty(l.title)) out.lessonTitle.add(key);
        if (l.contentKind === 'web') {
          if (!lessonWebHref(l)) out.lessonWebUrl.add(key);
        } else if (l.contentKind === 'quiz') {
          if (validateLessonQuiz(l, mi, li)) out.lessonQuiz.add(key);
        } else if (l.contentKind !== 'divider' && (!l.videoUrl.trim() || !l.videoUrl.startsWith('http'))) {
          out.videoUrl.add(key);
        }
      }
    }
    for (let mi = 0; mi < draft.modules.length; mi += 1) {
      for (let li = 0; li < draft.modules[mi].lessons.length; li += 1) {
        const l = draft.modules[mi].lessons[li];
        const key = `${mi}:${li}`;
        const lt = catalogMiniRichPlainText(l.title).toLowerCase();
        if (!lt) continue;
        for (let mi2 = 0; mi2 < draft.modules.length; mi2 += 1) {
          for (let li2 = 0; li2 < draft.modules[mi2].lessons.length; li2 += 1) {
            if (mi2 === mi && li2 === li) continue;
            if (mi2 > mi || (mi2 === mi && li2 > li)) continue;
            const o = draft.modules[mi2].lessons[li2];
            const oPlain = catalogMiniRichPlainText(o.title);
            if (oPlain && oPlain.toLowerCase() === lt) {
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
      const savedOpenKey = openLessonKeyRef.current;
      if (savedOpenKey) {
        const parts = savedOpenKey.split(':');
        const mi = Number(parts[0]);
        const li = Number(parts[1]);
        const savedLesson =
          Number.isInteger(mi) && Number.isInteger(li) ? normalized.modules[mi]?.lessons[li] : undefined;
        setOpenLessons({});
        if (savedLesson && savedLesson.contentKind !== 'divider') {
          setAddAnotherLessonAfterSave({ mi, insertAt: li + 1 });
        }
      }
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
    copy.catalogPublished = false;
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
      courseTitleConflict !== null ||
      changeLessonKindModal !== null ||
      splitDividerNewModuleModal !== null ||
      changeModuleKindModal !== null ||
      addLessonBranchModal !== null ||
      addAnotherLessonAfterSave !== null ||
      catalogPlaceModal !== null ||
      catalogDividerRemovePending !== null
  );

  /** Ref updated by PathBuilder via onPathsDirtyChange — read before opening catalog tab confirm. */
  const pathBuilderDirtyRef = useRef(false);
  const courseDiscardTargetRef = useRef<
    'paths' | 'taxonomy' | 'categories' | 'catalog' | 'presets' | 'skillPresets'
  >('paths');
  const pathDiscardTargetRef = useRef<
    'catalog' | 'taxonomy' | 'categories' | 'presets' | 'skillPresets'
  >('catalog');
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
      /** Creators may open taxonomy to suggest global labels; presets/categories admin tabs stay blocked below. */
      if (isCreatorCatalog && next !== 'catalog' && next !== 'paths' && next !== 'taxonomy') return;

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

  const closeChangeLessonKindModal = useCallback(() => setChangeLessonKindModal(null), []);
  const closeChangeModuleKindModal = useCallback(() => setChangeModuleKindModal(null), []);
  const closeSplitDividerNewModuleModal = useCallback(() => setSplitDividerNewModuleModal(null), []);

  useDialogKeyboard({
    open: changeLessonKindModal !== null,
    onClose: closeChangeLessonKindModal,
  });

  useDialogKeyboard({
    open: splitDividerNewModuleModal !== null,
    onClose: closeSplitDividerNewModuleModal,
  });

  useDialogKeyboard({
    open: changeModuleKindModal !== null,
    onClose: closeChangeModuleKindModal,
  });

  const closeAddLessonBranchModal = useCallback(() => setAddLessonBranchModal(null), []);

  const closeAddAnotherLessonAfterSave = useCallback(() => setAddAnotherLessonAfterSave(null), []);

  const confirmAddAnotherLessonAfterSave = useCallback(() => {
    setAddAnotherLessonAfterSave((ctx) => {
      if (ctx) setAddLessonBranchModal({ mi: ctx.mi, insertAt: ctx.insertAt });
      return null;
    });
  }, []);

  useDialogKeyboard({
    open: addLessonBranchModal !== null,
    onClose: closeAddLessonBranchModal,
  });

  useDialogKeyboard({
    open: addAnotherLessonAfterSave !== null,
    onClose: closeAddAnotherLessonAfterSave,
    onPrimaryAction: confirmAddAnotherLessonAfterSave,
  });

  useDialogKeyboard({
    open: catalogPlaceModal !== null,
    onClose: closeCatalogPlaceModal,
  });

  useDialogKeyboard({
    open: catalogDividerRemovePending !== null,
    onClose: closeCatalogDividerRemoveDialog,
    onPrimaryAction: confirmCatalogDividerRemoveKeepRows,
  });

  useEffect(() => {
    if (!draft || catalogPlaceModal?.kind !== 'lesson') return;
    const m = draft.modules[catalogLessonTargetMi];
    if (!m) return;
    setCatalogLessonInsertIdx((prev) => Math.min(prev, m.lessons.length));
  }, [catalogLessonTargetMi, draft, catalogPlaceModal?.kind]);

  useEffect(() => {
    if (!catalogPlaceModal || catalogPlaceModal.kind !== 'module' || !draft) return;
    const n = draft.modules.length;
    if (catalogPlaceMode === 'copy') {
      setCatalogModuleCopyInsertIdx((p) => Math.min(Math.max(0, p), n));
    } else {
      const wo = Math.max(0, n - 1);
      setCatalogModuleMoveInsertIdx((p) => Math.min(Math.max(0, p), wo));
    }
  }, [catalogPlaceModal, catalogPlaceMode, draft?.modules.length, draft]);

  useEffect(() => {
    if (!catalogPlaceModal || !draft) return;
    if (catalogPlaceModal.kind === 'module') {
      if (!draft.modules[catalogPlaceModal.sourceMi]) setCatalogPlaceModal(null);
    } else {
      const { sourceMi, sourceLi } = catalogPlaceModal;
      if (!draft.modules[sourceMi]?.lessons[sourceLi]) setCatalogPlaceModal(null);
    }
  }, [draft, catalogPlaceModal]);

  useEffect(() => {
    if (!changeLessonKindModal || !draft) return;
    const { mi, li } = changeLessonKindModal;
    const row = draft.modules[mi]?.lessons[li];
    if (!row) setChangeLessonKindModal(null);
  }, [draft, changeLessonKindModal]);

  useEffect(() => {
    if (!splitDividerNewModuleModal || !draft) return;
    const { mi, li, insertAt } = splitDividerNewModuleModal;
    const row = draft.modules[mi]?.lessons[li];
    if (!row || row.contentKind !== 'divider') {
      setSplitDividerNewModuleModal(null);
      return;
    }
    const maxAt = draft.modules.length;
    if (insertAt < 0 || insertAt > maxAt) {
      setSplitDividerNewModuleModal((prev) =>
        prev ? { ...prev, insertAt: Math.max(0, Math.min(prev.insertAt, maxAt)) } : null
      );
    }
  }, [draft, splitDividerNewModuleModal]);

  useEffect(() => {
    if (changeModuleKindModal == null || !draft) return;
    const { sourceMi } = changeModuleKindModal;
    if (draft.modules.length < 2 || !draft.modules[sourceMi]) setChangeModuleKindModal(null);
  }, [draft, changeModuleKindModal]);

  useEffect(() => {
    if (!addLessonBranchModal || !draft) return;
    const { mi, insertAt } = addLessonBranchModal;
    const mod = draft.modules[mi];
    if (!mod || insertAt < 0 || insertAt > mod.lessons.length) setAddLessonBranchModal(null);
  }, [draft, addLessonBranchModal]);

  useEffect(() => {
    if (!addAnotherLessonAfterSave || !draft) return;
    const { mi, insertAt } = addAnotherLessonAfterSave;
    const mod = draft.modules[mi];
    if (!mod || insertAt < 0 || insertAt > mod.lessons.length) setAddAnotherLessonAfterSave(null);
  }, [draft, addAnotherLessonAfterSave]);

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
    const added = draft.modules[mi]?.lessons[li];
    if (added?.contentKind === 'divider') {
      setDividerSectionsCollapsed((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    // Ensure the containing module is visible too.
    setOpenModules({ [mi]: true });
    pendingOpenNewLessonKeyRef.current = null;
  }, [draft?.modules, draft]);

  useEffect(() => {
    const id = pendingScrollTargetIdRef.current;
    if (!id) return;
    const rafId = requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (!(el instanceof HTMLElement)) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (id.startsWith('admin-module-title-') || id.startsWith('admin-lesson-title-')) {
        focusCatalogMiniRichById(id, { preventScroll: true });
      } else {
        el.focus({ preventScroll: true });
      }
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
    <div className="min-w-0 space-y-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 sm:space-y-6 sm:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between">
        <h2 className="flex min-w-0 items-center gap-2 text-base font-bold sm:text-lg">
          <BookOpen size={20} className="shrink-0 text-admin-icon" />
          <span className="min-w-0">{catalogSectionTitle ?? 'Course catalog'}</span>
        </h2>
        {/* Keep a stable slot so the title row does not jump when switching tabs */}
        <div className="flex w-full shrink-0 items-stretch justify-stretch md:w-auto md:items-center md:justify-end">
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
            className={`inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm font-semibold hover:bg-[var(--hover-bg)] active:opacity-90 disabled:opacity-50 sm:text-xs md:w-auto ${
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
          className="rounded-xl border border-[#8b8c8c]/65 bg-[#757676]/12 px-3 py-2.5 text-xs leading-relaxed text-[var(--text-secondary)] sm:text-sm"
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
          className={`inline-flex min-h-11 touch-manipulation shrink-0 items-center rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/45 active:opacity-90 ${
            contentCatalogSubTab === 'catalog'
              ? 'bg-[#616161]/10 text-[var(--text-primary)] ring-1 ring-[#a1a2a2]/45'
              : 'text-[var(--text-secondary)]'
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
            className={`inline-flex min-h-11 touch-manipulation shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/45 active:opacity-90 ${
              contentCatalogSubTab === 'paths'
                ? 'bg-[#616161]/10 text-[var(--text-primary)] ring-1 ring-[#a1a2a2]/45'
                : 'text-[var(--text-secondary)]'
            }`}
          >
            <Route size={15} aria-hidden />
            Paths
          </button>
          <button
            type="button"
            onClick={() => requestContentCatalogSubTab('taxonomy')}
            aria-current={contentCatalogSubTab === 'taxonomy' ? 'page' : undefined}
            aria-label="Categories and skills"
            className={`inline-flex min-h-11 touch-manipulation shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/45 active:opacity-90 ${
              contentCatalogSubTab === 'taxonomy'
                ? 'bg-[#616161]/10 text-[var(--text-primary)] ring-1 ring-[#a1a2a2]/45'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Tags size={15} className="shrink-0 opacity-90" aria-hidden />
            <span className="min-w-0 truncate">Categories & Skills</span>
          </button>
        </div>
      </div>

      {contentCatalogSubTab === 'catalog' && (
        <>
      <div ref={courseCatalogEditorRef} className="space-y-4">
        <div className="space-y-3">
        <div className="min-w-0 pb-0.5 md:overflow-x-auto md:overflow-y-visible md:[-webkit-overflow-scrolling:touch]">
        <div className="flex w-full min-w-0 flex-col gap-3 md:min-w-[min(100%,920px)] lg:flex-row lg:flex-nowrap lg:items-center lg:gap-3 lg:overflow-x-auto lg:overflow-y-visible lg:[-webkit-overflow-scrolling:touch] lg:[scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden">
            <div className="flex min-h-6 min-w-0 shrink-0 flex-wrap items-center gap-x-1.5 gap-y-1 lg:shrink-0">
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
                  className={`inline-flex size-6 shrink-0 touch-manipulation items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/45 active:opacity-90 ${
                    catalogTipsOpen ? 'border-[#8b8c8c]/90 text-[#616161] app-dark:border-[var(--tone-400)] app-dark:text-[var(--tone-100)]' : ''
                  }`}
                >
                  <Info size={14} className="text-admin-icon opacity-90" aria-hidden />
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
                          ? 'fixed z-[120] left-3 right-3 w-auto max-w-none translate-x-0 overflow-y-auto overflow-x-hidden overscroll-y-contain [-webkit-overflow-scrolling:touch] touch-pan-y max-h-[calc(100dvh-var(--admin-tip-top)-env(safe-area-inset-bottom,0px)-0.75rem)] rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3.5 text-left text-sm leading-relaxed text-[var(--text-primary)] shadow-xl pointer-events-auto outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/45'
                          : 'hidden'
                        : 'absolute left-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] max-w-sm rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-left text-xs leading-snug text-[var(--text-primary)] shadow-lg pointer-events-auto'
                  }
                  style={
                    catalogTipsOpen && tipsNarrowViewport && catalogTipFixedTop >= 0
                      ? narrowAdminTipPanelStyle(catalogTipFixedTop)
                      : undefined
                  }
                >
                  <ul className="list-disc space-y-1.5 pl-4 text-[var(--text-muted)] marker:text-[#757676]/90 app-dark:marker:text-[var(--tone-300)] sm:space-y-1">
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
                      <code className="text-[#616161] app-dark:text-[var(--tone-200)]">C1</code>, <code className="text-[#616161] app-dark:text-[var(--tone-200)]">C2</code>…;
                      list A–Z.
                    </li>
                    <li>
                      Ids: modules <code className="text-[#616161] app-dark:text-[var(--tone-200)]">C1M1</code>, lessons{' '}
                      <code className="text-[#616161] app-dark:text-[var(--tone-200)]">C1M1L1</code>, section dividers{' '}
                      <code className="text-[#616161] app-dark:text-[var(--tone-200)]">C1M1D1</code> (not L).
                    </li>
                  </ul>
                </div>
              </span>
            </div>
            <select
              id="admin-catalog-course-select"
              value={selector}
              onFocus={openCourseCatalogOnce}
              onMouseDown={openCourseCatalogOnce}
              onChange={onCourseSelectChange}
              className="admin-toolbar-main-select box-border min-h-11 min-w-0 w-full touch-manipulation rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-base text-[var(--text-primary)] md:text-sm lg:min-w-[12rem] lg:flex-1 lg:max-w-none"
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
          <div className="flex min-w-0 flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-x-4 md:gap-y-2 lg:flex-row lg:flex-nowrap lg:items-center lg:justify-start lg:gap-x-3 lg:gap-y-0 lg:shrink-0">
            <div className="flex w-full min-w-0 flex-row flex-nowrap items-center gap-2 overflow-x-auto overflow-y-visible overscroll-x-contain border-t border-[var(--border-color)]/60 pt-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] md:w-auto md:max-w-[min(100%,42rem)] md:flex-wrap md:overflow-visible md:border-t-0 md:pt-0 lg:w-auto lg:max-w-none lg:flex-nowrap lg:shrink-0 [&::-webkit-scrollbar]:hidden">
              <div className="flex min-w-0 shrink-0 flex-nowrap items-center gap-2">
                <div
                  className="box-border flex min-w-0 max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-2 text-sm font-mono text-[var(--text-primary)] md:px-2.5"
                  aria-live="polite"
                  title="Document ID"
                >
                  <Hash size={16} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
                  {draft ? (
                    <span className="truncate text-[#616161] app-dark:text-[var(--tone-200)]">{draft.id}</span>
                  ) : (
                    <span className="text-[var(--text-muted)]">—</span>
                  )}
                </div>
                {selector !== '__new__' && (
                  <button
                    type="button"
                    disabled={listLoading || !selector || !selectionIsExistingCatalogCourse}
                    onClick={requestDuplicateOrConfirm}
                    title="Duplicate as new draft — clone into a new document ID"
                    aria-label="Duplicate as new draft"
                    className="inline-flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-lg border border-[var(--border-color)] hover:bg-[var(--hover-bg)] disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Copy size={18} aria-hidden />
                  </button>
                )}
              </div>
              <div className="flex min-h-11 min-w-[7rem] max-w-full flex-1 items-center gap-1.5 md:hidden">
                <span className="inline-flex shrink-0 text-[var(--text-muted)]" title="Level">
                  <SlidersHorizontal size={16} aria-hidden />
                </span>
                <select
                  id="admin-catalog-course-level-mobile"
                  value={draft?.level ?? ''}
                  disabled={!draft}
                  aria-label="Course level"
                  title="Course level"
                  onChange={(e) =>
                    draft && updateDraft({ level: e.target.value as Course['level'] })
                  }
                  className="admin-toolbar-main-select box-border min-h-11 min-w-0 w-full flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-2 text-sm text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
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
              <div className="hidden min-h-11 min-w-[10.5rem] shrink-0 items-center gap-1.5 md:flex">
                <label htmlFor="admin-catalog-course-level" className="sr-only">
                  Level
                </label>
                <span className="inline-flex shrink-0 text-[var(--text-muted)]" title="Level">
                  <SlidersHorizontal size={16} aria-hidden />
                </span>
                <select
                  id="admin-catalog-course-level"
                  value={draft?.level ?? ''}
                  disabled={!draft}
                  aria-label="Course level"
                  title="Course level"
                  onChange={(e) =>
                    draft && updateDraft({ level: e.target.value as Course['level'] })
                  }
                  className="admin-toolbar-main-select box-border min-h-11 w-full min-w-[9rem] max-w-[11rem] rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-2 text-sm text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
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

          <div
            className="flex w-full min-w-0 shrink-0 flex-row flex-nowrap items-center gap-1.5 overflow-x-auto overflow-y-visible overscroll-x-contain border-t border-[var(--border-color)]/60 py-1 pt-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] md:ml-auto md:w-auto md:flex-wrap md:justify-end md:gap-2 md:overflow-visible md:border-t-0 md:py-0 md:pt-0 lg:ml-0 lg:w-auto lg:shrink-0 lg:justify-start [&::-webkit-scrollbar]:hidden"
            role="group"
            aria-label="Course actions"
          >
            <button
              type="button"
              disabled={busy || !draft || (baselineJson !== null && !isDirty)}
              onClick={() => void handleSave()}
              aria-busy={busy}
              title={busy ? 'Saving…' : 'Save changes to the catalog'}
              aria-label={busy ? 'Saving…' : 'Save course to catalog'}
              className="inline-flex min-h-11 shrink-0 touch-manipulation items-center justify-center gap-2 rounded-xl bg-[#616161] px-3 py-2 text-sm font-bold text-[#e7e7e7] hover:bg-[#757676] disabled:opacity-40 sm:px-4"
            >
              {busy ? (
                <Loader2 size={18} className="shrink-0 animate-spin" aria-hidden />
              ) : (
                <Save size={18} className="shrink-0" aria-hidden />
              )}
              <span>{busy ? 'Saving…' : 'Save'}</span>
            </button>
            {draft && isDirty ? (
              <span
                role="status"
                className="inline-flex size-11 shrink-0 items-center justify-center text-[#616161] app-dark:text-[#a1a2a2]"
                title="Unsaved changes"
              >
                <AlertCircle size={20} strokeWidth={2} aria-hidden />
                <span className="sr-only">Unsaved changes</span>
              </span>
            ) : draft && !isDirty && selector !== '__new__' ? (
              <span
                role="status"
                className="inline-flex size-11 shrink-0 items-center justify-center text-[#616161] app-dark:text-[#a1a2a2]"
                title="All changes saved"
              >
                <CheckCircle2 size={20} strokeWidth={2} aria-hidden />
                <span className="sr-only">All changes saved</span>
              </span>
            ) : null}
            {showPlatformCatalogPublishToggle && draft ? (
              <div className="flex shrink-0 items-center gap-1 border-l border-[var(--border-color)]/70 pl-2 md:pl-3">
                <label
                  htmlFor="admin-catalog-publish-checkbox"
                  className="flex min-h-11 cursor-pointer touch-manipulation items-center gap-1.5 rounded-lg px-0.5"
                  title="Published in catalog and learning paths"
                >
                  <Globe size={16} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
                  <input
                    id="admin-catalog-publish-checkbox"
                    type="checkbox"
                    checked={isCourseCatalogPublished(draft)}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setDraft((d) => {
                        if (!d) return d;
                        if (on) {
                          const { catalogPublished: _removed, ...rest } = d;
                          return { ...rest } as Course;
                        }
                        return { ...d, catalogPublished: false };
                      });
                    }}
                    className="h-4 w-4 shrink-0 rounded border-[var(--border-color)] checkbox-accent-theme"
                    aria-label="Published in course catalog and learning paths"
                  />
                </label>
                <span className="inline-flex shrink-0">
                  <AdminLabelInfoTip
                    controlOnly
                    tipId="admin-catalog-publish-tips"
                    tipRegionAriaLabel="Published in catalog and paths"
                    tipSubject="Published in catalog and paths"
                  >
                    <li>
                      When on, learners see this course in Browse, path outlines, and path link pickers.
                    </li>
                    <li>
                      When off, it stays hidden there even if a path row is set to Show for learners.
                    </li>
                  </AdminLabelInfoTip>
                </span>
              </div>
            ) : null}
            <div
              className="flex shrink-0 items-center border-l-2 border-[#616161]/25 pl-2 md:pl-3 lg:pl-4"
              role="group"
              aria-label="Destructive actions"
            >
              <button
                type="button"
                disabled={busy || !draft || !selectionIsExistingCatalogCourse}
                onClick={() => void requestDeleteCourse()}
                title="Permanently remove this course from the catalog"
                aria-label="Delete course from catalog"
                className="inline-flex min-h-11 shrink-0 touch-manipulation items-center justify-center gap-2 rounded-md border-2 border-[#616161]/50 bg-transparent px-2.5 py-2 text-sm font-semibold text-[#616161] hover:bg-[#757676]/12 app-dark:text-[#cfcfcf] disabled:opacity-40 sm:px-3"
              >
                <Trash2 size={17} className="shrink-0" aria-hidden />
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
        </div>
        </div>
        </div>

        {draft && (
          <div className="space-y-4">
          {!isCreatorCatalog && !siteAssistantLoading && siteAssistantEnabled ? (
            <AdminCourseAiAssistant
              draft={draft}
              apiKey={getGeminiApiKey()}
              isDirty={isDirty}
              showActionToast={showActionToast}
              onApplyAiCourse={applyAiGeneratedCourse}
              fallbackCategories={
                draft.categories.length > 0
                  ? draft.categories
                  : [defaultNewCourseCategoryFromState(getCachedCatalogCategoryPresets())]
              }
              fallbackSkills={
                draft.skills.length > 0
                  ? draft.skills
                  : [defaultNewCourseSkillFromState(getCachedCatalogSkillPresets())]
              }
            />
          ) : null}
          <div
            ref={courseDetailsDisclosureRef}
            className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/20"
          >
            <button
              type="button"
              onClick={() => setCourseDetailsOpen((v) => !v)}
              className="flex w-full min-w-0 items-center justify-between gap-2 px-4 py-3 text-left"
              aria-expanded={courseDetailsOpen}
              aria-label={`Course details, ${draftOutlineCounts.moduleCount} module${draftOutlineCounts.moduleCount === 1 ? '' : 's'}, ${draftOutlineCounts.lessonCount} lesson${draftOutlineCounts.lessonCount === 1 ? '' : 's'}`}
            >
              <span className="min-w-0 truncate text-sm font-bold text-[var(--text-primary)]">
                Course details
              </span>
              <span className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
                <span className="text-right text-xs font-medium tabular-nums text-[var(--text-muted)]">
                  {draftOutlineCounts.moduleCount}{' '}
                  {draftOutlineCounts.moduleCount === 1 ? 'module' : 'modules'}
                  <span aria-hidden> . </span>
                  {draftOutlineCounts.lessonCount}{' '}
                  {draftOutlineCounts.lessonCount === 1 ? 'lesson' : 'lessons'}
                </span>
                {courseDetailsOpen ? (
                  <ChevronDown size={16} className="shrink-0 text-[var(--text-secondary)]" />
                ) : (
                  <ChevronRight size={16} className="shrink-0 text-[var(--text-secondary)]" />
                )}
              </span>
            </button>
            {courseDetailsOpen && (
              <div className="border-t border-[var(--border-color)] p-3 sm:p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-12 xl:gap-x-5 xl:gap-y-4">
            <label className="block min-w-0 space-y-1 xl:col-span-7">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Course title</span>
              <input
                id="admin-course-title"
                value={draft.title}
                onChange={(e) => updateDraft({ title: e.target.value })}
                placeholder="Short catalog name, e.g. Web Foundations"
                className={`w-full min-w-0 bg-[var(--bg-primary)] border rounded-lg px-3 py-2 text-sm ${
                  showValidationHints && fieldErrors.courseTitle
                    ? 'border-[#616161]'
                    : 'border-[var(--border-color)]'
                }`}
              />
            </label>
            <label className="block min-w-0 space-y-1 xl:col-span-5">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Author</span>
              <input
                id="admin-course-author"
                value={draft.author}
                onChange={(e) => updateDraft({ author: e.target.value })}
                className={`w-full min-w-0 bg-[var(--bg-primary)] border rounded-lg px-3 py-2 text-sm ${
                  showValidationHints && fieldErrors.courseAuthor
                    ? 'border-[#616161]'
                    : 'border-[var(--border-color)]'
                }`}
              />
            </label>
            <div
              id="admin-course-categories"
              aria-labelledby="admin-course-categories-label"
              className={`min-w-0 space-y-1.5 xl:col-span-6 ${showValidationHints && fieldErrors.courseCategories ? 'rounded-lg ring-2 ring-red-500/60 ring-offset-2 ring-offset-[var(--bg-secondary)]' : ''}`}
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
                    className={`inline-flex size-6 shrink-0 touch-manipulation items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/45 active:opacity-90 ${
                      categoriesTipsOpen ? 'border-[#8b8c8c]/90 text-[#616161] app-dark:border-[var(--tone-400)] app-dark:text-[var(--tone-100)]' : ''
                    }`}
                  >
                    <Info size={14} className="text-admin-icon opacity-90" aria-hidden />
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
                            ? 'fixed z-[120] left-3 right-3 w-auto max-w-none translate-x-0 overflow-y-auto overflow-x-hidden overscroll-y-contain [-webkit-overflow-scrolling:touch] touch-pan-y max-h-[calc(100dvh-var(--admin-tip-top)-env(safe-area-inset-bottom,0px)-0.75rem)] rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3.5 text-left text-sm leading-relaxed text-[var(--text-primary)] shadow-xl pointer-events-auto outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/45'
                            : 'hidden'
                          : 'absolute left-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] max-w-sm rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-left text-xs leading-snug text-[var(--text-primary)] shadow-lg pointer-events-auto'
                    }
                    style={
                      categoriesTipsOpen && tipsNarrowViewport && categoriesTipFixedTop >= 0
                        ? narrowAdminTipPanelStyle(categoriesTipFixedTop)
                        : undefined
                    }
                  >
                    <ul className="list-disc space-y-1.5 pl-4 text-[var(--text-muted)] marker:text-[#757676]/90 app-dark:marker:text-[var(--tone-300)] sm:space-y-1">
                      <li>At least one category and one skill are required.</li>
                      {isCreatorCatalog ? (
                        <>
                          <li>
                            Removing a chip updates suggestions when that label is not used elsewhere on your drafts or
                            the live catalog.
                          </li>
                          <li>Suggestions include the published catalog and your drafts, not only this device.</li>
                        </>
                      ) : (
                        <li>
                          Add from list uses the same menu style as the Course picker; custom names use the text field +
                          Enter or Add. New labels join filters after save.
                        </li>
                      )}
                    </ul>
                  </div>
                </span>
              </div>
              <div className="flex max-h-24 min-h-9 flex-wrap gap-1.5 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch] pr-0.5">
                {draft.categories.length === 0 ? (
                  <span className="text-xs text-[var(--text-muted)]">Add at least one category.</span>
                ) : (
                  draft.categories.map((cat) => (
                    <span
                      key={cat}
                      className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-2 py-1 text-xs font-medium text-[var(--text-primary)]"
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
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] sm:items-stretch">
                <select
                  key={`admin-cat-pick-${draft.categories.join('\u001f')}`}
                  aria-label="Add category from list"
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    if (!v) return;
                    addDraftCategory(v);
                    e.currentTarget.selectedIndex = 0;
                  }}
                  onBlur={registerDraftTaxonomyExtras}
                  className="box-border min-h-11 min-w-0 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] touch-manipulation"
                >
                  <option value="">Add from list…</option>
                  {categoriesNotOnDraft.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  id="admin-course-custom-category"
                  placeholder="Or type custom…"
                  aria-label="Add custom category"
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    const el = e.currentTarget;
                    addDraftCategory(el.value);
                    el.value = '';
                  }}
                  onBlur={registerDraftTaxonomyExtras}
                  className="box-border min-h-11 min-w-0 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                />
                <button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById('admin-course-custom-category');
                    if (el instanceof HTMLInputElement) {
                      addDraftCategory(el.value);
                      el.value = '';
                    }
                  }}
                  className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center rounded-lg border border-[var(--border-color)] px-3 text-sm font-bold text-[#616161] hover:bg-[var(--hover-bg)] app-dark:text-[var(--tone-100)] sm:w-auto sm:min-w-[5.25rem]"
                >
                  Add
                </button>
              </div>
            </div>
            <div
              id="admin-course-skills"
              aria-labelledby="admin-course-skills-label"
              className={`min-w-0 space-y-1.5 xl:col-span-6 ${showValidationHints && fieldErrors.courseSkills ? 'rounded-lg ring-2 ring-red-500/60 ring-offset-2 ring-offset-[var(--bg-secondary)]' : ''}`}
            >
              <span
                id="admin-course-skills-label"
                className="inline-flex min-h-6 items-center text-xs font-semibold leading-none text-[var(--text-secondary)]"
              >
                Skills
              </span>
              <div className="flex max-h-24 min-h-9 flex-wrap gap-1.5 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch] pr-0.5">
                {draft.skills.length === 0 ? (
                  <span
                    className={`text-xs ${
                      showValidationHints && fieldErrors.courseSkills
                        ? 'font-medium text-[#a1a2a2]'
                        : 'text-[var(--text-muted)]'
                    }`}
                  >
                    Add at least one skill.
                  </span>
                ) : (
                  draft.skills.map((sk) => (
                    <span
                      key={sk}
                      className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-2 py-1 text-xs font-medium text-[var(--text-primary)]"
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
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] sm:items-stretch">
                <select
                  key={`admin-skill-pick-${draft.skills.join('\u001f')}`}
                  aria-label="Add skill from list"
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    if (!v) return;
                    addDraftSkill(v);
                    e.currentTarget.selectedIndex = 0;
                  }}
                  onBlur={registerDraftTaxonomyExtras}
                  className="box-border min-h-11 min-w-0 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] touch-manipulation"
                >
                  <option value="">Add from list…</option>
                  {skillsNotOnDraft.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  id="admin-course-custom-skill"
                  placeholder="Or type custom…"
                  aria-label="Add custom skill"
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    const el = e.currentTarget;
                    addDraftSkill(el.value);
                    el.value = '';
                  }}
                  onBlur={registerDraftTaxonomyExtras}
                  className="box-border min-h-11 min-w-0 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                />
                <button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById('admin-course-custom-skill');
                    if (el instanceof HTMLInputElement) {
                      addDraftSkill(el.value);
                      el.value = '';
                    }
                  }}
                  className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center rounded-lg border border-[var(--border-color)] px-3 text-sm font-bold text-[#616161] hover:bg-[var(--hover-bg)] app-dark:text-[var(--tone-100)] sm:w-auto sm:min-w-[5.25rem]"
                >
                  Add
                </button>
              </div>
            </div>
            <div className="sm:col-span-2 xl:col-span-12">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12 lg:items-end lg:gap-x-4 lg:gap-y-2">
                <label className="flex min-w-0 flex-col gap-1 sm:col-span-1 lg:col-span-2">
                  <span className="text-xs font-semibold text-[var(--text-secondary)]">Duration label</span>
                  <input
                    value={draft.duration}
                    onChange={(e) => updateDraft({ duration: e.target.value })}
                    className="box-border w-full min-w-0 min-h-11 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex min-w-0 flex-col gap-1 sm:col-span-1 lg:col-span-2">
                  <span className="text-xs font-semibold text-[var(--text-secondary)]">Rating (0–5)</span>
                  <input
                    id="admin-course-rating"
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    value={draft.rating}
                    onChange={(e) => updateDraft({ rating: Number(e.target.value) })}
                    className={`box-border w-full min-w-0 min-h-11 rounded-lg border bg-[var(--bg-primary)] px-3 py-2 text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
                      showValidationHints && fieldErrors.courseRating
                        ? 'border-[#616161]'
                        : 'border-[var(--border-color)]'
                    }`}
                  />
                </label>
                <label className="flex min-w-0 flex-col gap-1 sm:col-span-2 lg:col-span-8">
                  <span className="text-xs font-semibold text-[var(--text-secondary)]">Thumbnail URL</span>
                  <input
                    id="admin-course-thumbnail"
                    value={draft.thumbnail}
                    onChange={(e) => updateDraft({ thumbnail: e.target.value })}
                    className={`w-full min-w-0 min-h-11 bg-[var(--bg-primary)] border rounded-lg px-3 py-2 text-sm font-mono ${
                      showValidationHints && fieldErrors.courseThumbnail
                        ? 'border-[#616161]'
                        : 'border-[var(--border-color)]'
                    }`}
                  />
                </label>
              </div>
            </div>
            <div className="sm:col-span-2 xl:col-span-12">
              <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/15">
                <button
                  type="button"
                  id="admin-course-description-bio-toggle"
                  onClick={() => setCourseDescriptionBioOpen((v) => !v)}
                  className="flex w-full min-w-0 items-center justify-between gap-2 px-3 py-2.5 text-left sm:px-4 sm:py-3"
                  aria-expanded={courseDescriptionBioOpen}
                  aria-controls="admin-course-description-bio-panel"
                >
                  <span className="min-w-0 truncate text-sm font-bold text-[var(--text-primary)]">
                    Description & author bio
                  </span>
                  <span className="flex shrink-0 items-center gap-2 sm:gap-3">
                    <span className="text-xs font-medium text-[var(--text-muted)]">Optional</span>
                    {courseDescriptionBioOpen ? (
                      <ChevronDown size={16} className="shrink-0 text-[var(--text-secondary)]" aria-hidden />
                    ) : (
                      <ChevronRight size={16} className="shrink-0 text-[var(--text-secondary)]" aria-hidden />
                    )}
                  </span>
                </button>
                {courseDescriptionBioOpen ? (
                  <div
                    id="admin-course-description-bio-panel"
                    role="region"
                    aria-labelledby="admin-course-description-bio-toggle"
                    className="border-t border-[var(--border-color)] px-3 pb-3 pt-2 sm:px-4 sm:pb-4 sm:pt-3"
                  >
                    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:items-stretch sm:gap-4">
                      <label className="flex h-full min-h-[14rem] min-w-0 flex-col gap-1 sm:min-h-[16rem]">
                        <span className="text-xs font-semibold text-[var(--text-secondary)]">Description</span>
                        <CatalogMiniRichEditor
                          id="admin-course-description"
                          value={draft.description}
                          onChange={(description) => updateDraft({ description })}
                          aria-label="Course description"
                          variant="multiline"
                          placeholder="Overview shown on the course page — you can paste formatted text (subscripts, bold, etc.)."
                          className="flex min-h-0 flex-1 flex-col"
                        />
                      </label>
                      <label className="flex h-full min-h-[14rem] min-w-0 flex-col gap-1 sm:min-h-[16rem]">
                        <span className="text-xs font-semibold text-[var(--text-secondary)]">Author bio (optional)</span>
                        <textarea
                          value={draft.authorBio ?? ''}
                          onChange={(e) => updateDraft({ authorBio: e.target.value || undefined })}
                          rows={8}
                          className="box-border min-h-0 w-full flex-1 resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm leading-relaxed"
                        />
                      </label>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
              </div>
            )}
          </div>

          <div className="space-y-0">
            <div className="relative z-20 mb-1 flex flex-wrap items-start gap-2 pb-0 sm:mb-1.5 sm:pb-0">
              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                <h3 className="text-xs font-semibold text-[var(--text-secondary)]">Modules and lessons</h3>
                <span ref={modulesTipsWrapRef} className="relative z-10 inline-flex shrink-0 items-center gap-1">
                  <button
                    ref={modulesTipBtnRef}
                    type="button"
                    onClick={() => setModulesTipsOpen((o) => !o)}
                    aria-expanded={modulesTipsOpen}
                    aria-controls="admin-modules-lessons-tips"
                    aria-label={modulesTipsOpen ? 'Close modules and lessons tips' : 'Open modules and lessons tips'}
                    className={`inline-flex size-6 shrink-0 touch-manipulation items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/45 active:opacity-90 ${
                      modulesTipsOpen ? 'border-[#8b8c8c]/90 text-[#616161] app-dark:border-[var(--tone-400)] app-dark:text-[var(--tone-100)]' : ''
                    }`}
                  >
                    <Info size={14} className="text-admin-icon opacity-90" aria-hidden />
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
                            ? 'fixed z-[120] left-3 right-3 w-auto max-w-none translate-x-0 overflow-y-auto overflow-x-hidden overscroll-y-contain [-webkit-overflow-scrolling:touch] touch-pan-y max-h-[calc(100dvh-var(--admin-tip-top)-env(safe-area-inset-bottom,0px)-0.75rem)] rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3.5 text-left text-sm leading-relaxed text-[var(--text-primary)] shadow-xl pointer-events-auto outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/45'
                            : 'hidden'
                          : 'absolute left-0 top-full z-[100] mt-2 w-[min(22rem,calc(100vw-2rem))] max-w-sm rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-left text-xs leading-snug text-[var(--text-primary)] shadow-lg pointer-events-auto'
                    }
                    style={
                      modulesTipsOpen && tipsNarrowViewport && modulesTipFixedTop >= 0
                        ? narrowAdminTipPanelStyle(modulesTipFixedTop)
                        : undefined
                    }
                  >
                    <ul className="list-disc space-y-1.5 pl-4 text-[var(--text-muted)] marker:text-[#757676]/90 app-dark:marker:text-[var(--tone-300)] sm:space-y-1">
                      <li>Modules group lessons.</li>
                      <li>
                        <strong className="font-semibold text-[var(--text-secondary)]">Add module here</strong> before the
                        first module and between modules. On desktop, when the course already has modules, hover or focus
                        the gap between module cards to reveal the control.
                      </li>
                      <li>
                        <strong className="font-semibold text-[var(--text-secondary)]">Add branch here</strong> at the start
                        and between rows (on desktop, hover or focus the gap between rows to reveal the control when the
                        module has lessons) — then pick <strong className="font-semibold text-[var(--text-secondary)]">Lesson</strong> or{' '}
                        <strong className="font-semibold text-[var(--text-secondary)]">Section divider</strong> (heading
                        only in the outline, not playable).
                      </li>
                      <li>Reorder: row ↑/↓, or Arrow keys when a reorder control is focused.</li>
                      <li>
                        <strong className="font-semibold text-[var(--text-secondary)]">Copy</strong> on a lesson or
                        module opens <strong className="font-semibold text-[var(--text-secondary)]">Copy or move</strong>{' '}
                        — duplicate anywhere or move to another module and position (source module must keep at least one
                        playable lesson when you move).
                      </li>
                      <li>
                        <strong className="font-semibold text-[var(--text-secondary)]">Change module type</strong> (sliders
                        next to Module, needs at least two modules): pick another module and where to insert — after a
                        section divider, at the start, or at the end — then this module becomes a divider plus its lessons
                        in that spot (same outline effect as changing a lesson to a divider).
                      </li>
                      <li>
                        Structured ids (<code className="text-[#616161] app-dark:text-[var(--tone-200)]">C1</code>…): playable lessons use{' '}
                        <code className="text-[#616161] app-dark:text-[var(--tone-200)]">…M1L1</code>, section dividers use{' '}
                        <code className="text-[#616161] app-dark:text-[var(--tone-200)]">…M1D1</code> (not L). Ids renumber when you reorder.
                      </li>
                    </ul>
                  </div>
                </span>
              </div>
            </div>

            <CatalogModuleInsertSlot
              persistVisibleOnMd={draft.modules.length === 0}
              ariaLabel="Add module here before the first module"
              onClick={() => addModuleAt(0)}
            />

            {draft.modules.map((mod, mi) => {
              const toggleThisModuleRow = () => {
                const wasOpen = !!openModules[mi];
                toggleModuleOpen(mi);
                if (!wasOpen) {
                  requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                      focusCatalogMiniRichById(`admin-module-title-${mi}`, {
                        preventScroll: false,
                      });
                    });
                  });
                }
              };
              return (
              <Fragment key={`module-slot-${mi}`}>
              <div
                data-admin-module-index={mi}
                className="space-y-0 pb-0 pt-0"
              >
                <div
                  className={`flex flex-col items-stretch gap-1.5 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-x-2 md:gap-y-1 ${
                    openModules[mi] ? 'pb-0' : ''
                  }`}
                >
                  <div className="flex min-h-11 w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center md:min-h-10 md:flex-1 md:gap-2">
                    <div className="flex min-h-11 min-w-0 w-full flex-1 flex-col gap-0.5 md:min-h-10">
                      <div className="flex min-w-0 w-full flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-0.5">
                        <div className="flex min-w-0 shrink-0 items-center gap-x-1.5 sm:contents">
                        <button
                          type="button"
                          className={`${ADMIN_CATALOG_MODULE_BADGE_CLASS} items-center gap-1`}
                          title={openModules[mi] ? 'Collapse module lessons' : 'Expand module lessons'}
                          aria-expanded={!!openModules[mi]}
                          aria-label={`${openModules[mi] ? 'Collapse' : 'Expand'} module ${mi + 1} (${mod.id.trim() || 'no id'}) lessons`}
                          onClick={toggleThisModuleRow}
                        >
                          Module
                          {openModules[mi] ? (
                            <ChevronDown size={14} className="shrink-0 opacity-90" aria-hidden />
                          ) : (
                            <ChevronRight size={14} className="shrink-0 opacity-90" aria-hidden />
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={!draft || draft.modules.length < 2}
                          onClick={() => {
                            const d = draftRef.current;
                            if (!d || d.modules.length < 2) return;
                            const defaultTarget = d.modules.findIndex((_, i) => i !== mi);
                            if (defaultTarget < 0) return;
                            const len = d.modules[defaultTarget]?.lessons.length ?? 0;
                            /** Show full outline (every module + divider subsections) before merge / “Place divider…” options. */
                            setOpenModules(() => {
                              const next: Record<number, boolean> = {};
                              d.modules.forEach((_, i) => {
                                next[i] = true;
                              });
                              return next;
                            });
                            setDividerSectionsCollapsed({});
                            setChangeModuleKindModal({ sourceMi: mi, targetMi: defaultTarget, insertAt: len });
                          }}
                          className="inline-flex min-h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/40 disabled:pointer-events-none disabled:opacity-30 md:min-h-9 md:min-w-9"
                          title={
                            !draft || draft.modules.length < 2
                              ? 'Add another module first — then you can merge this one into it as a section divider.'
                              : 'Change module — merge as section divider into another module (pick target and position)'
                          }
                          aria-label="Change module type"
                        >
                          <SlidersHorizontal size={18} aria-hidden />
                        </button>
                        <span
                          id={`admin-module-id-${mi}`}
                          tabIndex={-1}
                          className={`shrink-0 rounded-md px-1.5 py-1 font-mono text-sm font-semibold tabular-nums text-[#616161] app-dark:text-[var(--tone-200)] outline-none sm:px-2 ${
                            showValidationHints && fieldErrors.moduleId.has(mi)
                              ? 'ring-2 ring-red-500 ring-offset-1 ring-offset-[var(--bg-secondary)]'
                              : ''
                          }`}
                          aria-label="Module ID (assigned automatically)"
                        >
                          {mod.id.trim() || '—'}
                        </span>
                        <span className="shrink-0 text-[var(--text-muted)]" aria-hidden>
                          -
                        </span>
                        </div>
                        <div className="min-w-0 w-full sm:flex-1 sm:min-w-0">
                          <CatalogMiniRichEditor
                            id={`admin-module-title-${mi}`}
                            value={mod.title}
                            onChange={(title) => updateModule(mi, { title })}
                            aria-label="Module title"
                            variant="title"
                            error={showValidationHints && fieldErrors.moduleTitle.has(mi)}
                            placeholder="e.g. HTML & CSS fundamentals — section title in the syllabus"
                          />
                        </div>
                        <span className="hidden shrink-0 text-[10px] font-medium leading-none tabular-nums text-[var(--text-muted)] md:inline md:text-[11px]">
                          {mod.lessons.length}{' '}
                          {mod.lessons.length === 1 ? 'lesson' : 'lessons'}
                          <span aria-hidden> · </span>
                          {mi + 1} of {draft.modules.length} in course
                        </span>
                      </div>
                      <p className="text-[10px] font-medium leading-tight tabular-nums text-[var(--text-muted)] md:hidden">
                        {mod.lessons.length}{' '}
                        {mod.lessons.length === 1 ? 'lesson' : 'lessons'}
                        <span aria-hidden> · </span>
                        {mi + 1} of {draft.modules.length} in course
                      </p>
                      {(showValidationHints &&
                        (fieldErrors.moduleId.has(mi) || fieldErrors.moduleTitle.has(mi))) && (
                        <div className="space-y-0.5 text-[10px]">
                          {fieldErrors.moduleId.has(mi) && (
                            <p className="text-[#a1a2a2]">Module ID is required.</p>
                          )}
                          {fieldErrors.moduleTitle.has(mi) && (
                            <p className="text-[#a1a2a2]">
                              {catalogMiniRichIsEffectivelyEmpty(mod.title)
                                ? 'Module title is required.'
                                : 'Module title must be unique in this course.'}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex w-full shrink-0 flex-wrap items-center justify-start gap-0.5 border-t border-[var(--border-color)]/50 pt-2 sm:gap-1 md:w-auto md:justify-end md:border-t-0 md:pt-0">
                    <button
                      type="button"
                      disabled={busy || !draft || (baselineJson !== null && !isDirty)}
                      onClick={() => void handleSave()}
                      aria-busy={busy}
                      aria-label={busy ? 'Saving course…' : 'Save course to catalog'}
                      title={busy ? 'Saving…' : 'Save course to catalog'}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-admin-icon hover:bg-[#616161]/10 app-dark:hover:bg-[var(--tone-800)] disabled:opacity-40 md:min-h-9 md:min-w-9"
                    >
                      {busy ? (
                        <Loader2 size={18} className="shrink-0 animate-spin" aria-hidden />
                      ) : (
                        <Save size={18} aria-hidden />
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={
                        busy ||
                        !baselineCourseSnapshot ||
                        !baselineCourseSnapshot.modules[mi]
                      }
                      onClick={() => resetModuleFromBaseline(mi)}
                      aria-label={`Reset module ${mi + 1} to last saved`}
                      title="Reset this module to last saved"
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-30 md:min-h-9 md:min-w-9"
                    >
                      <RotateCcw size={18} aria-hidden />
                    </button>
                    <button
                      type="button"
                      disabled={busy || !draft}
                      onClick={() => openCatalogPlaceForModule(mi)}
                      aria-label={`Copy or move module ${mi + 1}`}
                      title="Copy or move module — choose destination in the dialog"
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-30 md:min-h-9 md:min-w-9"
                    >
                      <Copy size={18} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeModule(mi)}
                      disabled={draft.modules.length <= 1}
                      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-[#a1a2a2] hover:bg-[#757676]/12 disabled:opacity-30 md:min-h-9 md:min-w-9"
                      aria-label="Remove module"
                      title="Remove module"
                    >
                      <Trash2 size={18} aria-hidden />
                    </button>
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
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-30 md:min-h-9 md:min-w-9"
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
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-30 md:min-h-9 md:min-w-9"
                      aria-label="Move module down"
                    >
                      <ArrowDown size={18} aria-hidden />
                    </button>
                  </div>
                </div>

                {openModules[mi] && (
                <>
                <div className="space-y-0 border-l border-[var(--border-color)]/50 pl-2 sm:pl-3">
                  <CatalogLessonInsertSlot
                    persistVisibleOnMd={mod.lessons.length === 0}
                    ariaLabel="Add branch here before the first row in this module"
                    onClick={() => setAddLessonBranchModal({ mi, insertAt: 0 })}
                  />
                  <div>
                  {mod.lessons.map((lesson, li) => {
                    const lessonRowKey = lessonRowDomKey(lesson, mi, li);
                    if (lessonRowHiddenUnderCollapsedDivider(mod, mi, li, dividerSectionsCollapsed)) {
                      return <Fragment key={lessonRowKey} />;
                    }
                    return (
                    <Fragment key={lessonRowKey}>
                    <div
                      data-admin-lesson-row={lessonRowKey}
                      data-lesson-mi={mi}
                      data-lesson-li={li}
                      className={`space-y-1.5 py-0 sm:space-y-2${
                        lessonRowInSectionUnderDivider(mod, li)
                          ? ` ${CATALOG_LESSON_SECTION_UNDER_DIVIDER_INDENT}`
                          : ''
                      }`}
                    >
                      <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
                        {lesson.contentKind === 'divider' ? (
                          <div
                            className="flex min-h-11 min-w-0 w-full flex-1 flex-col gap-1.5 rounded-lg py-0 -mx-0.5 px-0.5 sm:flex-row sm:items-center md:min-h-10 sm:gap-2 sm:py-0.5 sm:-mx-1 sm:px-1"
                            role="group"
                            aria-label="Section divider row"
                          >
                            <div className="flex shrink-0 items-center gap-1.5 sm:contents">
                            <button
                              type="button"
                              onClick={() => toggleDividerSection(mi, li)}
                              className={`${ADMIN_CATALOG_BRANCH_KIND_BADGE_CLASS} items-center gap-1`}
                              aria-expanded={!dividerSectionsCollapsed[`${mi}:${li}`]}
                              title={
                                dividerSectionsCollapsed[`${mi}:${li}`]
                                  ? 'Show lessons under this divider'
                                  : 'Hide lessons under this divider'
                              }
                              aria-label={`${
                                dividerSectionsCollapsed[`${mi}:${li}`] ? 'Show' : 'Hide'
                              } lessons under section divider ${li + 1}`}
                            >
                              Divider
                              {!dividerSectionsCollapsed[`${mi}:${li}`] ? (
                                <ChevronDown size={14} className="shrink-0 opacity-90" aria-hidden />
                              ) : (
                                <ChevronRight size={14} className="shrink-0 opacity-90" aria-hidden />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => setChangeLessonKindModal({ mi, li })}
                              className="inline-flex min-h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/40 md:min-h-9 md:min-w-9"
                              title="Change branch type (video, external page, or quiz)"
                              aria-label="Change branch type"
                            >
                              <SlidersHorizontal size={18} aria-hidden />
                            </button>
                            </div>
                            <div className="min-w-0 flex-1">
                              <CatalogMiniRichEditor
                                id={`admin-lesson-title-${mi}-${li}`}
                                value={lesson.title}
                                onChange={(title) => updateLesson(mi, li, { title })}
                                aria-label="Divider label"
                                variant="title"
                                error={showValidationHints && fieldErrors.lessonTitle.has(`${mi}:${li}`)}
                                placeholder="e.g. Part 2 — shown as a heading in the syllabus"
                              />
                            </div>
                          </div>
                        ) : (
                        <div className="flex min-h-11 min-w-0 w-full flex-1 flex-col gap-0.5 md:min-h-10">
                          <div className="flex min-w-0 w-full flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-0.5">
                            <div className="flex min-w-0 shrink-0 items-center gap-x-1.5 sm:contents">
                              <button
                                type="button"
                                onClick={() => toggleLessonOpen(mi, li)}
                                className={`${ADMIN_CATALOG_LESSON_BADGE_CLASS} items-center gap-1`}
                                title={
                                  openLessons[`${mi}:${li}`]
                                    ? 'Collapse lesson details'
                                    : 'Expand lesson details'
                                }
                                aria-expanded={!!openLessons[`${mi}:${li}`]}
                                aria-label={`${openLessons[`${mi}:${li}`] ? 'Collapse' : 'Expand'} lesson ${li + 1} (${lesson.id.trim() || 'no id'}) details`}
                              >
                                Lesson
                                {openLessons[`${mi}:${li}`] ? (
                                  <ChevronDown size={14} className="shrink-0 opacity-90" aria-hidden />
                                ) : (
                                  <ChevronRight size={14} className="shrink-0 opacity-90" aria-hidden />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => setChangeLessonKindModal({ mi, li })}
                                className="inline-flex min-h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/40 md:min-h-9 md:min-w-9"
                                title="Change branch type (video, external page, or quiz)"
                                aria-label={`Change branch type, now ${catalogLessonBranchKindModalLabel(lesson)}`}
                              >
                                <SlidersHorizontal size={18} aria-hidden />
                              </button>
                              <span
                                id={`admin-lesson-id-${mi}-${li}`}
                                tabIndex={-1}
                                className={`shrink-0 rounded-md px-1.5 py-1 font-mono text-sm font-semibold tabular-nums text-[#616161] app-dark:text-[var(--tone-200)] outline-none sm:px-2 ${
                                  showValidationHints && fieldErrors.lessonId.has(`${mi}:${li}`)
                                    ? 'ring-2 ring-red-500 ring-offset-1 ring-offset-[var(--bg-secondary)]'
                                    : ''
                                }`}
                                aria-label="Lesson ID (assigned automatically)"
                              >
                                {lesson.id.trim() || '—'}
                              </span>
                              <span className="shrink-0 text-[var(--text-muted)]" aria-hidden>
                                -
                              </span>
                            </div>
                            <div className="min-w-0 w-full sm:flex-1 sm:min-w-0">
                              <CatalogMiniRichEditor
                                id={`admin-lesson-title-${mi}-${li}`}
                                value={lesson.title}
                                onChange={(title) => updateLesson(mi, li, { title })}
                                aria-label="Lesson title"
                                variant="title"
                                error={showValidationHints && fieldErrors.lessonTitle.has(`${mi}:${li}`)}
                                placeholder="e.g. Semantic HTML & page structure — lesson name under the module"
                              />
                            </div>
                          </div>
                          {showValidationHints &&
                            (fieldErrors.lessonId.has(`${mi}:${li}`) ||
                              fieldErrors.lessonTitle.has(`${mi}:${li}`)) && (
                              <div className="space-y-0.5 text-[10px]">
                                {fieldErrors.lessonId.has(`${mi}:${li}`) && (
                                  <p className="text-[#a1a2a2]">Lesson ID is required.</p>
                                )}
                                {fieldErrors.lessonTitle.has(`${mi}:${li}`) && (
                                  <p className="text-[#a1a2a2]">
                                    {catalogMiniRichIsEffectivelyEmpty(lesson.title)
                                      ? 'Lesson title is required.'
                                      : 'Lesson title must be unique in this course.'}
                                  </p>
                                )}
                              </div>
                            )}
                        </div>
                        )}
                        <div className="flex w-full shrink-0 flex-row flex-wrap items-center justify-start gap-0.5 border-t border-[var(--border-color)]/50 pt-2 sm:justify-end sm:gap-0.5 md:w-auto md:border-t-0 md:pt-0">
                          <button
                            type="button"
                            disabled={busy || !draft || (baselineJson !== null && !isDirty)}
                            onClick={() => void handleSave()}
                            aria-busy={busy}
                            aria-label={busy ? 'Saving course…' : 'Save course to catalog'}
                            title={busy ? 'Saving…' : 'Save course to catalog'}
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-admin-icon hover:bg-[#616161]/10 app-dark:hover:bg-[var(--tone-800)] disabled:opacity-40 md:min-h-9 md:min-w-9"
                          >
                            {busy ? (
                              <Loader2 size={18} className="shrink-0 animate-spin" aria-hidden />
                            ) : (
                              <Save size={18} aria-hidden />
                            )}
                          </button>
                          <button
                            type="button"
                            disabled={
                              busy ||
                              !baselineCourseSnapshot?.modules[mi]?.lessons[li]
                            }
                            onClick={() => resetLessonFromBaseline(mi, li)}
                            aria-label={`Reset lesson ${li + 1} in module ${mi + 1} to last saved`}
                            title="Reset this lesson to last saved"
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]/40 disabled:opacity-30 md:min-h-9 md:min-w-9"
                          >
                            <RotateCcw size={18} aria-hidden />
                          </button>
                          <button
                            type="button"
                            disabled={busy || !draft}
                            onClick={() => openCatalogPlaceForLesson(mi, li)}
                            aria-label={
                              lesson.contentKind === 'divider'
                                ? 'Copy or move divider'
                                : `Copy or move lesson ${li + 1}`
                            }
                            title="Copy or move branch — choose destination in the dialog"
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]/40 disabled:opacity-30 md:min-h-9 md:min-w-9"
                          >
                            <Copy size={18} aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeLesson(mi, li)}
                            disabled={
                              mod.lessons.length <= 1 ||
                              !mod.lessons
                                .filter((_, j) => j !== li)
                                .some(isPlayableCatalogLesson)
                            }
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[#a1a2a2] hover:bg-[#757676]/12 disabled:opacity-30 md:min-h-9 md:min-w-9"
                            aria-label="Remove lesson"
                            title="Remove lesson"
                          >
                            <Trash2 size={18} aria-hidden />
                          </button>
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
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]/40 disabled:opacity-30 md:min-h-9 md:min-w-9"
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
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]/40 disabled:opacity-30 md:min-h-9 md:min-w-9"
                            aria-label="Move lesson down"
                          >
                            <ArrowDown size={18} aria-hidden />
                          </button>
                        </div>
                      </div>
                      {(lesson.contentKind === 'divider'
                        ? !dividerSectionsCollapsed[`${mi}:${li}`]
                        : !!openLessons[`${mi}:${li}`]) && (
                        <>
                      {lesson.contentKind === 'divider' &&
                      showValidationHints &&
                      (catalogMiniRichIsEffectivelyEmpty(lesson.title) ||
                        fieldErrors.lessonTitle.has(`${mi}:${li}`)) ? (
                        <div className="w-full min-w-0 pb-1">
                          <span className="block text-[11px] text-[#a1a2a2]">
                            {catalogMiniRichIsEffectivelyEmpty(lesson.title)
                              ? 'Divider label is required.'
                              : 'This label must be unique in this course.'}
                          </span>
                        </div>
                      ) : null}
                      {lesson.contentKind !== 'divider' ? (
                      <div className="min-w-0 lg:flex lg:items-start lg:gap-4 xl:gap-6">
                        <div className="min-w-0 flex-1 space-y-1.5 sm:space-y-2">
                      <div className="space-y-1 border-t border-[var(--border-color)]/60 pt-1.5 sm:space-y-1.5 sm:pt-2">
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
                              className="h-4 w-4 shrink-0 border-[var(--border-color)] text-admin-icon"
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
                                  videoOutlineNotes: undefined,
                                })
                              }
                              className="h-4 w-4 shrink-0 border-[var(--border-color)] text-admin-icon"
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
                                  videoOutlineNotes: undefined,
                                  quiz: {
                                    questions:
                                      lesson.quiz?.questions?.length && lesson.contentKind === 'quiz'
                                        ? lesson.quiz.questions
                                        : [createDefaultMcqQuestion()],
                                  },
                                })
                              }
                              className="h-4 w-4 shrink-0 border-[var(--border-color)] text-admin-icon"
                            />
                            Quiz
                          </label>
                          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-primary)] sm:gap-2 sm:text-sm">
                            <input
                              type="radio"
                              name={`admin-lesson-kind-${mi}-${li}`}
                              checked={false}
                              onChange={() =>
                                updateLesson(mi, li, {
                                  contentKind: 'divider',
                                  webUrl: undefined,
                                  quiz: undefined,
                                  videoUrl: '',
                                  videoOutlineNotes: undefined,
                                })
                              }
                              className="h-4 w-4 shrink-0 border-[var(--border-color)] text-admin-icon"
                            />
                            Section divider
                          </label>
                        </div>
                        <p className="text-[11px] leading-snug text-[var(--text-muted)]">
                          Video uses the embedded player. External page opens in a new tab. Quiz: multiple-choice and
                          open-ended questions with AI grading in the player. Use <strong className="font-semibold text-[var(--text-secondary)]">Section divider</strong> for a non-playable heading in the outline.
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
                                ? 'border-[#616161]'
                                : 'border-[var(--border-color)]'
                            }`}
                            placeholder="https://example.com/article or example.com/path"
                          />
                          <span
                            className={`min-h-[16px] text-[11px] ${
                              showValidationHints && fieldErrors.lessonWebUrl.has(`${mi}:${li}`)
                                ? 'text-[#a1a2a2]'
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
                              ? 'border-[#616161]'
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
                                className="text-xs font-bold text-[#616161] hover:text-[#4c4d4d] app-dark:text-[var(--tone-100)] app-dark:hover:text-[#e7e7e7] disabled:opacity-40"
                              >
                                + Multiple choice
                              </button>
                              <button
                                type="button"
                                onClick={() => addQuizQuestion(mi, li, 'freeform')}
                                disabled={(lesson.quiz?.questions.length ?? 0) >= MAX_QUIZ_QUESTIONS}
                                className="text-xs font-bold text-[#616161] hover:text-[#4c4d4d] app-dark:text-[var(--tone-100)] app-dark:hover:text-[#e7e7e7] disabled:opacity-40"
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
                                    className="ml-1 text-xs font-semibold text-[#a1a2a2] hover:underline disabled:opacity-30"
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
                                    className="h-3.5 w-3.5 text-admin-icon"
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
                                    className="h-3.5 w-3.5 text-admin-icon"
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
                                        className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-1.5 rounded-lg border border-[#8b8c8c]/80 bg-[#616161]/10 px-3 py-2.5 text-xs font-bold text-[#393a3a] transition-colors hover:bg-[#616161]/15 disabled:opacity-50 sm:w-auto app-dark:text-[#cfcfcf]"
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
                                        className="h-4 w-4 shrink-0 text-admin-icon"
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
                                        className="text-xs text-[#a1a2a2] hover:underline disabled:opacity-30"
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
                                    className="text-xs font-bold text-[#616161] hover:text-[#4c4d4d] app-dark:text-[var(--tone-100)] app-dark:hover:text-[#e7e7e7] disabled:opacity-40"
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
                        <div className="grid min-w-0 w-full grid-cols-1 gap-2 sm:grid-cols-[minmax(0,4fr)_minmax(0,1fr)] sm:items-end sm:gap-x-2 sm:gap-y-0">
                          <label className="flex min-w-0 flex-col gap-0.5">
                            <span className="text-xs font-semibold text-[var(--text-secondary)]">Video URL</span>
                            <input
                              id={`admin-lesson-url-${mi}-${li}`}
                              value={lesson.videoUrl}
                              onChange={(e) => updateLesson(mi, li, { videoUrl: e.target.value })}
                              className={`min-w-0 w-full rounded-lg border bg-[var(--bg-primary)] px-2 py-1.5 font-mono text-sm sm:px-2.5 sm:py-1.5 ${
                                showValidationHints && fieldErrors.videoUrl.has(`${mi}:${li}`)
                                  ? 'border-[#616161]'
                                  : 'border-[var(--border-color)]'
                              }`}
                              placeholder="https://www.youtube.com/watch?v=…"
                            />
                            <span
                              className={`min-h-[14px] text-[10px] leading-snug sm:min-h-[16px] sm:text-[11px] ${
                                showValidationHints && fieldErrors.videoUrl.has(`${mi}:${li}`)
                                  ? 'text-[#a1a2a2]'
                                  : 'text-transparent'
                              }`}
                            >
                              URL required (http…).
                            </span>
                          </label>
                          <label className="flex min-w-0 flex-col gap-0.5">
                            <span className="text-xs font-semibold text-[var(--text-secondary)]">Duration (opt.)</span>
                            <input
                              value={lesson.duration ?? ''}
                              onChange={(e) => updateLesson(mi, li, { duration: e.target.value || undefined })}
                              className="min-w-0 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm sm:px-2.5 sm:py-1.5"
                              placeholder="e.g. 12 min"
                              aria-label="Duration label shown next to lesson title"
                            />
                          </label>
                        </div>
                      )}
                      <>
                      {(lesson.contentKind === 'web' || lesson.contentKind === 'quiz') && (
                        <label className="block space-y-1">
                          <span className="text-xs font-semibold text-[var(--text-secondary)]">Duration (opt.)</span>
                          <input
                            value={lesson.duration ?? ''}
                            onChange={(e) => updateLesson(mi, li, { duration: e.target.value || undefined })}
                            className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-sm sm:px-3 sm:py-2"
                            placeholder="e.g. 12 min — next to lesson title"
                            aria-label="Duration label shown next to lesson title"
                          />
                        </label>
                      )}
                      <label className="block space-y-1">
                        <span className="text-xs font-semibold text-[var(--text-secondary)]">About (optional)</span>
                        <CatalogMiniRichEditor
                          id={`admin-lesson-about-${mi}-${li}`}
                          value={lesson.about ?? ''}
                          onChange={(about) => updateLesson(mi, li, { about: about || undefined })}
                          aria-label="About this lesson (optional)"
                          variant="multiline"
                          placeholder="Short description under the player — paste from Word or the web keeps subscripts and basic formatting."
                        />
                      </label>
                      <AdminVideoOutlineNotesField
                        textareaId={`admin-lesson-outline-${mi}-${li}`}
                        value={lesson.videoOutlineNotes ?? ''}
                        onChange={(v) => updateLesson(mi, li, { videoOutlineNotes: v || undefined })}
                      />
                      </>
                        </div>
                        <aside className="mt-4 w-full shrink-0 border-t border-[var(--border-color)]/60 pt-4 sm:mt-5 sm:pt-5 lg:sticky lg:top-3 lg:mt-0 lg:w-[min(17rem,32vw)] lg:max-w-[300px] lg:border-t-0 lg:border-l lg:border-[var(--border-color)]/60 lg:pt-0 lg:pl-4 xl:top-4">
                          <AdminLessonContentPreview lesson={lesson} />
                        </aside>
                      </div>
                      ) : null}
                        </>
                      )}
                    </div>
                    {li < mod.lessons.length - 1 && (
                      <div
                        className={
                          lessonInsertSlotInSectionUnderDivider(mod, li + 1)
                            ? CATALOG_LESSON_SECTION_UNDER_DIVIDER_INDENT
                            : undefined
                        }
                      >
                        <CatalogLessonInsertSlot
                          persistVisibleOnMd={false}
                          ariaLabel={`Add branch here after row ${li + 1} in this module`}
                          onClick={() => setAddLessonBranchModal({ mi, insertAt: li + 1 })}
                        />
                      </div>
                    )}
                    </Fragment>
                  );
                  })}
                  {mod.lessons.length > 0 && (
                    <CatalogLessonModuleBoundaryInsertRow
                      persistVisibleOnMd={false}
                      onAddBranch={() => setAddLessonBranchModal({ mi, insertAt: mod.lessons.length })}
                      onAddModule={() => addModuleAt(mi + 1)}
                      branchAriaLabel={`Add branch here after row ${mod.lessons.length} in this module`}
                      moduleAriaLabel={`Add module here after module ${mi + 1}`}
                    />
                  )}
                  </div>
                </div>
                </>
                )}
              </div>
              {(!openModules[mi] || mod.lessons.length === 0) && (
                <CatalogModuleInsertSlot
                  persistVisibleOnMd={false}
                  ariaLabel={`Add module here after module ${mi + 1}`}
                  onClick={() => addModuleAt(mi + 1)}
                />
              )}
              </Fragment>
            );
            })}
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
          isCreatorCatalog={isCreatorCatalog}
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
          onRefreshPublishedList={async () => {
            await refreshList();
          }}
          onCatalogChanged={onCatalogChanged}
          onPathsDirtyChange={setPathBuilderDirty}
          onPathsLoadingChange={setPathsListLoading}
          pathPersistence={catalogPersistence}
        />
      </div>

      <AnimatePresence>
        {pathSubTabSwitchConfirmOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#272828]/70"
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
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#616161] px-5 py-3 text-sm font-bold text-[#e7e7e7] transition-colors hover:bg-[#757676] sm:w-auto"
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
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#272828]/70"
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
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#616161] px-5 py-3 text-sm font-bold text-[#e7e7e7] transition-colors hover:bg-[#757676] sm:w-auto"
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
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#272828]/70"
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
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#616161] px-5 py-3 text-sm font-bold text-[#e7e7e7] transition-colors hover:bg-[#757676] sm:w-auto"
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
        {changeLessonKindModal && draft && (
          <div
            className="fixed inset-0 z-[102] flex items-end justify-center bg-[#272828]/70 p-0 sm:items-center sm:p-4"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeChangeLessonKindModal();
            }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-lesson-change-kind-title"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="flex max-h-[min(90dvh,640px)] w-full max-w-lg flex-col rounded-t-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl sm:max-h-[min(85dvh,560px)] sm:rounded-2xl"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
                <span className="w-10 shrink-0" aria-hidden />
                <h2
                  id="admin-lesson-change-kind-title"
                  className="min-w-0 flex-1 text-center text-base font-bold text-[var(--text-primary)] sm:text-lg"
                >
                  Change branch type
                </h2>
                <button
                  type="button"
                  className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]"
                  onClick={closeChangeLessonKindModal}
                >
                  Cancel
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
                <p className="mb-3 text-xs leading-relaxed text-[var(--text-muted)]">
                  {draft.modules[changeLessonKindModal.mi]?.lessons[changeLessonKindModal.li]?.contentKind ===
                  'divider' ? (
                    <>
                      Turn this section into its own module (same as the row’s{' '}
                      <span className="font-semibold text-[var(--text-secondary)]">Divider</span> control) — you’ll pick
                      where the new module sits in the course — or switch this row to a playable type below. On structured
                      courses, ids renumber after you change type.
                    </>
                  ) : (
                    <>
                      Pick a new type for this row. On structured courses, lesson and divider ids renumber after you
                      change type.
                    </>
                  )}
                </p>
                <div className="flex flex-col gap-3">
                  {draft.modules[changeLessonKindModal.mi]?.lessons[changeLessonKindModal.li]?.contentKind ===
                    'divider' && (
                    <button
                      type="button"
                      className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-[#8b8c8c]/80 hover:bg-[var(--hover-bg)]"
                      onClick={() => {
                        const { mi: m, li: l } = changeLessonKindModal;
                        closeChangeLessonKindModal();
                        openSplitDividerNewModuleModal(m, l);
                      }}
                    >
                      <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                        <Layers size={20} className="shrink-0 text-[#616161] app-dark:text-[#a1a2a2]" aria-hidden />
                        New module from this section
                        <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">Own module</span>
                      </span>
                      <span className="pl-8 text-xs text-[var(--text-muted)]">
                        Next, choose where the new module appears. Divider label becomes the module title; lessons under
                        this divider until the next divider (or end of module) move into it; the rest of this module
                        stays here.
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-[#8b8c8c]/80 hover:bg-[var(--hover-bg)]"
                    onClick={() => {
                      const { mi: m, li: l } = changeLessonKindModal;
                      const cur = draftRef.current?.modules[m]?.lessons[l];
                      updateLesson(m, l, {
                        contentKind: undefined,
                        webUrl: undefined,
                        quiz: undefined,
                        videoUrl: cur?.videoUrl?.trim()
                          ? cur.videoUrl
                          : 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
                      });
                      closeChangeLessonKindModal();
                    }}
                  >
                    <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                      <Video size={20} className="shrink-0 text-admin-icon" aria-hidden />
                      Video
                      <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">Embedded player</span>
                    </span>
                    <span className="pl-8 text-xs text-[var(--text-muted)]">
                      YouTube or other URL in the lesson editor after you switch.
                    </span>
                  </button>
                  <button
                    type="button"
                    className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-[#8b8c8c]/80 hover:bg-[var(--hover-bg)]"
                    onClick={() => {
                      const { mi: m, li: l } = changeLessonKindModal;
                      const cur = draftRef.current?.modules[m]?.lessons[l];
                      updateLesson(m, l, {
                        contentKind: 'web',
                        webUrl: cur?.webUrl ?? '',
                        videoUrl: '',
                        quiz: undefined,
                        videoOutlineNotes: undefined,
                      });
                      closeChangeLessonKindModal();
                    }}
                  >
                    <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                      <Globe size={20} className="shrink-0 text-admin-icon" aria-hidden />
                      External page
                      <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">New tab</span>
                    </span>
                    <span className="pl-8 text-xs text-[var(--text-muted)]">
                      Blog post, article, or any page — learners open it from the player.
                    </span>
                  </button>
                  <button
                    type="button"
                    className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-[#8b8c8c]/80 hover:bg-[var(--hover-bg)]"
                    onClick={() => {
                      const { mi: m, li: l } = changeLessonKindModal;
                      const cur = draftRef.current?.modules[m]?.lessons[l];
                      updateLesson(m, l, {
                        contentKind: 'quiz',
                        webUrl: undefined,
                        videoUrl: '',
                        videoOutlineNotes: undefined,
                        quiz: {
                          questions:
                            cur?.quiz?.questions?.length && cur.contentKind === 'quiz'
                              ? cur.quiz.questions
                              : [createDefaultMcqQuestion()],
                        },
                      });
                      closeChangeLessonKindModal();
                    }}
                  >
                    <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                      <ClipboardList size={20} className="shrink-0 text-admin-icon" aria-hidden />
                      Quiz
                      <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">In-player</span>
                    </span>
                    <span className="pl-8 text-xs text-[var(--text-muted)]">
                      Multiple-choice and open-ended questions with AI grading in the player.
                    </span>
                  </button>
                  {(() => {
                    const row = draft.modules[changeLessonKindModal.mi]?.lessons[changeLessonKindModal.li];
                    if (!row || row.contentKind === 'divider') return null;
                    return (
                      <button
                        type="button"
                        className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-[#8b8c8c]/80 hover:bg-[var(--hover-bg)]"
                        onClick={() => {
                          const { mi: m, li: l } = changeLessonKindModal;
                          updateLesson(m, l, {
                            contentKind: 'divider',
                            webUrl: undefined,
                            quiz: undefined,
                            videoUrl: '',
                            videoOutlineNotes: undefined,
                          });
                          closeChangeLessonKindModal();
                        }}
                      >
                        <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                          <Minus size={20} className="shrink-0 text-[#616161] app-dark:text-[#a1a2a2]" aria-hidden />
                          Section divider
                          <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">Heading only</span>
                        </span>
                        <span className="pl-8 text-xs text-[var(--text-muted)]">
                          Non-playable subheading in the course outline and player sidebar.
                        </span>
                      </button>
                    );
                  })()}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {splitDividerNewModuleModal != null && draft && (
          <div
            className="fixed inset-0 z-[102] flex items-end justify-center bg-[#272828]/70 p-0 sm:items-center sm:p-4"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeSplitDividerNewModuleModal();
            }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-split-divider-new-module-title"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="flex max-h-[min(90dvh,640px)] w-full max-w-lg flex-col rounded-t-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl sm:max-h-[min(85dvh,560px)] sm:rounded-2xl"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
                <span className="w-10 shrink-0" aria-hidden />
                <h2
                  id="admin-split-divider-new-module-title"
                  className="min-w-0 flex-1 text-center text-base font-bold text-[var(--text-primary)] sm:text-lg"
                >
                  New module from section
                </h2>
                <button
                  type="button"
                  className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]"
                  onClick={closeSplitDividerNewModuleModal}
                >
                  Cancel
                </button>
              </div>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
                <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                  The divider label becomes the new module’s title. Only lessons under this divider until the next divider
                  (or end of this module) move into it; other rows stay in the current module. On structured courses, ids
                  renumber after you confirm.
                </p>
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
                    Place new module in the course
                  </span>
                  <select
                    className="min-h-11 w-full max-w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[#8b8c8c]/80 focus:ring-2 focus:ring-[#a1a2a2]/25"
                    value={String(splitDividerNewModuleModal.insertAt)}
                    onChange={(e) => {
                      const insertAt = Number(e.target.value);
                      setSplitDividerNewModuleModal((prev) => (prev ? { ...prev, insertAt } : null));
                    }}
                  >
                    {splitDividerIntoNewModuleInsertOptions(
                      draft,
                      splitDividerNewModuleModal.mi
                    ).map((o) => (
                      <option key={String(o.insertAt)} value={String(o.insertAt)}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-[#8b8c8c]/80 hover:bg-[var(--hover-bg)]"
                  onClick={() => {
                    const ctx = splitDividerNewModuleModal;
                    if (!ctx) return;
                    if (commitSplitDividerIntoNewModuleAt(ctx.mi, ctx.li, ctx.insertAt)) {
                      closeSplitDividerNewModuleModal();
                    }
                  }}
                >
                  <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                    <Layers size={20} className="shrink-0 text-[#616161] app-dark:text-[#a1a2a2]" aria-hidden />
                    Create new module
                    <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">Confirm</span>
                  </span>
                  <span className="pl-8 text-xs text-[var(--text-muted)]">
                    Same result as the row’s Divider control, with the placement you chose above.
                  </span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {catalogDividerRemovePending ? (
        <div
          className="fixed inset-0 z-[190] flex items-end justify-center bg-[#272828]/70 p-0 sm:items-center sm:p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeCatalogDividerRemoveDialog();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="catalog-divider-remove-title"
            className="flex max-h-[min(90dvh,520px)] w-full max-w-lg flex-col rounded-t-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl sm:rounded-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
              <span className="inline-flex min-h-10 min-w-10 shrink-0" aria-hidden />
              <h2
                id="catalog-divider-remove-title"
                className="min-w-0 flex-1 text-center text-base font-bold text-[var(--text-primary)] sm:text-lg"
              >
                Remove divider?
              </h2>
              <button
                type="button"
                onClick={closeCatalogDividerRemoveDialog}
                className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-full text-[#616161] transition-colors hover:bg-[#757676]/15 hover:text-[#4c4d4d] app-dark:text-[#cfcfcf] app-dark:hover:text-[#cfcfcf]"
                aria-label="Close"
              >
                <X size={20} strokeWidth={2.25} aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
              <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                <strong className="text-[var(--text-primary)]">“{catalogDividerRemovePending.label}”</strong> still has{' '}
                <strong className="text-[var(--text-primary)]">{catalogDividerRemovePending.nestedCount}</strong> row
                {catalogDividerRemovePending.nestedCount === 1 ? '' : 's'} under it in this module (until the next divider
                or the end of the module).
              </p>
              <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                <strong className="text-[var(--text-primary)]">Keep rows</strong> — remove only the divider and leave those
                rows in the module list. <strong className="text-[var(--text-primary)]">Delete all</strong> — remove the
                divider and every row under it until the next divider. Use the close control above to dismiss without
                changes.
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end sm:gap-3">
                <button
                  type="button"
                  onClick={() => void confirmCatalogDividerRemoveDeleteAll()}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[#616161]/50 bg-[#757676]/12 px-4 py-3 text-sm font-bold text-[#4c4d4d] transition-colors hover:bg-[#757676]/18 app-dark:text-[#cfcfcf] sm:w-auto"
                >
                  Delete all
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => void confirmCatalogDividerRemoveKeepRows()}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#616161] px-4 py-3 text-sm font-bold text-[#e7e7e7] shadow-sm transition-colors hover:bg-[#757676] sm:w-auto"
                >
                  Keep rows
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <AnimatePresence>
        {changeModuleKindModal != null && draft && (
          <div
            className="fixed inset-0 z-[102] flex items-end justify-center bg-[#272828]/70 p-0 sm:items-center sm:p-4"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeChangeModuleKindModal();
            }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-module-change-kind-title"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="flex max-h-[min(90dvh,640px)] w-full max-w-lg flex-col rounded-t-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl sm:max-h-[min(85dvh,560px)] sm:rounded-2xl"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
                <span className="w-10 shrink-0" aria-hidden />
                <h2
                  id="admin-module-change-kind-title"
                  className="min-w-0 flex-1 text-center text-base font-bold text-[var(--text-primary)] sm:text-lg"
                >
                  Change module type
                </h2>
                <button
                  type="button"
                  className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]"
                  onClick={closeChangeModuleKindModal}
                >
                  Cancel
                </button>
              </div>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
                <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                  This module’s title becomes a <span className="font-semibold text-[var(--text-secondary)]">section divider</span> inside the module you pick. All of this module’s lessons are inserted at that position. For a divider section, that is{' '}
                  <span className="font-semibold text-[var(--text-secondary)]">after every lesson under that divider</span>{' '}
                  (up to the next divider), then any rows that were already below that point follow. This module is removed.
                  On structured courses, ids renumber after you confirm.
                </p>
                <div className="space-y-3">
                  <label className="block min-w-0">
                    <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
                      Merge into module
                    </span>
                    <select
                      className="min-h-11 w-full max-w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[#8b8c8c]/80 focus:ring-2 focus:ring-[#a1a2a2]/25"
                      value={String(changeModuleKindModal.targetMi)}
                      onChange={(e) => {
                        const nextT = Number(e.target.value);
                        setChangeModuleKindModal((prev) => {
                          if (!prev) return prev;
                          const d = draftRef.current;
                          const len = d?.modules[nextT]?.lessons.length ?? 0;
                          return { ...prev, targetMi: nextT, insertAt: len };
                        });
                      }}
                    >
                      {draft.modules.map((m, i) =>
                        i === changeModuleKindModal.sourceMi ? null : (
                          <option key={i} value={String(i)}>
                            {catalogModuleTitleLine(m, i + 1)}
                          </option>
                        )
                      )}
                    </select>
                  </label>
                  <label className="block min-w-0">
                    <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
                      Place divider and lessons after
                    </span>
                    <select
                      className="min-h-11 w-full max-w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[#8b8c8c]/80 focus:ring-2 focus:ring-[#a1a2a2]/25"
                      value={String(changeModuleKindModal.insertAt)}
                      onChange={(e) => {
                        const insertAt = Number(e.target.value);
                        setChangeModuleKindModal((prev) => (prev ? { ...prev, insertAt } : null));
                      }}
                    >
                      {moduleDividerMergePositionOptions(
                        draft.modules[changeModuleKindModal.targetMi] ?? { id: '', title: '', lessons: [] }
                      ).map((o) => (
                        <option key={`${o.insertAt}-${o.label}`} value={String(o.insertAt)}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  type="button"
                  className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-[#8b8c8c]/80 hover:bg-[var(--hover-bg)]"
                  onClick={() => {
                    const ctx = changeModuleKindModal;
                    if (!ctx) return;
                    const { sourceMi, targetMi, insertAt } = ctx;
                    const d = draftRef.current;
                    if (!d) return;
                    const next = applyConvertModuleIntoDividerAt(d, sourceMi, targetMi, insertAt);
                    if (!next) {
                      showActionToast(
                        'Could not merge. Pick a different target or position — the merged module must keep at least one playable lesson, and the source cannot be the same as the target.',
                        'danger'
                      );
                      return;
                    }
                    const mergedModuleIndex = sourceMi < targetMi ? targetMi - 1 : targetMi;
                    setDraft(ensureCourseLessonRowKeys(next));
                    closeChangeModuleKindModal();
                    setOpenModules({ [mergedModuleIndex]: true });
                    setOpenLessons({});
                    showActionToast('Module merged as a section divider at the position you chose.', 'neutral');
                  }}
                >
                  <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                    <Minus size={20} className="shrink-0 text-[#616161] app-dark:text-[#a1a2a2]" aria-hidden />
                    Merge as section divider
                    <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">Confirm</span>
                  </span>
                  <span className="pl-8 text-xs text-[var(--text-muted)]">
                    Same learner outline behavior as changing a lesson row to a section divider.
                  </span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {addAnotherLessonAfterSave && draft && (
          <div
            className="fixed inset-0 z-[102] flex items-end justify-center bg-[#272828]/70 p-0 sm:items-center sm:p-4"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeAddAnotherLessonAfterSave();
            }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-add-another-lesson-title"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="flex min-w-0 w-full max-w-md flex-col rounded-t-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl sm:rounded-2xl"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="border-b border-[var(--border-color)] px-4 py-3">
                <h2
                  id="admin-add-another-lesson-title"
                  className="text-center text-base font-bold text-[var(--text-primary)] sm:text-lg"
                >
                  Add another lesson?
                </h2>
                <p className="mt-2 text-center text-xs leading-relaxed text-[var(--text-muted)]">
                  Insert after the lesson you just saved in module{' '}
                  <span className="font-semibold text-[var(--text-secondary)]">
                    {addAnotherLessonAfterSave.mi + 1}
                  </span>
                  .
                </p>
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-2 p-4 sm:grid-cols-2 sm:gap-3">
                <button
                  type="button"
                  className="order-1 inline-flex min-h-11 min-w-0 w-full items-center justify-center rounded-xl bg-[#616161] px-3 py-2.5 text-sm font-semibold text-[#e7e7e7] hover:bg-[#757676] sm:order-2 sm:min-h-10 sm:px-4"
                  onClick={confirmAddAnotherLessonAfterSave}
                >
                  Yes, add lesson
                </button>
                <button
                  type="button"
                  className="order-2 inline-flex min-h-11 min-w-0 w-full items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--hover-bg)] sm:order-1 sm:min-h-10 sm:px-4"
                  onClick={closeAddAnotherLessonAfterSave}
                >
                  Not now
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {addLessonBranchModal && draft && (
          <div
            className="fixed inset-0 z-[102] flex items-end justify-center bg-[#272828]/70 p-0 sm:items-center sm:p-4"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeAddLessonBranchModal();
            }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-add-lesson-branch-title"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="flex max-h-[min(90dvh,520px)] w-full max-w-lg flex-col rounded-t-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl sm:max-h-[min(85dvh,480px)] sm:rounded-2xl"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
                <span className="w-10 shrink-0" aria-hidden />
                <h2
                  id="admin-add-lesson-branch-title"
                  className="min-w-0 flex-1 text-center text-base font-bold text-[var(--text-primary)] sm:text-lg"
                >
                  Add branch
                </h2>
                <button
                  type="button"
                  className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]"
                  onClick={closeAddLessonBranchModal}
                >
                  Cancel
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
                <p className="mb-3 text-xs leading-relaxed text-[var(--text-muted)]">
                  Choose what to insert in module{' '}
                  <span className="font-semibold text-[var(--text-secondary)]">{addLessonBranchModal.mi + 1}</span> at this
                  position in the list.
                </p>
                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-[#8b8c8c]/80 hover:bg-[var(--hover-bg)]"
                    onClick={() => {
                      const { mi, insertAt } = addLessonBranchModal;
                      addLesson(mi, insertAt, 'lesson');
                      closeAddLessonBranchModal();
                    }}
                  >
                    <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                      <BookOpen size={20} className="shrink-0 text-admin-icon" aria-hidden />
                      Lesson
                      <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">Playable</span>
                    </span>
                    <span className="pl-8 text-xs text-[var(--text-muted)]">
                      Video, external page, or quiz — set content type in the editor after adding.
                    </span>
                  </button>
                  <button
                    type="button"
                    className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-[#8b8c8c]/80 hover:bg-[var(--hover-bg)]"
                    onClick={() => {
                      const { mi, insertAt } = addLessonBranchModal;
                      addLesson(mi, insertAt, 'divider');
                      closeAddLessonBranchModal();
                    }}
                  >
                    <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                      <Minus size={20} className="shrink-0 text-[#616161] app-dark:text-[#a1a2a2]" aria-hidden />
                      Section divider
                      <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">Heading only</span>
                    </span>
                    <span className="pl-8 text-xs text-[var(--text-muted)]">
                      Non-playable subheading in the course outline and player sidebar.
                    </span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {catalogPlaceModal && draft ? (
        <div
          className="fixed inset-0 z-[103] flex items-end justify-center bg-[#272828]/70 p-0 sm:items-center sm:p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeCatalogPlaceModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="catalog-place-modal-title"
            className="flex max-h-[min(90dvh,560px)] w-full max-w-lg flex-col rounded-t-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl sm:rounded-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
              <h2
                id="catalog-place-modal-title"
                className="min-w-0 flex-1 text-center text-base font-bold text-[var(--text-primary)] sm:text-lg"
              >
                {catalogPlaceModal.kind === 'module' ? 'Copy or move module' : 'Copy or move branch'}
              </h2>
              <button
                type="button"
                className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]"
                onClick={closeCatalogPlaceModal}
              >
                Cancel
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
              <div className="mb-3 flex gap-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-1">
                <button
                  type="button"
                  onClick={() => setCatalogPlaceMode('copy')}
                  className={`flex min-h-11 flex-1 touch-manipulation items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-bold sm:text-sm ${
                    catalogPlaceMode === 'copy'
                      ? 'bg-[#616161] text-[#e7e7e7] shadow-sm'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
                  }`}
                >
                  <Copy size={16} className="shrink-0 opacity-90" aria-hidden />
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => setCatalogPlaceMode('move')}
                  disabled={
                    catalogPlaceModal.kind === 'module'
                      ? draft.modules.length <= 1
                      : false
                  }
                  className={`flex min-h-11 flex-1 touch-manipulation items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-bold sm:text-sm ${
                    catalogPlaceMode === 'move'
                      ? 'bg-[#616161] text-[#e7e7e7] shadow-sm'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
                  } disabled:opacity-40`}
                >
                  <ArrowRightLeft size={16} className="shrink-0 opacity-90" aria-hidden />
                  Move
                </button>
              </div>

              {catalogPlaceModal.kind === 'module' ? (
                <>
                  <p className="mb-3 text-xs leading-relaxed text-[var(--text-muted)]">
                    {catalogPlaceMode === 'copy' ? (
                      <>
                        Copying{' '}
                        <strong className="text-[var(--text-secondary)]">
                          {catalogModuleTitleLine(
                            draft.modules[catalogPlaceModal.sourceMi]!,
                            catalogPlaceModal.sourceMi + 1
                          )}
                        </strong>
                        . A duplicate with new row keys (and renumbered ids on structured courses) will be inserted —
                        pick where it should appear.
                      </>
                    ) : (
                      <>
                        Moving{' '}
                        <strong className="text-[var(--text-secondary)]">
                          {catalogModuleTitleLine(
                            draft.modules[catalogPlaceModal.sourceMi]!,
                            catalogPlaceModal.sourceMi + 1
                          )}
                        </strong>
                        . Module and lesson ids stay tied to order on structured courses; choose the new position.
                      </>
                    )}
                  </p>
                  <div>
                    <label
                      className="block text-xs font-semibold text-[var(--text-secondary)]"
                      htmlFor="catalog-place-module-slot"
                    >
                      {catalogPlaceMode === 'copy' ? 'Position in course' : 'Position after removal'}
                    </label>
                    <p id="catalog-place-module-slot-hint" className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                      {catalogPlaceMode === 'copy'
                        ? 'Order among all modules in this draft.'
                        : 'Order among the remaining modules (this one is taken out first, then placed here).'}
                    </p>
                    <select
                      id="catalog-place-module-slot"
                      aria-describedby="catalog-place-module-slot-hint"
                      className="mt-1.5 min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                      value={
                        catalogPlaceMode === 'copy'
                          ? catalogModuleCopyInsertIdx
                          : catalogModuleMoveInsertIdx
                      }
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (catalogPlaceMode === 'copy') setCatalogModuleCopyInsertIdx(v);
                        else setCatalogModuleMoveInsertIdx(v);
                      }}
                    >
                      {catalogPlaceMode === 'copy'
                        ? Array.from({ length: draft.modules.length + 1 }, (_, i) => (
                            <option key={i} value={i}>
                              {i === 0
                                ? `Before ${catalogModuleTitleLine(draft.modules[0]!, 1)}`
                                : i >= draft.modules.length
                                  ? `After ${catalogModuleTitleLine(
                                      draft.modules[draft.modules.length - 1]!,
                                      draft.modules.length
                                    )}`
                                  : `After ${catalogModuleTitleLine(
                                      draft.modules[i - 1]!,
                                      i
                                    )} · before ${catalogModuleTitleLine(draft.modules[i]!, i + 1)}`}
                            </option>
                          ))
                        : (() => {
                            const smi = catalogPlaceModal.sourceMi;
                            const without = draft.modules.filter((_, j) => j !== smi);
                            return Array.from({ length: without.length + 1 }, (_, i) => (
                              <option key={i} value={i}>
                                {without.length === 0
                                  ? 'Only position'
                                  : i === 0
                                    ? `Before ${catalogModuleTitleLine(without[0]!, 1)}`
                                    : i >= without.length
                                      ? `After ${catalogModuleTitleLine(
                                          without[without.length - 1]!,
                                          without.length
                                        )}`
                                      : `After ${catalogModuleTitleLine(without[i - 1]!, i)} · before ${catalogModuleTitleLine(
                                          without[i]!,
                                          i + 1
                                        )}`}
                              </option>
                            ));
                          })()}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  {(() => {
                    const { sourceMi, sourceLi } = catalogPlaceModal;
                    const srcLes = draft.modules[sourceMi]!.lessons[sourceLi]!;
                    const summary = catalogLessonRowSummary(srcLes);
                    const targetMod = draft.modules[catalogLessonTargetMi]!;
                    const liMax = targetMod.lessons.length;
                    const liClamped = Math.min(catalogLessonInsertIdx, liMax);
                    return (
                      <>
                        <p className="mb-3 text-xs leading-relaxed text-[var(--text-muted)]">
                          {catalogPlaceMode === 'copy' ? (
                            <>
                              Copying <strong className="text-[var(--text-secondary)]">{summary}</strong>. A duplicate
                              with a new row key (and renumbered ids on structured courses) will be inserted — pick the
                              module and position.
                            </>
                          ) : (
                            <>
                              Moving <strong className="text-[var(--text-secondary)]">{summary}</strong>. Choose the
                              module and position; the source module must keep at least one playable lesson.
                            </>
                          )}
                        </p>
                        <div className="space-y-3">
                          <div>
                            <label
                              className="block text-xs font-semibold text-[var(--text-secondary)]"
                              htmlFor="catalog-place-lesson-module"
                            >
                              Module
                            </label>
                            <select
                              id="catalog-place-lesson-module"
                              className="mt-1.5 min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                              value={catalogLessonTargetMi}
                              onChange={(e) => setCatalogLessonTargetMi(Number(e.target.value))}
                            >
                              {draft.modules.map((m, mj) => (
                                <option key={mj} value={mj}>
                                  {catalogModuleTitleLine(m, mj + 1)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label
                              className="block text-xs font-semibold text-[var(--text-secondary)]"
                              htmlFor="catalog-place-lesson-slot"
                            >
                              Position in module
                            </label>
                            <p
                              id="catalog-place-lesson-slot-hint"
                              className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]"
                            >
                              Order among rows in the selected module (including the row you are moving when it is the
                              same module).
                            </p>
                            <select
                              id="catalog-place-lesson-slot"
                              aria-describedby="catalog-place-lesson-slot-hint"
                              className="mt-1.5 min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                              value={liClamped}
                              onChange={(e) => setCatalogLessonInsertIdx(Number(e.target.value))}
                            >
                              {Array.from({ length: liMax + 1 }, (_, i) => (
                                <option key={i} value={i}>
                                  {catalogLessonInsertOptionLabel(targetMod, i)}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </>
              )}

              <button
                type="button"
                onClick={() => void commitCatalogPlace()}
                className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#616161] px-4 py-2 text-sm font-bold text-[#e7e7e7] hover:bg-[#757676]"
              >
                {catalogPlaceMode === 'copy' ? 'Place copy' : 'Move here'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <AnimatePresence>
        {deleteDialogOpen && draft && (
          <div
            className="fixed inset-0 z-[101] flex items-center justify-center bg-[#272828]/70 p-4"
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
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#616161] px-5 py-3 text-sm font-bold text-[#e7e7e7] transition-colors hover:bg-[#616161] sm:w-auto"
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
