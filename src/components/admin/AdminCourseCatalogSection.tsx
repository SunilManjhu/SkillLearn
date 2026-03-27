import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, Copy, Plus, RotateCcw, Save, Trash2, RefreshCw, X, ChevronDown, ChevronRight } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import { useAdminActionToast } from './useAdminActionToast';
import type { Course, Lesson, Module } from '../../data/courses';
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
  allPresetCatalogCategories,
  defaultNewCourseCategory,
} from '../../utils/catalogCategoryPresets';

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** C1, C12 — not C0. */
const STRUCTURED_COURSE_ID_RE = /^C[1-9]\d*$/;

function isStructuredCourseId(courseId: string): boolean {
  return STRUCTURED_COURSE_ID_RE.test(courseId);
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
    category: defaultNewCourseCategory(),
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

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,118}$/i;

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

type CancelDialogVariant = 'new-dirty' | 'new-clean' | 'published-dirty';

interface AdminCourseCatalogSectionProps {
  onCatalogChanged: () => void | Promise<void>;
  /** True while the course editor has unsaved edits (for admin portal navigation guard). */
  onDraftDirtyChange?: (dirty: boolean) => void;
}

interface RequiredFieldTarget {
  targetId: string;
  /** Course details vs modules — must match validateDraft order. */
  scope: 'course' | 'module';
  moduleIndex: number;
  /** Lessons to expand (module errors include first lesson so lesson 1 is visible). */
  lessonKeys?: string[];
}

