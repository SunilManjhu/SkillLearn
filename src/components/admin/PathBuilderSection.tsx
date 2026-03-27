import React, {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Loader2,
  Route,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import type { Course } from '../../data/courses';
import type { LearningPath } from '../../data/learningPaths';
import { firstAvailableStructuredLearningPathId } from '../../utils/learningPathStructuredIds';
import {
  isStructuredCourseId,
  remapStructuredCourseModuleLessonIdsByOrder,
} from '../../utils/courseStructuredIds';
import { validateCourseDraft } from '../../utils/courseDraftValidation';
import {
  deleteLearningPath,
  loadLearningPathsFromFirestore,
  saveLearningPath,
} from '../../utils/learningPathsFirestore';
import { savePublishedCourse } from '../../utils/publishedCoursesFirestore';
import { useAdminActionToast } from './useAdminActionToast';

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function sortablePc(courseId: string): string {
  return `pc:${courseId}`;
}
function sortableCm(courseId: string, mi: number): string {
  return `cm:${courseId}:${mi}`;
}
function sortableMl(courseId: string, mi: number, li: number): string {
  return `ml:${courseId}:${mi}:${li}`;
}

function parsePc(id: string): string | null {
  if (!id.startsWith('pc:')) return null;
  return id.slice(3);
}
function parseCm(id: string): { courseId: string; mi: number } | null {
  if (!id.startsWith('cm:')) return null;
  const rest = id.slice(3);
  const parts = rest.split(':');
  if (parts.length < 2) return null;
  const mi = parseInt(parts[parts.length - 1], 10);
  const courseId = parts.slice(0, -1).join(':');
  if (Number.isNaN(mi)) return null;
  return { courseId, mi };
}
function parseMl(id: string): { courseId: string; mi: number; li: number } | null {
  if (!id.startsWith('ml:')) return null;
  const rest = id.slice(3);
  const parts = rest.split(':');
  if (parts.length < 3) return null;
  const li = parseInt(parts[parts.length - 1], 10);
  const mi = parseInt(parts[parts.length - 2], 10);
  const courseId = parts.slice(0, -2).join(':');
  if (Number.isNaN(mi) || Number.isNaN(li)) return null;
  return { courseId, mi, li };
}

function SortableHandle(props: React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-muted)] hover:bg-[var(--hover-bg)] touch-manipulation"
      aria-label="Drag to reorder"
      {...props}
    >
      <GripVertical size={18} aria-hidden />
    </button>
  );
}

function PathCourseRow({
  id,
  courseId,
  title,
  thumbnail,
  expanded,
  onToggle,
  onRemove,
  children,
}: {
  id: string;
  courseId: string;
  title: string;
  thumbnail?: string;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  children?: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/40 overflow-hidden"
    >
      <div className="flex flex-wrap items-center gap-2 p-3 sm:p-4">
        <SortableHandle {...attributes} {...listeners} />
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            className="h-12 w-[4.5rem] shrink-0 rounded-lg object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex max-w-full items-center gap-1.5 text-left text-sm font-bold text-[var(--text-primary)]"
          >
            {expanded ? <ChevronDown size={16} className="shrink-0" /> : <ChevronRight size={16} className="shrink-0" />}
            <span className="truncate">{title}</span>
          </button>
          <p className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)] truncate">{courseId}</p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10"
          aria-label="Remove course from path"
        >
          <Trash2 size={18} />
        </button>
      </div>
      {expanded ? <div className="border-t border-[var(--border-color)] px-3 py-4 sm:px-4">{children}</div> : null}
    </div>
  );
}

function ModuleRow({
  id,
  moduleTitle,
  moduleIndexLabel,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  moduleTitle: string;
  moduleIndexLabel: string;
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-lg border border-[var(--border-color)]/80 bg-[var(--bg-secondary)]/50"
    >
      <div className="flex flex-wrap items-center gap-2 p-2">
        <SortableHandle {...attributes} {...listeners} />
        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex-1 text-left text-sm font-semibold text-[var(--text-primary)]"
        >
          {expanded ? <ChevronDown size={14} className="mr-1 inline" /> : <ChevronRight size={14} className="mr-1 inline" />}
          {moduleIndexLabel}: <span className="font-normal">{moduleTitle || 'Untitled module'}</span>
        </button>
      </div>
      {expanded ? <div className="border-t border-[var(--border-color)]/60 px-2 py-3">{children}</div> : null}
    </div>
  );
}

