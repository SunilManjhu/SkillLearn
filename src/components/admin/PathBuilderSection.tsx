import React, {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  useDndContext,
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
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  GripVertical,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Route,
  Save,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import type { Course, Lesson } from '../../data/courses';
import { formatCourseTaxonomyForSearch } from '../../utils/courseTaxonomy';
import {
  mindmapDocumentWithCenterChildren,
  newMindmapNodeId,
  type MindmapTreeNode,
} from '../../data/pathMindmap';
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
import { fetchPathMindmapFromFirestore, savePathMindmapToFirestore } from '../../utils/pathMindmapFirestore';
import { normalizeExternalHref } from '../../utils/externalUrl';
import { useAdminActionToast } from './useAdminActionToast';
import {
  applyReorderViewportScrollAndFocus,
  escapeSelectorAttrValue,
  queryElementInScopeOrDocument,
  REORDER_DATA_ATTR_SELECTORS,
} from '../../utils/reorderScrollViewport';
import { scrollDisclosureRowToTop } from '../../utils/scrollDisclosureRowToTop';

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** Pure — avoids Strict Mode double-invoking functional setCourseEditDraft on module swap. */
function computePathCourseModuleSwapDraft(
  c: Course,
  cid: string,
  mi: number,
  delta: -1 | 1
): { next: Course; pair: { a: number; b: number } } | null {
  if (c.id !== cid) return null;
  const ni = mi + delta;
  if (ni < 0 || ni >= c.modules.length) return null;
  const modules = arrayMove(c.modules, mi, ni);
  let next: Course = { ...c, modules };
  if (isStructuredCourseId(next.id)) {
    next = remapStructuredCourseModuleLessonIdsByOrder(next);
  }
  return { next, pair: { a: mi, b: ni } };
}

/** Pure — same rationale for in-module lesson reorder in path course editor. */
function computePathCourseLessonSwapDraft(
  c: Course,
  cid: string,
  mi: number,
  li: number,
  delta: -1 | 1
): { next: Course; pair: { li: number; ni: number } } | null {
  if (c.id !== cid) return null;
  const mod = c.modules[mi];
  if (!mod) return null;
  const ni = li + delta;
  if (ni < 0 || ni >= mod.lessons.length) return null;
  const modules = c.modules.map((m, i) => {
    if (i !== mi) return m;
    return { ...m, lessons: arrayMove(m.lessons, li, ni) };
  });
  let next: Course = { ...c, modules };
  if (isStructuredCourseId(next.id)) {
    next = remapStructuredCourseModuleLessonIdsByOrder(next);
  }
  return { next, pair: { li, ni } };
}

/** Legacy: next l{n} unique across the whole course (non-structured ids). */
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

/** Tree node for path mind map — synced to `pathMindmap` on save (nested branches allowed). */
type PathBranchNode =
  | { id: string; kind: 'label'; label: string; children: PathBranchNode[]; locked?: boolean }
  | { id: string; kind: 'course'; courseId: string; children: PathBranchNode[] }
  | { id: string; kind: 'lesson'; courseId: string; lessonId: string; children: PathBranchNode[] }
  | { id: string; kind: 'link'; label: string; href: string; children: PathBranchNode[] };

function updateNodeChildren(n: PathBranchNode, children: PathBranchNode[]): PathBranchNode {
  if (n.kind === 'label') return { ...n, children };
  if (n.kind === 'course') return { ...n, children };
  if (n.kind === 'link') return { ...n, children };
  return { ...n, children };
}

function collectCourseIdsFromTree(nodes: PathBranchNode[]): string[] {
  const out: string[] = [];
  function walk(ns: PathBranchNode[]) {
    for (const n of ns) {
      if (n.kind === 'course' || n.kind === 'lesson') {
        if (!out.includes(n.courseId)) out.push(n.courseId);
      }
      walk(n.children);
    }
  }
  walk(nodes);
  return out;
}

function mergeCourseIdsFromBranches(draft: LearningPath, roots: PathBranchNode[]): string[] {
  const merged = [...draft.courseIds];
  for (const cid of collectCourseIdsFromTree(roots)) {
    if (!merged.includes(cid)) merged.push(cid);
  }
  return merged;
}

function addChildAtParent(
  nodes: PathBranchNode[],
  parentId: string | null,
  child: PathBranchNode
): PathBranchNode[] {
  if (parentId === null) {
    return [...nodes, child];
  }
  return nodes.map((n) => {
    if (n.id === parentId) {
      return updateNodeChildren(n, [...n.children, child]);
    }
    return updateNodeChildren(n, addChildAtParent(n.children, parentId, child));
  });
}

function removeNodeById(nodes: PathBranchNode[], id: string): PathBranchNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => updateNodeChildren(n, removeNodeById(n.children, id)));
}

function mapBranchNodeById(
  nodes: PathBranchNode[],
  id: string,
  fn: (n: PathBranchNode) => PathBranchNode
): PathBranchNode[] {
  return nodes.map((n) => {
    if (n.id === id) return fn(n);
    return updateNodeChildren(n, mapBranchNodeById(n.children, id, fn));
  });
}

/** Droppable id prefix — must not collide with branch node ids used as sortable ids. */
const PATH_BRANCH_NEST_ID_PREFIX = 'path-branch-nest:';

/** Drop here to become a root-level sibling (nested SortableContexts often miss cross-level `over`). */
const PATH_BRANCH_ROOT_HEAD = 'path-branch-root:head';
const PATH_BRANCH_ROOT_TAIL = 'path-branch-root:tail';

function pathBranchNestDroppableId(nodeId: string): string {
  return PATH_BRANCH_NEST_ID_PREFIX + nodeId;
}

/** Prefer nest / root drop targets over the sortable row `li` so row-body drops nest instead of reordering. */
const pathBranchCollisionDetection: CollisionDetection = (args) => {
  const byPointer = pointerWithin(args);
  if (byPointer.length > 0) {
    const nestColl = byPointer.find(
      (c) => typeof c.id === 'string' && c.id.startsWith(PATH_BRANCH_NEST_ID_PREFIX)
    );
    if (nestColl) return [nestColl];
    const rootHead = byPointer.find((c) => c.id === PATH_BRANCH_ROOT_HEAD);
    if (rootHead) return [rootHead];
    const rootTail = byPointer.find((c) => c.id === PATH_BRANCH_ROOT_TAIL);
    if (rootTail) return [rootTail];
    return byPointer;
  }
  return closestCorners(args);
};

function findParentAndIndex(
  nodes: PathBranchNode[],
  id: string,
  parentId: string | null = null
): { parentId: string | null; index: number } | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return { parentId, index: i };
    const found = findParentAndIndex(nodes[i].children, id, nodes[i].id);
    if (found) return found;
  }
  return null;
}

function extractNodeById(
  nodes: PathBranchNode[],
  id: string
): { node: PathBranchNode | null; roots: PathBranchNode[] } {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx !== -1) {
    const node = nodes[idx];
    return { node, roots: [...nodes.slice(0, idx), ...nodes.slice(idx + 1)] };
  }
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const inner = extractNodeById(n.children, id);
    if (inner.node) {
      return {
        node: inner.node,
        roots: nodes.map((n2, j) => (j === i ? updateNodeChildren(n2, inner.roots) : n2)),
      };
    }
  }
  return { node: null, roots: nodes };
}

function isDescendantOf(roots: PathBranchNode[], ancestorId: string, maybeDescendantId: string): boolean {
  const ancestor = findBranchNode(roots, ancestorId);
  if (!ancestor) return false;
  function walk(ns: PathBranchNode[]): boolean {
    for (const n of ns) {
      if (n.id === maybeDescendantId) return true;
      if (walk(n.children)) return true;
    }
    return false;
  }
  return walk(ancestor.children);
}

function getChildrenArray(roots: PathBranchNode[], parentId: string | null): PathBranchNode[] {
  if (parentId === null) return roots;
  const p = findBranchNode(roots, parentId);
  return p?.children ?? [];
}

function setChildrenAtParent(
  roots: PathBranchNode[],
  parentId: string | null,
  children: PathBranchNode[]
): PathBranchNode[] {
  if (parentId === null) return children;
  return mapBranchNodeById(roots, parentId, (n) => updateNodeChildren(n, children));
}

function insertSiblingAt(
  nodes: PathBranchNode[],
  parentId: string | null,
  index: number,
  node: PathBranchNode
): PathBranchNode[] {
  if (parentId === null) {
    const next = [...nodes];
    next.splice(index, 0, node);
    return next;
  }
  return nodes.map((n) => {
    if (n.id === parentId) {
      const ch = [...n.children];
      ch.splice(index, 0, node);
      return updateNodeChildren(n, ch);
    }
    return updateNodeChildren(n, insertSiblingAt(n.children, parentId, index, node));
  });
}

function moveNodeToParentLast(
  roots: PathBranchNode[],
  activeId: string,
  newParentId: string
): PathBranchNode[] {
  if (activeId === newParentId) return roots;
  if (isDescendantOf(roots, activeId, newParentId)) return roots;
  const { node, roots: without } = extractNodeById(roots, activeId);
  if (!node) return roots;
  return addChildAtParent(without, newParentId, node);
}

function applyBranchDragEnd(roots: PathBranchNode[], activeId: string, overId: string): PathBranchNode[] {
  if (activeId === overId) return roots;

  if (overId === PATH_BRANCH_ROOT_HEAD) {
    const { node, roots: without } = extractNodeById(roots, activeId);
    if (!node) return roots;
    return insertSiblingAt(without, null, 0, node);
  }
  if (overId === PATH_BRANCH_ROOT_TAIL) {
    const { node, roots: without } = extractNodeById(roots, activeId);
    if (!node) return roots;
    return insertSiblingAt(without, null, without.length, node);
  }

  if (overId.startsWith(PATH_BRANCH_NEST_ID_PREFIX)) {
    const targetId = overId.slice(PATH_BRANCH_NEST_ID_PREFIX.length);
    return moveNodeToParentLast(roots, activeId, targetId);
  }

  if (isDescendantOf(roots, activeId, overId)) return roots;

  const pa = findParentAndIndex(roots, activeId);
  const pb = findParentAndIndex(roots, overId);
  if (!pa || !pb) return roots;

  if (pa.parentId === pb.parentId) {
    const parentId = pa.parentId;
    const siblings = getChildrenArray(roots, parentId);
    return setChildrenAtParent(roots, parentId, arrayMove(siblings, pa.index, pb.index));
  }

  const { node, roots: without } = extractNodeById(roots, activeId);
  if (!node) return roots;
  const pOver = findParentAndIndex(without, overId);
  if (!pOver) return roots;
  return insertSiblingAt(without, pOver.parentId, pOver.index, node);
}