export const AdminCourseCatalogSection: React.FC<AdminCourseCatalogSectionProps> = ({
  onCatalogChanged,
  onDraftDirtyChange,
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
  /** Target id when renaming an already-published course (Firestore doc id change). */
  const [renameDocId, setRenameDocId] = useState('');
  /** JSON snapshot of draft when last loaded / saved — for dirty detection and Cancel. */
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
  /** Avoid collapsing the editor when selector moves from __new__ to draft.id after first save (draft id unchanged). */
  const prevCatalogOpenStateRef = useRef<{ selector: string; draftId: string | undefined }>({
    selector: '',
    draftId: undefined,
  });
  const { showActionToast, actionToast } = useAdminActionToast();
  /** Re-read category option list when extras change in localStorage (same tab). */
  const [categoryOptionsVersion, setCategoryOptionsVersion] = useState(0);

  /** Full list for the Category dropdown (presets, saved extras, categories from published courses). */
  const categorySelectOptions = useMemo(() => {
    const s = new Set<string>(allPresetCatalogCategories());
    for (const c of readCatalogCategoryExtras()) s.add(c);
    for (const co of publishedList) {
      const cat = co.category?.trim();
      if (cat) s.add(cat);
    }
    return [...s].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [publishedList, categoryOptionsVersion]);

  useEffect(() => {
    const h = () => setCategoryOptionsVersion((v) => v + 1);
    window.addEventListener(CATALOG_CATEGORY_EXTRAS_CHANGED, h);
    return () => window.removeEventListener(CATALOG_CATEGORY_EXTRAS_CHANGED, h);
  }, []);

  const categorySelectValue = useMemo(() => {
    if (!draft) return '__custom__';
    const matched = categorySelectOptions.find(
      (o) => o.toLowerCase() === draft.category.trim().toLowerCase()
    );
    return matched ?? '__custom__';
  }, [draft, categorySelectOptions]);

  const registerDraftCategoryForFilters = () => {
    if (!draft) return;
    const t = draft.category.trim();
    if (t) addCatalogCategoryExtra(t);
  };

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

  const sortedPublishedCourses = useMemo(
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

  const pickCourse = (id: string) => {
    if (id === '') return;
    setSelector(id);
    setRenameDocId('');
    if (id === '__new__') {
      const fresh = emptyCourse(firstAvailableStructuredCourseId(publishedList));
      setDraft(fresh);
      setBaselineJson(JSON.stringify(fresh));
      return;
    }
    const c = publishedList.find((x) => x.id === id);
    if (c) {
      const clone = deepClone(c);
      setDraft(clone);
      setBaselineJson(JSON.stringify(clone));
    } else {
      setDraft(null);
      setBaselineJson(null);
    }
  };

  const updateDraft = (patch: Partial<Course>) => {
    setDraft((d) => (d ? { ...d, ...patch } : null));
  };

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

  const validateDraft = (c: Course): string | null => {
    if (!c.title.trim()) return 'Title is required.';
    if (!c.author.trim()) return 'Author is required.';
    if (!c.thumbnail.trim()) return 'Thumbnail URL is required.';
    if (!c.modules.length) return 'At least one module is required.';
    for (let mi = 0; mi < c.modules.length; mi += 1) {
      const m = c.modules[mi];
      if (!m.id.trim()) return `Module ${mi + 1}: Module ID is required.`;
      if (!m.title.trim()) return `Module ${mi + 1}: Module title is required.`;
      if (!m.lessons.length) return 'Each module needs at least one lesson.';
      for (let li = 0; li < m.lessons.length; li += 1) {
        const l = m.lessons[li];
        if (!l.id.trim()) return `Module ${mi + 1}, Lesson ${li + 1}: Lesson ID is required.`;
        if (!l.title.trim()) return `Module ${mi + 1}, Lesson ${li + 1}: Lesson title is required.`;
        if (!l.videoUrl.trim() || !l.videoUrl.startsWith('http')) {
          return `Module ${mi + 1}, Lesson ${li + 1}: Video URL is required and must start with http.`;
        }
      }
    }
    if (c.rating < 0 || c.rating > 5) return 'Rating must be 0–5.';
    return null;
  };

  const getFirstRequiredFieldTarget = (c: Course): RequiredFieldTarget | null => {
    if (!c.title.trim()) return { targetId: 'admin-course-title', scope: 'course', moduleIndex: 0 };
    if (!c.author.trim()) return { targetId: 'admin-course-author', scope: 'course', moduleIndex: 0 };
    if (!c.thumbnail.trim()) return { targetId: 'admin-course-thumbnail', scope: 'course', moduleIndex: 0 };
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

  const showCancel =
    !!draft && baselineJson !== null && (selector === '__new__' || isDirty);

  useEffect(() => {
    onDraftDirtyChange?.(isDirty);
    return () => onDraftDirtyChange?.(false);
  }, [isDirty, onDraftDirtyChange]);

  const handleSave = async () => {
    if (!draft) return;
    if (baselineJson !== null && JSON.stringify(draft) === baselineJson) {
      showActionToast('No changes to save.', 'neutral');
      return;
    }
    const err = validateDraft(draft);
    if (err) {
      setShowValidationHints(true);
      const target = getFirstRequiredFieldTarget(draft);
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
    const ok = await savePublishedCourse(draft);
    setBusy(false);
    if (ok) {
      setShowValidationHints(false);
      if (draft.category.trim()) addCatalogCategoryExtra(draft.category.trim());
      showActionToast('Course saved.');
      await refreshList();
      await onCatalogChanged();
      setSelector(draft.id);
      setBaselineJson(JSON.stringify(draft));
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
    setSelector('__new__');
    setDraft(copy);
    setBaselineJson(JSON.stringify(copy));
    setRenameDocId('');
    showActionToast(
      'Copy loaded as a new draft — IDs use C{n}M{m}L{l}. Adjust title if needed, then Save.'
    );
  };

  const canRenamePublishedDoc =
    !!draft &&
    selector !== '__new__' &&
    publishedList.some((c) => c.id === draft.id);

  const handleRenameDocumentId = async () => {
    if (!draft || !canRenamePublishedDoc) return;
    const oldId = draft.id;
    const newId = renameDocId.trim();
    if (!newId || newId === oldId) {
      showActionToast('Enter a new document ID that is different from the current one.', 'danger');
      return;
    }
    if (!SLUG_RE.test(newId)) {
      showActionToast(
        'Document ID: letters, numbers, hyphens only; 1–119 chars; must start with alphanumeric.',
        'danger'
      );
      return;
    }
    if (publishedList.some((c) => c.id === newId)) {
      showActionToast('That document ID already exists. Choose another.', 'danger');
      return;
    }
    const err = validateDraft(draft);
    if (err) {
      showActionToast(err, 'danger');
      return;
    }
    const okConfirm = window.confirm(
      `Change course id from "${oldId}" to "${newId}"?\n\n` +
        `Learner progress, bookmarks, and links that use the old id will not move automatically. ` +
        `If you use structured ids (e.g. C1M1L1), update module and lesson ids in the editor to match the new course id before continuing.\n\n` +
        `Continue?`
    );
    if (!okConfirm) return;

    setBusy(true);
    const coursePayload: Course = { ...draft, id: newId };
    const saved = await savePublishedCourse(coursePayload);
    if (!saved) {
      setBusy(false);
      showActionToast('Could not save under the new document ID (check console / rules).', 'danger');
      return;
    }
    const deleted = await deletePublishedCourse(oldId);
    setBusy(false);
    await refreshList();
    await onCatalogChanged();
    setDraft(deepClone(coursePayload));
    setBaselineJson(JSON.stringify(coursePayload));
    setSelector(newId);
    setRenameDocId('');
    if (!deleted) {
      showActionToast(
        `Saved as "${newId}", but "${oldId}" could not be deleted — check Console or Firebase Console.`,
        'danger'
      );
    } else {
      showActionToast(`Document ID updated: "${oldId}" -> "${newId}".`);
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
      setRenameDocId('');
      showActionToast('Course deleted.');
    } else {
      showActionToast('Delete failed.', 'danger');
    }
  }, [draft, refreshList, onCatalogChanged, showActionToast]);

  const [cancelDialogVariant, setCancelDialogVariant] = useState<CancelDialogVariant | null>(null);
  const cancelDialogOpen = cancelDialogVariant !== null;

  useBodyScrollLock(cancelDialogOpen || deleteDialogOpen);

  const closeCancelDialog = useCallback(() => setCancelDialogVariant(null), []);

  const commitCancel = useCallback(
    (variant: CancelDialogVariant) => {
      if (!draft || baselineJson === null) return;
      if (variant === 'new-dirty' || variant === 'new-clean') {
        const fresh = emptyCourse(firstAvailableStructuredCourseId(publishedList));
        setDraft(fresh);
        setBaselineJson(JSON.stringify(fresh));
        setRenameDocId('');
        setCancelDialogVariant(null);
        return;
      }
      try {
        const restored = JSON.parse(baselineJson) as Course;
        setDraft(deepClone(restored));
      } catch {
        showActionToast('Could not restore draft.', 'danger');
        return;
      }
      setRenameDocId('');
      setCancelDialogVariant(null);
    },
    [draft, baselineJson, publishedList, showActionToast]
  );

  useDialogKeyboard({
    open: cancelDialogOpen,
    onClose: closeCancelDialog,
    onPrimaryAction: () => {
      if (cancelDialogVariant) commitCancel(cancelDialogVariant);
    },
  });

  useDialogKeyboard({
    open: deleteDialogOpen,
    onClose: closeDeleteDialog,
    onPrimaryAction: () => void confirmDeletePublished(),
  });

  const openCancelDialog = () => {
    if (!draft || baselineJson === null) return;
    const dirty = JSON.stringify(draft) !== baselineJson;
    if (selector === '__new__') {
      setCancelDialogVariant(dirty ? 'new-dirty' : 'new-clean');
      return;
    }
    if (!dirty) return;
    setCancelDialogVariant('published-dirty');
  };

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

  const cancelDialogCopy =
    cancelDialogVariant === 'new-dirty'
      ? {
          title: 'Lose your changes?',
          body: 'You’ll start over with a blank new course. What you typed so far will be cleared.',
          primary: 'Yes, start over',
        }
      : cancelDialogVariant === 'new-clean'
        ? {
            title: 'Start over with a new course?',
            body: 'The form will clear and you’ll get a fresh template to fill in.',
            primary: 'Yes, start fresh',
          }
        : cancelDialogVariant === 'published-dirty'
          ? {
              title: 'Lose your changes?',
              body: 'The course will go back to how it looked when you last saved. Anything you’ve edited since then will be lost.',
              primary: 'Yes, discard',
            }
          : null;

  return (
    <div className="space-y-6 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <BookOpen size={20} className="text-orange-500" />
          Published courses
        </h2>
        <button
          type="button"
          disabled={listLoading}
          onClick={() => {
            catalogRequestedRef.current = true;
            setCatalogRequested(true);
            void refreshList();
          }}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs font-semibold hover:bg-[var(--hover-bg)] disabled:opacity-50"
        >
          <RefreshCw size={14} className={listLoading ? 'animate-spin' : ''} />
          Reload list
        </button>
      </div>

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
        <div className="grid gap-3 grid-cols-1 md:grid-cols-3 md:items-end md:gap-x-3 md:gap-y-3">
          <div className="min-w-0 space-y-1">
            <label className="text-xs font-semibold text-[var(--text-secondary)]">Course</label>
            <select
              value={selector}
              onFocus={openCourseCatalogOnce}
              onMouseDown={openCourseCatalogOnce}
              onChange={(e) => pickCourse(e.target.value)}
              className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
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
                  {sortedPublishedCourses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} ({c.id})
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>
          <div className="min-w-0 space-y-1">
            <label className="text-xs font-semibold text-[var(--text-secondary)]">Document ID</label>
            <div
              className="flex min-h-[42px] w-full min-w-0 items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-mono"
              aria-live="polite"
            >
              {draft ? (
                <span className="truncate text-orange-500/90">{draft.id}</span>
              ) : (
                <span className="text-[var(--text-muted)]">—</span>
              )}
            </div>
          </div>
          <label className="block min-w-0 space-y-1">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">Level</span>
            <select
              value={draft?.level ?? ''}
              disabled={!draft}
              onChange={(e) =>
                draft && updateDraft({ level: e.target.value as Course['level'] })
              }
              className="w-full min-h-[42px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {!draft && (
                <option value="" disabled>
                  —
                </option>
              )}
              <option value="Beginner">Beginner</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
            </select>
          </label>
        </div>
        {selector !== '__new__' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="min-w-0">
              <button
                type="button"
                disabled={
                  listLoading ||
                  !selector ||
                  !publishedList.some((c) => c.id === selector)
                }
                onClick={duplicatePublishedAsDraft}
                title="Clone the selected course into a new draft with a new document ID"
                className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs font-semibold hover:bg-[var(--hover-bg)] disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap"
              >
                <Copy size={14} />
                Duplicate as new draft
              </button>
            </div>
          </div>
        )}
        </div>

        {draft && (
          <div className="space-y-4 border-t border-[var(--border-color)] pt-4">
          {canRenamePublishedDoc && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
              <div>
                <h4 className="text-sm font-bold text-[var(--text-primary)]">Change document ID</h4>
                <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
                  Publishes this course under a new catalog id and removes the old entry. Fix module/lesson ids below if
                  they still use the old course prefix (e.g. rename <code className="text-orange-500/80">C1M1</code>{' '}
                  when moving to <code className="text-orange-500/80">C2</code>).
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="block space-y-1 flex-1 min-w-0">
                  <span className="text-xs font-semibold text-[var(--text-secondary)]">
                    New document ID
                  </span>
                  <input
                    value={renameDocId}
                    onChange={(e) => setRenameDocId(e.target.value)}
                    placeholder={`e.g. not ${draft.id}`}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !renameDocId.trim() || renameDocId.trim() === draft.id}
                  onClick={() => void handleRenameDocumentId()}
                  className="inline-flex items-center justify-center rounded-lg border border-amber-500/50 bg-amber-500/15 px-4 py-2 text-sm font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-500/25 disabled:opacity-40 disabled:pointer-events-none shrink-0"
                >
                  Apply new document ID
                </button>
              </div>
            </div>
          )}

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
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Course title</span>
              <input
                id="admin-course-title"
                value={draft.title}
                onChange={(e) => updateDraft({ title: e.target.value })}
                placeholder="e.g. Full-Stack Web Foundations — short name shown in the catalog"
                className={`w-full bg-[var(--bg-primary)] border rounded-lg px-3 py-2 text-sm ${
                  showValidationHints && fieldErrors.courseTitle
                    ? 'border-red-500'
                    : 'border-[var(--border-color)]'
                }`}
              />
              <span
                className={`min-h-[16px] text-[11px] block ${
                  showValidationHints && fieldErrors.courseTitle ? 'text-red-400' : 'text-transparent'
                }`}
              >
                Title is required.
              </span>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Author</span>
              <input
                id="admin-course-author"
                value={draft.author}
                onChange={(e) => updateDraft({ author: e.target.value })}
                className={`w-full bg-[var(--bg-primary)] border rounded-lg px-3 py-2 text-sm ${
                  showValidationHints && fieldErrors.courseAuthor
                    ? 'border-red-500'
                    : 'border-[var(--border-color)]'
                }`}
              />
              <span
                className={`min-h-[16px] text-[11px] block ${
                  showValidationHints && fieldErrors.courseAuthor ? 'text-red-400' : 'text-transparent'
                }`}
              >
                Author is required.
              </span>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Category</span>
              <select
                value={categorySelectValue}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '__custom__') updateDraft({ category: '' });
                  else updateDraft({ category: v });
                }}
                onBlur={registerDraftCategoryForFilters}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
              >
                {categorySelectOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
                <option value="__custom__">Other (type a custom category)…</option>
              </select>
              {categorySelectValue === '__custom__' && (
                <input
                  value={draft.category}
                  onChange={(e) => updateDraft({ category: e.target.value })}
                  onBlur={registerDraftCategoryForFilters}
                  placeholder="Type a new category name…"
                  className="mt-2 w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
                />
              )}
              <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-relaxed">
                All preset and known categories appear in the list. Pick <strong className="text-[var(--text-secondary)]">Other</strong> to type a new name; it is added to Course Library filters when you leave the custom field or save.
              </p>
            </label>
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
                  <span
                    className={`min-h-[16px] text-[11px] ${
                      showValidationHints && fieldErrors.courseRating ? 'text-red-400' : 'text-transparent'
                    }`}
                  >
                    Rating must be 0–5.
                  </span>
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
                <span
                  className={`min-h-[16px] text-[11px] block ${
                    showValidationHints && fieldErrors.courseThumbnail ? 'text-red-400' : 'text-transparent'
                  }`}
                >
                  Thumbnail URL is required.
                </span>
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

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              disabled={busy || !draft || (baselineJson !== null && !isDirty)}
              onClick={() => void handleSave()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-50"
            >
              <Save size={18} />
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            {showCancel && (
              <button
                type="button"
                disabled={busy}
                onClick={openCancelDialog}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] hover:bg-[var(--hover-bg)] disabled:opacity-50 px-6 py-3 text-sm font-bold text-[var(--text-secondary)]"
              >
                <RotateCcw size={18} />
                Cancel
              </button>
            )}
            <button
              type="button"
              disabled={busy || !publishedList.some((c) => c.id === draft.id)}
              onClick={openDeleteDialog}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/40 px-6 py-3 text-sm font-bold text-red-400 hover:bg-red-500/10 disabled:opacity-30"
            >
              <Trash2 size={18} />
              Delete published
            </button>
          </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {cancelDialogOpen && cancelDialogCopy && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-catalog-cancel-title"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-[var(--border-color)] flex items-center justify-between gap-4">
                <h2
                  id="admin-catalog-cancel-title"
                  className="text-xl font-bold text-[var(--text-primary)]"
                >
                  {cancelDialogCopy.title}
                </h2>
                <button
                  type="button"
                  onClick={closeCancelDialog}
                  className="p-2 hover:bg-[var(--hover-bg)] rounded-full transition-colors shrink-0"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{cancelDialogCopy.body}</p>
                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeCancelDialog}
                    className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] hover:bg-[var(--hover-bg)] px-5 py-3 text-sm font-bold text-[var(--text-secondary)] transition-colors"
                  >
                    Keep editing
                  </button>
                  <button
                    type="button"
                    autoFocus
                    onClick={() => commitCancel(cancelDialogVariant!)}
                    aria-label={
                      cancelDialogVariant === 'published-dirty'
                        ? 'Discard unsaved changes and restore the last saved version of this course'
                        : cancelDialogVariant === 'new-dirty'
                          ? 'Discard changes and start over with a new course draft'
                          : cancelDialogVariant === 'new-clean'
                            ? 'Clear the form and start a fresh course draft'
                            : undefined
                    }
                    className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl bg-orange-500 hover:bg-orange-600 text-white px-5 py-3 text-sm font-bold transition-colors"
                  >
                    {cancelDialogCopy.primary}
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
