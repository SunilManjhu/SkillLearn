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
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  ArrowRightLeft,
  Globe,
  GraduationCap,
  Link2,
  Layers,
  Loader2,
  Plus,
  Route,
  Save,
  Trash2,
  Type,
  X,
  Minus,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import type { Course, Lesson, Module } from '../../data/courses';
import { isCourseCatalogPublished } from '../../data/courses';
import { formatCourseTaxonomyForSearch } from '../../utils/courseTaxonomy';
import {
  compactVisibleToRolesForPersist,
  mindmapDocumentWithCenterChildren,
  mindmapNodeVisibleToViewer,
  newMindmapNodeId,
  type MindmapTreeNode,
  type PathOutlineAudienceRole,
} from '../../data/pathMindmap';
import type { LearningPath } from '../../data/learningPaths';
import { isLearningPathCatalogPublished } from '../../data/learningPaths';
import { firstAvailableStructuredLearningPathIdFromDocIds } from '../../utils/learningPathStructuredIds';
import {
  deleteLearningPath,
  listLearningPathDocumentIds,
  loadLearningPathsFromFirestore,
  saveLearningPath,
} from '../../utils/learningPathsFirestore';
import {
  deleteCreatorLearningPath,
  fetchCreatorPathMindmapFromFirestore,
  listCreatorLearningPathDocumentIdsForOwner,
  loadCreatorLearningPathsForOwner,
  saveCreatorLearningPath,
  saveCreatorPathMindmapToFirestore,
} from '../../utils/creatorLearningPathsFirestore';
import { fetchPathMindmapFromFirestore, savePathMindmapToFirestore } from '../../utils/pathMindmapFirestore';
import { normalizeExternalHref } from '../../utils/externalUrl';
import { AdminLabelInfoTip } from './adminLabelInfoTip';
import { useAdminActionToast } from './useAdminActionToast';
import { AdminDisplayNameConflictDialog } from './AdminDisplayNameConflictDialog';
import {
  findPathSaveTitleConflict,
  loadPathTitlesForConflictCheck,
  type TitleConflictHit,
} from '../../utils/catalogDisplayNameConflicts';
import { clearPathOutlineUiSessionForPathId } from '../../utils/pathOutlineUiSession';
import {
  applyReorderViewportScrollAndFocus,
  escapeSelectorAttrValue,
  queryElementInScopeOrDocument,
  REORDER_DATA_ATTR_SELECTORS,
} from '../../utils/reorderScrollViewport';
import { scrollDisclosureRowToTop } from '../../utils/scrollDisclosureRowToTop';
import {
  ADMIN_INSERT_STRIP_CHIP_BTN_EXPAND_ROW,
  ADMIN_INSERT_STRIP_CHIP_BTN_PERSIST,
  ADMIN_INSERT_STRIP_OUTER_EXPAND_HOVER,
} from './adminInsertStripClasses';

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [removed] = next.splice(from, 1);
  next.splice(to, 0, removed);
  return next;
}

/** Tree node for path outline — synced to `pathMindmap` on save. Two levels only: top-level sections (label or module) and sub-rows (sub-rows cannot nest further). */
type PathBranchNode =
  | {
      id: string;
      kind: 'label';
      label: string;
      children: PathBranchNode[];
      locked?: boolean;
      visibleToRoles?: PathOutlineAudienceRole[];
    }
  | { id: string; kind: 'divider'; label: string; children: PathBranchNode[]; visibleToRoles?: PathOutlineAudienceRole[] }
  | {
      id: string;
      kind: 'module';
      courseId: string;
      moduleId: string;
      children: PathBranchNode[];
      visibleToRoles?: PathOutlineAudienceRole[];
    }
  | { id: string; kind: 'course'; courseId: string; children: PathBranchNode[]; visibleToRoles?: PathOutlineAudienceRole[] }
  | {
      id: string;
      kind: 'lesson';
      courseId: string;
      lessonId: string;
      children: PathBranchNode[];
      visibleToRoles?: PathOutlineAudienceRole[];
    }
  | {
      id: string;
      kind: 'link';
      label: string;
      href: string;
      children: PathBranchNode[];
      visibleToRoles?: PathOutlineAudienceRole[];
    };

function courseModuleById(course: Course | undefined, moduleId: string): Module | undefined {
  return course?.modules.find((m) => m.id === moduleId);
}

function lessonBelongsToCourseModule(
  course: Course | undefined,
  moduleId: string,
  lessonId: string
): boolean {
  const mod = courseModuleById(course, moduleId);
  if (!mod) return false;
  return mod.lessons.some((l) => l.id === lessonId);
}

function pathBranchVisibilityToMindmapFields(
  n: PathBranchNode
): Pick<MindmapTreeNode, 'visibleToRoles'> | Record<string, never> {
  const c = compactVisibleToRolesForPersist(n.visibleToRoles);
  if (c === undefined) return {};
  return { visibleToRoles: c };
}

function pathBranchVisibilityFromMindmap(
  n: MindmapTreeNode
): { visibleToRoles?: PathOutlineAudienceRole[] } {
  const v = n.visibleToRoles;
  if (v === undefined) return {};
  if (v.length === 0) return { visibleToRoles: [] };
  if (v.includes('user') && v.includes('admin')) return {};
  return { visibleToRoles: [...new Set(v)] };
}

/** Promote legacy nested rows into section-level dividers + flat siblings (admin “Flatten”). */
function flattenPathBranchSectionChildren(nodes: PathBranchNode[], publishedList: Course[]): PathBranchNode[] {
  const out: PathBranchNode[] = [];
  const walk = (ns: PathBranchNode[]) => {
    for (const n of ns) {
      if (n.kind === 'divider') {
        out.push({ ...n, children: [] });
        continue;
      }
      if (n.kind === 'module' && n.children.length > 0) {
        out.push({
          id: newMindmapNodeId(),
          kind: 'divider',
          label: branchNodeDisplayLabel(n, publishedList).trim() || 'Module',
          children: [],
          ...(n.visibleToRoles ? { visibleToRoles: n.visibleToRoles } : {}),
        });
        walk(n.children);
        continue;
      }
      if (n.kind === 'label' && n.children.length > 0) {
        out.push({
          id: newMindmapNodeId(),
          kind: 'divider',
          label: n.label.trim() || 'Topic',
          children: [],
          ...(n.visibleToRoles ? { visibleToRoles: n.visibleToRoles } : {}),
        });
        walk(n.children);
        continue;
      }
      if (n.children.length > 0) {
        out.push({ ...n, children: [] });
        walk(n.children);
        continue;
      }
      out.push({ ...n, children: [] });
    }
  };
  walk(nodes);
  return out;
}

function collectPathBranchStructureIssues(roots: PathBranchNode[], publishedList: Course[]): string[] {
  const issues: string[] = [];
  for (const root of roots) {
    if (root.kind !== 'label' && root.kind !== 'module') {
      const display = branchNodeDisplayLabel(root, publishedList);
      if (root.kind === 'divider') {
        issues.push('A divider cannot be a top-level section — move it under a section or delete it.');
      } else {
        issues.push(
          `Top-level rows must be a text section or a course module. “${display}” is a ${root.kind} row — use Change type, or add a section / module at the top level first.`
        );
      }
    }
    const secLabel = branchNodeDisplayLabel(root, publishedList);
    if (root.kind === 'module') {
      const course = publishedList.find((c) => c.id === root.courseId);
      const mod = courseModuleById(course, root.moduleId);
      if (!course) {
        issues.push(`Module row “${secLabel}” uses an unknown course (id: ${root.courseId}).`);
      } else if (!mod) {
        issues.push(`Module row “${secLabel}” does not match any module in that course.`);
      }
      for (const row of root.children) {
        if (row.children.length > 0) {
          issues.push(
            `Under module “${secLabel}”, “${branchNodeDisplayLabel(row, publishedList)}” has nested rows — only a flat list of lessons is allowed.`
          );
        }
        if (row.kind !== 'lesson') {
          issues.push(
            `Under module “${secLabel}”, only lesson rows are allowed (not ${row.kind}). Remove or change “${branchNodeDisplayLabel(row, publishedList)}”.`
          );
          continue;
        }
        if (row.courseId !== root.courseId) {
          issues.push(
            `Lesson “${branchNodeDisplayLabel(row, publishedList)}” under module “${secLabel}” must belong to the same course as that module.`
          );
        } else if (!lessonBelongsToCourseModule(course, root.moduleId, row.lessonId)) {
          issues.push(
            `Lesson “${branchNodeDisplayLabel(row, publishedList)}” is not in module “${secLabel}”.`
          );
        }
      }
    } else {
      for (const row of root.children) {
        if (row.children.length > 0) {
          issues.push(
            `Under “${secLabel}”, “${branchNodeDisplayLabel(row, publishedList)}” has nested rows. Paths must be section → flat list only—flatten or remove nesting.`
          );
        }
        if (row.kind === 'module') {
          issues.push(
            `Course modules belong at the top level only — move “${branchNodeDisplayLabel(row, publishedList)}” out from under “${secLabel}”.`
          );
        }
      }
    }
  }
  return issues;
}

/** True if `id` is a root row in the outline (not nested under a section). */
function isRootBranchId(roots: PathBranchNode[], id: string): boolean {
  return roots.some((r) => r.id === id);
}

function updateNodeChildren(n: PathBranchNode, children: PathBranchNode[]): PathBranchNode {
  if (n.kind === 'divider') return { ...n, children: [] };
  if (n.kind === 'label') return { ...n, children };
  if (n.kind === 'module') return { ...n, children };
  if (n.kind === 'course') return { ...n, children };
  if (n.kind === 'link') return { ...n, children };
  return { ...n, children };
}

function collectCourseIdsFromTree(nodes: PathBranchNode[]): string[] {
  const out: string[] = [];
  function walk(ns: PathBranchNode[]) {
    for (const n of ns) {
      if (n.kind === 'course' || n.kind === 'module' || n.kind === 'lesson') {
        if (!out.includes(n.courseId)) out.push(n.courseId);
      }
      if (n.kind !== 'divider') walk(n.children);
    }
  }
  walk(nodes);
  return out;
}

function mergeCourseIdsFromBranches(draft: LearningPath, roots: PathBranchNode[]): string[] {
  const fromTree = collectCourseIdsFromTree(roots);
  // Branch tree is authoritative: do not union with draft.courseIds or removed courses stay in Firestore forever.
  if (roots.length > 0) {
    return fromTree;
  }
  return [...draft.courseIds];
}

/** Same visibility as learner outline: Show off or Admin-only → not “shown” to learners for publish rules. */
function pathBranchVisibleToLearner(n: PathBranchNode): boolean {
  const p = compactVisibleToRolesForPersist(n.visibleToRoles);
  const node: MindmapTreeNode = {
    id: n.id,
    label: '',
    children: [],
    ...(p !== undefined ? { visibleToRoles: p } : {}),
  };
  return mindmapNodeVisibleToViewer(node, false);
}

/**
 * Unpublished catalog courses on learner-visible outline rows (unique by id, outline order).
 * Empty outline tree: merged course ids are treated as learner-visible (legacy flat path list).
 */
function collectLearnerVisibleUnpublishedCourses(
  roots: PathBranchNode[],
  publishedList: Course[],
  mergedCourseIdsWhenNoTree: string[]
): Course[] {
  const seen = new Set<string>();
  const out: Course[] = [];
  const addIfEligible = (row: Course | undefined) => {
    if (!row || isCourseCatalogPublished(row) || seen.has(row.id)) return;
    seen.add(row.id);
    out.push(row);
  };

  if (roots.length > 0) {
    const walk = (ns: PathBranchNode[]) => {
      for (const n of ns) {
        if (n.kind === 'course' || n.kind === 'module' || n.kind === 'lesson') {
          if (pathBranchVisibleToLearner(n)) {
            addIfEligible(publishedList.find((c) => c.id === n.courseId));
          }
        }
        if (n.kind !== 'divider') walk(n.children);
      }
    };
    walk(roots);
    return out;
  }
  for (const cid of mergedCourseIdsWhenNoTree) {
    addIfEligible(publishedList.find((c) => c.id === cid));
  }
  return out;
}

function formatPathPublishBlockedByCoursesMessage(courses: Course[]): string {
  if (courses.length === 0) return '';
  const lines = courses.map((c, i) => `${i + 1}. ${c.title.trim() || c.id}`).join('\n');
  const intro =
    courses.length === 1
      ? 'The course below is not published to the Catalog. Remove it from the path, turn Show off for that row, or publish it before publishing this path:'
      : 'The courses below are not published to the Catalog. Remove them from the path, turn Show off for those rows, or publish them before publishing this path:';
  return `${intro}\n${lines}`;
}

function addChildAtParent(
  nodes: PathBranchNode[],
  parentId: string | null,
  child: PathBranchNode
): PathBranchNode[] {
  if (parentId !== null && !parentAllowsChildRows(nodes, parentId)) {
    return nodes;
  }
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

function insertChildAtParent(
  nodes: PathBranchNode[],
  parentId: string | null,
  insertIndex: number,
  child: PathBranchNode
): PathBranchNode[] {
  if (parentId !== null && !parentAllowsChildRows(nodes, parentId)) {
    return nodes;
  }
  if (parentId === null) {
    const next = [...nodes];
    const i = Math.max(0, Math.min(insertIndex, next.length));
    next.splice(i, 0, child);
    return next;
  }
  return nodes.map((n) => {
    if (n.id === parentId) {
      const ch = [...n.children];
      const i = Math.max(0, Math.min(insertIndex, ch.length));
      ch.splice(i, 0, child);
      return updateNodeChildren(n, ch);
    }
    return updateNodeChildren(n, insertChildAtParent(n.children, parentId, insertIndex, child));
  });
}

function removeNodeById(nodes: PathBranchNode[], id: string): PathBranchNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => updateNodeChildren(n, removeNodeById(n.children, id)));
}

/** Remove the first node with `id` and return it (for move). Does not remap ids. */
function extractNodeById(
  nodes: PathBranchNode[],
  id: string
): { next: PathBranchNode[]; extracted: PathBranchNode | null } {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx >= 0) {
    const extracted = nodes[idx]!;
    const next = nodes.filter((_, i) => i !== idx);
    return { next, extracted };
  }
  let extracted: PathBranchNode | null = null;
  const next = nodes.map((n) => {
    if (extracted) return n;
    const inner = extractNodeById(n.children, id);
    if (inner.extracted) {
      extracted = inner.extracted;
      return updateNodeChildren(n, inner.next);
    }
    return n;
  });
  return { next: extracted ? next : nodes, extracted };
}