function moveNodeInTree(nodes: PathBranchNode[], nodeId: string, delta: -1 | 1): PathBranchNode[] {
  const idx = nodes.findIndex((n) => n.id === nodeId);
  if (idx !== -1) {
    const j = idx + delta;
    if (j < 0 || j >= nodes.length) return nodes;
    return arrayMove(nodes, idx, j);
  }
  return nodes.map((n) => updateNodeChildren(n, moveNodeInTree(n.children, nodeId, delta)));
}

function branchNodeToMindmap(n: PathBranchNode, publishedList: Course[]): MindmapTreeNode {
  const children = n.children.map((c) => branchNodeToMindmap(c, publishedList));
  if (n.kind === 'label') {
    return {
      id: n.id,
      label: n.label.trim() || 'Untitled',
      children,
      kind: 'label',
      ...(n.locked ? { locked: true } : {}),
    };
  }
  if (n.kind === 'link') {
    const href = normalizeExternalHref(n.href) ?? n.href.trim();
    return {
      id: n.id,
      label: n.label.trim() || 'Link',
      children,
      kind: 'link',
      externalUrl: href,
    };
  }
  if (n.kind === 'course') {
    const c = publishedList.find((x) => x.id === n.courseId);
    return {
      id: n.id,
      label: c?.title ?? n.courseId,
      children,
      kind: 'course',
      courseId: n.courseId,
    };
  }
  const c = publishedList.find((x) => x.id === n.courseId);
  let lessonLabel = n.lessonId;
  if (c) {
    for (const m of c.modules) {
      const les = m.lessons.find((l) => l.id === n.lessonId);
      if (les) {
        lessonLabel = les.title?.trim() || n.lessonId;
        break;
      }
    }
  }
  return {
    id: n.id,
    label: lessonLabel,
    children,
    kind: 'lesson',
    courseId: n.courseId,
    lessonId: n.lessonId,
  };
}

function branchTreeToMindmapForest(roots: PathBranchNode[], publishedList: Course[]): MindmapTreeNode[] {
  return roots.map((r) => branchNodeToMindmap(r, publishedList));
}

function branchNodeDisplayLabel(n: PathBranchNode, publishedList: Course[]): string {
  if (n.kind === 'label') return n.label || 'Untitled';
  if (n.kind === 'link') return n.label.trim() || n.href || 'Link';
  if (n.kind === 'course') return publishedList.find((c) => c.id === n.courseId)?.title ?? n.courseId;
  const c = publishedList.find((x) => x.id === n.courseId);
  let t = n.lessonId;
  if (c) {
    for (const m of c.modules) {
      const les = m.lessons.find((l) => l.id === n.lessonId);
      if (les) {
        t = les.title || n.lessonId;
        break;
      }
    }
  }
  return t;
}

function findBranchNode(roots: PathBranchNode[], id: string): PathBranchNode | null {
  for (const n of roots) {
    if (n.id === id) return n;
    const sub = findBranchNode(n.children, id);
    if (sub) return sub;
  }
  return null;
}

/** Ids of nodes that share the same parent as `targetId` (top-level roots are siblings of each other). */
function findSiblingBranchIds(roots: PathBranchNode[], targetId: string): string[] | null {
  const rootIdx = roots.findIndex((r) => r.id === targetId);
  if (rootIdx >= 0) return roots.map((r) => r.id);
  for (const n of roots) {
    const childIdx = n.children.findIndex((c) => c.id === targetId);
    if (childIdx >= 0) return n.children.map((c) => c.id);
    const nested = findSiblingBranchIds(n.children, targetId);
    if (nested) return nested;
  }
  return null;
}

/** All descendant branch ids under `ancestorId` (not including `ancestorId`). */
function collectDescendantBranchIds(roots: PathBranchNode[], ancestorId: string): Set<string> {
  const node = findBranchNode(roots, ancestorId);
  if (!node) return new Set();
  const out = new Set<string>();
  const walk = (ns: PathBranchNode[]) => {
    for (const n of ns) {
      out.add(n.id);
      walk(n.children);
    }
  };
  walk(node.children);
  return out;
}

function stripBranchExpandState(next: Set<string>, tree: PathBranchNode[], nodeId: string) {
  next.delete(nodeId);
  for (const d of collectDescendantBranchIds(tree, nodeId)) {
    next.delete(d);
  }
}

/** Collapse sibling branches (and their open descendants); expand `id` when it has children. */
function accordionExpandBranchRow(prev: Set<string>, tree: PathBranchNode[], id: string): Set<string> {
  const node = findBranchNode(tree, id);
  const siblings = findSiblingBranchIds(tree, id);
  const next = new Set(prev);
  if (siblings) {
    for (const sid of siblings) {
      if (sid !== id) stripBranchExpandState(next, tree, sid);
    }
  }
  if (node && node.children.length > 0) {
    next.add(id);
  }
  return next;
}

/** Ids of branches that have children (for pruning expand state when the tree changes). */
function collectBranchIdsWithChildren(nodes: PathBranchNode[]): Set<string> {
  const out = new Set<string>();
  function walk(ns: PathBranchNode[]) {
    for (const n of ns) {
      if (n.children.length > 0) {
        out.add(n.id);
        walk(n.children);
      }
    }
  }
  walk(nodes);
  return out;
}

/** Restore admin branch tree from Firestore mind map nodes. */
function mindmapNodeToPathBranch(n: MindmapTreeNode): PathBranchNode {
  const children = n.children.map(mindmapNodeToPathBranch);
  if (n.kind === 'course' && n.courseId) {
    return { id: n.id, kind: 'course', courseId: n.courseId, children };
  }
  if (n.kind === 'lesson' && n.courseId && n.lessonId) {
    return { id: n.id, kind: 'lesson', courseId: n.courseId, lessonId: n.lessonId, children };
  }
  if (n.kind === 'link' && n.externalUrl) {
    return {
      id: n.id,
      kind: 'link',
      label: n.label,
      href: n.externalUrl,
      children,
    };
  }
  return {
    id: n.id,
    kind: 'label',
    label: n.label,
    children,
    ...(n.locked ? { locked: true } : {}),
  };
}

type BranchModalStep = 'kind' | 'label' | 'course' | 'linkForm' | 'lessonCourse' | 'lessonPick';