function LessonRow({
  id,
  title,
  lessonId,
}: {
  id: string;
  title: string;
  lessonId: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-lg border border-[var(--border-color)]/60 bg-[var(--bg-primary)]/30 px-2 py-2"
    >
      <SortableHandle {...attributes} {...listeners} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-[var(--text-primary)]">{title || 'Untitled lesson'}</p>
        <p className="truncate font-mono text-[10px] text-[var(--text-muted)]">{lessonId}</p>
      </div>
    </div>
  );
}

export interface PathBuilderSectionProps {
  publishedList: Course[];
  onRefreshPublishedList: () => Promise<void>;
  onCatalogChanged: () => void | Promise<void>;
  onPathsDirtyChange?: (dirty: boolean) => void;
  /** For parent header: disable Reload while paths are loading. */
  onPathsLoadingChange?: (loading: boolean) => void;
}

export interface PathBuilderSectionHandle {
  reloadPaths: () => Promise<void>;
}

export const PathBuilderSection = forwardRef<PathBuilderSectionHandle, PathBuilderSectionProps>(
  function PathBuilderSection(
    {
      publishedList,
      onRefreshPublishedList,
      onCatalogChanged,
      onPathsDirtyChange,
      onPathsLoadingChange,
    },
    ref
  ) {
  const { showActionToast, actionToast } = useAdminActionToast();
  const [paths, setPaths] = useState<LearningPath[]>([]);
  const [pathsLoading, setPathsLoading] = useState(true);
  const [pathBusy, setPathBusy] = useState(false);
  const [pathSelector, setPathSelector] = useState<string>('');
  /** Bumps when starting a new path draft so we focus Path title even if the allocated id matches the previous draft. */
  const [pathTitleFocusKey, setPathTitleFocusKey] = useState(0);
  /** Shown after Save path when the path has no courses (inline hint like module field errors). */
  const [showPathCourseRequiredHint, setShowPathCourseRequiredHint] = useState(false);
  const [pathDraft, setPathDraft] = useState<LearningPath | null>(null);
  const [pathBaselineJson, setPathBaselineJson] = useState<string | null>(null);

  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);
  const [openModuleIdx, setOpenModuleIdx] = useState<Record<string, boolean>>({});
  const [courseEditDraft, setCourseEditDraft] = useState<Course | null>(null);
  const [courseEditBaseline, setCourseEditBaseline] = useState<string | null>(null);

  type PathConfirmKind =
    | { kind: 'pickNewPath' }
    | { kind: 'switchPath'; targetId: string }
    | { kind: 'collapseCourse'; nextExpanded: string | null }
    | { kind: 'discardDraft' }
    | { kind: 'deletePublished' };

  const [pathConfirmDialog, setPathConfirmDialog] = useState<PathConfirmKind | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const refreshPaths = useCallback(async () => {
    setPathsLoading(true);
    const list = await loadLearningPathsFromFirestore();
    setPaths(list);
    setPathsLoading(false);
    return list;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      reloadPaths: () => refreshPaths(),
    }),
    [refreshPaths]
  );

  useEffect(() => {
    onPathsLoadingChange?.(pathsLoading);
  }, [pathsLoading, onPathsLoadingChange]);

  useEffect(() => {
    void refreshPaths();
  }, [refreshPaths]);

  useEffect(() => {
    if (pathSelector !== '__new__' || !pathDraft || pathTitleFocusKey === 0) return;
    const rafId = requestAnimationFrame(() => {
      const el = document.getElementById('admin-path-title') as HTMLInputElement | null;
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(rafId);
  }, [pathSelector, pathDraft?.id, pathTitleFocusKey]);

  useEffect(() => {
    if (!pathSelector) {
      setPathDraft(null);
      setPathBaselineJson(null);
      return;
    }
    if (pathSelector === '__new__') {
      return;
    }
    const found = paths.find((x) => x.id === pathSelector);
    if (!found) return;
    setPathDraft((prev) => {
      if (prev?.id === pathSelector) return prev;
      const clone = deepClone(found);
      setPathBaselineJson(JSON.stringify(clone));
      return clone;
    });
  }, [pathSelector, paths]);

  const pathDirty = useMemo(
    () =>
      !!pathDraft &&
      pathBaselineJson !== null &&
      JSON.stringify(pathDraft) !== pathBaselineJson,
    [pathDraft, pathBaselineJson]
  );

  const courseDirty = useMemo(
    () =>
      !!courseEditDraft &&
      courseEditBaseline !== null &&
      JSON.stringify(courseEditDraft) !== courseEditBaseline,
    [courseEditDraft, courseEditBaseline]
  );

  const sortedPaths = useMemo(
    () =>
      [...paths].sort((a, b) => {
        const byTitle = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
        return byTitle !== 0 ? byTitle : a.id.localeCompare(b.id);
      }),
    [paths]
  );

  const applyPickNewPath = useCallback(() => {
    setCourseEditDraft(null);
    setCourseEditBaseline(null);
    setExpandedCourseId(null);
    const reserveIds = pathSelector === '__new__' && pathDraft?.id ? [pathDraft.id] : [];
    const newId = firstAvailableStructuredLearningPathId(paths, reserveIds);
    const fresh: LearningPath = { id: newId, title: '', courseIds: [] };
    setShowPathCourseRequiredHint(false);
    setPathTitleFocusKey((k) => k + 1);
    setPathSelector('__new__');
    setPathDraft(fresh);
    setPathBaselineJson(JSON.stringify(fresh));
  }, [pathSelector, pathDraft, paths]);

  const pickPath = useCallback(
    (id: string) => {
      if (id === '') return;

      if (id === '__new__') {
        if (pathDirty || courseDirty) {
          setPathConfirmDialog({ kind: 'pickNewPath' });
          return;
        }
        applyPickNewPath();
        return;
      }

      if ((pathDirty || courseDirty) && pathSelector !== id) {
        setPathConfirmDialog({ kind: 'switchPath', targetId: id });
        return;
      }
      setPathSelector(id);
    },
    [pathDirty, courseDirty, pathSelector, applyPickNewPath]
  );

  const closePathConfirmDialog = useCallback(() => setPathConfirmDialog(null), []);

  const loadExpandedCourse = useCallback(
    (courseId: string) => {
      const c = publishedList.find((x) => x.id === courseId);
      if (!c) {
        showActionToast('Course not found in catalog. Reload the list.', 'danger');
        setExpandedCourseId(null);
        return;
      }
      const draft = deepClone(c);
      setCourseEditDraft(draft);
      setCourseEditBaseline(JSON.stringify(draft));
      setExpandedCourseId(courseId);
      setOpenModuleIdx({ 0: true });
    },
    [publishedList, showActionToast]
  );

  const confirmPathDialogPrimary = useCallback(() => {
    const d = pathConfirmDialog;
    if (!d) return;
    setPathConfirmDialog(null);

    if (d.kind === 'pickNewPath') {
      applyPickNewPath();
      return;
    }
    if (d.kind === 'switchPath') {
      setCourseEditDraft(null);
      setCourseEditBaseline(null);
      setExpandedCourseId(null);
      setPathSelector(d.targetId);
      return;
    }
    if (d.kind === 'collapseCourse') {
      setCourseEditDraft(null);
      setCourseEditBaseline(null);
      setOpenModuleIdx({});
      if (d.nextExpanded === null) {
        setExpandedCourseId(null);
        return;
      }
      loadExpandedCourse(d.nextExpanded);
      return;
    }
    if (d.kind === 'discardDraft') {
      setPathSelector('');
      setPathDraft(null);
      setPathBaselineJson(null);
      setCourseEditDraft(null);
      setCourseEditBaseline(null);
      setExpandedCourseId(null);
      return;
    }
    if (d.kind === 'deletePublished') {
      const id = pathDraft?.id;
      if (!id) return;
      void (async () => {
        setPathBusy(true);
        const deleted = await deleteLearningPath(id);
        setPathBusy(false);
        if (deleted) {
          showActionToast('Learning path deleted.');
          setPathSelector('');
          setPathDraft(null);
          setPathBaselineJson(null);
          await refreshPaths();
          await onCatalogChanged();
        } else {
          showActionToast('Delete failed.', 'danger');
        }
      })();
    }
  }, [
    pathConfirmDialog,
    pathDraft,
    applyPickNewPath,
    loadExpandedCourse,
    refreshPaths,
    onCatalogChanged,
    showActionToast,
  ]);

  const pathConfirmCopy = useMemo(() => {
    if (!pathConfirmDialog) return null;
    switch (pathConfirmDialog.kind) {
      case 'pickNewPath':
        return {
          title: 'Leave without saving?',
          body:
            pathSelector === '__new__'
              ? 'Discard unsaved changes and start a new path again?'
              : 'Discard unsaved changes and create a new path?',
          primary: 'Discard and continue',
        };
      case 'switchPath':
        return {
          title: 'Leave without saving?',
          body: 'Discard unsaved changes and switch paths?',
          primary: 'Discard and switch',
        };
      case 'collapseCourse':
        return {
          title: 'Leave without saving?',
          body: 'You have unsaved changes to the course structure. Discard them and continue?',
          primary: 'Discard and continue',
        };
      case 'discardDraft':
        return {
          title: 'Discard this path?',
          body: 'Your changes will be lost.',
          primary: 'Discard',
        };
      case 'deletePublished':
        return {
          title: 'Delete learning path?',
          body: pathDraft
            ? `Delete "${pathDraft.title}"? This cannot be undone.`
            : 'This cannot be undone.',
          primary: 'Delete path',
        };
      default:
        return null;
    }
  }, [pathConfirmDialog, pathSelector, pathDraft]);

  useBodyScrollLock(!!pathConfirmDialog);

  useDialogKeyboard({
    open: !!pathConfirmDialog,
    onClose: closePathConfirmDialog,
    onPrimaryAction: confirmPathDialogPrimary,
  });

  useEffect(() => {
    onPathsDirtyChange?.(pathDirty || courseDirty);
    return () => onPathsDirtyChange?.(false);
  }, [pathDirty, courseDirty, onPathsDirtyChange]);

  useEffect(() => {
    if ((pathDraft?.courseIds.length ?? 0) > 0) {
      setShowPathCourseRequiredHint(false);
    }
  }, [pathDraft?.courseIds.length]);

  const toggleCourseExpand = (courseId: string) => {
    if (expandedCourseId === courseId) {
      if (courseDirty) {
        setPathConfirmDialog({ kind: 'collapseCourse', nextExpanded: null });
        return;
      }
      setCourseEditDraft(null);
      setCourseEditBaseline(null);
      setOpenModuleIdx({});
      setExpandedCourseId(null);
      return;
    }
    if (courseDirty) {
      setPathConfirmDialog({ kind: 'collapseCourse', nextExpanded: courseId });
      return;
    }
    loadExpandedCourse(courseId);
  };

  const handleSavePath = async () => {
    if (!pathDraft) return;
    if (!pathDraft.title.trim()) {
      setShowPathCourseRequiredHint(false);
      showActionToast('Path title is required.', 'danger');
      return;
    }
    if (pathDraft.courseIds.length === 0) {
      if (publishedList.length === 0) {
        setShowPathCourseRequiredHint(false);
        showActionToast(
          'Publish at least one course in the Catalog tab before saving a path.',
          'danger'
        );
        return;
      }
      setShowPathCourseRequiredHint(true);
      requestAnimationFrame(() => {
        const el = document.getElementById('admin-path-add-course') as HTMLSelectElement | null;
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus({ preventScroll: true });
      });
      return;
    }
    for (const cid of pathDraft.courseIds) {
      if (!publishedList.some((c) => c.id === cid)) {
        setShowPathCourseRequiredHint(false);
        showActionToast(`Course "${cid}" is not in the published catalog. Remove it or publish the course first.`, 'danger');
        return;
      }
    }
    setPathBusy(true);
    const ok = await saveLearningPath(pathDraft);
    setPathBusy(false);
    if (ok) {
      setShowPathCourseRequiredHint(false);
      showActionToast('Learning path saved.');
      const list = await refreshPaths();
      const still = list.find((x) => x.id === pathDraft.id);
      if (still) {
        setPathDraft(deepClone(still));
        setPathBaselineJson(JSON.stringify(still));
        setPathSelector(still.id);
      }
      await onCatalogChanged();
    } else {
      showActionToast('Could not save path (check console / rules).', 'danger');
    }
  };

  const requestDeletePath = () => {
    if (!pathDraft) return;
    const persisted = paths.some((p) => p.id === pathDraft.id);
    if (!persisted) {
      setPathConfirmDialog({ kind: 'discardDraft' });
      return;
    }
    setPathConfirmDialog({ kind: 'deletePublished' });
  };

  const handleSaveCourseStructure = async () => {
    if (!courseEditDraft) return;
    const err = validateCourseDraft(courseEditDraft);
    if (err) {
      showActionToast(err, 'danger');
      return;
    }
    setPathBusy(true);
    const ok = await savePublishedCourse(courseEditDraft);
    setPathBusy(false);
    if (ok) {
      showActionToast('Course structure saved.');
      await onRefreshPublishedList();
      await onCatalogChanged();
      const updated = deepClone(courseEditDraft);
      setCourseEditDraft(updated);
      setCourseEditBaseline(JSON.stringify(updated));
    } else {
      showActionToast('Save failed (check console / rules).', 'danger');
    }
  };

  const addCourseToPath = (courseId: string) => {
    if (!pathDraft) return;
    if (pathDraft.courseIds.includes(courseId)) {
      showActionToast('That course is already in this path.', 'neutral');
      return;
    }
    setShowPathCourseRequiredHint(false);
    setPathDraft((p) => {
      if (!p) return p;
      return { ...p, courseIds: [...p.courseIds, courseId] };
    });
  };

  const removeCourseFromPath = (courseId: string) => {
    setPathDraft((p) => {
      if (!p) return p;
      return { ...p, courseIds: p.courseIds.filter((id) => id !== courseId) };
    });
    if (expandedCourseId === courseId) {
      setCourseEditDraft(null);
      setCourseEditBaseline(null);
      setExpandedCourseId(null);
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const aid = String(active.id);
    const oid = String(over.id);

    if (aid.startsWith('pc:')) {
      if (!pathDraft || !oid.startsWith('pc:')) return;
      const items = pathDraft.courseIds.map((id) => sortablePc(id));
      const oldIndex = items.indexOf(aid);
      const newIndex = items.indexOf(oid);
      if (oldIndex === -1 || newIndex === -1) return;
      setPathDraft((p) => {
        if (!p) return p;
        return { ...p, courseIds: arrayMove(p.courseIds, oldIndex, newIndex) };
      });
      return;
    }

    if (aid.startsWith('cm:')) {
      const a = parseCm(aid);
      const o = parseCm(oid);
      if (!a || !o || a.courseId !== o.courseId || !courseEditDraft || courseEditDraft.id !== a.courseId) return;
      const items = courseEditDraft.modules.map((_, mi) => sortableCm(a.courseId, mi));
      const oldIndex = items.indexOf(aid);
      const newIndex = items.indexOf(oid);
      if (oldIndex === -1 || newIndex === -1) return;
      setCourseEditDraft((c) => {
        if (!c || c.id !== a.courseId) return c;
        let modules = arrayMove(c.modules, oldIndex, newIndex);
        let next: Course = { ...c, modules };
        if (isStructuredCourseId(next.id)) {
          next = remapStructuredCourseModuleLessonIdsByOrder(next);
        }
        return next;
      });
      return;
    }

    if (aid.startsWith('ml:')) {
      const a = parseMl(aid);
      const o = parseMl(oid);
      if (!a || !o || a.courseId !== o.courseId || a.mi !== o.mi || !courseEditDraft || courseEditDraft.id !== a.courseId) {
        return;
      }
      const mod = courseEditDraft.modules[a.mi];
      if (!mod) return;
      const items = mod.lessons.map((_, li) => sortableMl(a.courseId, a.mi, li));
      const oldIndex = items.indexOf(aid);
      const newIndex = items.indexOf(oid);
      if (oldIndex === -1 || newIndex === -1) return;
      setCourseEditDraft((c) => {
        if (!c || c.id !== a.courseId) return c;
        const modules = c.modules.map((m, mi) => {
          if (mi !== a.mi) return m;
          const lessons = arrayMove(m.lessons, oldIndex, newIndex);
          return { ...m, lessons };
        });
        let next: Course = { ...c, modules };
        if (isStructuredCourseId(next.id)) {
          next = remapStructuredCourseModuleLessonIdsByOrder(next);
        }
        return next;
      });
    }
  };

  const availableCoursesToAdd = useMemo(() => {
    if (!pathDraft) return [];
    return publishedList.filter((c) => !pathDraft.courseIds.includes(c.id));
  }, [pathDraft, publishedList]);

  return (
    <div className="min-w-0 w-full space-y-4">
      {actionToast}

      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:items-start md:gap-x-3 md:gap-y-3">
          <div className="flex min-w-0 flex-col gap-1">
            <label
              htmlFor="admin-learning-path-select"
              className="text-xs font-semibold text-[var(--text-secondary)]"
            >
              Learning path
            </label>
            <select
              id="admin-learning-path-select"
              value={pathSelector}
              onChange={(e) => pickPath(e.target.value)}
              disabled={pathsLoading}
              className="box-border min-h-[42px] w-full min-w-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="" disabled>
                {pathsLoading ? 'Loading paths…' : 'Select a path…'}
              </option>
              {!pathsLoading && (
                <>
                  <option value="__new__">New path</option>
                  {sortedPaths.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({p.id})
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">Document ID</span>
            <div
              className="box-border flex min-h-[42px] w-full min-w-0 items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-mono text-[var(--text-primary)]"
              aria-live="polite"
            >
              {pathDraft ? (
                <span className="truncate text-orange-500/90">{pathDraft.id}</span>
              ) : (
                <span className="text-[var(--text-muted)]">—</span>
              )}
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">Courses in path</span>
            <div
              className="box-border flex min-h-[42px] w-full min-w-0 items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
              aria-live="polite"
            >
              {pathDraft ? (
                <span>{pathDraft.courseIds.length}</span>
              ) : (
                <span className="text-[var(--text-muted)]">—</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pathBusy || !pathDraft || !pathDirty}
            onClick={() => void handleSavePath()}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-500 px-5 py-2 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-40"
          >
            {pathBusy ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            Save path
          </button>
          <button
            type="button"
            disabled={pathBusy || !pathDraft}
            onClick={requestDeletePath}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-500/40 px-5 py-2 text-sm font-bold text-red-400 hover:bg-red-500/10 disabled:opacity-40"
          >
            <Trash2 size={18} />
            Delete path
          </button>
        </div>
      </div>

      {pathsLoading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <Loader2 size={18} className="animate-spin" />
          Loading paths…
        </div>
      ) : null}

      {!pathDraft && !pathsLoading ? (
        <div className="rounded-xl border border-[var(--border-color)]/60 bg-[var(--bg-primary)]/40 px-4 py-10 text-center">
          <Route size={28} className="mx-auto mb-3 text-[var(--text-muted)]" aria-hidden />
          <p className="text-sm font-semibold text-[var(--text-primary)]">No path selected</p>
          <p className="mt-2 text-xs text-[var(--text-muted)]">Choose a path above or create a new one.</p>
        </div>
      ) : null}

      {pathDraft ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block min-w-0 space-y-1 sm:col-span-2" htmlFor="admin-path-title">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Path title</span>
              <input
                id="admin-path-title"
                value={pathDraft.title}
                onChange={(e) => setPathDraft((p) => (p ? { ...p, title: e.target.value } : p))}
                placeholder="e.g. Full-Stack Developer — short name shown in Paths"
                className="w-full min-w-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
              />
            </label>
            <label className="block min-w-0 space-y-1 sm:col-span-2">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Description (optional)</span>
              <textarea
                value={pathDraft.description ?? ''}
                onChange={(e) =>
                  setPathDraft((p) => (p ? { ...p, description: e.target.value || undefined } : p))
                }
                rows={2}
                className="w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <label className="block min-w-0 flex-1 space-y-1" htmlFor="admin-path-add-course">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Add course to path</span>
              <select
                id="admin-path-add-course"
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) {
                    addCourseToPath(v);
                    e.target.value = '';
                  }
                }}
                className={`w-full min-w-0 rounded-lg border bg-[var(--bg-primary)] px-3 py-2 text-sm ${
                  showPathCourseRequiredHint ? 'border-red-500' : 'border-[var(--border-color)]'
                }`}
              >
                <option value="">Choose a published course…</option>
                {availableCoursesToAdd.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.id})
                  </option>
                ))}
              </select>
              <span
                className={`min-h-[16px] text-[11px] ${
                  showPathCourseRequiredHint ? 'text-red-400' : 'text-transparent'
                }`}
              >
                At least one course is required.
              </span>
            </label>
            {availableCoursesToAdd.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">All published courses are already in this path.</p>
            ) : null}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-bold text-[var(--text-primary)]">Courses in path (drag to reorder)</h3>
            <DndContext sensors={sensors} onDragEnd={onDragEnd}>
              <SortableContext
                items={pathDraft.courseIds.map((id) => sortablePc(id))}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {pathDraft.courseIds.map((cid) => {
                    const meta = publishedList.find((c) => c.id === cid);
                    const title = meta?.title ?? cid;
                    const thumb = meta?.thumbnail;
                    const expanded = expandedCourseId === cid;
                    return (
                      <div key={cid} className="min-w-0 w-full">
                      <PathCourseRow
                        id={sortablePc(cid)}
                        courseId={cid}
                        title={title}
                        thumbnail={thumb}
                        expanded={expanded}
                        onToggle={() => toggleCourseExpand(cid)}
                        onRemove={() => removeCourseFromPath(cid)}
                      >
                        {expanded && courseEditDraft && courseEditDraft.id === cid ? (
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs text-[var(--text-muted)]">
                                Reorder modules and lessons. Save applies the same catalog document. Structured courses
                                (C1…) get ids remapped by position.
                              </p>
                              <button
                                type="button"
                                disabled={pathBusy || !courseDirty}
                                onClick={() => void handleSaveCourseStructure()}
                                className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-xs font-bold text-white hover:bg-orange-600 disabled:opacity-40"
                              >
                                {pathBusy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                Save course structure
                              </button>
                            </div>
                            <SortableContext
                              items={courseEditDraft.modules.map((_, mi) => sortableCm(cid, mi))}
                              strategy={verticalListSortingStrategy}
                            >
                              <div className="space-y-2">
                                {courseEditDraft.modules.map((mod, mi) => {
                                  const mid = `m-${cid}-${mi}`;
                                  const modOpen = !!openModuleIdx[mid];
                                  return (
                                    <Fragment key={`${cid}-m-${mi}`}>
                                    <ModuleRow
                                      id={sortableCm(cid, mi)}
                                      moduleTitle={mod.title}
                                      moduleIndexLabel={`Module ${mi + 1}`}
                                      expanded={modOpen}
                                      onToggle={() =>
                                        setOpenModuleIdx((prev) => ({
                                          ...prev,
                                          [mid]: !modOpen,
                                        }))
                                      }
                                    >
                                      {modOpen ? (
                                        <SortableContext
                                          items={mod.lessons.map((_, li) => sortableMl(cid, mi, li))}
                                          strategy={verticalListSortingStrategy}
                                        >
                                          <div className="space-y-2 pl-1">
                                            {mod.lessons.map((les, li) => (
                                              <Fragment key={`${cid}-${mi}-l-${li}`}>
                                              <LessonRow
                                                id={sortableMl(cid, mi, li)}
                                                title={les.title}
                                                lessonId={les.id}
                                              />
                                              </Fragment>
                                            ))}
                                          </div>
                                        </SortableContext>
                                      ) : null}
                                    </ModuleRow>
                                    </Fragment>
                                  );
                                })}
                              </div>
                            </SortableContext>
                          </div>
                        ) : expanded ? (
                          <p className="text-xs text-[var(--text-muted)]">Loading course…</p>
                        ) : null}
                      </PathCourseRow>
                      </div>
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>

            {pathDraft.courseIds.length === 0 ? (
              <p className="mt-3 text-center text-xs text-[var(--text-muted)]">No courses yet. Add published courses above.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <AnimatePresence>
        {pathConfirmDialog && pathConfirmCopy && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="path-builder-confirm-title"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-lg overflow-hidden rounded-3xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
            >
              <div className="flex items-center justify-between gap-4 border-b border-[var(--border-color)] p-6">
                <h2
                  id="path-builder-confirm-title"
                  className="text-xl font-bold text-[var(--text-primary)]"
                >
                  {pathConfirmCopy.title}
                </h2>
                <button
                  type="button"
                  onClick={closePathConfirmDialog}
                  className="shrink-0 rounded-full p-2 transition-colors hover:bg-[var(--hover-bg)]"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4 p-6">
                <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{pathConfirmCopy.body}</p>
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closePathConfirmDialog}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-5 py-3 text-sm font-bold text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] sm:w-auto"
                  >
                    Keep editing
                  </button>
                  <button
                    type="button"
                    autoFocus
                    onClick={() => void confirmPathDialogPrimary()}
                    className={`inline-flex min-h-11 w-full items-center justify-center rounded-xl px-5 py-3 text-sm font-bold text-white transition-colors sm:w-auto ${
                      pathConfirmDialog.kind === 'deletePublished'
                        ? 'bg-red-500 hover:bg-red-600'
                        : 'bg-orange-500 hover:bg-orange-600'
                    }`}
                  >
                    {pathConfirmCopy.primary}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
});