function siblingsUnderParent(roots: PathBranchNode[], parentId: string | null): PathBranchNode[] {
  if (parentId === null) return roots;
  const p = findBranchNode(roots, parentId);
  return p?.children ?? [];
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
  const v = pathBranchVisibilityToMindmapFields(n);
  if (n.kind === 'divider') {
    return {
      id: n.id,
      label: n.label.trim() || 'Untitled',
      children: [],
      kind: 'divider',
      ...v,
    };
  }
  if (n.kind === 'module') {
    const c = publishedList.find((x) => x.id === n.courseId);
    const mod = courseModuleById(c, n.moduleId);
    return {
      id: n.id,
      label: mod?.title?.trim() || n.moduleId,
      children,
      kind: 'module',
      courseId: n.courseId,
      moduleId: n.moduleId,
      ...v,
    };
  }
  if (n.kind === 'label') {
    return {
      id: n.id,
      label: n.label.trim() || 'Untitled',
      children,
      kind: 'label',
      ...(n.locked ? { locked: true } : {}),
      ...v,
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
      ...v,
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
      ...v,
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
    ...v,
  };
}

function branchTreeToMindmapForest(roots: PathBranchNode[], publishedList: Course[]): MindmapTreeNode[] {
  return roots.map((r) => branchNodeToMindmap(r, publishedList));
}

function branchNodeDisplayLabel(n: PathBranchNode, publishedList: Course[]): string {
  if (n.kind === 'label') return n.label || 'Untitled';
  if (n.kind === 'divider') return n.label.trim() || 'Divider';
  if (n.kind === 'link') return n.label.trim() || n.href || 'Link';
  if (n.kind === 'module') {
    const c = publishedList.find((x) => x.id === n.courseId);
    const mod = courseModuleById(c, n.moduleId);
    if (c && mod) return `${c.title} · ${mod.title?.trim() || n.moduleId}`;
    return mod?.title?.trim() || n.moduleId || n.courseId;
  }
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

/** Parent branch id, or `null` if `targetId` is a top-level root (or missing). */
function findParentIdOfBranch(roots: PathBranchNode[], targetId: string): string | null {
  for (const r of roots) {
    if (r.children.some((c) => c.id === targetId)) return r.id;
    const inner = findParentIdOfBranch(r.children, targetId);
    if (inner !== null) return inner;
  }
  return null;
}

/** Depth from root: top-level = 0, sub-branch under a section = 1. */
function findDepthOfBranchId(roots: PathBranchNode[], targetId: string): number | null {
  function walk(nodes: PathBranchNode[], d: number): number | null {
    for (const n of nodes) {
      if (n.id === targetId) return d;
      const inner = walk(n.children, d + 1);
      if (inner !== null) return inner;
    }
    return null;
  }
  return walk(roots, 0);
}

/** Only top-level rows may have child rows (two levels total: section → sub-branch). */
function parentAllowsChildRows(roots: PathBranchNode[], parentId: string | null): boolean {
  if (parentId === null) return true;
  return findDepthOfBranchId(roots, parentId) === 0;
}

/** Reassign every node id in a subtree (new IDs for Firestore). */
function remapBranchSubtreeIds(node: PathBranchNode): PathBranchNode {
  const walk = (n: PathBranchNode): PathBranchNode => {
    const id = newMindmapNodeId();
    if (n.kind === 'divider') {
      return { ...n, id, children: [] };
    }
    if (n.kind === 'module') {
      return { ...n, id, children: n.children.map(walk) };
    }
    return { ...n, id, children: n.children.map(walk) };
  };
  return walk(node);
}

/** New ids for every node in a saved outline (duplicate whole path). */
function remapPathBranchForest(roots: PathBranchNode[]): PathBranchNode[] {
  return roots.map((n) => remapBranchSubtreeIds(deepClone(n)));
}

/** If true, the duplicate can only sit in the top-level list (otherwise nested rows would exceed two levels). */
function duplicateSubtreeRequiresTopLevelOnly(node: PathBranchNode): boolean {
  return node.children.length > 0;
}

function countSubtreeRows(node: PathBranchNode): number {
  return 1 + node.children.reduce((sum, c) => sum + countSubtreeRows(c), 0);
}

/** Top-level rows that can accept child outline rows (dividers cannot). */
function topLevelParentsForDuplicate(roots: PathBranchNode[]): PathBranchNode[] {
  return roots.filter((r) => r.kind !== 'divider');
}

function insertSlotLabel(
  siblings: PathBranchNode[],
  insertIndex: number,
  publishedList: Course[]
): string {
  if (siblings.length === 0) return 'First position';
  if (insertIndex <= 0) {
    return `Before “${branchNodeDisplayLabel(siblings[0], publishedList)}”`;
  }
  if (insertIndex >= siblings.length) {
    const last = siblings[siblings.length - 1];
    return `After “${branchNodeDisplayLabel(last, publishedList)}”`;
  }
  const prev = siblings[insertIndex - 1];
  const next = siblings[insertIndex];
  return `Between “${branchNodeDisplayLabel(prev, publishedList)}” and “${branchNodeDisplayLabel(next, publishedList)}”`;
}

/** Label / link / divider rows can get a distinct title on duplicate; course & lesson titles come from the catalog. */
function duplicateRootHasEditableTitle(root: PathBranchNode): boolean {
  return root.kind === 'label' || root.kind === 'divider' || root.kind === 'link';
}

function duplicateRootEditableTitleBase(root: PathBranchNode, publishedList: Course[]): string {
  if (root.kind === 'label' || root.kind === 'divider' || root.kind === 'link') {
    const t = root.label.trim();
    if (t.length > 0) return t;
  }
  return branchNodeDisplayLabel(root, publishedList).trim() || 'Untitled';
}

function applyCopyNameToBranchRoot(
  root: PathBranchNode,
  nameInput: string,
  publishedList: Course[]
): PathBranchNode {
  if (root.kind === 'course' || root.kind === 'lesson') {
    return root;
  }
  const trimmed = nameInput.trim();
  const base = duplicateRootEditableTitleBase(root, publishedList);
  const finalLabel = trimmed.length > 0 ? trimmed : `${base} (copy)`;
  if (root.kind === 'label') {
    return { ...root, label: finalLabel };
  }
  if (root.kind === 'divider') {
    return { ...root, label: finalLabel };
  }
  if (root.kind === 'link') {
    return { ...root, label: finalLabel };
  }
  return root;
}

type PlaceBranchCommitPayload =
  | { mode: 'copy'; branch: PathBranchNode }
  | { mode: 'move'; sourceId: string };

function PlaceDuplicateBranchModal({
  open,
  onClose,
  sourceSnapshot,
  roots,
  publishedList,
  defaultTopParentId,
  onCommit,
}: {
  open: boolean;
  onClose: () => void;
  /** Branch at open time (original ids). Copy remaps ids on commit; move keeps them. */
  sourceSnapshot: PathBranchNode;
  roots: PathBranchNode[];
  publishedList: Course[];
  /** When duplicating a nested row, prefer its current top-level section as the first dropdown. */
  defaultTopParentId: string | null;
  onCommit: (parentId: string | null, insertIndex: number, payload: PlaceBranchCommitPayload) => void;
}) {
  const topLevelOnly = duplicateSubtreeRequiresTopLevelOnly(sourceSnapshot);
  const [placeMode, setPlaceMode] = useState<'copy' | 'move'>('copy');
  const [parentId, setParentId] = useState<string | null>(null);
  const [insertIndex, setInsertIndex] = useState(0);
  const [copyNameInput, setCopyNameInput] = useState('');

  const rootsRef = useRef(roots);
  rootsRef.current = roots;

  const parentOptions = useMemo(() => {
    const opts: { id: string | null; label: string }[] = [];
    if (sourceSnapshot.kind === 'label' || sourceSnapshot.kind === 'module') {
      opts.push({ id: null, label: 'Top of outline' });
    }
    if (topLevelOnly) return opts;
    for (const r of topLevelParentsForDuplicate(roots)) {
      if (!parentAllowsChildRows(roots, r.id)) continue;
      opts.push({
        id: r.id,
        label: branchNodeDisplayLabel(r, publishedList),
      });
    }
    return opts;
  }, [sourceSnapshot.kind, roots, publishedList, topLevelOnly]);

  const effectiveParentId = topLevelOnly ? null : parentId;

  const siblings = useMemo(() => {
    if (effectiveParentId === null) return roots;
    const p = findBranchNode(roots, effectiveParentId);
    return p?.children ?? [];
  }, [roots, effectiveParentId]);

  /** Only when the dialog opens or the duplicate source changes — not on every outline edit (avoids resetting Top parent and showing stale sibling labels). */
  useEffect(() => {
    if (!open) return;
    if (topLevelOnly) {
      setParentId(null);
      return;
    }
    const r = rootsRef.current;
    const validDefault =
      defaultTopParentId != null &&
      findBranchNode(r, defaultTopParentId) != null &&
      findDepthOfBranchId(r, defaultTopParentId) === 0 &&
      parentAllowsChildRows(r, defaultTopParentId) &&
      findBranchNode(r, defaultTopParentId)!.kind !== 'divider';
    setParentId(validDefault ? defaultTopParentId : null);
  }, [open, sourceSnapshot.id, topLevelOnly, defaultTopParentId]);

  /** If the selected top parent row disappears (e.g. tree reload), clear it. Do not reset to default on every rename. */
  useEffect(() => {
    if (!open || topLevelOnly) return;
    setParentId((prev) => {
      if (prev == null) return null;
      const r = rootsRef.current;
      const n = findBranchNode(r, prev);
      const valid =
        n != null &&
        findDepthOfBranchId(r, prev) === 0 &&
        parentAllowsChildRows(r, prev) &&
        n.kind !== 'divider';
      return valid ? prev : null;
    });
  }, [roots, open, topLevelOnly]);

  useEffect(() => {
    if (!open) return;
    setInsertIndex(siblings.length);
  }, [open, effectiveParentId, siblings.length]);

  useEffect(() => {
    if (!open) return;
    setCopyNameInput('');
    setPlaceMode('copy');
  }, [open, sourceSnapshot.id]);

  const parentSelectKey = useMemo(
    () => parentOptions.map((o) => `${o.id ?? 'root'}:${o.label}`).join('|'),
    [parentOptions]
  );

  /** Remount selects when sibling titles change so option text never stays stale (browser/React edge cases). */
  const positionSelectKey = useMemo(
    () =>
      siblings.map((n) => `${n.id}:${branchNodeDisplayLabel(n, publishedList)}`).join('|'),
    [siblings, publishedList]
  );

  const copyNameDefaultPreview = useMemo(
    () => duplicateRootEditableTitleBase(sourceSnapshot, publishedList) + ' (copy)',
    [sourceSnapshot, publishedList]
  );

  const showCopyNameField = placeMode === 'copy' && duplicateRootHasEditableTitle(sourceSnapshot);

  useDialogKeyboard({ open, onClose });

  if (!open) return null;

  const summary = branchNodeDisplayLabel(sourceSnapshot, publishedList);
  const totalRows = countSubtreeRows(sourceSnapshot);
  const canCommit =
    parentOptions.length > 0 &&
    (effectiveParentId === null
      ? parentOptions.some((o) => o.id === null)
      : findBranchNode(roots, effectiveParentId) != null);
  const subtreeHint =
    effectiveParentId === null
      ? 'Order among top-level rows.'
      : (() => {
          const p = findBranchNode(roots, effectiveParentId);
          return p
            ? `Order among rows inside “${branchNodeDisplayLabel(p, publishedList)}”.`
            : '';
        })();

  const insertIdx = Math.min(insertIndex, siblings.length);

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
        aria-labelledby="place-duplicate-branch-title"
        className="flex max-h-[min(90dvh,560px)] w-full max-w-lg flex-col rounded-t-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl sm:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
          <h2
            id="place-duplicate-branch-title"
            className="min-w-0 flex-1 text-center text-base font-bold text-[var(--text-primary)] sm:text-lg"
          >
            Copy or move branch
          </h2>
          <button
            type="button"
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-sm font-semibold text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          <div className="mb-3 flex gap-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-1">
            <button
              type="button"
              onClick={() => setPlaceMode('copy')}
              className={`flex min-h-11 flex-1 touch-manipulation items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-bold sm:text-sm ${
                placeMode === 'copy'
                  ? 'bg-orange-500 text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
              }`}
            >
              <Copy size={16} className="shrink-0 opacity-90" aria-hidden />
              Copy
            </button>
            <button
              type="button"
              onClick={() => setPlaceMode('move')}
              className={`flex min-h-11 flex-1 touch-manipulation items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-bold sm:text-sm ${
                placeMode === 'move'
                  ? 'bg-orange-500 text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
              }`}
            >
              <ArrowRightLeft size={16} className="shrink-0 opacity-90" aria-hidden />
              Move
            </button>
          </div>

          <p className="mb-3 text-xs leading-relaxed text-[var(--text-muted)]">
            {placeMode === 'copy' ? (
              <>
                Copying <strong className="text-[var(--text-secondary)]">{summary}</strong>
                {totalRows > 1 ? (
                  <>
                    {' '}
                    ({totalRows} rows including nested)
                  </>
                ) : null}
                . A duplicate with new ids will be inserted — choose where it should appear.
              </>
            ) : (
              <>
                Moving <strong className="text-[var(--text-secondary)]">{summary}</strong>
                {totalRows > 1 ? (
                  <>
                    {' '}
                    ({totalRows} rows including nested)
                  </>
                ) : null}
                . Outline ids stay the same; choose the new parent and position.
              </>
            )}
          </p>
          {topLevelOnly ? (
            <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-[var(--text-secondary)]">
              This branch has nested rows, so it can only be placed in the <strong>top-level</strong> outline (two levels
              max: section → sub-rows).
            </p>
          ) : null}

          {showCopyNameField ? (
            <div className="mb-3">
              <label className="block text-xs font-semibold text-[var(--text-secondary)]" htmlFor="place-dup-copy-name">
                Copy name
              </label>
              <p id="place-dup-copy-name-hint" className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                Optional. Leave blank to use <strong className="text-[var(--text-secondary)]">{copyNameDefaultPreview}</strong>.
              </p>
              <input
                id="place-dup-copy-name"
                type="text"
                value={copyNameInput}
                onChange={(e) => setCopyNameInput(e.target.value)}
                placeholder={copyNameDefaultPreview}
                aria-describedby="place-dup-copy-name-hint"
                className="mt-1.5 min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                autoComplete="off"
              />
            </div>
          ) : (
            <p className="mb-3 text-[11px] leading-snug text-[var(--text-muted)]">
              {placeMode === 'move'
                ? 'Course and lesson rows keep the catalog title; only the outline position changes.'
                : 'Course and lesson rows keep the catalog title; only the outline position changes on the copy.'}
            </p>
          )}

          <div className="space-y-3">
            {parentOptions.length === 0 ? (
              <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-[var(--text-primary)]">
                No valid placement target. Top-level outline only accepts section labels — fix the branch type or outline
                structure first.
              </p>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)]" htmlFor="place-dup-parent">
                    Top parent
                  </label>
                  <p id="place-dup-parent-hint" className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                    Top-level section that will contain this branch, or the main outline list.
                  </p>
                  <select
                    key={parentSelectKey}
                    id="place-dup-parent"
                    aria-describedby="place-dup-parent-hint"
                    className="mt-1.5 min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                    value={effectiveParentId ?? ''}
                    disabled={topLevelOnly}
                    onChange={(e) => {
                      const v = e.target.value;
                      setParentId(v === '' ? null : v);
                    }}
                  >
                    {parentOptions.map((o) => (
                      <option key={o.id ?? 'root'} value={o.id ?? ''}>
                        {o.id === null ? o.label : `Section: ${o.label}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)]" htmlFor="place-dup-index">
                    Within subtree
                  </label>
                  <p id="place-dup-subtree-hint" className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                    {subtreeHint}
                  </p>
                  <select
                    key={positionSelectKey}
                    id="place-dup-index"
                    aria-describedby="place-dup-subtree-hint"
                    className="mt-1.5 min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                    value={insertIdx}
                    onChange={(e) => setInsertIndex(Number(e.target.value))}
                  >
                    {Array.from({ length: siblings.length + 1 }, (_, i) => (
                      <option key={i} value={i}>
                        {insertSlotLabel(siblings, i, publishedList)}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            disabled={!canCommit}
            onClick={() => {
              if (placeMode === 'copy') {
                const remapped = remapBranchSubtreeIds(deepClone(sourceSnapshot));
                const named = applyCopyNameToBranchRoot(remapped, copyNameInput, publishedList);
                onCommit(effectiveParentId, insertIdx, { mode: 'copy', branch: named });
              } else {
                onCommit(effectiveParentId, insertIdx, { mode: 'move', sourceId: sourceSnapshot.id });
              }
            }}
            className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-40"
          >
            {placeMode === 'copy' ? 'Place copy' : 'Move here'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Children kept when changing type; dividers always flatten to none. */
function pathBranchChildrenAfterTypeChange(
  replaceSource: PathBranchNode,
  newKind: PathBranchNode['kind']
): PathBranchNode[] {
  if (newKind === 'divider') return [];
  if (replaceSource.kind === 'divider') return [];
  return replaceSource.children;
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
  const vis = pathBranchVisibilityFromMindmap(n);
  if (n.kind === 'divider') {
    return { id: n.id, kind: 'divider', label: n.label, children: [], ...vis };
  }
  if (n.kind === 'module' && n.courseId && n.moduleId) {
    return {
      id: n.id,
      kind: 'module',
      courseId: n.courseId,
      moduleId: n.moduleId,
      children,
      ...vis,
    };
  }
  if (n.kind === 'course' && n.courseId) {
    return { id: n.id, kind: 'course', courseId: n.courseId, children, ...vis };
  }
  if (n.kind === 'lesson' && n.courseId && n.lessonId) {
    return { id: n.id, kind: 'lesson', courseId: n.courseId, lessonId: n.lessonId, children, ...vis };
  }
  if (n.kind === 'link' && n.externalUrl) {
    return {
      id: n.id,
      kind: 'link',
      label: n.label,
      href: n.externalUrl,
      children,
      ...vis,
    };
  }
  return {
    id: n.id,
    kind: 'label',
    label: n.label,
    children,
    ...(n.locked ? { locked: true } : {}),
    ...vis,
  };
}

type BranchModalStep =
  | 'kind'
  | 'label'
  | 'divider'
  | 'course'
  | 'linkForm'
  | 'lessonCourse'
  | 'lessonPick'
  | 'moduleCourse'
  | 'modulePick';

function AddPathBranchModal({
  open,
  onClose,
  catalogCourses,
  catalogCoursesForLabels,
  onCommit,
  contextHint,
  mode = 'add',
  addPreset,
  topLevelOutlineAdd = false,
  changeTypeRootRowLabelOnly = false,
  allowSectionDivider = false,
  replaceSource = null,
  lessonAddContext = null,
  showModuleInKindPicker = false,
  topLevelNewPathSectionLabelOnly = false,
}: {
  open: boolean;
  onClose: () => void;
  /** Courses allowed when adding/linking branches (excludes platform-catalog drafts). */
  catalogCourses: readonly Course[];
  /** Full list for labels and resolving rows that already reference a draft course. Defaults to `catalogCourses`. */
  catalogCoursesForLabels?: readonly Course[];
  onCommit: (branch: PathBranchNode) => void;
  /** Where the new node will attach (top level vs nested). */
  contextHint?: string;
  mode?: 'add' | 'changeType';
  /** When `mode === 'add'`, skip the kind picker and open the matching step. */
  addPreset?: 'label' | 'course' | 'link' | 'divider' | 'module';
  /** Top-level outline add: kind step is Text label + Section only; Back from label/divider closes. */
  topLevelOutlineAdd?: boolean;
  /** Admin → Create new path: top-level kind step is section label (text label) only — no divider heading. */
  topLevelNewPathSectionLabelOnly?: boolean;
  /** Root-row change type: only converting to a text label (no course/link/lesson/divider picker). */
  changeTypeRootRowLabelOnly?: boolean;
  /** Section divider rows only make sense under a top-level section, not at the root list. */
  allowSectionDivider?: boolean;
  /** When changing an existing row’s type: keep id, visibility, and children when allowed. */
  replaceSource?: PathBranchNode | null;
  /** Under a module row: skip to picking a lesson in that module only. */
  lessonAddContext?: { courseId: string; moduleId: string } | null;
  /** Show “Course module” in the kind step (top-level sections only). */
  showModuleInKindPicker?: boolean;
}) {
  const labelCatalog = catalogCoursesForLabels ?? catalogCourses;
  const [step, setStep] = useState<BranchModalStep>('kind');
  const [query, setQuery] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [linkLabelInput, setLinkLabelInput] = useState('');
  const [linkHrefInput, setLinkHrefInput] = useState('');
  const [lessonCourse, setLessonCourse] = useState<Course | null>(null);
  const [moduleCoursePick, setModuleCoursePick] = useState<Course | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setLabelInput('');
    setLinkLabelInput('');
    setLinkHrefInput('');
    setModuleCoursePick(null);
    if (lessonAddContext) {
      const c = labelCatalog.find((x) => x.id === lessonAddContext.courseId) ?? null;
      setLessonCourse(c);
      setStep('lessonPick');
      return;
    }
    if (mode === 'changeType' && replaceSource) {
      setLessonCourse(null);
      if (changeTypeRootRowLabelOnly) {
        setStep('label');
        if (replaceSource.kind === 'label' || replaceSource.kind === 'divider') {
          setLabelInput(replaceSource.label);
        } else {
          setLabelInput(branchNodeDisplayLabel(replaceSource, [...labelCatalog]).trim());
        }
        if (replaceSource.kind === 'link') {
          setLinkLabelInput(replaceSource.label);
          setLinkHrefInput(replaceSource.href);
        }
      } else {
        setStep('kind');
        if (replaceSource.kind === 'label' || replaceSource.kind === 'divider') {
          setLabelInput(replaceSource.label);
        } else {
          setLabelInput('');
        }
        if (replaceSource.kind === 'link') {
          setLinkLabelInput(replaceSource.label);
          setLinkHrefInput(replaceSource.href);
        }
      }
    } else {
      if (addPreset === 'label') {
        setStep('label');
      } else if (addPreset === 'divider') {
        setStep('divider');
      } else if (addPreset === 'module') {
        setStep('moduleCourse');
      } else if (addPreset === 'course') {
        setStep('course');
      } else if (addPreset === 'link') {
        setStep('linkForm');
      } else {
        setStep('kind');
      }
      setLessonCourse(null);
    }
  }, [
    open,
    mode,
    catalogCourses,
    labelCatalog,
    addPreset,
    allowSectionDivider,
    replaceSource,
    topLevelOutlineAdd,
    changeTypeRootRowLabelOnly,
    lessonAddContext,
  ]);

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
      if (lessonAddContext && mod.id !== lessonAddContext.moduleId) continue;
      for (const lesson of mod.lessons) {
        if (lesson.contentKind === 'divider') continue;
        rows.push({ moduleTitle: mod.title, lesson });
      }
    }
    return rows;
  }, [lessonCourse, lessonAddContext]);

  const filteredModules = useMemo(() => {
    if (!moduleCoursePick) return [] as Module[];
    const q = query.trim().toLowerCase();
    let mods = moduleCoursePick.modules.filter((m) => m.lessons.length > 0);
    if (q) {
      mods = mods.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          m.lessons.some((l) => (l.title || l.id).toLowerCase().includes(q))
      );
    }
    return mods;
  }, [moduleCoursePick, query]);

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
  const replacing = replaceSource != null;

  if (!open) return null;

  const visPatch =
    replaceSource?.visibleToRoles !== undefined
      ? ({ visibleToRoles: replaceSource.visibleToRoles } as const)
      : {};

  const commitLabel = () => {
    const t = labelInput.trim();
    if (!t) return;
    if (replaceSource) {
      const ch = pathBranchChildrenAfterTypeChange(replaceSource, 'label');
      onCommit({
        id: replaceSource.id,
        kind: 'label',
        label: t,
        children: ch,
        ...visPatch,
        ...(replaceSource.kind === 'label' && replaceSource.locked ? { locked: true } : {}),
      });
    } else {
      onCommit({ id: newMindmapNodeId(), kind: 'label', label: t, children: [] });
    }
    onClose();
  };

  const commitDivider = () => {
    const t = labelInput.trim();
    if (!t) return;
    onCommit({
      id: replaceSource?.id ?? newMindmapNodeId(),
      kind: 'divider',
      label: t,
      children: [],
      ...visPatch,
    });
    onClose();
  };

  const commitCourse = (c: Course) => {
    const ch = replaceSource ? pathBranchChildrenAfterTypeChange(replaceSource, 'course') : [];
    onCommit({
      id: replaceSource?.id ?? newMindmapNodeId(),
      kind: 'course',
      courseId: c.id,
      children: ch,
      ...visPatch,
    });
    onClose();
  };

  const commitLesson = (course: Course, lesson: Lesson) => {
    const ch = replaceSource ? pathBranchChildrenAfterTypeChange(replaceSource, 'lesson') : [];
    onCommit({
      id: replaceSource?.id ?? newMindmapNodeId(),
      kind: 'lesson',
      courseId: course.id,
      lessonId: lesson.id,
      children: ch,
      ...visPatch,
    });
    onClose();
  };

  const commitModule = (course: Course, mod: Module) => {
    const ch = replaceSource ? pathBranchChildrenAfterTypeChange(replaceSource, 'module') : [];
    onCommit({
      id: replaceSource?.id ?? newMindmapNodeId(),
      kind: 'module',
      courseId: course.id,
      moduleId: mod.id,
      children: ch,
      ...visPatch,
    });
    onClose();
  };

  const commitWebLink = () => {
    const t = linkLabelInput.trim();
    const hrefNorm = normalizeExternalHref(linkHrefInput);
    if (!t || !hrefNorm) return;
    const ch = replaceSource ? pathBranchChildrenAfterTypeChange(replaceSource, 'link') : [];
    onCommit({
      id: replaceSource?.id ?? newMindmapNodeId(),
      kind: 'link',
      label: t,
      href: hrefNorm,
      children: ch,
      ...visPatch,
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
          {((mode === 'add' || mode === 'changeType') && step !== 'kind') ? (
            <button
              type="button"
              className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
              aria-label="Back"
              onClick={() => {
                setQuery('');
                if (step === 'course' || step === 'moduleCourse') {
                  setStep('kind');
                  return;
                }
                if (step === 'modulePick') {
                  setModuleCoursePick(null);
                  setStep('moduleCourse');
                  return;
                }
                if (step === 'lessonCourse') {
                  setStep('kind');
                  return;
                }
                if (step === 'label' || step === 'divider') {
                  if (mode === 'add' && topLevelOutlineAdd) {
                    onClose();
                    return;
                  }
                  if (mode === 'changeType' && changeTypeRootRowLabelOnly) {
                    onClose();
                    return;
                  }
                  setStep('kind');
                } else if (step === 'linkForm') setStep('kind');
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
            {step === 'kind' &&
              (mode === 'changeType' ? 'Change branch type' : topLevelOutlineAdd ? 'Add top-level section' : 'Add a branch')}
            {step === 'label' && (replacing ? 'Text label' : 'Label')}
            {step === 'divider' && 'Section divider'}
            {step === 'linkForm' && 'Web link'}
            {step === 'course' && 'Choose course'}
            {step === 'moduleCourse' && 'Choose course (module)'}
            {step === 'modulePick' && moduleCoursePick && `Module — ${moduleCoursePick.title}`}
            {step === 'lessonCourse' && 'Choose course (other)'}
            {step === 'lessonPick' && lessonCourse && `Lesson — ${lessonCourse.title}`}
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
              {mode === 'add' && topLevelOutlineAdd ? (
                <>
                  <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                    {topLevelNewPathSectionLabelOnly ? (
                      <>
                        New paths start with a <strong className="text-[var(--text-secondary)]">section label</strong> only.
                        Add courses, links, or lessons under it with <strong className="text-[var(--text-secondary)]">Add branch here</strong>.
                      </>
                    ) : (
                      <>
                        Top-level outline rows are either a <strong className="text-[var(--text-secondary)]">text label</strong>{' '}
                        (section you can open and add courses, links, or lessons under) or a{' '}
                        <strong className="text-[var(--text-secondary)]">section</strong> heading (non-playable divider). Use{' '}
                        <strong className="text-[var(--text-secondary)]">Add branch here</strong> under a label for catalog items.
                      </>
                    )}
                  </p>
                  <button
                    type="button"
                    className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-light)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-orange-500/40 hover:bg-[var(--hover-bg)]"
                    onClick={() => setStep('label')}
                  >
                    <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                      <Type size={20} className="shrink-0 text-orange-500" aria-hidden />
                      Text label
                      <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">Section group</span>
                    </span>
                    <span className="pl-8 text-xs text-[var(--text-muted)]">
                      Collapsible section title (e.g. &quot;Foundations&quot;) — add courses, links, and lessons inside.
                    </span>
                  </button>
                  {!topLevelNewPathSectionLabelOnly ? (
                    <button
                      type="button"
                      className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-light)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-orange-500/40 hover:bg-[var(--hover-bg)]"
                      onClick={() => setStep('divider')}
                    >
                      <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                        <Minus size={20} className="shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                        Section
                        <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">Heading only</span>
                      </span>
                      <span className="pl-8 text-xs text-[var(--text-muted)]">
                        Non-collapsible subheading in the path outline — not a group; no nested rows.
                      </span>
                    </button>
                  ) : null}
                </>
              ) : (
                <>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                {mode === 'changeType' ? (
                  <>
                    Pick a new type. Visibility settings stay the same. Nested rows stay under this branch when the new type
                    allows it. <strong className="text-[var(--text-secondary)]">Section divider</strong> drops nested rows.
                  </>
                ) : (
                  <>
                    Choose what to add. Top-level rows are <strong className="text-[var(--text-secondary)]">sections</strong>;
                    use <strong className="text-[var(--text-secondary)]">Add branch here</strong> between rows for courses,
                    links, or dividers (flat list only — no nested label groups).
                  </>
                )}
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
              {showModuleInKindPicker ? (
                <button
                  type="button"
                  disabled={!canLink}
                  className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-light)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-orange-500/40 hover:bg-[var(--hover-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    setStep('moduleCourse');
                    setQuery('');
                  }}
                >
                  <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                    <Layers size={20} className="shrink-0 text-indigo-500" aria-hidden />
                    Course module
                    <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">Top level</span>
                  </span>
                  <span className="pl-8 text-xs text-[var(--text-muted)]">
                    A catalog module as a section; add only lessons from that module underneath.
                  </span>
                </button>
              ) : null}
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
              {allowSectionDivider ? (
                <button
                  type="button"
                  className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-light)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-orange-500/40 hover:bg-[var(--hover-bg)]"
                  onClick={() => setStep('divider')}
                >
                  <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                    <Minus size={20} className="shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                    Section divider
                    <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">Non-collapsible</span>
                  </span>
                  <span className="pl-8 text-xs text-[var(--text-muted)]">
                    Subheading inside this section — not a nested group. Use course tags for skills and level.
                  </span>
                </button>
              ) : null}
              {mode === 'changeType' ? (
                <button
                  type="button"
                  disabled={!canLink}
                  className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-light)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-orange-500/40 hover:bg-[var(--hover-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    setStep('lessonCourse');
                    setQuery('');
                  }}
                >
                  <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                    <GraduationCap size={20} className="shrink-0 text-teal-500" aria-hidden />
                    Single lesson
                    <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">From a course</span>
                  </span>
                  <span className="pl-8 text-xs text-[var(--text-muted)]">
                    One lesson row in the outline (pick course, then lesson).
                  </span>
                </button>
              ) : null}
              {!canLink && (
                <p className="text-xs text-[var(--text-muted)]">
                  Publish at least one course in the <strong className="text-[var(--text-secondary)]">Catalog</strong>{' '}
                  tab to add <strong className="text-[var(--text-secondary)]">Whole course</strong> branches.
                </p>
              )}
                </>
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
              <p className="text-xs text-[var(--text-muted)]">
                {replacing ? 'Press Enter to save, or tap the button.' : 'Press Enter to add, or tap the button.'}
              </p>
              <button
                type="button"
                disabled={!labelInput.trim()}
                onClick={commitLabel}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-40"
              >
                {replacing ? 'Save label' : 'Add branch'}
              </button>
            </div>
          )}

          {step === 'divider' && (
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-[var(--text-secondary)]" htmlFor="path-branch-divider-input">
                Divider text
              </label>
              <input
                id="path-branch-divider-input"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && labelInput.trim()) {
                    e.preventDefault();
                    commitDivider();
                  }
                }}
                placeholder="e.g. Week 2, Core concepts"
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
                autoFocus
              />
              <p className="text-xs text-[var(--text-muted)]">
                Shown as a static line in the learner outline — learners do not expand it.
              </p>
              <button
                type="button"
                disabled={!labelInput.trim()}
                onClick={commitDivider}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-40"
              >
                {replacing ? 'Save divider' : 'Add divider'}
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
                {replacing ? 'Save link' : 'Add link'}
              </button>
            </div>
          )}

          {(step === 'course' || step === 'lessonCourse' || step === 'moduleCourse') && (
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
                          else if (step === 'moduleCourse') {
                            setModuleCoursePick(c);
                            setQuery('');
                            setStep('modulePick');
                          } else {
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

          {step === 'modulePick' && moduleCoursePick ? (
            <div className="space-y-2">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search modules or lessons…"
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
                autoFocus
              />
              {filteredModules.length === 0 ? (
                <p className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]/50 px-3 py-6 text-center text-sm text-[var(--text-muted)]">
                  {moduleCoursePick.modules.every((m) => m.lessons.length === 0)
                    ? 'This course has no lessons in any module yet.'
                    : 'No modules match your search.'}
                </p>
              ) : (
                <ul className="max-h-[min(50dvh,320px)] space-y-1 overflow-y-auto overscroll-contain pr-1">
                  {filteredModules.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        className="flex w-full min-h-11 flex-col items-start rounded-lg border border-transparent px-2 py-2 text-left text-sm hover:bg-[var(--hover-bg)]"
                        onClick={() => commitModule(moduleCoursePick, m)}
                      >
                        <span className="font-medium">{m.title?.trim() || m.id}</span>
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {m.lessons.length} lesson{m.lessons.length === 1 ? '' : 's'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

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

function pathBranchKindBadgeShortLabel(kind: PathBranchNode['kind']): string {
  switch (kind) {
    case 'label':
      return 'Label';
    case 'divider':
      return 'Divider';
    case 'module':
      return 'Module';
    case 'course':
      return 'Course';
    case 'link':
      return 'Link';
    case 'lesson':
      return 'Lesson';
    default: {
      const _x: never = kind;
      return _x;
    }
  }
}

/** Derived state for path branch outline visibility (Firestore `visibleToRoles`). */
function pathBranchOutlineVisibility(visibleToRoles: PathOutlineAudienceRole[] | undefined): {
  showInOutline: boolean;
  audienceSelectValue: 'admin' | 'everyone';
} {
  const hiddenFromAll = Array.isArray(visibleToRoles) && visibleToRoles.length === 0;
  const showInOutline = !hiddenFromAll;
  const adminOnly =
    showInOutline &&
    Array.isArray(visibleToRoles) &&
    visibleToRoles.length === 1 &&
    visibleToRoles[0] === 'admin';
  const audienceSelectValue = adminOnly ? 'admin' : 'everyone';
  return { showInOutline, audienceSelectValue };
}

/** Insert control between sibling rows in the path outline list. `parentId === null` = top-level path rows; else = inside that section’s child list. */
function PathBranchInsertSlot({
  parentId,
  insertIndex,
  depth,
  onInsertBranchAt,
  /** When a section has no children yet, keep the control visible on md+ (default is hover-reveal between rows). */
  persistVisibleOnMd = false,
}: {
  parentId: string | null;
  insertIndex: number;
  depth: number;
  onInsertBranchAt: (parentId: string | null, insertIndex: number) => void;
  persistVisibleOnMd?: boolean;
}) {
  const atTopLevel = parentId == null;
  const label = atTopLevel ? 'Add top-level section here' : 'Add branch here';
  const title = atTopLevel
    ? 'Adds a new top-level section (label). Add courses, links, or dividers inside the section afterward.'
    : 'Adds a row inside this section at this position among its items.';
  const pad =
    depth > 0 ? ({ paddingLeft: `${Math.min(depth, 8) * 0.75}rem` } as const) : undefined;
  return (
    <li
      className={
        persistVisibleOnMd
          ? 'group/ins relative z-0 min-w-0 list-none overflow-visible py-0.5'
          : `group/ins relative z-0 min-h-0 min-w-0 list-none ${ADMIN_INSERT_STRIP_OUTER_EXPAND_HOVER}`
      }
      title={persistVisibleOnMd ? undefined : title}
    >
      <div
        className={
          persistVisibleOnMd
            ? 'flex w-full max-md:!pl-0 items-center justify-center'
            : 'flex w-full max-md:!pl-0 items-center justify-center md:min-h-0 md:py-1.5'
        }
        style={pad}
      >
        <button
          type="button"
          title={persistVisibleOnMd ? title : undefined}
          aria-label={label}
          onClick={() => onInsertBranchAt(parentId, insertIndex)}
          className={
            persistVisibleOnMd
              ? ADMIN_INSERT_STRIP_CHIP_BTN_PERSIST
              : ADMIN_INSERT_STRIP_CHIP_BTN_EXPAND_ROW
          }
        >
          <Plus size={14} className="shrink-0 opacity-90" aria-hidden />
          <span>{label}</span>
        </button>
      </div>
    </li>
  );
}

/** Outline row (top + nested): row1 = title labels; row2 = badge, field(s), show, audience, actions. */
const PATH_BRANCH_OUTLINE_ROW_GRID =
  'grid w-full min-w-0 grid-cols-1 gap-y-2 max-md:gap-y-1.5 md:grid-cols-[auto_minmax(0,1fr)_8.25rem_14rem_minmax(7.25rem,max-content)] md:grid-rows-[auto_auto] md:gap-x-3 md:gap-y-1';

/** Hover / long-press tip for the catalog outline visibility checkbox column. */
const PATH_BRANCH_SHOW_COLUMN_TIP =
  'When off, the row is hidden from the path outline for everyone (including admins). When on, use the audience menu for User vs Admin-only. For course or lesson rows, learners only see them if that course is also published in the Catalog tab—draft courses stay hidden from learners even when Show is on. Admins viewing a path in the app see all rows that are shown to User or Admin.';

/** Matches link row + branch row: small label above title field (nested / narrow viewports). */
const PATH_BRANCH_TITLE_FIELD_LABEL_CLASS =
  'text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]';

function PathBranchVisibilityCells({
  nodeId,
  visibleToRoles,
  onChange,
  nested,
  nestedGridSecondRow,
  topLevelGridSecondRow,
}: {
  nodeId: string;
  visibleToRoles: PathOutlineAudienceRole[] | undefined;
  onChange: (id: string, next: PathOutlineAudienceRole[]) => void;
  nested: boolean;
  /** When nested, place checkbox/select on grid row 2 with the title input (not vertically centered on the whole cell). */
  nestedGridSecondRow?: boolean;
  /** Same as nested, for top-level `li` outline grid (row 2 with inputs). */
  topLevelGridSecondRow?: boolean;
}) {
  const { showInOutline, audienceSelectValue } = pathBranchOutlineVisibility(visibleToRoles);

  const showCell = (
    <label
      className="flex min-h-10 cursor-pointer items-center gap-2 touch-manipulation text-xs text-[var(--text-secondary)] md:min-h-0 md:justify-center md:gap-0"
      title={PATH_BRANCH_SHOW_COLUMN_TIP}
    >
      <input
        type="checkbox"
        checked={showInOutline}
        onChange={(e) => {
          if (e.target.checked) {
            onChange(nodeId, ['user', 'admin']);
          } else {
            onChange(nodeId, []);
          }
        }}
        className="h-4 w-4 shrink-0 rounded border-[var(--border-color)] accent-orange-500"
        aria-label="Show in catalog path outline"
      />
      <span className="min-w-0 select-none font-semibold leading-snug md:sr-only">Show</span>
    </label>
  );

  const roleCell = (
    <select
      value={audienceSelectValue}
      disabled={!showInOutline}
      onChange={(e) => {
        const v = e.target.value;
        if (v === 'admin') onChange(nodeId, ['admin']);
        else onChange(nodeId, ['user', 'admin']);
      }}
      title={
        showInOutline
          ? 'Everyone: learners, guests, and admins. Administrators only: row stays in the admin editor but is hidden from the catalog outline for everyone else.'
          : 'Hidden from the catalog outline. Turn on Show to choose who can see this row there.'
      }
      className={`box-border min-h-10 w-full min-w-0 rounded-lg border px-2 py-2 text-xs sm:px-3 sm:text-sm ${
        showInOutline
          ? 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]'
          : 'cursor-not-allowed border-[var(--border-color)]/50 bg-[var(--bg-secondary)] text-[var(--text-muted)] opacity-60'
      }`}
      aria-label="Who can see this in the catalog outline"
    >
      <option value="everyone">User (admins included)</option>
      <option value="admin">Administrators only</option>
    </select>
  );

  if ((nested && nestedGridSecondRow) || topLevelGridSecondRow) {
    return (
      <div className="max-md:col-span-full max-md:col-start-1 max-md:row-auto max-md:flex max-md:min-w-0 max-md:flex-row max-md:flex-wrap max-md:items-center max-md:gap-x-3 max-md:gap-y-2 md:contents">
        <div className="col-start-3 row-start-2 flex min-w-0 items-center justify-center justify-self-center max-md:justify-start md:justify-self-center">
          {showCell}
        </div>
        <div className="col-start-4 row-start-2 flex min-w-0 w-full items-center justify-self-stretch max-md:min-w-0 max-md:max-w-none max-md:flex-1 sm:min-w-[12rem] md:max-w-[16rem]">
          {roleCell}
        </div>
      </div>
    );
  }

  if (nested) {
    return (
      <div
        className="flex shrink-0 flex-col gap-2 self-end sm:flex-row sm:flex-wrap sm:items-end sm:gap-3"
        role="group"
        aria-label="Catalog outline visibility"
      >
        {showCell}
        <div className="min-w-0 sm:min-w-[12rem] sm:max-w-[16rem]">{roleCell}</div>
      </div>
    );
  }

  return (
    <>
      <div className="flex min-w-0 justify-center md:px-0">{showCell}</div>
      <div className="min-w-0 md:min-w-0">{roleCell}</div>
    </>
  );
}

function PathBranchRow({
  b,
  depth,
  siblingIndex,
  siblingsLen,
  publishedList,
  expandedBranchIds,
  onToggleCollapse,
  onInsertBranchAt,
  onRemove,
  onCopyBranch,
  onMove,
  onLabelChange,
  onLinkBranchChange,
  onRequestChangeType,
  onBranchRowFocus,
  onVisibleToRolesChange,
}: {
  b: PathBranchNode;
  depth: number;
  siblingIndex: number;
  siblingsLen: number;
  publishedList: Course[];
  /** Branch shows nested rows only when its id is in this set. */
  expandedBranchIds: ReadonlySet<string>;
  onToggleCollapse: (id: string) => void;
  onInsertBranchAt: (parentId: string | null, insertIndex: number) => void;
  onRemove: (id: string) => void;
  onCopyBranch: (id: string) => void;
  onMove: (id: string, delta: -1 | 1, scrollAnchor?: HTMLElement | null) => void;
  onLabelChange: (id: string, label: string) => void;
  onLinkBranchChange: (id: string, patch: { label?: string; href?: string }) => void;
  onRequestChangeType: (id: string) => void;
  onBranchRowFocus: (id: string) => void;
  onVisibleToRolesChange: (id: string, roles: PathOutlineAudienceRole[]) => void;
}) {
  /** Only top-level rows (sections) may hold sub-branches; depth-1 rows are leaves—no sub-sub-branches. */
  const canNestBranches = b.kind !== 'divider' && depth === 0;
  const hasNestedRows = b.children.length > 0;
  const hasExpandableNested = canNestBranches && hasNestedRows;
  const isCollapsed = hasExpandableNested && !expandedBranchIds.has(b.id);
  /** Show nested list + insert slots when empty (first sub-branch) or when expanded with children. */
  const showNestedBranchList = canNestBranches && (!hasNestedRows || !isCollapsed);

  const chevronSize = depth === 0 ? 16 : 14;

  const kindBadgeClass =
    b.kind === 'label'
      ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
      : b.kind === 'divider'
        ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
        : b.kind === 'module'
          ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400'
          : b.kind === 'course'
            ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
            : b.kind === 'link'
              ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
              : 'bg-teal-500/15 text-teal-600 dark:text-teal-400';

  const rowDivider =
    depth === 0
      ? 'border-b border-[var(--border-color)]/55 pb-3 last:border-b-0 last:pb-0'
      : 'py-0.5';

  const onBranchRowFocusCapture = (e: React.FocusEvent<HTMLDivElement | HTMLLIElement>) => {
    const header = e.currentTarget;
    const related = e.relatedTarget as Node | null;
    if (related && header.contains(related)) return;
    onBranchRowFocus(b.id);
  };

  const branchBadgeGroup = (
    <div className="flex shrink-0 items-center gap-1">
      {hasExpandableNested ? (
        <button
          type="button"
          onClick={() => onToggleCollapse(b.id)}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]/80 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
          aria-expanded={!isCollapsed}
          aria-label={
            isCollapsed
              ? `Expand nested branches (${pathBranchKindBadgeShortLabel(b.kind)})`
              : `Collapse nested branches (${pathBranchKindBadgeShortLabel(b.kind)})`
          }
          title={isCollapsed ? 'Expand nested branches' : 'Collapse nested branches'}
        >
          {isCollapsed ? (
            <ChevronRight size={chevronSize} className="shrink-0" aria-hidden />
          ) : (
            <ChevronDown size={chevronSize} className="shrink-0" aria-hidden />
          )}
        </button>
      ) : (
        <span className="inline-block h-7 w-7 shrink-0" aria-hidden />
      )}
      {depth === 0 && b.kind === 'label' ? (
        <span
          className={`inline-flex h-7 min-w-[3.25rem] shrink-0 items-center justify-center rounded-md px-3.5 text-[10px] font-bold uppercase leading-none ${kindBadgeClass}`}
          title="Section label (edit title in the field)"
          aria-label={`Branch type: ${pathBranchKindBadgeShortLabel(b.kind)}`}
        >
          {pathBranchKindBadgeShortLabel(b.kind)}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onRequestChangeType(b.id)}
          className={`inline-flex h-7 min-w-[3.25rem] shrink-0 items-center justify-center rounded-md px-3.5 text-[10px] font-bold uppercase leading-none transition-colors hover:ring-2 hover:ring-orange-500/40 focus:outline-none focus:ring-2 focus:ring-orange-500/40 ${kindBadgeClass}`}
          title="Change branch type"
          aria-label={`Change branch type, now ${pathBranchKindBadgeShortLabel(b.kind)}`}
        >
          {pathBranchKindBadgeShortLabel(b.kind)}
        </button>
      )}
    </div>
  );

  const branchFieldInputClass =
    'min-h-10 w-full min-w-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]';

  const renderOutlineRowMainCells = () => {
    if (b.kind === 'label') {
      return (
        <div className="max-md:flex max-md:min-w-0 max-md:flex-row max-md:flex-wrap max-md:items-center max-md:gap-2 md:contents">
          <span
            className={`min-w-0 shrink-0 md:col-start-2 md:row-start-1 ${PATH_BRANCH_TITLE_FIELD_LABEL_CLASS}`}
          >
            Title
          </span>
          <div className="flex shrink-0 items-center md:col-start-1 md:row-start-2">{branchBadgeGroup}</div>
          <input
            type="text"
            value={b.label}
            onChange={(e) => onLabelChange(b.id, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label="Branch label"
            className={`${branchFieldInputClass} min-w-0 max-md:min-h-10 max-md:flex-1 md:col-start-2 md:row-start-2`}
            placeholder="Label text"
          />
        </div>
      );
    }
    if (b.kind === 'divider') {
      return (
        <div className="max-md:flex max-md:min-w-0 max-md:flex-row max-md:flex-wrap max-md:items-center max-md:gap-2 md:contents">
          <span
            className={`min-w-0 shrink-0 md:col-start-2 md:row-start-1 ${PATH_BRANCH_TITLE_FIELD_LABEL_CLASS}`}
          >
            Title
          </span>
          <div className="flex shrink-0 items-center md:col-start-1 md:row-start-2">{branchBadgeGroup}</div>
          <input
            type="text"
            value={b.label}
            onChange={(e) => onLabelChange(b.id, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label="Divider text"
            className={`${branchFieldInputClass} min-w-0 max-md:min-h-10 max-md:flex-1 md:col-start-2 md:row-start-2`}
            placeholder="Divider text (shown in learner outline)"
          />
        </div>
      );
    }
    if (b.kind === 'link') {
      return (
        <>
          <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 max-md:flex-col max-md:gap-1 md:col-start-2 md:row-start-1">
            <span className={PATH_BRANCH_TITLE_FIELD_LABEL_CLASS}>Title</span>
            <span className={PATH_BRANCH_TITLE_FIELD_LABEL_CLASS}>URL</span>
          </div>
          <div className="max-md:flex max-md:min-w-0 max-md:flex-col max-md:items-stretch max-md:gap-1.5 md:contents">
            <div className="flex items-center md:col-start-1 md:row-start-2">{branchBadgeGroup}</div>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-3 sm:gap-y-2 md:col-start-2 md:row-start-2">
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
            </div>
          </div>
        </>
      );
    }
    return (
      <div className="max-md:flex max-md:min-w-0 max-md:flex-row max-md:flex-wrap max-md:items-center max-md:gap-2 md:contents">
        <span
          className={`min-w-0 shrink-0 md:col-start-2 md:row-start-1 ${PATH_BRANCH_TITLE_FIELD_LABEL_CLASS}`}
        >
          Title
        </span>
        <div className="flex shrink-0 items-center md:col-start-1 md:row-start-2">{branchBadgeGroup}</div>
        <span className="flex min-h-10 min-w-0 flex-1 items-center truncate text-sm font-bold text-[var(--text-primary)] max-md:min-h-0 md:col-start-2 md:row-start-2">
          {branchNodeDisplayLabel(b, publishedList)}
        </span>
      </div>
    );
  };

  const branchActionButtons = (
    <>
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
        onClick={(e) => {
          e.stopPropagation();
          onCopyBranch(b.id);
        }}
        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-bg)] hover:text-orange-500"
        aria-label="Copy or move this branch — choose destination in the dialog"
        title="Copy or move branch"
      >
        <Copy size={16} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onRemove(b.id)}
        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10"
        aria-label="Remove branch and nested items"
      >
        <Trash2 size={16} />
      </button>
    </>
  );

  return (
    <li
      data-path-branch-node-id={b.id}
      className={`min-w-0 list-none overflow-hidden ${rowDivider}${
        depth === 0
          ? 'grid grid-cols-1 gap-y-3 px-3 py-3 max-md:gap-y-2 max-md:px-2 max-md:py-2 sm:px-4 md:grid md:grid-cols-[auto_minmax(0,1fr)_8.25rem_14rem_minmax(7.25rem,max-content)] md:grid-rows-[auto_auto] md:gap-x-3 md:gap-y-1'
          : ''
      }`}
      onFocusCapture={depth === 0 ? onBranchRowFocusCapture : undefined}
    >
      {depth === 0 ? (
        <div className="contents">
          {renderOutlineRowMainCells()}
          <PathBranchVisibilityCells
            nodeId={b.id}
            visibleToRoles={b.visibleToRoles}
            onChange={onVisibleToRolesChange}
            nested={false}
            topLevelGridSecondRow
          />
          <div className="max-md:flex max-md:w-full max-md:justify-end md:contents">
            <div className="flex items-center justify-end gap-1 max-md:col-span-full max-md:col-start-1 max-md:row-auto md:col-start-5 md:row-start-2">
              {branchActionButtons}
            </div>
          </div>
        </div>
      ) : (
        <div
          className={`${PATH_BRANCH_OUTLINE_ROW_GRID} max-md:!pl-0 max-md:px-0 max-md:py-1.5 px-1 py-2 sm:px-2 sm:py-2`}
          style={{ paddingLeft: `${Math.min(depth, 8) * 0.75}rem` }}
          onFocusCapture={onBranchRowFocusCapture}
          role="group"
          aria-label="Catalog outline visibility"
        >
          {renderOutlineRowMainCells()}
          <PathBranchVisibilityCells
            nodeId={b.id}
            visibleToRoles={b.visibleToRoles}
            onChange={onVisibleToRolesChange}
            nested
            nestedGridSecondRow
          />
          <div className="max-md:flex max-md:w-full max-md:justify-end md:contents">
            <div className="flex items-center justify-end gap-1 max-md:col-span-full max-md:col-start-1 max-md:row-auto max-md:pt-0 md:col-start-5 md:row-start-2">
              {branchActionButtons}
            </div>
          </div>
        </div>
      )}
      {showNestedBranchList ? (
        <div
          className={`col-span-full min-w-0 ${
            depth === 0
              ? 'mt-2 border-t border-[var(--border-color)]/50 pt-3 sm:mt-1 md:row-start-3'
              : 'mt-1 pt-1'
          }`}
        >
          <PathBranchTreeList
            parentId={b.id}
            nodes={b.children}
            depth={depth + 1}
            publishedList={publishedList}
            expandedBranchIds={expandedBranchIds}
            onToggleCollapse={onToggleCollapse}
            onInsertBranchAt={onInsertBranchAt}
            onRemove={onRemove}
            onCopyBranch={onCopyBranch}
            onMove={onMove}
            onLabelChange={onLabelChange}
            onLinkBranchChange={onLinkBranchChange}
            onRequestChangeType={onRequestChangeType}
            onBranchRowFocus={onBranchRowFocus}
            onVisibleToRolesChange={onVisibleToRolesChange}
          />
        </div>
      ) : null}
    </li>
  );
}

function PathBranchTreeList({
  parentId,
  nodes,
  depth,
  publishedList,
  expandedBranchIds,
  onToggleCollapse,
  onInsertBranchAt,
  onRemove,
  onCopyBranch,
  onMove,
  onLabelChange,
  onLinkBranchChange,
  onRequestChangeType,
  onBranchRowFocus,
  onVisibleToRolesChange,
}: {
  parentId: string | null;
  nodes: PathBranchNode[];
  depth: number;
  publishedList: Course[];
  expandedBranchIds: ReadonlySet<string>;
  onToggleCollapse: (id: string) => void;
  onInsertBranchAt: (parentId: string | null, insertIndex: number) => void;
  onRemove: (id: string) => void;
  onCopyBranch: (id: string) => void;
  onMove: (id: string, delta: -1 | 1, scrollAnchor?: HTMLElement | null) => void;
  onLabelChange: (id: string, label: string) => void;
  onLinkBranchChange: (id: string, patch: { label?: string; href?: string }) => void;
  onRequestChangeType: (id: string) => void;
  onBranchRowFocus: (id: string) => void;
  onVisibleToRolesChange: (id: string, roles: PathOutlineAudienceRole[]) => void;
}) {
  const insKey = parentId ?? 'root';
  const list = (
    <ul
      className={
        depth > 0
          ? 'space-y-0 max-md:border-l-0 max-md:pl-0 border-l-2 border-orange-500/30 pl-3 sm:pl-4'
          : // Reserve space so the first md “between rows” insert strip (–translate-y-1/2) does not overlap the Outline heading above the list.
            'space-y-0 pt-5 md:pt-6'
      }
    >
      <Fragment key={`ins-${insKey}-0`}>
        <PathBranchInsertSlot
          parentId={parentId}
          insertIndex={0}
          depth={depth}
          onInsertBranchAt={onInsertBranchAt}
          persistVisibleOnMd={nodes.length === 0}
        />
      </Fragment>
      {nodes.map((b, i) => (
        <Fragment key={b.id}>
          <PathBranchRow
            b={b}
            depth={depth}
            siblingIndex={i}
            siblingsLen={nodes.length}
            publishedList={publishedList}
            expandedBranchIds={expandedBranchIds}
            onToggleCollapse={onToggleCollapse}
            onInsertBranchAt={onInsertBranchAt}
            onRemove={onRemove}
            onCopyBranch={onCopyBranch}
            onMove={onMove}
            onLabelChange={onLabelChange}
            onLinkBranchChange={onLinkBranchChange}
            onRequestChangeType={onRequestChangeType}
            onBranchRowFocus={onBranchRowFocus}
            onVisibleToRolesChange={onVisibleToRolesChange}
          />
          <PathBranchInsertSlot
            parentId={parentId}
            insertIndex={i + 1}
            depth={depth}
            onInsertBranchAt={onInsertBranchAt}
          />
        </Fragment>
      ))}
    </ul>
  );
  return list;
}

export type PathPersistenceMode =
  | { kind: 'published' }
  | { kind: 'creator'; ownerUid: string };

export interface PathBuilderSectionProps {
  publishedList: Course[];
  /** Courses whose titles must not collide with a path title (published + creator drafts as in the catalog). */
  coursesForPathTitleConflictCheck: Course[];
  onRefreshPublishedList: () => Promise<void>;
  onCatalogChanged: () => void | Promise<void>;
  onPathsDirtyChange?: (dirty: boolean) => void;
  /** For parent header: disable Reload while paths are loading. */
  onPathsLoadingChange?: (loading: boolean) => void;
  /** When set to creator, paths read/write `creatorLearningPaths` for `ownerUid`. */
  pathPersistence?: PathPersistenceMode;
}

export interface PathBuilderSectionHandle {
  reloadPaths: () => Promise<void>;
}

export const PathBuilderSection = forwardRef<PathBuilderSectionHandle, PathBuilderSectionProps>(
  function PathBuilderSection(
    {
      publishedList,
      coursesForPathTitleConflictCheck,
      onRefreshPublishedList: _onRefreshPublishedList,
      onCatalogChanged,
      onPathsDirtyChange,
      onPathsLoadingChange,
      pathPersistence,
    },
    ref
  ) {
  const isCreatorPaths = pathPersistence?.kind === 'creator';
  /** Platform paths may reference draft catalog courses; learners only see those rows after the course is catalog-published. */
  const catalogCoursesForPathPicker = useMemo(() => publishedList, [publishedList]);
  const { showActionToast, actionToast } = useAdminActionToast();
  const [pathTitleConflict, setPathTitleConflict] = useState<TitleConflictHit | null>(null);
  const [paths, setPaths] = useState<LearningPath[]>([]);
  const [pathsLoading, setPathsLoading] = useState(true);
  const [pathBusy, setPathBusy] = useState(false);
  const [pathSelector, setPathSelector] = useState<string>('');
  /** Bumps when starting a new path draft so we focus Path title even if the allocated id matches the previous draft. */
  const [pathTitleFocusKey, setPathTitleFocusKey] = useState(0);
  /** Shown after Save when the path has no courses (inline hint like module field errors). */
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
  /** Add-branch flow or change row type on an existing node. */
  type BranchModalState =
    | { kind: 'closed' }
    | {
        kind: 'add';
        parentId: string | null;
        insertIndex?: number;
        preset?: 'label' | 'course' | 'link' | 'divider' | 'module';
        lessonAddContext?: { courseId: string; moduleId: string };
      }
    | { kind: 'changeType'; nodeId: string }
    | { kind: 'duplicatePlace'; sourceSnapshot: PathBranchNode; sourceParentId: string | null };
  const [branchModal, setBranchModal] = useState<BranchModalState>({ kind: 'closed' });
  /** Branch rows with children are collapsed unless their id is in this set. Siblings accordion (only one expanded among same-parent children at any depth). */
  const [expandedBranchIds, setExpandedBranchIds] = useState<Set<string>>(() => new Set());

  type PathConfirmKind =
    | { kind: 'pickNewPath' }
    | { kind: 'switchPath'; targetId: string }
    | { kind: 'discardDraft' }
    | { kind: 'deletePublished' }
    | { kind: 'duplicatePath' };

  const [pathConfirmDialog, setPathConfirmDialog] = useState<PathConfirmKind | null>(null);

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

  const handleRemoveBranch = useCallback(
    (id: string) => {
      const before = deepClone(pathBranchTreeRef.current);
      const removed = findBranchNode(before, id);
      const raw = removed ? branchNodeDisplayLabel(removed, publishedList) : 'Branch';
      const label = raw.length > 72 ? `${raw.slice(0, 70)}…` : raw;
      setPathBranchTree((roots) => removeNodeById(roots, id));
      showActionToast(`“${label}” removed.`, {
        variant: 'neutral',
        undo: () => setPathBranchTree(before),
        undoLabel: 'Undo',
      });
    },
    [publishedList, showActionToast]
  );

  const handleDuplicateBranch = useCallback((id: string) => {
    const roots = pathBranchTreeRef.current;
    const node = findBranchNode(roots, id);
    if (!node) {
      showActionToast('Could not find that branch.', 'danger');
      return;
    }
    const sourceParentId = findParentIdOfBranch(roots, id);
    setBranchModal({ kind: 'duplicatePlace', sourceSnapshot: deepClone(node), sourceParentId });
  }, [showActionToast]);

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

  const refreshPaths = useCallback(async () => {
    setPathsLoading(true);
    const list =
      pathPersistence?.kind === 'creator'
        ? (await loadCreatorLearningPathsForOwner(pathPersistence.ownerUid)).paths
        : (await loadLearningPathsFromFirestore()).paths;
    setPaths(list);
    setPathsLoading(false);
    return list;
  }, [pathPersistence]);

  /**
   * Full reload for parent triggers (e.g. catalog deleted a course and stripped paths).
   * Re-fetches the path list and, when a saved path is selected, reloads its mindmap into the branch editor
   * — `refreshPaths` alone does not update `pathBranchTree` because that effect only runs on `pathSelector` change.
   *
   * When updating `paths` and `pathDraft` for the same selected id, batch with `flushSync` so the `[pathSelector, paths]`
   * effect does not run between them and re-apply stale `pathDraft` (it returns `prev` when ids match).
   */
  const reloadPathsFromServer = useCallback(async () => {
    setPathsLoading(true);
    try {
      const list =
        pathPersistence?.kind === 'creator'
          ? (await loadCreatorLearningPathsForOwner(pathPersistence.ownerUid)).paths
          : (await loadLearningPathsFromFirestore()).paths;

      const sel = pathSelector;
      if (sel && sel !== '__new__') {
        const found = list.find((p) => p.id === sel);
        if (found) {
          const clone = deepClone(found);
          flushSync(() => {
            setPaths(list);
            setPathDraft(clone);
            setPathBaselineJson(JSON.stringify(clone));
          });
        } else {
          setPaths(list);
        }
      } else {
        setPaths(list);
      }

      if (sel && sel !== '__new__' && list.some((p) => p.id === sel)) {
        setPathMindmapLoading(true);
        try {
          const mm =
            pathPersistence?.kind === 'creator'
              ? await fetchCreatorPathMindmapFromFirestore(sel)
              : await fetchPathMindmapFromFirestore(sel);
          const roots = mm?.root.children.map(mindmapNodeToPathBranch) ?? [];
          setPathBranchTree(roots);
          setPathBranchTreeBaselineJson(JSON.stringify(roots));
        } finally {
          setPathMindmapLoading(false);
        }
      }

      return list;
    } finally {
      setPathsLoading(false);
    }
  }, [pathPersistence, pathSelector]);

  /** Union Firestore doc ids + in-memory list so allocation skips every occupied id (incl. unparsable docs) and survives a failed list request. Creators also reserve ids used in published `learningPaths` so doc ids never collide across collections. */
  const pathDocumentIdsForAllocation = useCallback(async (): Promise<string[]> => {
    let fromServer: string[];
    if (pathPersistence?.kind === 'creator') {
      const [ownCreatorIds, publishedIds] = await Promise.all([
        listCreatorLearningPathDocumentIdsForOwner(pathPersistence.ownerUid),
        listLearningPathDocumentIds(),
      ]);
      fromServer = [...ownCreatorIds, ...publishedIds];
    } else {
      fromServer = await listLearningPathDocumentIds();
    }
    const fromState = paths.map((p) => p.id);
    return [...new Set([...fromServer, ...fromState])];
  }, [pathPersistence, paths]);

  useImperativeHandle(
    ref,
    () => ({
      reloadPaths: async () => {
        await reloadPathsFromServer();
      },
    }),
    [reloadPathsFromServer]
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
      const mm =
        pathPersistence?.kind === 'creator'
          ? await fetchCreatorPathMindmapFromFirestore(pathSelector)
          : await fetchPathMindmapFromFirestore(pathSelector);
      if (cancelled) return;
      const roots = mm?.root.children.map(mindmapNodeToPathBranch) ?? [];
      setPathBranchTree(roots);
      setPathBranchTreeBaselineJson(JSON.stringify(roots));
      setPathMindmapLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [pathSelector, pathPersistence]);

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
    const publishDirty =
      isLearningPathCatalogPublished(pathDraft) !== isLearningPathCatalogPublished(baselineParsed);
    const metaDirty =
      pathDraft.title !== baselineParsed.title ||
      (pathDraft.description ?? '') !== (baselineParsed.description ?? '') ||
      JSON.stringify(mergedNow) !== JSON.stringify(mergedBaseline) ||
      publishDirty;
    return metaDirty || branchesDirty;
  }, [pathDraft, pathBaselineJson, pathBranchTree, pathBranchTreeBaselineJson, branchesDirty]);

  const platformPathMergedCourseIds = useMemo(
    () => (pathDraft ? mergeCourseIdsFromBranches(pathDraft, pathBranchTree) : []),
    [pathDraft, pathBranchTree]
  );

  /** Unpublished courses on learner-visible rows (or flat path list) — blocks publishing the path. */
  const platformPathLearnerVisibleUnpublishedCourses = useMemo(() => {
    if (isCreatorPaths || !pathDraft) return [];
    return collectLearnerVisibleUnpublishedCourses(
      pathBranchTree,
      publishedList,
      platformPathMergedCourseIds
    );
  }, [isCreatorPaths, pathDraft, pathBranchTree, publishedList, platformPathMergedCourseIds]);

  const platformPathHasUnpublishedCourse = platformPathLearnerVisibleUnpublishedCourses.length > 0;

  const sortedPaths = useMemo(
    () =>
      [...paths].sort((a, b) => {
        const byTitle = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
        return byTitle !== 0 ? byTitle : a.id.localeCompare(b.id);
      }),
    [paths]
  );

  const changeTypeSource = useMemo((): PathBranchNode | null => {
    if (branchModal.kind !== 'changeType') return null;
    return findBranchNode(pathBranchTree, branchModal.nodeId);
  }, [branchModal, pathBranchTree]);

  const addPathBranchModalAllowDivider = useMemo(() => {
    if (branchModal.kind === 'add' && branchModal.parentId != null) {
      return findBranchNode(pathBranchTree, branchModal.parentId)?.kind === 'label';
    }
    if (branchModal.kind === 'changeType') {
      const pid = findParentIdOfBranch(pathBranchTree, branchModal.nodeId);
      if (pid == null) return false;
      return findBranchNode(pathBranchTree, pid)?.kind === 'label';
    }
    return false;
  }, [branchModal, pathBranchTree]);

  const addPathBranchModalShowModuleKind = useMemo(() => {
    if (branchModal.kind === 'add') return branchModal.parentId == null;
    if (branchModal.kind === 'changeType') return isRootBranchId(pathBranchTree, branchModal.nodeId);
    return false;
  }, [branchModal, pathBranchTree]);

  const addPathBranchModalChangeTypeRootLabelOnly = useMemo(() => {
    if (branchModal.kind !== 'changeType' || !isRootBranchId(pathBranchTree, branchModal.nodeId)) return false;
    const src = changeTypeSource;
    return src?.kind === 'course' || src?.kind === 'lesson' || src?.kind === 'link';
  }, [branchModal, pathBranchTree, changeTypeSource]);

  useEffect(() => {
    if (branchModal.kind !== 'changeType') return;
    if (!findBranchNode(pathBranchTree, branchModal.nodeId)) {
      setBranchModal({ kind: 'closed' });
    }
  }, [branchModal, pathBranchTree]);

  const branchModalContextHint = useMemo(() => {
    if (branchModal.kind === 'changeType') {
      if (isRootBranchId(pathBranchTree, branchModal.nodeId)) {
        return 'Top-level rows are a section label or a course module. Pick a new type; nested rows stay when the new type allows.';
      }
      return 'Pick a new type. Nested rows are removed if you choose a section divider; otherwise they stay when the new type allows.';
    }
    if (branchModal.kind === 'add') {
      const pos =
        branchModal.insertIndex !== undefined
          ? ' Inserts at the position you chose in the list.'
          : '';
      if (branchModal.parentId == null) {
        return `Top level: add a section label or a course module, then use Add branch here inside it.${pos}`;
      }
      const p = findBranchNode(pathBranchTree, branchModal.parentId);
      if (p?.kind === 'module') {
        return `Under module: ${branchNodeDisplayLabel(p, publishedList)} — pick a lesson from this module only.${pos}`;
      }
      return p
        ? `Inside section: ${branchNodeDisplayLabel(p, publishedList)}.${pos}`
        : `Inside section.${pos}`;
    }
    return undefined;
  }, [branchModal, pathBranchTree, publishedList]);

  const pathBranchFlatnessIssues = useMemo(
    () => collectPathBranchStructureIssues(pathBranchTree, publishedList),
    [pathBranchTree, publishedList]
  );

  const applyPickNewPath = useCallback(async () => {
    const reserveIds = pathSelector === '__new__' && pathDraft?.id ? [pathDraft.id] : [];
    const docIds = await pathDocumentIdsForAllocation();
    const newId = firstAvailableStructuredLearningPathIdFromDocIds(docIds, reserveIds);
    const fresh: LearningPath = { id: newId, title: '', courseIds: [], catalogPublished: false };
    setShowPathCourseRequiredHint(false);
    setPathBranchTree([]);
    setPathBranchTreeBaselineJson('[]');
    setBranchModal({ kind: 'closed' });
    setPathTitleFocusKey((k) => k + 1);
    setPathSelector('__new__');
    setPathDraft(fresh);
    setPathBaselineJson(JSON.stringify(fresh));
  }, [pathSelector, pathDraft, pathDocumentIdsForAllocation]);

  const pickPath = useCallback(
    (id: string) => {
      if (id === '') return;

      if (id === '__new__') {
        if (pathDirty) {
          setPathConfirmDialog({ kind: 'pickNewPath' });
          return;
        }
        void applyPickNewPath();
        return;
      }

      if (pathDirty && pathSelector !== id) {
        setPathConfirmDialog({ kind: 'switchPath', targetId: id });
        return;
      }
      setPathSelector(id);
    },
    [pathDirty, pathSelector, applyPickNewPath]
  );

  const performPathDuplicate = useCallback(
    async (sourcePath: LearningPath, sourceTree: PathBranchNode[]) => {
      if (!paths.some((p) => p.id === sourcePath.id)) {
        showActionToast('Path not found. Reload the list and try again.', 'danger');
        return;
      }
      const reserveIds = pathSelector === '__new__' && pathDraft?.id ? [pathDraft.id] : [];
      const docIds = await pathDocumentIdsForAllocation();
      const newId = firstAvailableStructuredLearningPathIdFromDocIds(docIds, reserveIds);
      const t = sourcePath.title.trim();
      const newPath: LearningPath = {
        ...deepClone(sourcePath),
        id: newId,
        title: t.endsWith(' (copy)') ? t : `${t} (copy)`,
        courseIds: [...sourcePath.courseIds],
        catalogPublished: false,
      };
      const newTree = remapPathBranchForest(sourceTree);
      setShowPathCourseRequiredHint(false);
      setPathBranchTree(newTree);
      setPathBranchTreeBaselineJson(JSON.stringify(newTree));
      setBranchModal({ kind: 'closed' });
      setPathTitleFocusKey((k) => k + 1);
      setPathSelector('__new__');
      setPathDraft(newPath);
      setPathBaselineJson(JSON.stringify(newPath));
      setExpandedBranchIds(new Set());
      showActionToast(
        'Copy loaded as a new draft — new path id. Adjust the title if needed, then Save.'
      );
    },
    [paths, pathSelector, pathDraft?.id, showActionToast, pathDocumentIdsForAllocation]
  );

  const requestDuplicatePathOrConfirm = useCallback(() => {
    if (!pathSelector || pathSelector === '__new__') {
      showActionToast('Select a saved path in the list, then duplicate.', 'danger');
      return;
    }
    if (!paths.some((p) => p.id === pathSelector)) {
      showActionToast('Path not found. Reload the list and try again.', 'danger');
      return;
    }
    if (pathDirty) {
      setPathConfirmDialog({ kind: 'duplicatePath' });
      return;
    }
    if (!pathDraft || pathDraft.id !== pathSelector) {
      showActionToast('Path not loaded.', 'danger');
      return;
    }
    void performPathDuplicate(pathDraft, pathBranchTree);
  }, [pathSelector, pathDirty, pathDraft, pathBranchTree, paths, performPathDuplicate, showActionToast]);

  const closePathConfirmDialog = useCallback(() => setPathConfirmDialog(null), []);

  const confirmPathDialogPrimary = useCallback(() => {
    const d = pathConfirmDialog;
    if (!d) return;
    setPathConfirmDialog(null);

    if (d.kind === 'pickNewPath') {
      void applyPickNewPath();
      return;
    }
    if (d.kind === 'switchPath') {
      setPathSelector(d.targetId);
      return;
    }
    if (d.kind === 'discardDraft') {
      setPathSelector('');
      setPathDraft(null);
      setPathBaselineJson(null);
      setPathBranchTree([]);
      setPathBranchTreeBaselineJson('[]');
      setBranchModal({ kind: 'closed' });
      return;
    }
    if (d.kind === 'deletePublished') {
      const id = pathDraft?.id;
      if (!id) return;
      void (async () => {
        setPathBusy(true);
        const deleted =
          pathPersistence?.kind === 'creator'
            ? await deleteCreatorLearningPath(id)
            : await deleteLearningPath(id);
        setPathBusy(false);
        if (deleted) {
          clearPathOutlineUiSessionForPathId(id);
          showActionToast('Path deleted.');
          setPathSelector('');
          setPathDraft(null);
          setPathBaselineJson(null);
          await refreshPaths();
          await onCatalogChanged();
        } else {
          showActionToast('Delete failed.', 'danger');
        }
      })();
      return;
    }
    if (d.kind === 'duplicatePath') {
      if (!pathBaselineJson || !pathBranchTreeBaselineJson) {
        showActionToast('Could not restore saved path.', 'danger');
        return;
      }
      let sourceDraft: LearningPath;
      let sourceTree: PathBranchNode[];
      try {
        sourceDraft = JSON.parse(pathBaselineJson) as LearningPath;
        sourceTree = JSON.parse(pathBranchTreeBaselineJson) as PathBranchNode[];
      } catch {
        showActionToast('Could not restore saved path.', 'danger');
        return;
      }
      if (!paths.some((p) => p.id === sourceDraft.id)) {
        showActionToast('Path not found. Reload the list and try again.', 'danger');
        return;
      }
      void performPathDuplicate(sourceDraft, sourceTree);
    }
  }, [
    pathConfirmDialog,
    pathDraft,
    applyPickNewPath,
    refreshPaths,
    onCatalogChanged,
    showActionToast,
    pathBaselineJson,
    pathBranchTreeBaselineJson,
    paths,
    performPathDuplicate,
    pathPersistence,
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
      case 'discardDraft':
        return {
          title: 'Discard this path?',
          body: 'Your changes will be lost.',
          primary: 'Discard',
        };
      case 'deletePublished':
        return {
          title: 'Delete this path?',
          body: pathDraft
            ? `Delete "${pathDraft.title}"? This cannot be undone.`
            : 'This cannot be undone.',
          primary: 'Delete path',
        };
      case 'duplicatePath':
        return {
          title: 'Leave without saving?',
          body: 'Duplicate uses the last saved version of this path. Unsaved changes will be discarded.',
          primary: 'Discard and duplicate',
        };
      default:
        return null;
    }
  }, [pathConfirmDialog, pathSelector, pathDraft]);

  useBodyScrollLock(!!pathConfirmDialog || branchModal.kind !== 'closed' || pathTitleConflict !== null);

  useDialogKeyboard({
    open: !!pathConfirmDialog,
    onClose: closePathConfirmDialog,
    onPrimaryAction: confirmPathDialogPrimary,
  });

  useEffect(() => {
    onPathsDirtyChange?.(pathDirty);
    return () => onPathsDirtyChange?.(false);
  }, [pathDirty, onPathsDirtyChange]);

  useEffect(() => {
    if ((pathDraft?.courseIds.length ?? 0) > 0) {
      setShowPathCourseRequiredHint(false);
      return;
    }
    if (pathBranchTree.length > 0) {
      setShowPathCourseRequiredHint(false);
    }
  }, [pathDraft?.courseIds.length, pathBranchTree.length]);

  const handleSavePath = async () => {
    if (!pathDraft) return;
    if (!pathDraft.title.trim()) {
      setShowPathCourseRequiredHint(false);
      showActionToast('Add a path title before saving.', 'danger');
      return;
    }

    const structureIssues = collectPathBranchStructureIssues(pathBranchTree, publishedList);
    if (structureIssues.length > 0) {
      setShowPathCourseRequiredHint(false);
      showActionToast(structureIssues[0], 'danger');
      requestAnimationFrame(() => {
        document.getElementById('admin-path-branches')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
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
      const row = publishedList.find((c) => c.id === cid);
      if (!row) {
        setShowPathCourseRequiredHint(false);
        showActionToast(
          isCreatorPaths
            ? `Course "${cid}" is not in your course list. Add it in the Catalog tab first.`
            : `Course "${cid}" is not in the published catalog. Remove it or publish the course first.`,
          'danger'
        );
        return;
      }
    }

    if (!isCreatorPaths && isLearningPathCatalogPublished(pathDraft)) {
      const blocked = collectLearnerVisibleUnpublishedCourses(pathBranchTree, publishedList, mergedCourseIds);
      if (blocked.length > 0) {
        setShowPathCourseRequiredHint(false);
        showActionToast(formatPathPublishBlockedByCoursesMessage(blocked), 'danger');
        return;
      }
    }

    try {
      const pathRows = await loadPathTitlesForConflictCheck({
        mode: isCreatorPaths ? 'creator' : 'admin',
        creatorOwnerUid: pathPersistence?.kind === 'creator' ? pathPersistence.ownerUid : undefined,
      });
      const courseRows = coursesForPathTitleConflictCheck.map((c) => ({ id: c.id, title: c.title }));
      const titleHit = findPathSaveTitleConflict(pathDraft.title, pathDraft.id, pathRows, courseRows);
      if (titleHit) {
        setPathTitleConflict(titleHit);
        return;
      }
    } catch {
      showActionToast('Could not verify path title uniqueness. Try again.', 'danger');
      return;
    }

    const toSave = { ...pathDraft, courseIds: mergedCourseIds };

    setPathBusy(true);
    const ok =
      pathPersistence?.kind === 'creator'
        ? await saveCreatorLearningPath(toSave, pathPersistence.ownerUid)
        : await saveLearningPath(toSave);
    setPathBusy(false);
    if (ok) {
      setShowPathCourseRequiredHint(false);
      const nodes = branchTreeToMindmapForest(pathBranchTree, publishedList);
      const doc = mindmapDocumentWithCenterChildren(nodes);
      const mmOk =
        pathPersistence?.kind === 'creator'
          ? await saveCreatorPathMindmapToFirestore(toSave.id, doc)
          : await savePathMindmapToFirestore(toSave.id, doc);
      if (mmOk) {
        setPathBranchTreeBaselineJson(JSON.stringify(pathBranchTree));
        showActionToast('Path and outline saved.');
      } else {
        showActionToast('Path saved, but outline failed to save (check console / rules).', 'danger');
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

  useLayoutEffect(() => {
    const id = pendingBranchDisclosureScrollRef.current;
    if (!id) return;
    pendingBranchDisclosureScrollRef.current = null;
    const sel = `[data-path-branch-node-id="${escapeSelectorAttrValue(id)}"]`;
    const row = queryElementInScopeOrDocument(pathBranchMindMapRootRef.current, sel);
    scrollDisclosureRowToTop(null, row);
  }, [expandedBranchIds]);

  return (
    <div className="min-w-0 w-full space-y-4">
      <AdminDisplayNameConflictDialog
        open={pathTitleConflict !== null}
        savingLabel="path"
        conflict={pathTitleConflict}
        renameFieldId="admin-path-title"
        onClose={() => setPathTitleConflict(null)}
      />
      {actionToast}

      {isCreatorPaths && publishedList.length === 0 && (
        <p
          className="rounded-xl border border-orange-500/25 bg-orange-500/[0.07] px-3 py-2.5 text-xs leading-relaxed text-[var(--text-secondary)] sm:text-sm"
          role="status"
        >
          You have no courses yet. Open the <strong className="font-semibold text-[var(--text-primary)]">Catalog</strong>{' '}
          tab, create a course, then return here to add it to a path outline.
        </p>
      )}

      <div className="space-y-3">
        <div className="flex flex-col gap-3 md:grid md:grid-cols-[minmax(0,1.5fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_auto] md:items-start md:gap-x-3 md:gap-y-3">
          <div className="flex min-w-0 flex-col gap-1">
            <AdminLabelInfoTip
              htmlFor="admin-learning-path-select"
              label="Path"
              tipId="admin-path-field-tips"
              tipRegionAriaLabel="Path field tips"
              tipSubject="Path"
            >
              <li>
                {isCreatorPaths
                  ? 'Saves to your private creator path + outline (Firestore).'
                  : 'Saves go to the live path and outline (Firestore).'}
              </li>
              <li>
                Open <strong className="font-semibold text-[var(--text-secondary)]">Path</strong> once to load titles.
              </li>
              {isCreatorPaths ? (
                <li>
                  <strong className="font-semibold text-[var(--text-secondary)]">Create new path</strong> assigns a
                  unique id automatically; paths are listed A–Z by title.
                </li>
              ) : (
                <li>
                  <strong className="font-semibold text-[var(--text-secondary)]">Create new path</strong>: next id{' '}
                  <code className="text-orange-500/90">P1</code>, <code className="text-orange-500/90">P2</code>…; list
                  A–Z.
                </li>
              )}
              <li>
                {isCreatorPaths
                  ? 'Add courses from the Catalog tab to the outline — path rows only offer courses you have created there.'
                  : 'Add any course from the live catalog. Learners only see course/lesson rows when the course is published in the Catalog tab and Show is on for that row.'}
              </li>
            </AdminLabelInfoTip>
            <div className="flex min-w-0 items-stretch gap-2">
              <select
                id="admin-learning-path-select"
                value={pathSelector}
                onChange={(e) => pickPath(e.target.value)}
                disabled={pathsLoading}
                className="box-border min-h-11 min-w-0 flex-1 touch-manipulation rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-base text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[42px] sm:text-sm"
              >
                <option value="" disabled>
                  Choose a path…
                </option>
                {!pathsLoading && (
                  <>
                    <option value="__new__">+ Create new path</option>
                    {sortedPaths.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title || p.id} ({p.id})
                      </option>
                    ))}
                  </>
                )}
              </select>
              {pathSelector !== '__new__' && pathSelector !== '' ? (
                <button
                  type="button"
                  disabled={
                    pathsLoading ||
                    !pathSelector ||
                    !paths.some((p) => p.id === pathSelector)
                  }
                  onClick={requestDuplicatePathOrConfirm}
                  title="Clone the selected path into a new draft with a new path id"
                  aria-label="Duplicate path as new draft"
                  className="inline-flex shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] px-2.5 min-h-[42px] min-w-[42px] hover:bg-[var(--hover-bg)] disabled:pointer-events-none disabled:opacity-40"
                >
                  <Copy size={18} aria-hidden />
                </button>
              ) : null}
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-2 md:contents">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex min-h-6 min-w-0 items-center">
                <span className="text-xs font-semibold leading-none text-[var(--text-secondary)]">Path id</span>
              </div>
              <div
                className="box-border flex min-h-[42px] w-full min-w-0 items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-2 text-sm font-mono text-[var(--text-primary)] md:px-3"
                aria-live="polite"
                title="Firestore document id"
              >
                {pathDraft ? (
                  <span className="truncate text-orange-500/90">{pathDraft.id}</span>
                ) : (
                  <span className="text-[var(--text-muted)]">—</span>
                )}
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex min-h-6 min-w-0 items-center">
                <span className="text-xs font-semibold leading-none text-[var(--text-secondary)]">Linked courses</span>
              </div>
              <div
                className="box-border flex min-h-[42px] w-full min-w-0 items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-2 text-sm text-[var(--text-primary)] md:px-3"
                aria-live="polite"
              >
                {pathDraft ? (
                  <span>
                    {pathDraft.courseIds.length === 0
                      ? 'None yet'
                      : pathDraft.courseIds.length === 1
                        ? '1 course'
                        : `${pathDraft.courseIds.length} courses`}
                  </span>
                ) : (
                  <span className="text-[var(--text-muted)]">—</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex min-w-0 w-full flex-col gap-1 md:w-auto md:max-w-full">
            <div className="flex min-h-6 min-w-0 items-center">
              <span className="text-xs font-semibold leading-none text-[var(--text-secondary)] max-md:sr-only">
                Actions
              </span>
            </div>
            <div
              className="flex min-w-0 flex-nowrap items-center justify-start gap-2 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch] md:justify-end"
              role="group"
              aria-label="Path actions"
            >
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  disabled={
                    pathBusy ||
                    !pathDraft ||
                    (pathBaselineJson !== null && !pathDirty) ||
                    (!isCreatorPaths &&
                      isLearningPathCatalogPublished(pathDraft) &&
                      platformPathHasUnpublishedCourse)
                  }
                  onClick={() => void handleSavePath()}
                  aria-busy={pathBusy}
                  title={
                    !isCreatorPaths &&
                    pathDraft &&
                    isLearningPathCatalogPublished(pathDraft) &&
                    platformPathHasUnpublishedCourse
                      ? 'Fix learner-visible unpublished courses, or unpublish this path before saving'
                      : pathBusy
                        ? 'Saving…'
                        : 'Save path and outline'
                  }
                  aria-label={pathBusy ? 'Saving…' : 'Save path to catalog'}
                  className="inline-flex min-h-11 shrink-0 touch-manipulation items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-40 sm:px-5"
                >
                  {pathBusy ? (
                    <Loader2 size={18} className="shrink-0 animate-spin" aria-hidden />
                  ) : (
                    <Save size={18} className="shrink-0" aria-hidden />
                  )}
                  <span>{pathBusy ? 'Saving…' : 'Save'}</span>
                </button>
                {pathDraft && pathDirty ? (
                  <span
                    role="status"
                    className="inline-flex size-11 shrink-0 items-center justify-center text-amber-600 dark:text-amber-400"
                    title="Unsaved changes"
                  >
                    <AlertCircle size={20} strokeWidth={2} aria-hidden />
                    <span className="sr-only">Unsaved changes</span>
                  </span>
                ) : pathDraft && !pathDirty && pathSelector !== '__new__' ? (
                  <span
                    role="status"
                    className="inline-flex size-11 shrink-0 items-center justify-center text-emerald-600 dark:text-emerald-400"
                    title="All changes saved"
                  >
                    <CheckCircle2 size={20} strokeWidth={2} aria-hidden />
                    <span className="sr-only">All changes saved</span>
                  </span>
                ) : null}
              </div>
              {!isCreatorPaths && pathDraft ? (
                <div className="flex items-center gap-1 border-l border-[var(--border-color)]/70 pl-3">
                  <label
                    htmlFor="admin-path-catalog-publish-checkbox"
                    className="flex min-h-11 cursor-pointer touch-manipulation items-center gap-1.5 rounded-lg px-0.5"
                    title="Published in path picker and navbar"
                  >
                    <Globe size={16} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
                    <input
                      id="admin-path-catalog-publish-checkbox"
                      type="checkbox"
                      checked={isLearningPathCatalogPublished(pathDraft)}
                      onChange={(e) => {
                        const on = e.target.checked;
                        if (on && platformPathHasUnpublishedCourse) {
                          showActionToast(
                            formatPathPublishBlockedByCoursesMessage(platformPathLearnerVisibleUnpublishedCourses),
                            'danger'
                          );
                          return;
                        }
                        setPathDraft((d) => {
                          if (!d) return d;
                          if (on) {
                            const { catalogPublished: _removed, ...rest } = d;
                            return { ...rest } as LearningPath;
                          }
                          return { ...d, catalogPublished: false };
                        });
                      }}
                      className="h-4 w-4 shrink-0 rounded border-[var(--border-color)] accent-orange-500"
                      aria-label="Published in learning path picker and navbar"
                    />
                  </label>
                  <AdminLabelInfoTip
                    controlOnly
                    tipId="admin-path-catalog-publish-tips"
                    tipRegionAriaLabel="Published path visibility"
                    tipSubject="Published in path picker"
                  >
                    <li>When on, learners see this path in the navbar and path menu.</li>
                    <li>When off, it stays hidden there while you keep editing.</li>
                    <li>
                      Any outline row <strong className="font-semibold text-[var(--text-secondary)]">shown to learners</strong>{' '}
                      (Show on, not admin-only) must use a course that is published in the Catalog tab. Unpublished
                      courses are fine if Show is off or the row is administrators only.
                    </li>
                  </AdminLabelInfoTip>
                </div>
              ) : null}
              <div
                className="flex items-center border-l-2 border-red-500/25 pl-3 md:pl-4"
                role="group"
                aria-label="Destructive actions"
              >
                <button
                  type="button"
                  disabled={pathBusy || !pathDraft}
                  onClick={requestDeletePath}
                  title={
                    pathDraft && paths.some((p) => p.id === pathDraft.id)
                      ? 'Permanently remove this path from the catalog'
                      : 'Discard unsaved new path'
                  }
                  aria-label="Delete path from catalog"
                  className="inline-flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-md border-2 border-red-500/50 bg-transparent px-3 py-2 text-sm font-semibold text-red-500 hover:bg-red-500/10 dark:text-red-400 disabled:opacity-40"
                >
                  <Trash2 size={17} className="shrink-0" aria-hidden />
                  <span className="max-sm:sr-only">Delete</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        {!isCreatorPaths &&
        pathDraft &&
        isLearningPathCatalogPublished(pathDraft) &&
        platformPathHasUnpublishedCourse ? (
          <p
            className="whitespace-pre-line rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-900 dark:text-amber-100/90 sm:text-sm"
            role="status"
          >
            {formatPathPublishBlockedByCoursesMessage(platformPathLearnerVisibleUnpublishedCourses)}
          </p>
        ) : null}
      </div>

      {!pathDraft && !pathsLoading ? (
        <div className="rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)]/35 px-4 py-8 text-center sm:py-10">
          <Route size={28} className="mx-auto mb-3 text-orange-500/70" aria-hidden />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Select or create a path</p>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-[var(--text-muted)]">
            Pick an existing path from the menu, or choose <span className="font-medium text-[var(--text-secondary)]">Create new path</span> to start fresh.
          </p>
        </div>
      ) : null}

      {pathDraft ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block min-w-0 space-y-1 sm:col-span-2" htmlFor="admin-path-title">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Title</span>
              <input
                id="admin-path-title"
                value={pathDraft.title}
                onChange={(e) => setPathDraft((p) => (p ? { ...p, title: e.target.value } : p))}
                placeholder="Short name shown to learners (e.g. Full-Stack Track)"
                className="w-full min-w-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-base sm:text-sm"
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
                className="w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-base sm:text-sm"
              />
            </label>
          </div>

          <div
            id="admin-path-branches"
            className={`space-y-3 ${pathMindmapLoading ? 'pointer-events-none opacity-60' : ''}`}
          >
            <div className="space-y-2">
              <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                <h3 className="m-0 text-sm font-bold leading-none text-[var(--text-primary)]">Outline</h3>
                <AdminLabelInfoTip
                  controlOnly
                  tipId="admin-path-outline-tips"
                  tipRegionAriaLabel="Outline tips"
                  tipSubject="Outline"
                >
                  <li>
                    <strong className="font-semibold text-[var(--text-secondary)]">Section divider</strong> — in-section
                    subheading (not collapsible).
                  </li>
                  <li>
                    Courses and lessons update{' '}
                    <strong className="font-semibold text-[var(--text-secondary)]">Linked courses</strong>.
                  </li>
                  <li>
                    <strong className="font-semibold text-[var(--text-secondary)]">Show</strong> off hides the row for
                    everyone. On: <strong className="font-semibold text-[var(--text-secondary)]">User</strong> or{' '}
                    <strong className="font-semibold text-[var(--text-secondary)]">Administrators only</strong>. Course
                    rows: learners need catalog publish too.
                  </li>
                </AdminLabelInfoTip>
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                <strong className="text-[var(--text-secondary)]">Sections</strong> hold one flat list (courses, lessons,
                links, dividers). <strong className="text-[var(--text-secondary)]">↑↓</strong> to reorder;{' '}
                <strong className="text-[var(--text-secondary)]">Add branch here</strong> to insert.{' '}
                <strong className="text-[var(--text-secondary)]">Save</strong> to apply.
              </p>
              {pathBranchFlatnessIssues.length > 0 ? (
                <div
                  role="status"
                  className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-[var(--text-primary)]"
                >
                  <p className="font-semibold text-amber-800 dark:text-amber-200">Outline needs flattening</p>
                  <ul className="mt-1 list-inside list-disc text-[var(--text-secondary)]">
                    {pathBranchFlatnessIssues.slice(0, 5).map((msg, i) => (
                      <li key={i}>{msg}</li>
                    ))}
                  </ul>
                  {pathBranchFlatnessIssues.length > 5 ? (
                    <p className="mt-1 text-[var(--text-muted)]">…and more. Flatten to fix all at once.</p>
                  ) : null}
                  <button
                    type="button"
                    disabled={!!pathMindmapLoading && pathSelector !== '__new__'}
                    onClick={() =>
                      setPathBranchTree((roots) =>
                        roots.map((sec) => ({
                          ...sec,
                          children: flattenPathBranchSectionChildren(sec.children, publishedList),
                        }))
                      )
                    }
                    className="mt-2 inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-40 sm:w-auto"
                  >
                    Flatten for editing
                  </button>
                </div>
              ) : null}
            </div>
            {pathMindmapLoading && pathSelector !== '__new__' ? (
              <div className="flex items-center gap-2 py-4 text-sm text-[var(--text-muted)]">
                <Loader2 size={18} className="animate-spin shrink-0" aria-hidden />
                Loading outline…
              </div>
            ) : (
                pathBranchTree.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-orange-500/35 bg-orange-500/[0.07] px-4 py-6 sm:px-6">
                    <p className="text-center text-sm font-semibold text-[var(--text-primary)]">Start your outline</p>
                    <p className="mt-2 text-center text-xs leading-relaxed text-[var(--text-muted)]">
                      {pathSelector === '__new__' ? (
                        <>
                          Start with a <strong className="text-[var(--text-secondary)]">section label</strong>. After you
                          save the path, you can add a top-level <strong className="text-[var(--text-secondary)]">course module</strong>{' '}
                          from the outline. Under a label, add courses, lessons, links, or dividers.
                        </>
                      ) : (
                        <>
                          Top-level rows are a <strong className="text-[var(--text-secondary)]">section label</strong> or a{' '}
                          <strong className="text-[var(--text-secondary)]">course module</strong>. Under a label, add courses,
                          lessons, links, or dividers. Under a module, add{' '}
                          <strong className="text-[var(--text-secondary)]">only lessons</strong> from that module.
                        </>
                      )}
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
                          Section label
                        </span>
                        <span className="pl-[1.625rem] text-xs text-[var(--text-muted)]">
                          Free-text heading; add courses, lessons, or links underneath
                        </span>
                      </button>
                      {pathSelector !== '__new__' ? (
                        <button
                          type="button"
                          disabled={!!pathMindmapLoading && pathSelector !== '__new__'}
                          onClick={() => setBranchModal({ kind: 'add', parentId: null, preset: 'module' })}
                          className="flex min-h-12 w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-3 text-left transition-colors hover:border-orange-500/40 hover:bg-[var(--hover-bg)] disabled:opacity-40"
                        >
                          <span className="flex w-full items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                            <Layers size={18} className="shrink-0 text-indigo-500" aria-hidden />
                            Course module
                          </span>
                          <span className="pl-[1.625rem] text-xs text-[var(--text-muted)]">
                            Pick a catalog module; only its lessons can go under this row
                          </span>
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-4 text-center text-[11px] leading-relaxed text-[var(--text-muted)]">
                      {pathSelector === '__new__' ? (
                        <>
                          More top-level rows: <strong className="text-[var(--text-secondary)]">Add top-level section here</strong>{' '}
                          between rows (section label or section heading only until the path is saved).
                        </>
                      ) : (
                        <>
                          More top-level rows: <strong className="text-[var(--text-secondary)]">Add top-level section here</strong>{' '}
                          between rows. Under a module, use <strong className="text-[var(--text-secondary)]">Add branch here</strong>{' '}
                          for lessons only.
                        </>
                      )}
                    </p>
                  </div>
                ) : (
                  <div ref={pathBranchMindMapRootRef} className="min-w-0">
                    <PathBranchTreeList
                      parentId={null}
                      nodes={pathBranchTree}
                      depth={0}
                      publishedList={publishedList}
                      expandedBranchIds={expandedBranchIds}
                      onToggleCollapse={toggleBranchCollapse}
                      onBranchRowFocus={focusBranchRow}
                      onInsertBranchAt={(pid, insertIndex) => {
                        const roots = pathBranchTreeRef.current;
                        if (pid != null) {
                          const parent = findBranchNode(roots, pid);
                          if (parent?.kind === 'module') {
                            setBranchModal({
                              kind: 'add',
                              parentId: pid,
                              insertIndex,
                              lessonAddContext: {
                                courseId: parent.courseId,
                                moduleId: parent.moduleId,
                              },
                            });
                            return;
                          }
                        }
                        setBranchModal(
                          pid == null
                            ? { kind: 'add', parentId: null, insertIndex }
                            : { kind: 'add', parentId: pid, insertIndex }
                        );
                      }}
                      onRemove={handleRemoveBranch}
                      onCopyBranch={handleDuplicateBranch}
                      onMove={moveBranchAmongSiblings}
                      onLabelChange={(id, label) =>
                        setPathBranchTree((roots) =>
                          mapBranchNodeById(roots, id, (n) =>
                            n.kind === 'label' || n.kind === 'divider' ? { ...n, label } : n
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
                      onRequestChangeType={(id) => setBranchModal({ kind: 'changeType', nodeId: id })}
                      onVisibleToRolesChange={(id, roles) =>
                        setPathBranchTree((roots) =>
                          mapBranchNodeById(roots, id, (n) => ({
                            ...n,
                            visibleToRoles:
                              roles.length === 0
                                ? []
                                : roles.includes('user') && roles.includes('admin')
                                  ? undefined
                                  : roles,
                          }))
                        )
                      }
                    />
                  </div>
                )
            )}
          </div>

          {pathDraft.courseIds.length === 0 && showPathCourseRequiredHint ? (
            <p id="admin-path-course-required-hint" className="text-xs font-medium text-red-500 dark:text-red-400">
              Link at least one course (or lesson) before saving. Links alone do not count as catalog courses.
            </p>
          ) : null}

          <AddPathBranchModal
            open={
              branchModal.kind === 'add' ||
              (branchModal.kind === 'changeType' && changeTypeSource != null)
            }
            onClose={() => setBranchModal({ kind: 'closed' })}
            catalogCourses={catalogCoursesForPathPicker}
            catalogCoursesForLabels={publishedList}
            contextHint={branchModalContextHint}
            addPreset={branchModal.kind === 'add' ? branchModal.preset : undefined}
            topLevelOutlineAdd={branchModal.kind === 'add' && branchModal.parentId == null}
            topLevelNewPathSectionLabelOnly={pathSelector === '__new__'}
            changeTypeRootRowLabelOnly={addPathBranchModalChangeTypeRootLabelOnly}
            allowSectionDivider={addPathBranchModalAllowDivider}
            lessonAddContext={branchModal.kind === 'add' ? branchModal.lessonAddContext ?? null : null}
            showModuleInKindPicker={addPathBranchModalShowModuleKind}
            replaceSource={changeTypeSource}
            mode={branchModal.kind === 'changeType' ? 'changeType' : 'add'}
            onCommit={(branch) => {
              if (branchModal.kind === 'changeType') {
                setPathBranchTree((roots) => mapBranchNodeById(roots, branchModal.nodeId, () => branch));
                setBranchModal({ kind: 'closed' });
                return;
              }
              if (branchModal.kind === 'add') {
                const roots = pathBranchTreeRef.current;
                const next =
                  branchModal.insertIndex !== undefined
                    ? insertChildAtParent(roots, branchModal.parentId, branchModal.insertIndex, branch)
                    : addChildAtParent(roots, branchModal.parentId, branch);
                setPathBranchTree(next);
                if (branchModal.parentId != null) {
                  setExpandedBranchIds((prev) => accordionExpandBranchRow(prev, next, branchModal.parentId!));
                }
                setBranchModal({ kind: 'closed' });
              }
            }}
          />

          {branchModal.kind === 'duplicatePlace' ? (
            <PlaceDuplicateBranchModal
              open
              sourceSnapshot={branchModal.sourceSnapshot}
              roots={pathBranchTree}
              publishedList={publishedList}
              defaultTopParentId={branchModal.sourceParentId}
              onClose={() => setBranchModal({ kind: 'closed' })}
              onCommit={(parentId, insertIndex, payload) => {
                const roots = pathBranchTreeRef.current;
                if (payload.mode === 'copy') {
                  const br = payload.branch;
                  if (parentId === null && br.kind !== 'label' && br.kind !== 'module') {
                    showActionToast('Only section labels or course modules can be placed at the top level.', 'danger');
                    return;
                  }
                  if (br.kind === 'module' && parentId !== null) {
                    showActionToast('Course modules can only be placed at the top level.', 'danger');
                    return;
                  }
                  if (duplicateSubtreeRequiresTopLevelOnly(br) && parentId !== null) {
                    showActionToast('This copy must stay at the top level.', 'danger');
                    return;
                  }
                  const next = insertChildAtParent(roots, parentId, insertIndex, br);
                  if (findBranchNode(next, br.id) == null) {
                    showActionToast('Could not place the copy.', 'danger');
                    return;
                  }
                  setPathBranchTree(next);
                  if (parentId != null) {
                    setExpandedBranchIds((prev) => accordionExpandBranchRow(prev, next, parentId));
                  } else {
                    setExpandedBranchIds((prev) => accordionExpandBranchRow(prev, next, br.id));
                  }
                  setBranchModal({ kind: 'closed' });
                  showActionToast('Branch duplicated.');
                  return;
                }

                const sourceId = payload.sourceId;
                const snap = findBranchNode(roots, sourceId);
                if (!snap) {
                  showActionToast('Could not find that branch to move.', 'danger');
                  return;
                }
                if (parentId === snap.id) {
                  showActionToast('Cannot move a branch under itself.', 'danger');
                  return;
                }
                if (parentId !== null && collectDescendantBranchIds(roots, sourceId).has(parentId)) {
                  showActionToast('Cannot move a branch inside its own nested rows.', 'danger');
                  return;
                }
                if (parentId === null && snap.kind !== 'label' && snap.kind !== 'module') {
                  showActionToast('Only section labels or course modules can be placed at the top level.', 'danger');
                  return;
                }
                if (snap.kind === 'module' && parentId !== null) {
                  showActionToast('Course modules can only be placed at the top level.', 'danger');
                  return;
                }
                if (duplicateSubtreeRequiresTopLevelOnly(snap) && parentId !== null) {
                  showActionToast('This branch must stay at the top level.', 'danger');
                  return;
                }
                const { next: without, extracted } = extractNodeById(roots, sourceId);
                if (!extracted) {
                  showActionToast('Could not move that branch.', 'danger');
                  return;
                }
                let adj = insertIndex;
                const srcParent = findParentIdOfBranch(roots, sourceId);
                if (srcParent === parentId) {
                  const sibs = siblingsUnderParent(roots, parentId);
                  const srcIdx = sibs.findIndex((n) => n.id === sourceId);
                  if (srcIdx >= 0 && srcIdx < insertIndex) {
                    adj = insertIndex - 1;
                  }
                }
                const next = insertChildAtParent(without, parentId, adj, extracted);
                if (findBranchNode(next, extracted.id) == null) {
                  showActionToast('Could not place the branch.', 'danger');
                  return;
                }
                setPathBranchTree(next);
                if (parentId != null) {
                  setExpandedBranchIds((prev) => accordionExpandBranchRow(prev, next, parentId));
                } else {
                  setExpandedBranchIds((prev) => accordionExpandBranchRow(prev, next, extracted.id));
                }
                setBranchModal({ kind: 'closed' });
                showActionToast('Branch moved.');
              }}
            />
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
                    Cancel
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