function AddPathBranchModal({
  open,
  onClose,
  catalogCourses,
  onCommit,
  contextHint,
  mode = 'add',
  editLessonPreset,
  addPreset,
}: {
  open: boolean;
  onClose: () => void;
  catalogCourses: readonly Course[];
  onCommit: (branch: PathBranchNode) => void;
  /** Where the new node will attach (top level vs nested). */
  contextHint?: string;
  /** `editCourse` / `editLesson` skip the kind step and open on the picker for changing links. */
  mode?: 'add' | 'editCourse' | 'editLesson';
  /** When `mode === 'editLesson'`, optionally start on lesson list for this course. */
  editLessonPreset?: { courseId: string; lessonId: string };
  /** When `mode === 'add'`, skip the kind picker and open the matching step. */
  addPreset?: 'label' | 'course' | 'link';
}) {
  const [step, setStep] = useState<BranchModalStep>('kind');
  const [query, setQuery] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [linkLabelInput, setLinkLabelInput] = useState('');
  const [linkHrefInput, setLinkHrefInput] = useState('');
  const [lessonCourse, setLessonCourse] = useState<Course | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setLabelInput('');
    setLinkLabelInput('');
    setLinkHrefInput('');
    if (mode === 'editCourse') {
      setStep('course');
      setLessonCourse(null);
    } else if (mode === 'editLesson') {
      const preset = editLessonPreset;
      if (preset && catalogCourses.length > 0) {
        const c = catalogCourses.find((x) => x.id === preset.courseId) ?? null;
        if (c) {
          setLessonCourse(c);
          setStep('lessonPick');
        } else {
          setLessonCourse(null);
          setStep('lessonCourse');
        }
      } else {
        setLessonCourse(null);
        setStep('lessonCourse');
      }
    } else {
      if (addPreset === 'label') {
        setStep('label');
      } else if (addPreset === 'course') {
        setStep('course');
      } else if (addPreset === 'link') {
        setStep('linkForm');
      } else {
        setStep('kind');
      }
      setLessonCourse(null);
    }
  }, [open, mode, editLessonPreset, catalogCourses, addPreset]);

  useDialogKeyboard({ open, onClose });

  const sortedCourses = useMemo(
    () => [...catalogCourses].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })),
    [catalogCourses]
  );

  const filteredCourses = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedCourses;
    return sortedCourses.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        formatCourseTaxonomyForSearch(c).toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
    );
  }, [sortedCourses, query]);

  const lessonRows = useMemo(() => {
    if (!lessonCourse) return [] as { moduleTitle: string; lesson: Lesson }[];
    const rows: { moduleTitle: string; lesson: Lesson }[] = [];
    for (const mod of lessonCourse.modules) {
      for (const lesson of mod.lessons) {
        rows.push({ moduleTitle: mod.title, lesson });
      }
    }
    return rows;
  }, [lessonCourse]);

  const filteredLessons = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lessonRows;
    return lessonRows.filter(
      (r) =>
        r.lesson.title.toLowerCase().includes(q) ||
        r.moduleTitle.toLowerCase().includes(q)
    );
  }, [lessonRows, query]);

  const canLink = catalogCourses.length > 0;

  if (!open) return null;

  const commitLabel = () => {
    const t = labelInput.trim();
    if (!t) return;
    onCommit({ id: newMindmapNodeId(), kind: 'label', label: t, children: [] });
    onClose();
  };

  const commitCourse = (c: Course) => {
    onCommit({ id: newMindmapNodeId(), kind: 'course', courseId: c.id, children: [] });
    onClose();
  };

  const commitLesson = (course: Course, lesson: Lesson) => {
    onCommit({
      id: newMindmapNodeId(),
      kind: 'lesson',
      courseId: course.id,
      lessonId: lesson.id,
      children: [],
    });
    onClose();
  };

  const commitWebLink = () => {
    const t = linkLabelInput.trim();
    const hrefNorm = normalizeExternalHref(linkHrefInput);
    if (!t || !hrefNorm) return;
    onCommit({
      id: newMindmapNodeId(),
      kind: 'link',
      label: t,
      href: hrefNorm,
      children: [],
    });
    onClose();
  };

  const linkFormValid =
    linkLabelInput.trim().length > 0 && normalizeExternalHref(linkHrefInput) !== null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="path-branch-modal-title"
        className="flex max-h-[min(90dvh,640px)] w-full max-w-lg flex-col rounded-t-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl sm:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
          {(mode === 'add' && step !== 'kind') || mode === 'editCourse' || mode === 'editLesson' ? (
            <button
              type="button"
              className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
              aria-label="Back"
              onClick={() => {
                setQuery('');
                if (mode === 'editCourse' && step === 'course') {
                  onClose();
                  return;
                }
                if (mode === 'editLesson' && step === 'lessonCourse') {
                  onClose();
                  return;
                }
                if (step === 'course') {
                  if (mode === 'add') setStep('kind');
                  else onClose();
                  return;
                }
                if (step === 'lessonCourse') {
                  if (mode === 'add') setStep('kind');
                  else onClose();
                  return;
                }
                if (step === 'label') setStep('kind');
                else if (step === 'linkForm') setStep('kind');
                else if (step === 'lessonPick') {
                  setLessonCourse(null);
                  setStep('lessonCourse');
                }
              }}
            >
              <ChevronLeft size={22} />
            </button>
          ) : (
            <span className="w-10" aria-hidden />
          )}
          <h2
            id="path-branch-modal-title"
            className="min-w-0 flex-1 text-center text-base font-bold text-[var(--text-primary)] sm:text-lg"
          >
            {step === 'kind' && 'Add a branch'}
            {step === 'label' && 'Label'}
            {step === 'linkForm' && 'Web link'}
            {step === 'course' && (mode === 'editCourse' ? 'Change course' : 'Choose course')}
            {step === 'lessonCourse' && (mode === 'editLesson' ? 'Change lesson — pick course' : 'Choose course (other)')}
            {step === 'lessonPick' && lessonCourse && (mode === 'editLesson' ? `Change lesson — ${lessonCourse.title}` : `Lesson — ${lessonCourse.title}`)}
          </h2>
          <button
            type="button"
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-sm font-semibold text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
        {contextHint ? (
          <p className="border-b border-[var(--border-color)] px-4 pb-3 text-center text-xs leading-snug text-[var(--text-muted)]">
            {contextHint}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {step === 'kind' && (
            <div className="flex flex-col gap-3">
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                Choose what this branch represents. You can add more branches and nest them later.
              </p>
              <button
                type="button"
                className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-light)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-orange-500/40 hover:bg-[var(--hover-bg)]"
                onClick={() => setStep('label')}
              >
                <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                  <Type size={20} className="shrink-0 text-orange-500" aria-hidden />
                  Text label
                  <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">Fastest</span>
                </span>
                <span className="pl-8 text-xs text-[var(--text-muted)]">
                  Section title or topic (e.g. &quot;Foundations&quot;) — no catalog link yet.
                </span>
              </button>
              <button
                type="button"
                disabled={!canLink}
                className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-light)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-orange-500/40 hover:bg-[var(--hover-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  setStep('course');
                  setQuery('');
                }}
              >
                <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                  <GraduationCap size={20} className="shrink-0 text-blue-500" aria-hidden />
                  Whole course
                  <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">From catalog</span>
                </span>
                <span className="pl-8 text-xs text-[var(--text-muted)]">
                  Links the full course; course and lesson order still follow your path.
                </span>
              </button>
              <button
                type="button"
                className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-light)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-orange-500/40 hover:bg-[var(--hover-bg)]"
                onClick={() => {
                  setStep('linkForm');
                  setQuery('');
                }}
              >
                <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                  <Link2 size={20} className="shrink-0 text-violet-500" aria-hidden />
                  Web link
                  <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">Opens in new tab</span>
                </span>
                <span className="pl-8 text-xs text-[var(--text-muted)]">
                  Blog post, article, or any page — not limited to video. Learners tap the title to open it.
                </span>
              </button>
              {!canLink && (
                <p className="text-xs text-[var(--text-muted)]">
                  Publish at least one course in the <strong className="text-[var(--text-secondary)]">Catalog</strong>{' '}
                  tab to add <strong className="text-[var(--text-secondary)]">Whole course</strong> branches.
                </p>
              )}
            </div>
          )}

          {step === 'label' && (
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-[var(--text-secondary)]" htmlFor="path-branch-label-input">
                Branch label
              </label>
              <input
                id="path-branch-label-input"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && labelInput.trim()) {
                    e.preventDefault();
                    commitLabel();
                  }
                }}
                placeholder="e.g. Foundations, Week 1, Core skills"
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
                autoFocus
              />
              <p className="text-xs text-[var(--text-muted)]">Press Enter to add, or tap the button.</p>
              <button
                type="button"
                disabled={!labelInput.trim()}
                onClick={commitLabel}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-40"
              >
                Add branch
              </button>
            </div>
          )}

          {step === 'linkForm' && (
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-[var(--text-secondary)]" htmlFor="path-branch-link-label">
                Link title
              </label>
              <input
                id="path-branch-link-label"
                value={linkLabelInput}
                onChange={(e) => setLinkLabelInput(e.target.value)}
                placeholder="e.g. Read this blog post"
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
                autoFocus
              />
              <label className="block text-xs font-semibold text-[var(--text-secondary)]" htmlFor="path-branch-link-url">
                URL
              </label>
              <input
                id="path-branch-link-url"
                type="url"
                inputMode="url"
                value={linkHrefInput}
                onChange={(e) => setLinkHrefInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && linkFormValid) {
                    e.preventDefault();
                    commitWebLink();
                  }
                }}
                placeholder="https://example.com/article or example.com/path"
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 font-mono text-sm"
              />
              <p className="text-xs text-[var(--text-muted)]">
                Opens in a new browser tab for learners. Use a full URL or a domain (https:// is added when omitted).
              </p>
              <button
                type="button"
                disabled={!linkFormValid}
                onClick={commitWebLink}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-40"
              >
                Add link
              </button>
            </div>
          )}

          {(step === 'course' || step === 'lessonCourse') && (
            <div className="space-y-2">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by title, category, or id…"
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
                autoFocus
              />
              {filteredCourses.length === 0 ? (
                <p className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]/50 px-3 py-6 text-center text-sm text-[var(--text-muted)]">
                  {sortedCourses.length === 0
                    ? 'No published courses in the catalog.'
                    : 'No courses match your search. Try another term.'}
                </p>
              ) : (
                <ul className="space-y-1">
                  {filteredCourses.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="flex w-full min-h-11 items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-left text-sm hover:bg-[var(--hover-bg)]"
                        onClick={() => {
                          if (step === 'course') commitCourse(c);
                          else {
                            setLessonCourse(c);
                            setQuery('');
                            setStep('lessonPick');
                          }
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
                        <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">{c.id}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {step === 'lessonPick' && lessonCourse ? (
            <div className="space-y-2">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search lessons or modules…"
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
                autoFocus
              />
              {filteredLessons.length === 0 ? (
                <p className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]/50 px-3 py-6 text-center text-sm text-[var(--text-muted)]">
                  {lessonRows.length === 0
                    ? 'This course has no lessons yet.'
                    : 'No lessons match your search. Try another term.'}
                </p>
              ) : (
                <ul className="max-h-[min(50dvh,320px)] space-y-1 overflow-y-auto overscroll-contain pr-1">
                  {filteredLessons.map((r) => (
                    <li key={r.lesson.id}>
                      <button
                        type="button"
                        className="flex w-full min-h-11 flex-col items-start rounded-lg border border-transparent px-2 py-2 text-left text-sm hover:bg-[var(--hover-bg)]"
                        onClick={() => commitLesson(lessonCourse, r.lesson)}
                      >
                        <span className="font-medium">{r.lesson.title || r.lesson.id}</span>
                        <span className="text-[10px] text-[var(--text-muted)]">{r.moduleTitle}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PathBranchRootDropSlot({
  variant,
  dndDisabled,
}: {
  variant: 'head' | 'tail';
  dndDisabled: boolean;
}) {
  const id = variant === 'head' ? PATH_BRANCH_ROOT_HEAD : PATH_BRANCH_ROOT_TAIL;
  const { setNodeRef, isOver } = useDroppable({ id, disabled: dndDisabled });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-11 rounded-lg border border-dashed border-orange-500/40 bg-orange-500/5 px-3 py-2 text-center text-xs font-semibold leading-snug text-orange-700/90 dark:text-orange-300/90 ${
        isOver ? 'ring-2 ring-orange-400 ring-offset-2 ring-offset-[var(--bg-primary)]' : ''
      }`}
      role="presentation"
    >
      {variant === 'head'
        ? 'Drop here to add as top-level branch (above)'
        : 'Drop here to add as top-level branch (below)'}
    </div>
  );
}

function PathBranchSortableRow({
  b,
  depth,
  siblingIndex,
  siblingsLen,
  publishedList,
  expandedBranchIds,
  onToggleCollapse,
  onAddUnder,
  onRemove,
  onMove,
  onLabelChange,
  onLinkBranchChange,
  onRequestEditCourse,
  onRequestEditLesson,
  onBranchRowFocus,
  dndDisabled,
}: {
  b: PathBranchNode;
  depth: number;
  siblingIndex: number;
  siblingsLen: number;
  publishedList: Course[];
  /** Branch shows nested rows only when its id is in this set. */
  expandedBranchIds: ReadonlySet<string>;
  onToggleCollapse: (id: string) => void;
  onAddUnder: (parentId: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, delta: -1 | 1, scrollAnchor?: HTMLElement | null) => void;
  onLabelChange: (id: string, label: string) => void;
  onLinkBranchChange: (id: string, patch: { label?: string; href?: string }) => void;
  onRequestEditCourse: (id: string) => void;
  onRequestEditLesson: (id: string) => void;
  onBranchRowFocus: (id: string) => void;
  dndDisabled: boolean;
}) {
  const hasChildren = b.children.length > 0;
  const isCollapsed = hasChildren && !expandedBranchIds.has(b.id);

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: b.id, disabled: dndDisabled });
  const { active } = useDndContext();
  /** No sibling “make space” shift while dragging; DragOverlay still shows the drag preview. */
  const freezeSortableLayout = active != null;

  const { setNodeRef: setNestRef, isOver: nestOver } = useDroppable({
    id: pathBranchNestDroppableId(b.id),
    disabled: dndDisabled,
  });

  const style = {
    transform: freezeSortableLayout ? undefined : CSS.Transform.toString(transform),
    transition: freezeSortableLayout ? undefined : transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  const chevronSize = depth === 0 ? 16 : 14;
  const cardBg =
    depth === 0
      ? 'bg-[var(--bg-primary)]/20'
      : 'bg-[var(--bg-primary)]/30';

  const kindBadgeClass =
    b.kind === 'label'
      ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
      : b.kind === 'course'
        ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
        : b.kind === 'link'
          ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
          : 'bg-teal-500/15 text-teal-600 dark:text-teal-400';

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-path-branch-node-id={b.id}
      className={`min-w-0 list-none overflow-hidden rounded-xl border border-[var(--border-color)] ${cardBg}`}
    >
      <div
        className="flex flex-wrap items-stretch gap-2 px-3 py-3 sm:px-4"
        onFocusCapture={(e) => {
          const header = e.currentTarget;
          const related = e.relatedTarget as Node | null;
          if (related && header.contains(related)) return;
          onBranchRowFocus(b.id);
        }}
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...listeners}
          {...attributes}
          className="inline-flex min-h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center self-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-muted)] hover:bg-[var(--hover-bg)]"
          aria-label="Drag from here to reorder among siblings"
          title="Drag from grip to reorder; drop on the rest of the row to nest under"
        >
          <GripVertical size={18} aria-hidden />
        </button>
        <div
          ref={setNestRef}
          className={`min-h-11 min-w-0 flex-1 flex flex-wrap items-center gap-2 rounded-md px-0.5 py-0.5 ${
            nestOver
              ? 'bg-orange-500/10 ring-2 ring-orange-400 ring-offset-2 ring-offset-[var(--bg-secondary)]'
              : ''
          }`}
          role="region"
          aria-label="Drop here to nest under this branch"
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => onToggleCollapse(b.id)}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-1 py-1 text-left text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]/80 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? 'Expand nested branches' : 'Collapse nested branches'}
              title={isCollapsed ? 'Expand nested branches' : 'Collapse nested branches'}
            >
              {isCollapsed ? (
                <ChevronRight size={chevronSize} className="shrink-0" aria-hidden />
              ) : (
                <ChevronDown size={chevronSize} className="shrink-0" aria-hidden />
              )}
              <span
                className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${kindBadgeClass}`}
              >
                {b.kind === 'label'
                  ? 'Label'
                  : b.kind === 'course'
                    ? 'Course'
                    : b.kind === 'link'
                      ? 'Link'
                      : 'Lesson'}
              </span>
            </button>
          ) : (
            <span
              className={`inline-flex min-h-11 shrink-0 items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${kindBadgeClass}`}
            >
              {b.kind === 'label'
                ? 'Label'
                : b.kind === 'course'
                  ? 'Course'
                  : b.kind === 'link'
                    ? 'Link'
                    : 'Lesson'}
            </span>
          )}
          {b.kind === 'label' ? (
            <input
              type="text"
              value={b.label}
              onChange={(e) => onLabelChange(b.id, e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              aria-label="Branch label"
              className="min-h-10 min-w-0 flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              placeholder="Label text"
            />
          ) : b.kind === 'link' ? (
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-3 sm:gap-y-2">
              <label className="flex min-w-0 flex-[2_1_10rem] max-w-full flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
                  Title
                </span>
                <input
                  type="text"
                  value={b.label}
                  onChange={(e) => onLinkBranchChange(b.id, { label: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  aria-label="Web link title"
                  className="min-h-10 min-w-0 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  placeholder="Shown in the path outline"
                />
              </label>
              <label className="flex min-w-0 flex-[3_1_14rem] max-w-full flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
                  URL
                </span>
                <input
                  type="url"
                  inputMode="url"
                  value={b.href}
                  onChange={(e) => onLinkBranchChange(b.id, { href: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  aria-label="Web link URL"
                  className="min-h-10 min-w-0 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 font-mono text-sm text-[var(--text-primary)]"
                  placeholder="https://…"
                />
              </label>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-[var(--text-primary)]">
                {branchNodeDisplayLabel(b, publishedList)}
              </span>
              <button
                type="button"
                onClick={() =>
                  b.kind === 'course' ? onRequestEditCourse(b.id) : onRequestEditLesson(b.id)
                }
                className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
              >
                <Pencil size={14} className="shrink-0" aria-hidden />
                {b.kind === 'course' ? 'Change course' : 'Change lesson'}
              </button>
            </div>
          )}
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => onAddUnder(b.id)}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-orange-500/30 bg-orange-500/5 px-2 py-1.5 text-xs font-semibold text-orange-600 dark:text-orange-400 hover:bg-orange-500/10"
            >
              <Plus size={14} aria-hidden />
              Add under
            </button>
            <button
              type="button"
              data-branch-reorder="up"
              disabled={siblingIndex === 0}
              onClick={(e) => {
                e.stopPropagation();
                onMove(b.id, -1, e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                if (e.altKey || e.ctrlKey || e.metaKey) return;
                e.preventDefault();
                e.stopPropagation();
                if (e.key === 'ArrowUp' && siblingIndex > 0) onMove(b.id, -1, e.currentTarget);
                if (e.key === 'ArrowDown' && siblingIndex < siblingsLen - 1)
                  onMove(b.id, 1, e.currentTarget);
              }}
              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-[var(--border-color)] text-xs font-semibold disabled:opacity-30"
              aria-label="Move up among siblings"
            >
              ↑
            </button>
            <button
              type="button"
              data-branch-reorder="down"
              disabled={siblingIndex >= siblingsLen - 1}
              onClick={(e) => {
                e.stopPropagation();
                onMove(b.id, 1, e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                if (e.altKey || e.ctrlKey || e.metaKey) return;
                e.preventDefault();
                e.stopPropagation();
                if (e.key === 'ArrowUp' && siblingIndex > 0) onMove(b.id, -1, e.currentTarget);
                if (e.key === 'ArrowDown' && siblingIndex < siblingsLen - 1)
                  onMove(b.id, 1, e.currentTarget);
              }}
              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-[var(--border-color)] text-xs font-semibold disabled:opacity-30"
              aria-label="Move down among siblings"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => onRemove(b.id)}
              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10"
              aria-label="Remove branch and nested items"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </div>
      {hasChildren && !isCollapsed ? (
        <div className="border-t border-[var(--border-color)] bg-[var(--bg-primary)]/10 px-3 pb-3 pt-3 sm:px-4">
          <PathBranchTreeList
            nodes={b.children}
            depth={depth + 1}
            publishedList={publishedList}
            expandedBranchIds={expandedBranchIds}
            onToggleCollapse={onToggleCollapse}
            onAddUnder={onAddUnder}
            onRemove={onRemove}
            onMove={onMove}
            onLabelChange={onLabelChange}
            onLinkBranchChange={onLinkBranchChange}
            onRequestEditCourse={onRequestEditCourse}
            onRequestEditLesson={onRequestEditLesson}
            onBranchRowFocus={onBranchRowFocus}
            dndDisabled={dndDisabled}
          />
        </div>
      ) : null}
    </li>
  );
}

function PathBranchTreeList({
  nodes,
  depth,
  publishedList,
  expandedBranchIds,
  onToggleCollapse,
  onAddUnder,
  onRemove,
  onMove,
  onLabelChange,
  onLinkBranchChange,
  onRequestEditCourse,
  onRequestEditLesson,
  onBranchRowFocus,
  dndDisabled = false,
}: {
  nodes: PathBranchNode[];
  depth: number;
  publishedList: Course[];
  expandedBranchIds: ReadonlySet<string>;
  onToggleCollapse: (id: string) => void;
  onAddUnder: (parentId: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, delta: -1 | 1, scrollAnchor?: HTMLElement | null) => void;
  onLabelChange: (id: string, label: string) => void;
  onLinkBranchChange: (id: string, patch: { label?: string; href?: string }) => void;
  onRequestEditCourse: (id: string) => void;
  onRequestEditLesson: (id: string) => void;
  onBranchRowFocus: (id: string) => void;
  dndDisabled?: boolean;
}) {
  if (nodes.length === 0) return null;
  const itemIds = nodes.map((n) => n.id);
  const list = (
    <ul
      className={
        depth > 0
          ? 'space-y-2 border-l-2 border-orange-500/30 pl-3 sm:pl-4'
          : 'space-y-2'
      }
    >
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {nodes.map((b, i) => (
          <Fragment key={b.id}>
            <PathBranchSortableRow
              b={b}
              depth={depth}
              siblingIndex={i}
              siblingsLen={nodes.length}
              publishedList={publishedList}
              expandedBranchIds={expandedBranchIds}
              onToggleCollapse={onToggleCollapse}
              onAddUnder={onAddUnder}
              onRemove={onRemove}
              onMove={onMove}
              onLabelChange={onLabelChange}
              onLinkBranchChange={onLinkBranchChange}
              onRequestEditCourse={onRequestEditCourse}
              onRequestEditLesson={onRequestEditLesson}
              onBranchRowFocus={onBranchRowFocus}
              dndDisabled={dndDisabled}
            />
          </Fragment>
        ))}
      </SortableContext>
    </ul>
  );
  if (depth !== 0) return list;
  return (
    <div className="space-y-2">
      <PathBranchRootDropSlot variant="head" dndDisabled={dndDisabled} />
      {list}
      <PathBranchRootDropSlot variant="tail" dndDisabled={dndDisabled} />
    </div>
  );
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

/**
 * Nested sortables (path courses → modules → lessons) share one DndContext. Without scoping,
 * collisions often hit the parent course droppable (`pc:…`) so module/lesson drags never match `cm:`/`ml:` targets.
 */
const pathCoursesListCollisionDetection: CollisionDetection = (args) => {
  const activeId = String(args.active.id);

  if (activeId.startsWith('pc:')) {
    const filtered = args.droppableContainers.filter((c) => String(c.id).startsWith('pc:'));
    if (filtered.length === 0) return closestCorners(args);
    return closestCorners({ ...args, droppableContainers: filtered });
  }

  if (activeId.startsWith('cm:')) {
    const parsed = parseCm(activeId);
    if (!parsed) return closestCorners(args);
    const prefix = `cm:${parsed.courseId}:`;
    const filtered = args.droppableContainers.filter((c) => String(c.id).startsWith(prefix));
    if (filtered.length === 0) return closestCorners(args);
    return closestCorners({ ...args, droppableContainers: filtered });
  }

  if (activeId.startsWith('ml:')) {
    const parsed = parseMl(activeId);
    if (!parsed) return closestCorners(args);
    const prefix = `ml:${parsed.courseId}:${parsed.mi}:`;
    const filtered = args.droppableContainers.filter((c) => String(c.id).startsWith(prefix));
    if (filtered.length === 0) return closestCorners(args);
    return closestCorners({ ...args, droppableContainers: filtered });
  }

  return closestCorners(args);
};

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
  const { active } = useDndContext();
  const freezeSortableLayout = active != null;
  const style = {
    transform: freezeSortableLayout ? undefined : CSS.Transform.toString(transform),
    transition: freezeSortableLayout ? undefined : transition,
    opacity: isDragging ? 0.85 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-path-course-disclosure={courseId}
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
  pathCourseId,
  pathModuleIndex,
  moduleId,
  moduleTitle,
  moduleIndexLabel,
  expanded,
  onToggle,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  children,
}: {
  id: string;
  pathCourseId: string;
  pathModuleIndex: number;
  moduleId: string;
  moduleTitle: string;
  moduleIndexLabel: string;
  expanded: boolean;
  onToggle: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: (scrollAnchor?: HTMLElement | null) => void;
  onMoveDown: (scrollAnchor?: HTMLElement | null) => void;
  children?: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const { active } = useDndContext();
  const freezeSortableLayout = active != null;
  const style = {
    transform: freezeSortableLayout ? undefined : CSS.Transform.toString(transform),
    transition: freezeSortableLayout ? undefined : transition,
    opacity: isDragging ? 0.85 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-lg border border-[var(--border-color)]/80 bg-[var(--bg-secondary)]/50"
      data-path-course-id={pathCourseId}
      data-path-module-index={pathModuleIndex}
    >
      <div className="flex flex-wrap items-center gap-2 p-2">
        <SortableHandle {...attributes} {...listeners} />
        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 rounded-md"
          aria-expanded={expanded}
          aria-label={`${moduleIndexLabel}: ${moduleId.trim() || 'no id'} - ${moduleTitle.trim() || 'Untitled module'}. ${expanded ? 'Collapse' : 'Expand'} module`}
        >
          <span className="flex min-w-0 items-start gap-1">
            <span className="mt-0.5 shrink-0" aria-hidden>
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block min-w-0 truncate text-sm font-bold text-[var(--text-primary)]">
                <span className="font-mono text-orange-500/90">{moduleId.trim() || '—'}</span>
                <span> - {moduleTitle.trim() || 'Untitled module'}</span>
              </span>
              <span className="mt-0.5 block truncate text-[11px] font-medium text-[var(--text-muted)]">
                {moduleIndexLabel}
              </span>
            </span>
          </span>
        </button>
        <div className="flex shrink-0 flex-col gap-0.5 sm:flex-row sm:gap-1">
          <button
            type="button"
            data-module-reorder="up"
            onClick={(e) => {
              e.stopPropagation();
              onMoveUp(e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
              if (e.altKey || e.ctrlKey || e.metaKey) return;
              e.preventDefault();
              e.stopPropagation();
              if (e.key === 'ArrowUp' && canMoveUp) onMoveUp(e.currentTarget);
              if (e.key === 'ArrowDown' && canMoveDown) onMoveDown(e.currentTarget);
            }}
            disabled={!canMoveUp}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-30"
            aria-label="Move module up"
          >
            <ArrowUp size={18} aria-hidden />
          </button>
          <button
            type="button"
            data-module-reorder="down"
            onClick={(e) => {
              e.stopPropagation();
              onMoveDown(e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
              if (e.altKey || e.ctrlKey || e.metaKey) return;
              e.preventDefault();
              e.stopPropagation();
              if (e.key === 'ArrowUp' && canMoveUp) onMoveUp(e.currentTarget);
              if (e.key === 'ArrowDown' && canMoveDown) onMoveDown(e.currentTarget);
            }}
            disabled={!canMoveDown}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-30"
            aria-label="Move module down"
          >
            <ArrowDown size={18} aria-hidden />
          </button>
        </div>
      </div>
      {expanded ? <div className="border-t border-[var(--border-color)]/60 px-2 py-3">{children}</div> : null}
    </div>
  );
}

function LessonRow({
  id,
  pathCourseId,
  pathModuleIndex,
  pathLessonIndex,
  lessonIndexLabel,
  title,
  lessonId,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  moveToModuleOptions,
  canMoveLessonOutOfModule,
  onMoveLessonToModule,
}: {
  id: string;
  pathCourseId: string;
  pathModuleIndex: number;
  pathLessonIndex: number;
  lessonIndexLabel: string;
  title: string;
  lessonId: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: (scrollAnchor?: HTMLElement | null) => void;
  onMoveDown: (scrollAnchor?: HTMLElement | null) => void;
  moveToModuleOptions?: { value: number; label: string }[];
  canMoveLessonOutOfModule?: boolean;
  onMoveLessonToModule?: (targetMi: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const { active } = useDndContext();
  const freezeSortableLayout = active != null;
  const style = {
    transform: freezeSortableLayout ? undefined : CSS.Transform.toString(transform),
    transition: freezeSortableLayout ? undefined : transition,
    opacity: isDragging ? 0.85 : 1,
  };
  const showModulePicker =
    moveToModuleOptions && moveToModuleOptions.length > 0 && onMoveLessonToModule;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex flex-col gap-2 rounded-lg border border-[var(--border-color)]/60 bg-[var(--bg-primary)]/30 px-2 py-2"
      data-path-course-id={pathCourseId}
      data-path-module-index={pathModuleIndex}
      data-path-lesson-index={pathLessonIndex}
    >
      <div className="flex min-w-0 items-center gap-2">
        <SortableHandle {...attributes} {...listeners} />
        <div className="min-w-0 flex-1">
          <p className="min-w-0 truncate text-sm font-bold text-[var(--text-primary)]">
            <span className="font-mono text-orange-500/90">{lessonId.trim() || '—'}</span>
            <span> - {title.trim() || 'Untitled lesson'}</span>
          </p>
          <p className="mt-0.5 truncate text-[11px] font-medium text-[var(--text-muted)]">{lessonIndexLabel}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-0.5 sm:flex-row sm:gap-1">
          <button
            type="button"
            data-lesson-reorder="up"
            onClick={(e) => {
              e.stopPropagation();
              onMoveUp(e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
              if (e.altKey || e.ctrlKey || e.metaKey) return;
              e.preventDefault();
              e.stopPropagation();
              if (e.key === 'ArrowUp' && canMoveUp) onMoveUp(e.currentTarget);
              if (e.key === 'ArrowDown' && canMoveDown) onMoveDown(e.currentTarget);
            }}
            disabled={!canMoveUp}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-30"
            aria-label="Move lesson up"
          >
            <ArrowUp size={18} aria-hidden />
          </button>
          <button
            type="button"
            data-lesson-reorder="down"
            onClick={(e) => {
              e.stopPropagation();
              onMoveDown(e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
              if (e.altKey || e.ctrlKey || e.metaKey) return;
              e.preventDefault();
              e.stopPropagation();
              if (e.key === 'ArrowUp' && canMoveUp) onMoveUp(e.currentTarget);
              if (e.key === 'ArrowDown' && canMoveDown) onMoveDown(e.currentTarget);
            }}
            disabled={!canMoveDown}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] disabled:opacity-30"
            aria-label="Move lesson down"
          >
            <ArrowDown size={18} aria-hidden />
          </button>
        </div>
      </div>
      {showModulePicker ? (
        <div className="min-w-0 space-y-1 pl-1">
          <label className="block min-w-0">
            <span className="sr-only">Move lesson to another module</span>
            <select
              value=""
              disabled={canMoveLessonOutOfModule === false}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                const t = Number(v);
                if (Number.isInteger(t)) onMoveLessonToModule(t);
                e.target.value = '';
              }}
              className="box-border min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Move lesson to another module"
            >
              <option value="">Move to module…</option>
              {moveToModuleOptions.map((opt) => (
                <option key={opt.value} value={String(opt.value)}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          {canMoveLessonOutOfModule === false ? (
            <p className="text-[11px] leading-snug text-[var(--text-muted)]">
              Add another lesson here first—each module must keep at least one.
            </p>
          ) : null}
        </div>
      ) : null}
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
  /** Top-level mind map branches — editable for new and saved paths; synced to `pathMindmap` on save. */
  const [pathBranchTree, setPathBranchTree] = useState<PathBranchNode[]>([]);
  const pathBranchTreeRef = useRef<PathBranchNode[]>([]);
  pathBranchTreeRef.current = pathBranchTree;
  const pathBranchMindMapRootRef = useRef<HTMLDivElement | null>(null);
  /** After expanding a branch row, align its card to the top of the viewport. */
  const pendingBranchDisclosureScrollRef = useRef<string | null>(null);
  const pendingPathBranchReorderFocusRef = useRef<{
    nodeId: string;
    control: 'up' | 'down';
    beforeTop: number;
  } | null>(null);
  const [pathBranchReorderLayoutTick, setPathBranchReorderLayoutTick] = useState(0);
  const [pathBranchTreeBaselineJson, setPathBranchTreeBaselineJson] = useState('[]');
  const [pathMindmapLoading, setPathMindmapLoading] = useState(false);
  /** Add-branch flow or change linked course/lesson on an existing node. */
  type BranchModalState =
    | { kind: 'closed' }
    | { kind: 'add'; parentId: string | null; preset?: 'label' | 'course' | 'link' }
    | { kind: 'editCourse'; nodeId: string }
    | { kind: 'editLesson'; nodeId: string; courseId: string; lessonId: string };
  const [branchModal, setBranchModal] = useState<BranchModalState>({ kind: 'closed' });
  /** Branch rows with children are collapsed unless their id is in this set. Siblings accordion (only one expanded among same-parent children at any depth). */
  const [expandedBranchIds, setExpandedBranchIds] = useState<Set<string>>(() => new Set());
  const [branchDragActiveId, setBranchDragActiveId] = useState<string | null>(null);

  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);
  const [openModuleIdx, setOpenModuleIdx] = useState<Record<string, boolean>>({});
  const pathCoursesDisclosureOpenKey = useMemo(() => JSON.stringify(openModuleIdx), [openModuleIdx]);
  const [courseEditDraft, setCourseEditDraft] = useState<Course | null>(null);
  const [courseEditBaseline, setCourseEditBaseline] = useState<string | null>(null);
  const courseEditDraftRef = useRef<Course | null>(null);
  courseEditDraftRef.current = courseEditDraft;
  const pathCourseStructureEditorRef = useRef<HTMLDivElement | null>(null);
  const pendingPathModuleReorderFocusRef = useRef<{
    courseId: string;
    targetMiAfter: number;
    control: 'up' | 'down';
    beforeTop: number;
  } | null>(null);
  const pendingPathLessonReorderFocusRef = useRef<{
    courseId: string;
    moduleIndex: number;
    targetLessonIndexAfter: number;
    control: 'up' | 'down';
    beforeTop: number;
  } | null>(null);
  const [pathCourseReorderLayoutTick, setPathCourseReorderLayoutTick] = useState(0);

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

  const toggleBranchCollapse = useCallback(
    (id: string) => {
      setExpandedBranchIds((prev) => {
        if (prev.has(id)) {
          pendingBranchDisclosureScrollRef.current = null;
          const next = new Set<string>(prev);
          stripBranchExpandState(next, pathBranchTree, id);
          return next;
        }
        pendingBranchDisclosureScrollRef.current = id;
        return accordionExpandBranchRow(prev, pathBranchTree, id);
      });
    },
    [pathBranchTree]
  );

  const focusBranchRow = useCallback(
    (id: string) => {
      pendingBranchDisclosureScrollRef.current = id;
      setExpandedBranchIds((prev) => accordionExpandBranchRow(prev, pathBranchTree, id));
    },
    [pathBranchTree]
  );

  const handleBranchDragStart = useCallback((e: DragStartEvent) => {
    setBranchDragActiveId(String(e.active.id));
  }, []);

  const handleBranchDragEnd = useCallback((event: DragEndEvent) => {
    setBranchDragActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const nextRoots = applyBranchDragEnd(pathBranchTree, activeId, overId);
    setPathBranchTree(nextRoots);
  }, [pathBranchTree]);

  const handleBranchDragCancel = useCallback(() => {
    setBranchDragActiveId(null);
  }, []);

  /** Branch ↑/↓: one pure move + flushSync (avoids Strict Mode double functional setState). */
  const moveBranchAmongSiblings = useCallback(
    (id: string, delta: -1 | 1, scrollAnchor?: HTMLElement | null) => {
      const roots = pathBranchTreeRef.current;
      const next = moveNodeInTree(roots, id, delta);
      if (scrollAnchor) {
        const ctrl = scrollAnchor.getAttribute('data-branch-reorder');
        pendingPathBranchReorderFocusRef.current = {
          nodeId: id,
          control: ctrl === 'down' ? 'down' : 'up',
          beforeTop: scrollAnchor.getBoundingClientRect().top,
        };
      }
      flushSync(() => setPathBranchTree(next));
      setPathBranchReorderLayoutTick((t) => t + 1);
    },
    []
  );

  useLayoutEffect(() => {
    const job = pendingPathBranchReorderFocusRef.current;
    if (!job) return;
    pendingPathBranchReorderFocusRef.current = null;
    const sel = `[data-path-branch-node-id="${escapeSelectorAttrValue(job.nodeId)}"]`;
    const row = queryElementInScopeOrDocument(pathBranchMindMapRootRef.current, sel);
    applyReorderViewportScrollAndFocus(row, job, REORDER_DATA_ATTR_SELECTORS.branch);
  }, [pathBranchReorderLayoutTick]);

  const branchDragOverlayNode = useMemo(() => {
    if (!branchDragActiveId) return null;
    return findBranchNode(pathBranchTree, branchDragActiveId);
  }, [branchDragActiveId, pathBranchTree]);

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

  /** Load saved mind map tree when selecting a persisted path (keeps branches editable after first save). */
  useEffect(() => {
    if (!pathSelector || pathSelector === '__new__') {
      if (pathSelector === '__new__') setPathMindmapLoading(false);
      return;
    }
    let cancelled = false;
    setPathMindmapLoading(true);
    void (async () => {
      const mm = await fetchPathMindmapFromFirestore(pathSelector);
      if (cancelled) return;
      const roots = mm?.root.children.map(mindmapNodeToPathBranch) ?? [];
      setPathBranchTree(roots);
      setPathBranchTreeBaselineJson(JSON.stringify(roots));
      setPathMindmapLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [pathSelector]);

  useEffect(() => {
    setExpandedBranchIds(new Set());
  }, [pathSelector]);

  /** Remove expand state for branches that no longer exist or no longer have children. */
  useEffect(() => {
    const valid = collectBranchIdsWithChildren(pathBranchTree);
    setExpandedBranchIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
      }
      if (next.size === prev.size && [...prev].every((id) => next.has(id))) return prev;
      return next;
    });
  }, [pathBranchTree]);

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

  const branchesDirty = useMemo(
    () => JSON.stringify(pathBranchTree) !== pathBranchTreeBaselineJson,
    [pathBranchTree, pathBranchTreeBaselineJson]
  );

  /** True when title/description/merged course order differ from last baseline, or branch tree differs. */
  const pathDirty = useMemo(() => {
    if (!pathDraft) return false;
    if (pathBaselineJson === null) {
      return branchesDirty;
    }
    const baselineParsed = JSON.parse(pathBaselineJson) as LearningPath;
    const treeBaseline = JSON.parse(pathBranchTreeBaselineJson) as PathBranchNode[];
    const mergedNow = mergeCourseIdsFromBranches(pathDraft, pathBranchTree);
    const mergedBaseline = mergeCourseIdsFromBranches(baselineParsed, treeBaseline);
    const metaDirty =
      pathDraft.title !== baselineParsed.title ||
      (pathDraft.description ?? '') !== (baselineParsed.description ?? '') ||
      JSON.stringify(mergedNow) !== JSON.stringify(mergedBaseline);
    return metaDirty || branchesDirty;
  }, [pathDraft, pathBaselineJson, pathBranchTree, pathBranchTreeBaselineJson, branchesDirty]);

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

  const branchModalContextHint = useMemo(() => {
    if (branchModal.kind === 'editCourse' || branchModal.kind === 'editLesson') {
      return 'Nested branches under this node stay attached when you change the link.';
    }
    if (branchModal.kind === 'add') {
      if (branchModal.parentId == null) {
        return 'Top level — connects directly under Learning Path in the mind map.';
      }
      const p = findBranchNode(pathBranchTree, branchModal.parentId);
      return p
        ? `Nested under: ${branchNodeDisplayLabel(p, publishedList)}`
        : 'Nested branch';
    }
    return undefined;
  }, [branchModal, pathBranchTree, publishedList]);

  const applyPickNewPath = useCallback(() => {
    setCourseEditDraft(null);
    setCourseEditBaseline(null);
    setExpandedCourseId(null);
    const reserveIds = pathSelector === '__new__' && pathDraft?.id ? [pathDraft.id] : [];
    const newId = firstAvailableStructuredLearningPathId(paths, reserveIds);
    const fresh: LearningPath = { id: newId, title: '', courseIds: [] };
    setShowPathCourseRequiredHint(false);
    setPathBranchTree([]);
    setPathBranchTreeBaselineJson('[]');
    setBranchModal({ kind: 'closed' });
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
      setOpenModuleIdx({ [`m-${courseId}-0`]: true });
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
      setPathBranchTree([]);
      setPathBranchTreeBaselineJson('[]');
      setBranchModal({ kind: 'closed' });
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

  useBodyScrollLock(!!pathConfirmDialog || branchModal.kind !== 'closed');

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
      return;
    }
    if (pathBranchTree.length > 0) {
      setShowPathCourseRequiredHint(false);
    }
  }, [pathDraft?.courseIds.length, pathBranchTree.length]);

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

    const mergedCourseIds = mergeCourseIdsFromBranches(pathDraft, pathBranchTree);
    const hasContent = mergedCourseIds.length > 0 || pathBranchTree.length > 0;

    if (!hasContent) {
      setShowPathCourseRequiredHint(true);
      requestAnimationFrame(() => {
        const el =
          document.getElementById('admin-path-branches') ??
          document.getElementById('admin-path-course-required-hint') ??
          document.getElementById('admin-path-title');
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (el instanceof HTMLInputElement) el.focus({ preventScroll: true });
      });
      return;
    }

    for (const cid of mergedCourseIds) {
      if (!publishedList.some((c) => c.id === cid)) {
        setShowPathCourseRequiredHint(false);
        showActionToast(`Course "${cid}" is not in the published catalog. Remove it or publish the course first.`, 'danger');
        return;
      }
    }

    const toSave = { ...pathDraft, courseIds: mergedCourseIds };

    setPathBusy(true);
    const ok = await saveLearningPath(toSave);
    setPathBusy(false);
    if (ok) {
      setShowPathCourseRequiredHint(false);
      const nodes = branchTreeToMindmapForest(pathBranchTree, publishedList);
      const doc = mindmapDocumentWithCenterChildren(nodes);
      const mmOk = await savePathMindmapToFirestore(toSave.id, doc);
      if (mmOk) {
        setPathBranchTreeBaselineJson(JSON.stringify(pathBranchTree));
        showActionToast('Learning path and mind map saved.');
      } else {
        showActionToast('Path saved, but mind map could not be saved (check console / rules).', 'danger');
      }
      const list = await refreshPaths();
      const still = list.find((x) => x.id === toSave.id);
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

  const moveCourseModule = useCallback(
    (cid: string, mi: number, delta: -1 | 1, scrollAnchor?: HTMLElement | null) => {
      const c0 = courseEditDraftRef.current;
      if (!c0) return;
      const computed = computePathCourseModuleSwapDraft(c0, cid, mi, delta);
      if (!computed) return;

      if (scrollAnchor) {
        const ctrl = scrollAnchor.getAttribute('data-module-reorder');
        pendingPathModuleReorderFocusRef.current = {
          courseId: cid,
          targetMiAfter: mi + delta,
          control: ctrl === 'down' ? 'down' : 'up',
          beforeTop: scrollAnchor.getBoundingClientRect().top,
        };
      }

      const { a, b } = computed.pair;
      flushSync(() => setCourseEditDraft(computed.next));

      const ka = `m-${cid}-${a}`;
      const kb = `m-${cid}-${b}`;
      setOpenModuleIdx((prev) => {
        const oa = prev[ka];
        const ob = prev[kb];
        if (!oa && !ob) return prev;
        const next = { ...prev };
        delete next[ka];
        delete next[kb];
        if (oa) next[kb] = true;
        if (ob) next[ka] = true;
        return next;
      });

      setPathCourseReorderLayoutTick((t) => t + 1);
    },
    []
  );

  const moveCourseLesson = useCallback(
    (cid: string, mi: number, li: number, delta: -1 | 1, scrollAnchor?: HTMLElement | null) => {
      const c0 = courseEditDraftRef.current;
      if (!c0) return;
      const computed = computePathCourseLessonSwapDraft(c0, cid, mi, li, delta);
      if (!computed) return;

      if (scrollAnchor) {
        const ctrl = scrollAnchor.getAttribute('data-lesson-reorder');
        pendingPathLessonReorderFocusRef.current = {
          courseId: cid,
          moduleIndex: mi,
          targetLessonIndexAfter: li + delta,
          control: ctrl === 'down' ? 'down' : 'up',
          beforeTop: scrollAnchor.getBoundingClientRect().top,
        };
      }

      flushSync(() => setCourseEditDraft(computed.next));
      setPathCourseReorderLayoutTick((t) => t + 1);
    },
    []
  );

  useLayoutEffect(() => {
    const modJob = pendingPathModuleReorderFocusRef.current;
    if (modJob) {
      pendingPathModuleReorderFocusRef.current = null;
      const escC = escapeSelectorAttrValue(modJob.courseId);
      const sel = `[data-path-course-id="${escC}"][data-path-module-index="${modJob.targetMiAfter}"]`;
      const row = queryElementInScopeOrDocument(pathCourseStructureEditorRef.current, sel);
      applyReorderViewportScrollAndFocus(row, modJob, REORDER_DATA_ATTR_SELECTORS.module);
      return;
    }

    const lesJob = pendingPathLessonReorderFocusRef.current;
    if (!lesJob) return;
    pendingPathLessonReorderFocusRef.current = null;
    const escC = escapeSelectorAttrValue(lesJob.courseId);
    const sel = `[data-path-course-id="${escC}"][data-path-module-index="${lesJob.moduleIndex}"][data-path-lesson-index="${lesJob.targetLessonIndexAfter}"]`;
    const row = queryElementInScopeOrDocument(pathCourseStructureEditorRef.current, sel);
    applyReorderViewportScrollAndFocus(row, lesJob, REORDER_DATA_ATTR_SELECTORS.lesson);
  }, [pathCourseReorderLayoutTick]);

  useLayoutEffect(() => {
    const id = pendingBranchDisclosureScrollRef.current;
    if (!id) return;
    pendingBranchDisclosureScrollRef.current = null;
    const sel = `[data-path-branch-node-id="${escapeSelectorAttrValue(id)}"]`;
    const row = queryElementInScopeOrDocument(pathBranchMindMapRootRef.current, sel);
    scrollDisclosureRowToTop(null, row);
  }, [expandedBranchIds]);

  useLayoutEffect(() => {
    if (!expandedCourseId) return;
    const section = document.getElementById('admin-path-courses-section');
    if (!section) return;
    const esc = escapeSelectorAttrValue(expandedCourseId);
    const prefix = `m-${expandedCourseId}-`;
    let bestMi: number | null = null;
    for (const [k, v] of Object.entries(openModuleIdx)) {
      if (!v || !k.startsWith(prefix)) continue;
      const mi = Number(k.slice(prefix.length));
      if (Number.isInteger(mi) && (bestMi === null || mi > bestMi)) bestMi = mi;
    }
    let el: HTMLElement | null = null;
    if (bestMi !== null) {
      el = section.querySelector(`[data-path-course-id="${esc}"][data-path-module-index="${bestMi}"]`);
    }
    if (!el) {
      el = section.querySelector(`[data-path-course-disclosure="${esc}"]`);
    }
    scrollDisclosureRowToTop(null, el);
  }, [expandedCourseId, pathCoursesDisclosureOpenKey]);

  const moveCourseLessonToModule = useCallback(
    (cid: string, mi: number, li: number, targetMi: number) => {
      if (targetMi === mi) return;
      let movedOk = false;
      setCourseEditDraft((c) => {
        if (!c || c.id !== cid) return c;
        if (targetMi < 0 || targetMi >= c.modules.length) return c;
        const source = c.modules[mi];
        if (!source || source.lessons.length <= 1 || !source.lessons[li]) return c;

        const moved = { ...source.lessons[li]! };
        const modulesWithout = c.modules.map((m, i) => {
          if (i !== mi) return m;
          return { ...m, lessons: m.lessons.filter((_, j) => j !== li) };
        });

        let lessonToInsert = moved;
        if (!isStructuredCourseId(c.id)) {
          const tempCourse: Course = { ...c, modules: modulesWithout };
          lessonToInsert = { ...moved, id: nextLessonIdLegacy(tempCourse) };
        }

        const finalModules = modulesWithout.map((m, i) => {
          if (i !== targetMi) return m;
          return { ...m, lessons: [...m.lessons, lessonToInsert] };
        });

        let next: Course = { ...c, modules: finalModules };
        if (isStructuredCourseId(next.id)) {
          next = remapStructuredCourseModuleLessonIdsByOrder(next);
        }
        movedOk = true;
        return next;
      });
      if (!movedOk) {
        showActionToast(
          'Could not move lesson. Add another lesson to this module first—each module must keep at least one.',
          'danger'
        );
        return;
      }
      setOpenModuleIdx((prev) => ({
        ...prev,
        [`m-${cid}-${targetMi}`]: true,
      }));
      showActionToast('Lesson moved to the other module.');
    },
    [showActionToast]
  );

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
      if (!oid.startsWith('cm:')) return;
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
      if (!oid.startsWith('ml:')) return;
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

  return (
    <div className="min-w-0 w-full space-y-4">
      {actionToast}

      <div className="space-y-3">
        <div className="flex flex-col gap-3 md:grid md:grid-cols-3 md:items-start md:gap-x-3 md:gap-y-3">
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
          <div className="grid min-w-0 grid-cols-2 gap-2 md:contents">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Document ID</span>
              <div
                className="box-border flex min-h-[42px] w-full min-w-0 items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-2 text-sm font-mono text-[var(--text-primary)] md:px-3"
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
                className="box-border flex min-h-[42px] w-full min-w-0 items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-2 text-sm text-[var(--text-primary)] md:px-3"
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

          <div
            id="admin-path-branches"
            className={`space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-4 ${
              pathMindmapLoading ? 'pointer-events-none opacity-60' : ''
            }`}
          >
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-[var(--text-primary)]">Branches (mind map)</h3>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                Add branches below, then drag to reorder or nest. Everything saves with{' '}
                <strong className="text-[var(--text-secondary)]">Save path</strong>.
              </p>
              <details className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]/30 px-3 py-2 text-xs text-[var(--text-muted)]">
                <summary className="cursor-pointer select-none font-semibold text-[var(--text-secondary)]">
                  How branching works
                </summary>
                <div className="mt-2 space-y-2 leading-relaxed">
                  <p>
                    Drag the <strong className="text-[var(--text-secondary)]">grip</strong> to reorder among siblings.
                    Drop on the <strong className="text-[var(--text-secondary)]">main part of a row</strong> (not the
                    grip) to nest under that branch. Use the dashed strips at the{' '}
                    <strong className="text-[var(--text-secondary)]">top or bottom</strong> of the list for top-level
                    position.
                  </p>
                  <p>
                    Edit label text inline. Use <strong className="text-[var(--text-secondary)]">Change course</strong>{' '}
                    or <strong className="text-[var(--text-secondary)]">Change lesson</strong> to relink linked
                    branches. The <strong className="text-[var(--text-secondary)]">chevron</strong> hides or shows nested
                    branches. <strong className="text-[var(--text-secondary)]">Add under</strong> adds a child branch.
                  </p>
                  <p>
                    Course branches (and legacy lesson branches) feed{' '}
                    <strong className="text-[var(--text-secondary)]">Courses in path</strong>{' '}
                    order automatically.
                  </p>
                </div>
              </details>
            </div>
            {pathMindmapLoading && pathSelector !== '__new__' ? (
              <div className="flex items-center gap-2 py-4 text-sm text-[var(--text-muted)]">
                <Loader2 size={18} className="animate-spin shrink-0" aria-hidden />
                Loading mind map…
              </div>
            ) : (
              <>
                {pathBranchTree.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-orange-500/35 bg-orange-500/[0.07] px-4 py-6 sm:px-6">
                    <p className="text-center text-sm font-semibold text-[var(--text-primary)]">Add your first branch</p>
                    <p className="mt-2 text-center text-xs leading-relaxed text-[var(--text-muted)]">
                      Start with a text label, a full course, or a web link—you can reorder and nest afterward.
                    </p>
                    <div className="mt-4 flex flex-col gap-2">
                      <button
                        type="button"
                        disabled={!!pathMindmapLoading && pathSelector !== '__new__'}
                        onClick={() => setBranchModal({ kind: 'add', parentId: null, preset: 'label' })}
                        className="flex min-h-12 w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-3 text-left transition-colors hover:border-orange-500/40 hover:bg-[var(--hover-bg)] disabled:opacity-40"
                      >
                        <span className="flex w-full items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                          <Type size={18} className="shrink-0 text-orange-500" aria-hidden />
                          Text label
                        </span>
                        <span className="pl-[1.625rem] text-xs text-[var(--text-muted)]">Section or topic heading</span>
                      </button>
                      <button
                        type="button"
                        disabled={
                          (pathMindmapLoading && pathSelector !== '__new__') || publishedList.length === 0
                        }
                        onClick={() => setBranchModal({ kind: 'add', parentId: null, preset: 'course' })}
                        className="flex min-h-12 w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-3 text-left transition-colors hover:border-orange-500/40 hover:bg-[var(--hover-bg)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span className="flex w-full items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                          <GraduationCap size={18} className="shrink-0 text-blue-500" aria-hidden />
                          Whole course
                        </span>
                        <span className="pl-[1.625rem] text-xs text-[var(--text-muted)]">
                          {publishedList.length === 0
                            ? 'Publish courses in Catalog first'
                            : 'Link a course from the catalog'}
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={!!pathMindmapLoading && pathSelector !== '__new__'}
                        onClick={() => setBranchModal({ kind: 'add', parentId: null, preset: 'link' })}
                        className="flex min-h-12 w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-3 text-left transition-colors hover:border-orange-500/40 hover:bg-[var(--hover-bg)] disabled:opacity-40"
                      >
                        <span className="flex w-full items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                          <Link2 size={18} className="shrink-0 text-violet-500" aria-hidden />
                          Web link
                        </span>
                        <span className="pl-[1.625rem] text-xs text-[var(--text-muted)]">
                          Blog, article, or any page — opens in a new tab
                        </span>
                      </button>
                    </div>
                    <p className="mt-4 text-center text-[11px] text-[var(--text-muted)]">
                      Or use <strong className="text-[var(--text-secondary)]">Add branch</strong> below to open all
                      options—including nested add flows.
                    </p>
                  </div>
                ) : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={pathBranchCollisionDetection}
                    onDragStart={handleBranchDragStart}
                    onDragEnd={handleBranchDragEnd}
                    onDragCancel={handleBranchDragCancel}
                  >
                    <div ref={pathBranchMindMapRootRef} className="min-w-0">
                    <PathBranchTreeList
                      nodes={pathBranchTree}
                      depth={0}
                      publishedList={publishedList}
                      expandedBranchIds={expandedBranchIds}
                      onToggleCollapse={toggleBranchCollapse}
                      onBranchRowFocus={focusBranchRow}
                      onAddUnder={(parentId) => setBranchModal({ kind: 'add', parentId })}
                      onRemove={(id) => setPathBranchTree((roots) => removeNodeById(roots, id))}
                      onMove={moveBranchAmongSiblings}
                      onLabelChange={(id, label) =>
                        setPathBranchTree((roots) =>
                          mapBranchNodeById(roots, id, (n) =>
                            n.kind === 'label' ? { ...n, label } : n
                          )
                        )
                      }
                      onLinkBranchChange={(id, patch) =>
                        setPathBranchTree((roots) =>
                          mapBranchNodeById(roots, id, (n) =>
                            n.kind === 'link' ? { ...n, ...patch } : n
                          )
                        )
                      }
                      onRequestEditCourse={(id) => setBranchModal({ kind: 'editCourse', nodeId: id })}
                      onRequestEditLesson={(id) => {
                        const node = findBranchNode(pathBranchTree, id);
                        if (node?.kind !== 'lesson') return;
                        setBranchModal({
                          kind: 'editLesson',
                          nodeId: id,
                          courseId: node.courseId,
                          lessonId: node.lessonId,
                        });
                      }}
                      dndDisabled={!!pathMindmapLoading}
                    />
                    </div>
                    <DragOverlay dropAnimation={null}>
                      {branchDragOverlayNode ? (
                        <div className="flex max-w-[min(100vw-2rem,20rem)] items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 shadow-lg">
                          <GripVertical size={18} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
                          <span className="min-w-0 truncate text-sm font-semibold text-[var(--text-primary)]">
                            {branchNodeDisplayLabel(branchDragOverlayNode, publishedList)}
                          </span>
                        </div>
                      ) : null}
                    </DragOverlay>
                  </DndContext>
                )}
                <button
                  type="button"
                  disabled={pathMindmapLoading && pathSelector !== '__new__'}
                  onClick={() => setBranchModal({ kind: 'add', parentId: null })}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-orange-500/40 bg-orange-500/10 px-4 text-sm font-bold text-orange-600 dark:text-orange-400 hover:bg-orange-500/15 disabled:opacity-40 sm:w-auto"
                >
                  <Plus size={18} aria-hidden />
                  Add branch
                </button>
              </>
            )}
          </div>

          {pathDraft.courseIds.length === 0 && showPathCourseRequiredHint ? (
            <p id="admin-path-course-required-hint" className="text-xs font-semibold text-red-400">
              Add at least one branch, or link a course via Course / Lesson branches, before saving. Web links alone
              do not add catalog courses.
            </p>
          ) : null}

          <AddPathBranchModal
            open={branchModal.kind !== 'closed'}
            onClose={() => setBranchModal({ kind: 'closed' })}
            catalogCourses={publishedList}
            contextHint={branchModalContextHint}
            addPreset={branchModal.kind === 'add' ? branchModal.preset : undefined}
            mode={
              branchModal.kind === 'editCourse'
                ? 'editCourse'
                : branchModal.kind === 'editLesson'
                  ? 'editLesson'
                  : 'add'
            }
            editLessonPreset={
              branchModal.kind === 'editLesson'
                ? { courseId: branchModal.courseId, lessonId: branchModal.lessonId }
                : undefined
            }
            onCommit={(branch) => {
              if (branchModal.kind === 'editCourse' || branchModal.kind === 'editLesson') {
                const targetId = branchModal.nodeId;
                setPathBranchTree((roots) => {
                  const existing = findBranchNode(roots, targetId);
                  const ch = existing?.children ?? [];
                  if (branch.kind === 'course') {
                    return mapBranchNodeById(roots, targetId, () => ({
                      id: targetId,
                      kind: 'course',
                      courseId: branch.courseId,
                      children: ch,
                    }));
                  }
                  if (branch.kind === 'lesson') {
                    return mapBranchNodeById(roots, targetId, () => ({
                      id: targetId,
                      kind: 'lesson',
                      courseId: branch.courseId,
                      lessonId: branch.lessonId,
                      children: ch,
                    }));
                  }
                  return roots;
                });
                setBranchModal({ kind: 'closed' });
                return;
              }
              if (branchModal.kind === 'add') {
                setPathBranchTree((roots) => addChildAtParent(roots, branchModal.parentId, branch));
                setBranchModal({ kind: 'closed' });
              }
            }}
          />

          {pathDraft.courseIds.length > 0 ? (
            <div id="admin-path-courses-section">
              <h3 className="mb-2 text-sm font-bold text-[var(--text-primary)]">
                Courses in path <span className="font-normal text-[var(--text-muted)]">(drag to reorder)</span>
              </h3>
              <DndContext
                sensors={sensors}
                collisionDetection={pathCoursesListCollisionDetection}
                onDragEnd={onDragEnd}
              >
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
                          <div ref={pathCourseStructureEditorRef} className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs text-[var(--text-muted)]">
                                Reorder modules and lessons with the grip, drag-and-drop, or arrows. Use{' '}
                                <strong className="font-medium text-[var(--text-secondary)]">Move to module…</strong> on a
                                lesson to move it to another section (add a second lesson first if it is the only one in
                                its module). Save applies the same catalog document; structured courses (C1…) remap ids by
                                position.
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
                                      pathCourseId={cid}
                                      pathModuleIndex={mi}
                                      moduleId={mod.id}
                                      moduleTitle={mod.title}
                                      moduleIndexLabel={`Module ${mi + 1}`}
                                      expanded={modOpen}
                                      onToggle={() =>
                                        setOpenModuleIdx((prev) => ({
                                          ...prev,
                                          [mid]: !modOpen,
                                        }))
                                      }
                                      canMoveUp={mi > 0}
                                      canMoveDown={mi < courseEditDraft.modules.length - 1}
                                      onMoveUp={(el) => moveCourseModule(cid, mi, -1, el)}
                                      onMoveDown={(el) => moveCourseModule(cid, mi, 1, el)}
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
                                                pathCourseId={cid}
                                                pathModuleIndex={mi}
                                                pathLessonIndex={li}
                                                lessonIndexLabel={`Lesson ${li + 1}`}
                                                title={les.title}
                                                lessonId={les.id}
                                                canMoveUp={li > 0}
                                                canMoveDown={li < mod.lessons.length - 1}
                                                onMoveUp={(el) => moveCourseLesson(cid, mi, li, -1, el)}
                                                onMoveDown={(el) => moveCourseLesson(cid, mi, li, 1, el)}
                                                moveToModuleOptions={
                                                  courseEditDraft.modules.length > 1
                                                    ? courseEditDraft.modules
                                                        .map((tm, mj) => ({ mj, tm }))
                                                        .filter(({ mj }) => mj !== mi)
                                                        .map(({ mj, tm }) => ({
                                                          value: mj,
                                                          label: `Module ${mj + 1}: ${tm.id.trim() || '—'} - ${tm.title.trim() || 'Untitled module'}`,
                                                        }))
                                                    : undefined
                                                }
                                                canMoveLessonOutOfModule={mod.lessons.length > 1}
                                                onMoveLessonToModule={(targetMi) =>
                                                  moveCourseLessonToModule(cid, mi, li, targetMi)
                                                }
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
            </div>
          ) : null}
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
