import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, Copy, Plus, RotateCcw, Save, Trash2, RefreshCw, X } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
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
}

export const AdminCourseCatalogSection: React.FC<AdminCourseCatalogSectionProps> = ({
  onCatalogChanged,
}) => {
  const [publishedList, setPublishedList] = useState<Course[]>([]);
  /** '' = none selected; avoids loading Firestore until the user opens the Course dropdown. */
  const [selector, setSelector] = useState<string>('');
  const [draft, setDraft] = useState<Course | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  /** True after first focus on Course select or explicit Reload list — then options include New Course + published. */
  const [catalogRequested, setCatalogRequested] = useState(false);
  const catalogRequestedRef = useRef(false);
  /** Target id when renaming an already-published course (Firestore doc id change). */
  const [renameDocId, setRenameDocId] = useState('');
  /** JSON snapshot of draft when last loaded / saved — for dirty detection and Cancel. */
  const [baselineJson, setBaselineJson] = useState<string | null>(null);
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
    setMsg(null);
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
  };

  const removeModule = (mi: number) => {
    setDraft((d) => {
      if (!d || d.modules.length <= 1) return d;
      return { ...d, modules: d.modules.filter((_, i) => i !== mi) };
    });
  };

  const addLesson = (mi: number) => {
    setDraft((d) => {
      if (!d) return null;
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
    setDraft((d) => {
      if (!d) return null;
      const modules = d.modules.map((m, i) => {
        if (i !== mi) return m;
        if (m.lessons.length <= 1) return m;
        return { ...m, lessons: m.lessons.filter((_, j) => j !== li) };
      });
      return { ...d, modules };
    });
  };

  const validateDraft = (c: Course): string | null => {
    if (!c.title.trim()) return 'Title is required.';
    if (!c.author.trim()) return 'Author is required.';
    if (!c.thumbnail.trim()) return 'Thumbnail URL is required.';
    if (!c.modules.length) return 'At least one module is required.';
    for (const m of c.modules) {
      if (!m.lessons.length) return 'Each module needs at least one lesson.';
      for (const l of m.lessons) {
        if (!l.videoUrl.trim() || !l.videoUrl.startsWith('http')) return 'Every lesson needs a valid video URL.';
      }
    }
    if (c.rating < 0 || c.rating > 5) return 'Rating must be 0–5.';
    return null;
  };

  const handleSave = async () => {
    if (!draft) return;
    const err = validateDraft(draft);
    if (err) {
      setMsg(err);
      return;
    }
    setBusy(true);
    setMsg(null);
    const ok = await savePublishedCourse(draft);
    setBusy(false);
    if (ok) {
      if (draft.category.trim()) addCatalogCategoryExtra(draft.category.trim());
      setMsg('Saved to Firestore.');
      await refreshList();
      await onCatalogChanged();
      setSelector(draft.id);
      setBaselineJson(JSON.stringify(draft));
    } else setMsg('Save failed (check console / rules).');
  };

  const duplicatePublishedAsDraft = () => {
    setMsg(null);
    if (!selector || selector === '__new__') {
      setMsg('Select an existing published course in the list, then duplicate.');
      return;
    }
    const fromEditor =
      draft && draft.id === selector ? draft : publishedList.find((c) => c.id === selector);
    if (!fromEditor) {
      setMsg('Course not found. Reload the list and try again.');
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
    setMsg('Copy loaded as a new draft — IDs use C{n}M{m}L{l}. Adjust title if needed, then Save.');
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
      setMsg('Enter a new document ID that is different from the current one.');
      return;
    }
    if (!SLUG_RE.test(newId)) {
      setMsg('Document ID: letters, numbers, hyphens only; 1–119 chars; must start with alphanumeric.');
      return;
    }
    if (publishedList.some((c) => c.id === newId)) {
      setMsg('That document ID already exists. Choose another.');
      return;
    }
    const err = validateDraft(draft);
    if (err) {
      setMsg(err);
      return;
    }
    const okConfirm = window.confirm(
      `Change Firestore document from "${oldId}" to "${newId}"?\n\n` +
        `This updates the publishedCourses document path. Learner progress, bookmarks, and URLs that use the old id will not move automatically. ` +
        `If you use structured ids (e.g. C1M1L1), update module and lesson ids in the editor to match the new course id before continuing.\n\n` +
        `Continue?`
    );
    if (!okConfirm) return;

    setBusy(true);
    setMsg(null);
    const coursePayload: Course = { ...draft, id: newId };
    const saved = await savePublishedCourse(coursePayload);
    if (!saved) {
      setBusy(false);
      setMsg('Could not save under the new document ID (check console / rules).');
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
      setMsg(
        `Saved as "${newId}". The old document "${oldId}" could not be deleted — remove the duplicate manually in Firebase Console.`
      );
    } else {
      setMsg(`Document ID updated: "${oldId}" → "${newId}".`);
    }
  };

  const handleDelete = async () => {
    if (!draft) return;
    if (!window.confirm('Delete published course "' + draft.id + '" from Firestore?')) return;
    setBusy(true);
    setMsg(null);
    const ok = await deletePublishedCourse(draft.id);
    setBusy(false);
    if (ok) {
      const list = await refreshList();
      await onCatalogChanged();
      const nextId = firstAvailableStructuredCourseId(list);
      const fresh = emptyCourse(nextId);
      setDraft(fresh);
      setBaselineJson(JSON.stringify(fresh));
      setSelector('__new__');
      setRenameDocId('');
      setMsg('Course deleted.');
    } else setMsg('Delete failed.');
  };

  const isDirty =
    !!draft &&
    baselineJson !== null &&
    JSON.stringify(draft) !== baselineJson;

  const showCancel =
    !!draft && baselineJson !== null && (selector === '__new__' || isDirty);

  const [cancelDialogVariant, setCancelDialogVariant] = useState<CancelDialogVariant | null>(null);
  const cancelDialogOpen = cancelDialogVariant !== null;

  useBodyScrollLock(cancelDialogOpen);

  const closeCancelDialog = useCallback(() => setCancelDialogVariant(null), []);

  const commitCancel = useCallback(
    (variant: CancelDialogVariant) => {
      if (!draft || baselineJson === null) return;
      if (variant === 'new-dirty' || variant === 'new-clean') {
        const fresh = emptyCourse(firstAvailableStructuredCourseId(publishedList));
        setDraft(fresh);
        setBaselineJson(JSON.stringify(fresh));
        setMsg(null);
        setRenameDocId('');
        setCancelDialogVariant(null);
        return;
      }
      try {
        const restored = JSON.parse(baselineJson) as Course;
        setDraft(deepClone(restored));
      } catch {
        setMsg('Could not restore draft.');
        return;
      }
      setRenameDocId('');
      setMsg(null);
      setCancelDialogVariant(null);
    },
    [draft, baselineJson, publishedList]
  );

  useDialogKeyboard({
    open: cancelDialogOpen,
    onClose: closeCancelDialog,
    onPrimaryAction: () => {
      if (cancelDialogVariant) commitCancel(cancelDialogVariant);
    },
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

  const cancelDialogCopy =
    cancelDialogVariant === 'new-dirty'
      ? {
          title: 'Discard unsaved changes?',
          body: 'Your edits to this new course will be lost. The form will reset to a fresh draft with the next available document ID (e.g. C1, C2…).',
          primary: 'Discard and reset',
        }
      : cancelDialogVariant === 'new-clean'
        ? {
            title: 'Start a fresh draft?',
            body: 'Reset to a new course template with the next available document ID.',
            primary: 'Reset draft',
          }
        : cancelDialogVariant === 'published-dirty'
          ? {
              title: 'Discard unsaved changes?',
              body: 'Reload the last saved copy from Firestore. Any edits you have not saved will be lost.',
              primary: 'Reload saved copy',
            }
          : null;

  return (
    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
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
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--hover-bg)] disabled:opacity-50"
        >
          <RefreshCw size={14} className={listLoading ? 'animate-spin' : ''} />
          Reload list
        </button>
      </div>

      <p className="text-xs text-[var(--text-muted)] leading-relaxed">
        Edits write to <code className="text-orange-500/90">publishedCourses</code>. Seed from the Alerts tab if empty.
        Open <strong className="text-[var(--text-secondary)]">Course</strong> once to load the list (no query until then).
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

        {msg && (
          <p className="text-sm text-[var(--text-secondary)] border border-[var(--border-color)] rounded-xl px-4 py-3 bg-[var(--bg-primary)]/50">
            {msg}
          </p>
        )}

        {draft && (
          <div className="space-y-4 border-t border-[var(--border-color)] pt-4">
          {canRenamePublishedDoc && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
              <div>
                <h4 className="text-sm font-bold text-[var(--text-primary)]">Change document ID</h4>
                <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
                  Creates a new <code className="text-orange-500/90">publishedCourses</code> document
                  with this content and deletes the old one. Fix module/lesson ids below if they still
                  use the old course prefix (e.g. rename <code className="text-orange-500/80">C1M1</code>{' '}
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

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Course title</span>
              <input
                value={draft.title}
                onChange={(e) => updateDraft({ title: e.target.value })}
                placeholder="e.g. Full-Stack Web Foundations — short name shown in the catalog"
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Author</span>
              <input
                value={draft.author}
                onChange={(e) => updateDraft({ author: e.target.value })}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
              />
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
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    value={draft.rating}
                    onChange={(e) => updateDraft({ rating: Number(e.target.value) })}
                    className="box-border w-full min-w-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                </label>
              </div>
              <label className="block min-w-0 flex-1 space-y-1">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">Thumbnail URL</span>
                <input
                  value={draft.thumbnail}
                  onChange={(e) => updateDraft({ thumbnail: e.target.value })}
                  className="w-full min-w-0 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm font-mono"
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

          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-primary)]">Modules and lessons</h3>
                <p className="text-xs text-[var(--text-muted)] mt-1 max-w-xl">
                  Each module is a group of lessons. IDs are stored in Firestore and used for progress and links; titles are what learners see.
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
                  <div>
                    <h4 className="text-sm font-bold text-[var(--text-primary)]">Module {mi + 1}</h4>
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

                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-x-3">
                  <label className="inline-flex w-max max-w-full shrink-0 flex-col gap-1">
                    <span className="whitespace-nowrap text-xs font-semibold text-[var(--text-secondary)]">
                      Module ID
                    </span>
                    <input
                      value={mod.id}
                      onChange={(e) => updateModule(mi, { id: e.target.value })}
                      className="box-border w-full min-w-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 font-mono text-sm"
                    />
                  </label>
                  <label className="block min-w-0 flex-1 space-y-1">
                    <span className="text-xs font-semibold text-[var(--text-secondary)]">Module title</span>
                    <input
                      value={mod.title}
                      onChange={(e) => updateModule(mi, { title: e.target.value })}
                      className="w-full text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2"
                      placeholder="e.g. HTML & CSS fundamentals — section title in the syllabus"
                    />
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
                      <p className="text-xs font-bold text-[var(--text-primary)]">Lesson {li + 1}</p>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-x-3">
                        <label className="inline-flex w-max max-w-full shrink-0 flex-col gap-1">
                          <span className="whitespace-nowrap text-xs font-semibold text-[var(--text-secondary)]">
                            Lesson ID
                          </span>
                          <input
                            value={lesson.id}
                            onChange={(e) => updateLesson(mi, li, { id: e.target.value })}
                            className="box-border w-full min-w-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 font-mono text-sm"
                          />
                        </label>
                        <label className="block min-w-0 flex-1 space-y-1">
                          <span className="text-xs font-semibold text-[var(--text-secondary)]">Lesson title</span>
                          <input
                            value={lesson.title}
                            onChange={(e) => updateLesson(mi, li, { title: e.target.value })}
                            className="w-full text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2"
                            placeholder="e.g. Semantic HTML & page structure — lesson name under the module"
                          />
                        </label>
                      </div>
                      <label className="block space-y-1">
                        <span className="text-xs font-semibold text-[var(--text-secondary)]">Video URL</span>
                        <input
                          value={lesson.videoUrl}
                          onChange={(e) => updateLesson(mi, li, { videoUrl: e.target.value })}
                          className="w-full text-sm font-mono bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2"
                          placeholder="https://www.youtube.com/watch?v=…"
                        />
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
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSave()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-6 py-3 text-sm font-bold"
            >
              <Save size={18} />
              {busy ? 'Saving…' : 'Save to Firestore'}
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
              onClick={() => void handleDelete()}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-30 px-6 py-3 text-sm font-bold"
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
    </div>
  );
};
