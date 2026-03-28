import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BookOpen,
  Copy,
  Loader2,
  Plus,
  Route,
  Save,
  SlidersHorizontal,
  Tags,
  Trash2,
  RefreshCw,
  X,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import { useAdminActionToast } from './useAdminActionToast';
import { PathBuilderSection, type PathBuilderSectionHandle } from './PathBuilderSection';
import { AdminCatalogCategoriesPanel } from './AdminCatalogCategoriesPanel';
import { AdminCatalogCategoryPresetsPanel } from './AdminCatalogCategoryPresetsPanel';
import type { Course, Lesson, Module } from '../../data/courses';
import { STRUCTURED_COURSE_ID_RE, isStructuredCourseId } from '../../utils/courseStructuredIds';
import { validateCourseDraft } from '../../utils/courseDraftValidation';
import {
  loadPublishedCoursesFromFirestore,
  savePublishedCourse,
  deletePublishedCourse,
} from '../../utils/publishedCoursesFirestore';
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
import { allPresetCatalogSkills } from '../../utils/catalogSkillPresets';
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

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const CN_INDEX_RE = /^C([1-9]\d*)$/;

/** Smallest C{n} (n >= 1) not used by any published id matching C[1-9]…, nor any extra reserved id string. */
function firstAvailableStructuredCourseId(
  publishedList: Course[],
  extraReservedIds: string[] = []
): string {
  const used = new Set<number>();
  const bump = (cid: string) => {
    const m = CN_INDEX_RE.exec(cid);
    if (m) used.add(parseInt(m[1], 10));
  };
  for (const c of publishedList) bump(c.id);
  for (const id of extraReservedIds) bump(id);
  let n = 1;
  while (used.has(n)) n += 1;
  return `C${n}`;
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

/** Sub-tabs inside Course catalog: course entries, learning paths, category management. */
type ContentCatalogSubTab = 'catalog' | 'paths' | 'categories' | 'presets';

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
}) => {
  const [publishedList, setPublishedList] = useState<Course[]>([]);
  /** '' = none selected; avoids loading Firestore until the user opens the Course dropdown. */
  const [selector, setSelector] = useState<string>('');
  const [draft, setDraft] = useState<Course | null>(null);
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
  /** On failed save, scroll/focus the first invalid required field once it is rendered. */
  const pendingScrollTargetIdRef = useRef<string | null>(null);
  /** After choosing New Course (or equivalent), focus Course title once details are expanded. */
  const pendingFocusCourseTitleRef = useRef(false);
  /** Avoid collapsing the editor when selector moves from __new__ to draft.id after first save (draft id unchanged). */
  const prevCatalogOpenStateRef = useRef<{ selector: string; draftId: string | undefined }>({
    selector: '',
    draftId: undefined,
  });
  const { showActionToast, actionToast } = useAdminActionToast();
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

  /** Full list for adding categories (presets, saved extras, labels from published courses). */
  const categorySelectOptions = useMemo(() => {
    const s = new Set<string>(allPresetCatalogCategoriesFromState(categoryPresetsState));
    for (const c of readCatalogCategoryExtras()) s.add(c);
    for (const co of publishedList) {
      for (const cat of co.categories ?? []) {
        const t = cat?.trim();
        if (t) s.add(t);
      }
    }
    return [...s].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [publishedList, categoryOptionsVersion, categoryPresetsState]);

  /** Full list for adding skills (presets, saved extras, labels from published courses). */
  const skillSelectOptions = useMemo(() => {
    const s = new Set<string>(allPresetCatalogSkills());
    for (const x of readCatalogSkillExtras()) s.add(x);
    for (const co of publishedList) {
      for (const sk of co.skills ?? []) {
        const t = sk?.trim();
        if (t) s.add(t);
      }
    }
    return [...s].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [publishedList, skillOptionsVersion]);

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
    if (!draft) return;
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
    const list = await loadPublishedCoursesFromFirestore();
    setPublishedList(list);
    setListLoading(false);
    return list;
  }, []);

  const openCourseCatalogOnce = useCallback(() => {
    if (catalogRequestedRef.current) return;
    catalogRequestedRef.current = true;
    setCatalogRequested(true);
    void refreshList();
  }, [refreshList]);

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
    if (!catalogRequested) return;
    void loadCatalogCategoryPresets().then(setCategoryPresetsState);
  }, [catalogRequested]);

  useEffect(() => {
    const h = () => void loadCatalogCategoryPresets().then(setCategoryPresetsState);
    window.addEventListener(CATALOG_CATEGORY_PRESETS_CHANGED, h);
    return () => window.removeEventListener(CATALOG_CATEGORY_PRESETS_CHANGED, h);
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

  /** First time draft appears (e.g. initial load) without baseline yet. */
  useEffect(() => {
    if (!draft || baselineJson !== null) return;
    setBaselineJson(JSON.stringify(draft));
  }, [draft, baselineJson]);

  const applyPickCourse = useCallback(
    (id: string) => {
      if (id === '') return;
      setSelector(id);
      if (id === '__new__') {
        pendingFocusCourseTitleRef.current = true;
        const fresh = emptyCourse(firstAvailableStructuredCourseId(publishedList));
        setDraft(fresh);
        setBaselineJson(JSON.stringify(fresh));
        return;
      }
      const c = publishedList.find((x) => x.id === id);
      if (c) {
        const clone = normalizeCourseTaxonomy(deepClone(c));
        setDraft(clone);
        setBaselineJson(JSON.stringify(clone));
      } else {
        setDraft(null);
        setBaselineJson(null);
      }
    },
    [publishedList]
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
      addCatalogCategoryExtra(canonical);
    },
    [categorySelectOptions]
  );

  const removeDraftCategory = useCallback((label: string) => {
    const low = label.toLowerCase();
    setDraft((d) => (d ? { ...d, categories: d.categories.filter((c) => c.toLowerCase() !== low) } : d));
  }, []);

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
      addCatalogSkillExtra(canonical);
    },
    [skillSelectOptions]
  );

  const removeDraftSkill = useCallback((label: string) => {
    const low = label.toLowerCase();
    setDraft((d) => (d ? { ...d, skills: d.skills.filter((s) => s.toLowerCase() !== low) } : d));
  }, []);

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

  const addModule = () => {
    setDraft((d) => {
      if (!d) return null;
      const newModuleIndex = d.modules.length;
      pendingOpenNewModuleIndexRef.current = newModuleIndex;
      pendingOpenNewLessonKeyRef.current = `${newModuleIndex}:0`;
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
              },
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
      pendingOpenNewLessonKeyRef.current = `${mi}:${targetModule.lessons.length}`;
      const lid = isStructuredCourseId(d.id)
        ? nextLessonIdInModule(d, mi)
        : nextLessonIdLegacy(d);
      const modules = d.modules.map((m, i) => {
        if (i !== mi) return m;
        return {
          ...m,
          lessons: [
            ...m.lessons,
            { id: lid, title: '', videoUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' },
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
        if (!l.videoUrl.trim() || !l.videoUrl.startsWith('http')) {
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
      for (let li = 0; li < m.lessons.length; li += 1) {
        const l = m.lessons[li];
        const key = `${mi}:${li}`;
        if (!l.id.trim()) out.lessonId.add(key);
        if (!l.title.trim()) out.lessonTitle.add(key);
        if (!l.videoUrl.trim() || !l.videoUrl.startsWith('http')) out.videoUrl.add(key);
      }
    }
    return out;
  }, [draft]);

  const isDirty =
    !!draft &&
    baselineJson !== null &&
    JSON.stringify(draft) !== baselineJson;

  useEffect(() => {
    onDraftDirtyChange?.(isDirty);
    return () => onDraftDirtyChange?.(false);
  }, [isDirty, onDraftDirtyChange]);

  const onCourseSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (id === '') return;
    if (isDirty && id !== selector) {
      setCourseLeaveDialog({ kind: 'select', nextId: id });
      return;
    }
    applyPickCourse(id);
  };

  const handleSave = async () => {
    if (!draft) return;
    if (baselineJson !== null && JSON.stringify(draft) === baselineJson) {
      showActionToast('No changes to save.', 'neutral');
      return;
    }
    const normalized = normalizeCourseTaxonomy(draft);
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
    setBusy(true);
    const ok = await savePublishedCourse(normalized);
    setBusy(false);
    if (ok) {
      setShowValidationHints(false);
      setDraft(normalized);
      for (const cat of normalized.categories) {
        if (cat.trim()) addCatalogCategoryExtra(cat.trim());
      }
      for (const sk of normalized.skills) {
        if (sk.trim()) addCatalogSkillExtra(sk.trim());
      }
      showActionToast('Course saved.');
      await refreshList();
      await onCatalogChanged();
      setSelector(normalized.id);
      setBaselineJson(JSON.stringify(normalized));
    } else {
      showActionToast('Save failed (check console / rules).', 'danger');
    }
  };

  const duplicatePublishedAsDraft = () => {
    if (!selector || selector === '__new__') {
      showActionToast('Select an existing published course in the list, then duplicate.', 'danger');
      return;
    }
    const fromEditor =
      draft && draft.id === selector ? draft : publishedList.find((c) => c.id === selector);
    if (!fromEditor) {
      showActionToast('Course not found. Reload the list and try again.', 'danger');
      return;
    }
    const reserveDraftCn =
      selector === '__new__' && draft && STRUCTURED_COURSE_ID_RE.test(draft.id) ? [draft.id] : [];
    const newId = firstAvailableStructuredCourseId(publishedList, reserveDraftCn);
    const copy = remapCourseToStructuredIds(deepClone(fromEditor), newId);
    const t = fromEditor.title.trim();
    copy.title = t.endsWith(' (copy)') ? t : `${t} (copy)`;
    pendingFocusCourseTitleRef.current = true;
    setSelector('__new__');
    setDraft(copy);
    setBaselineJson(JSON.stringify(copy));
    showActionToast(
      'Copy loaded as a new draft — IDs use C{n}M{m}L{l}. Adjust title if needed, then Save.'
    );
  };

  const requestDuplicateOrConfirm = () => {
    if (!isDirty) {
      duplicatePublishedAsDraft();
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
        setDraft(deepClone(restored));
      } catch {
        showActionToast('Could not restore draft.', 'danger');
        return;
      }
    }
    if (pending.kind === 'select') {
      applyPickCourse(pending.nextId);
    } else {
      duplicatePublishedAsDraft();
    }
  };

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const closeDeleteDialog = useCallback(() => setDeleteDialogOpen(false), []);

  const openDeleteDialog = useCallback(() => {
    if (!draft || !publishedList.some((c) => c.id === draft.id)) return;
    setDeleteDialogOpen(true);
  }, [draft, publishedList]);

  const confirmDeletePublished = useCallback(async () => {
    if (!draft) return;
    const courseId = draft.id;
    setDeleteDialogOpen(false);
    setBusy(true);
    const ok = await deletePublishedCourse(courseId);
    setBusy(false);
    if (ok) {
      await refreshList();
      await onCatalogChanged();
      setDraft(null);
      setBaselineJson(null);
      setSelector('');
      showActionToast('Course deleted.');
    } else {
      showActionToast('Delete failed.', 'danger');
    }
  }, [draft, refreshList, onCatalogChanged, showActionToast]);

  useBodyScrollLock(
    deleteDialogOpen ||
      subTabSwitchConfirmOpen ||
      pathSubTabSwitchConfirmOpen ||
      courseLeaveDialog !== null
  );

  /** Ref updated by PathBuilder via onPathsDirtyChange — read before opening catalog tab confirm. */
  const pathBuilderDirtyRef = useRef(false);
  const courseDiscardTargetRef = useRef<'paths' | 'categories' | 'catalog' | 'presets'>('paths');
  const pathDiscardTargetRef = useRef<'catalog' | 'categories' | 'presets'>('catalog');
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
        if (next === 'categories' || next === 'presets') {
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
        if (next === 'categories' || next === 'presets') {
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
      }
    },
    [contentCatalogSubTab, isDirty]
  );

  const closeSubTabSwitchConfirm = useCallback(() => setSubTabSwitchConfirmOpen(false), []);

  const confirmDiscardCourseDraftAndSwitch = useCallback(() => {
    if (draft && baselineJson !== null) {
      try {
        const restored = JSON.parse(baselineJson) as Course;
        setDraft(deepClone(restored));
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
    if (prev.selector === '__new__' && did && selector === did && prev.draftId === did) {
      prevCatalogOpenStateRef.current = { selector, draftId: did };
      return;
    }

    setCourseDetailsOpen(false);
    setOpenModules({});
    setOpenLessons({});
    prevCatalogOpenStateRef.current = { selector, draftId: did };
  }, [draft?.id, selector]);

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
          <span className="min-w-0">Course catalog</span>
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
                  : contentCatalogSubTab === 'categories' || contentCatalogSubTab === 'presets'
                    ? listLoading
                    : true
            }
            tabIndex={
              contentCatalogSubTab === 'catalog' ||
              contentCatalogSubTab === 'paths' ||
              contentCatalogSubTab === 'categories' ||
              contentCatalogSubTab === 'presets'
                ? undefined
                : -1
            }
            aria-hidden={
              contentCatalogSubTab !== 'catalog' &&
              contentCatalogSubTab !== 'paths' &&
              contentCatalogSubTab !== 'categories' &&
              contentCatalogSubTab !== 'presets'
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
              if (contentCatalogSubTab === 'categories') {
                void refreshList();
                return;
              }
              if (contentCatalogSubTab === 'presets') {
                void refreshList();
                void loadCatalogCategoryPresets().then(setCategoryPresetsState);
              }
            }}
            className={`inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs font-semibold hover:bg-[var(--hover-bg)] disabled:opacity-50 ${
              contentCatalogSubTab !== 'catalog' &&
              contentCatalogSubTab !== 'paths' &&
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
                ((contentCatalogSubTab === 'categories' || contentCatalogSubTab === 'presets') &&
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

      <div className="-mx-1 flex min-h-[2.75rem] gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-[var(--border-color)] px-1 pb-2 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => requestContentCatalogSubTab('catalog')}
          className={`inline-flex min-h-10 shrink-0 items-center rounded-lg px-3 py-2 text-sm font-semibold ${
            contentCatalogSubTab === 'catalog' ? 'bg-orange-500/20 text-orange-500' : 'text-[var(--text-secondary)]'
          }`}
        >
          Catalog
        </button>
        <button
          type="button"
          onClick={() => requestContentCatalogSubTab('paths')}
          className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold ${
            contentCatalogSubTab === 'paths' ? 'bg-orange-500/20 text-orange-500' : 'text-[var(--text-secondary)]'
          }`}
        >
          <Route size={14} aria-hidden />
          Learning paths
        </button>
        <button
          type="button"
          onClick={() => requestContentCatalogSubTab('categories')}
          className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold ${
            contentCatalogSubTab === 'categories' ? 'bg-orange-500/20 text-orange-500' : 'text-[var(--text-secondary)]'
          }`}
        >
          <Tags size={14} aria-hidden />
          Categories
        </button>
        <button
          type="button"
          onClick={() => requestContentCatalogSubTab('presets')}
          className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold ${
            contentCatalogSubTab === 'presets' ? 'bg-orange-500/20 text-orange-500' : 'text-[var(--text-secondary)]'
          }`}
        >
          <SlidersHorizontal size={14} aria-hidden />
          Topic presets
        </button>
      </div>

      {contentCatalogSubTab === 'paths' && (
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          Saved paths appear in the learner <strong className="text-[var(--text-secondary)]">Paths</strong> menu and
          filter the course library. Published courses only can be added—use the{' '}
          <strong className="text-[var(--text-secondary)]">Catalog</strong> tab first if the list is empty (
          <strong className="text-[var(--text-secondary)]">Catalog bootstrap</strong> on Alerts when needed). Choose{' '}
          <strong className="text-[var(--text-secondary)]">New path</strong> in the list for a fresh path (smallest unused{' '}
          <code className="text-orange-500/90">P1</code>, <code className="text-orange-500/90">P2</code>, …) or an
          existing path (sorted A–Z). Drag to reorder courses; expand a course to reorder modules and lessons—
          <strong className="text-[var(--text-secondary)]">Save path</strong> stores the path;{' '}
          <strong className="text-[var(--text-secondary)]">Save course structure</strong> updates the published
          course document like the catalog editor.
        </p>
      )}

      {contentCatalogSubTab === 'catalog' && (
        <>
      <p className="text-xs text-[var(--text-muted)] leading-relaxed">
        Saved changes appear in the live course catalog for learners. If the list is empty, use{' '}
        <strong className="text-[var(--text-secondary)]">Catalog bootstrap</strong> on the Alerts tab first.
        Open <strong className="text-[var(--text-secondary)]">Course</strong> once to load the list.
        Pick <strong className="text-[var(--text-secondary)]">New Course</strong> for a fresh draft (smallest unused{' '}
        <code className="text-orange-500/90">C1</code>, <code className="text-orange-500/90">C2</code>, …) or an existing
        course (sorted A–Z). Modules <code className="text-orange-500/90">C1M1</code>; lessons{' '}
        <code className="text-orange-500/90">C1M1L1</code>.
      </p>

      <div className="space-y-4">
        <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:items-start md:gap-x-3 md:gap-y-3">
          <div className="flex min-w-0 flex-col gap-1">
            <label
              htmlFor="admin-catalog-course-select"
              className="text-xs font-semibold text-[var(--text-secondary)]"
            >
              Course
            </label>
            <div className="flex min-w-0 items-stretch gap-2">
            <select
              id="admin-catalog-course-select"
              value={selector}
              onFocus={openCourseCatalogOnce}
              onMouseDown={openCourseCatalogOnce}
              onChange={onCourseSelectChange}
              className="box-border min-h-[42px] min-w-0 flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
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
                  {sortedCatalogCourses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} ({c.id})
                    </option>
                  ))}
                </>
              )}
            </select>
            {selector !== '__new__' && (
              <button
                type="button"
                disabled={
                  listLoading ||
                  !selector ||
                  !publishedList.some((c) => c.id === selector)
                }
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
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">Document ID</span>
            <div
              className="box-border flex min-h-[42px] w-full min-w-0 items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-mono text-[var(--text-primary)]"
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
            <label
              htmlFor="admin-catalog-course-level"
              className="text-xs font-semibold text-[var(--text-secondary)]"
            >
              Level
            </label>
            <select
              id="admin-catalog-course-level"
              value={draft?.level ?? ''}
              disabled={!draft}
              onChange={(e) =>
                draft && updateDraft({ level: e.target.value as Course['level'] })
              }
              className="box-border w-full min-h-[42px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
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

        {draft && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || !draft || (baselineJson !== null && !isDirty)}
              onClick={() => void handleSave()}
              aria-busy={busy}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-500 px-5 py-2 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-40"
            >
              {busy ? (
                <Loader2 size={18} className="shrink-0 animate-spin" aria-hidden />
              ) : (
                <Save size={18} className="shrink-0" aria-hidden />
              )}
              Save changes
            </button>
            <button
              type="button"
              disabled={busy || !publishedList.some((c) => c.id === draft.id)}
              onClick={openDeleteDialog}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-500/40 px-5 py-2 text-sm font-bold text-red-400 hover:bg-red-500/10 disabled:opacity-40"
            >
              <Trash2 size={18} aria-hidden />
              Delete published
            </button>
          </div>
        )}
        </div>

        {draft && (
          <div className="space-y-4">
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/20">
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
              className={`space-y-2 sm:col-span-2 ${showValidationHints && fieldErrors.courseCategories ? 'rounded-lg ring-2 ring-red-500/60 p-2 -m-2' : ''}`}
            >
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Categories</span>
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
              <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                At least one category is required. Custom names are added to library filters when you save or leave the fields above.
              </p>
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

          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-primary)]">Modules and lessons</h3>
                <p className="text-xs text-[var(--text-muted)] mt-1 max-w-xl">
                  Each module is a group of lessons. Stable ids are used for learner progress and deep links; titles are
                  what learners see.
                </p>
              </div>
              <button
                type="button"
                onClick={addModule}
                className="inline-flex items-center gap-1 text-xs font-bold text-orange-500 hover:text-orange-400"
              >
                <Plus size={14} /> Add module
              </button>
            </div>

            {draft.modules.map((mod, mi) => (
              <div
                key={`module-slot-${mi}`}
                className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/30 p-4 space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border-color)] pb-3">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => toggleModuleOpen(mi)}
                      className="inline-flex items-center gap-1.5 text-left"
                      aria-expanded={!!openModules[mi]}
                    >
                      {openModules[mi] ? (
                        <ChevronDown size={14} className="text-[var(--text-secondary)]" />
                      ) : (
                        <ChevronRight size={14} className="text-[var(--text-secondary)]" />
                      )}
                      <h4 className="text-sm font-bold text-[var(--text-primary)]">Module {mi + 1}</h4>
                    </button>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Stable id (e.g. C1M1) and display name for this section of the course.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeModule(mi)}
                    disabled={draft.modules.length <= 1}
                    className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg disabled:opacity-30 shrink-0"
                    aria-label="Remove module"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                {openModules[mi] && (
                <>
                <div className="flex flex-row flex-wrap items-end gap-x-3 gap-y-2">
                  <label className="flex min-w-0 flex-[1_1_11rem] max-w-full flex-col gap-1 sm:max-w-[16rem]">
                    <span className="whitespace-nowrap text-xs font-semibold text-[var(--text-secondary)]">
                      Module ID
                    </span>
                    <input
                      id={`admin-module-id-${mi}`}
                      value={mod.id}
                      onChange={(e) => updateModule(mi, { id: e.target.value })}
                      className={`box-border w-full min-w-0 rounded-lg border bg-[var(--bg-primary)] px-3 py-2 font-mono text-sm ${
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
                      className={`w-full text-sm bg-[var(--bg-primary)] border rounded-lg px-3 py-2 ${
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
                      Module title is required.
                    </span>
                  </label>
                </div>

                <div className="space-y-3 pl-2 sm:pl-3 border-l-2 border-orange-500/30">
                  <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
                    Lessons in this module
                  </p>
                  {mod.lessons.map((lesson, li) => (
                    <div
                      key={`lesson-slot-${mi}-${li}`}
                      className="rounded-lg bg-[var(--bg-secondary)]/80 p-4 space-y-3 border border-[var(--border-color)]/60"
                    >
                      <button
                        type="button"
                        onClick={() => toggleLessonOpen(mi, li)}
                        className="inline-flex items-center gap-1.5 text-left"
                        aria-expanded={!!openLessons[`${mi}:${li}`]}
                      >
                        {openLessons[`${mi}:${li}`] ? (
                          <ChevronDown size={14} className="text-[var(--text-secondary)]" />
                        ) : (
                          <ChevronRight size={14} className="text-[var(--text-secondary)]" />
                        )}
                        <p className="text-xs font-bold text-[var(--text-primary)]">Lesson {li + 1}</p>
                      </button>
                      {openLessons[`${mi}:${li}`] && (
                        <>
                      <div className="flex flex-row flex-wrap items-end gap-x-3 gap-y-2">
                        <label className="flex min-w-0 flex-[1_1_11rem] max-w-full flex-col gap-1 sm:max-w-[16rem]">
                          <span className="whitespace-nowrap text-xs font-semibold text-[var(--text-secondary)]">
                            Lesson ID
                          </span>
                          <input
                            id={`admin-lesson-id-${mi}-${li}`}
                            value={lesson.id}
                            onChange={(e) => updateLesson(mi, li, { id: e.target.value })}
                            className={`box-border w-full min-w-0 rounded-lg border bg-[var(--bg-primary)] px-3 py-2 font-mono text-sm ${
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
                            className={`w-full text-sm bg-[var(--bg-primary)] border rounded-lg px-3 py-2 ${
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
                            Lesson title is required.
                          </span>
                        </label>
                      </div>
                      <label className="block space-y-1">
                        <span className="text-xs font-semibold text-[var(--text-secondary)]">Video URL</span>
                        <input
                          id={`admin-lesson-url-${mi}-${li}`}
                          value={lesson.videoUrl}
                          onChange={(e) => updateLesson(mi, li, { videoUrl: e.target.value })}
                          className={`w-full text-sm font-mono bg-[var(--bg-primary)] border rounded-lg px-3 py-2 ${
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
                      <label className="block space-y-1">
                        <span className="text-xs font-semibold text-[var(--text-secondary)]">Duration label (optional)</span>
                        <input
                          value={lesson.duration ?? ''}
                          onChange={(e) => updateLesson(mi, li, { duration: e.target.value || undefined })}
                          className="w-full text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2"
                          placeholder="Shown next to the lesson title when set"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs font-semibold text-[var(--text-secondary)]">About (optional)</span>
                        <textarea
                          value={lesson.about ?? ''}
                          onChange={(e) => updateLesson(mi, li, { about: e.target.value || undefined })}
                          rows={2}
                          className="w-full text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 resize-y"
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
                  ))}
                  <button
                    type="button"
                    onClick={() => addLesson(mi)}
                    className="text-xs font-bold text-orange-500 hover:text-orange-400"
                  >
                    + Add lesson
                  </button>
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

      {contentCatalogSubTab === 'paths' && (
        <PathBuilderSection
          ref={pathBuilderRef}
          key={pathBuilderResetKey}
          publishedList={publishedList}
          onRefreshPublishedList={refreshList}
          onCatalogChanged={onCatalogChanged}
          onPathsDirtyChange={setPathBuilderDirty}
          onPathsLoadingChange={setPathsListLoading}
        />
      )}

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
                  Leaving Learning paths will discard unsaved changes to the path builder.
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
                  Remove this course?
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
                  {' '}({draft.id}) will be removed from the catalog. Learners will no longer see it. This cannot be
                  undone.
                </p>
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
                    aria-label={`Remove ${draft.id} from the catalog permanently`}
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

      {actionToast}
    </div>
  );
};
