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
  Folder,
  ArrowRightLeft,
  FileText,
  Globe,
  GraduationCap,
  Hash,
  Info,
  Link2,
  Layers,
  Loader2,
  Package,
  Plus,
  Route,
  Save,
  SlidersHorizontal,
  Trash2,
  Type,
  X,
  Minus,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import { useInsertStripRevealCursor } from '../../hooks/useInsertStripRevealCursor';
import type { Course, Lesson, Module } from '../../data/courses';
import { isCourseCatalogPublished } from '../../data/courses';
import { formatCourseTaxonomyForSearch } from '../../utils/courseTaxonomy';
import {
  compactVisibleToRolesForPersist,
  mindmapDocumentWithCenterChildren,
  newMindmapNodeId,
  outlineVisibleToRolesVisibleToViewer,
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
import {
  narrowAdminTipPanelStyle,
  readFixedTipTopBelowAnchor,
  useTipsNarrowViewport,
} from './adminTipPanelLayout';
import { useAdminActionToast } from './useAdminActionToast';
import { AdminDisplayNameConflictDialog } from './AdminDisplayNameConflictDialog';
import { PathSectionDividerCard } from '../PathSectionDividerCard';
import { InsertStripWaitCursorPortal } from './InsertStripWaitCursorPortal';
import {
  findPathSaveTitleConflict,
  loadPathTitlesForConflictCheck,
  type TitleConflictHit,
} from '../../utils/catalogDisplayNameConflicts';
import { clearPathOutlineUiSessionForPathId } from '../../utils/pathOutlineUiSession';
import {
  ADMIN_EMBEDDED_SCROLL_LIST_DIVIDED,
  CUSTOM_LISTBOX_LOADING,
  PATH_MODAL_LIST_ROW_COURSE,
  PATH_MODAL_LIST_ROW_TWO_LINE,
} from '../../ui/customMenuClasses';
import {
  applyReorderViewportScrollAndFocus,
  escapeSelectorAttrValue,
  queryElementInScopeOrDocument,
  REORDER_DATA_ATTR_SELECTORS,
} from '../../utils/reorderScrollViewport';
import { scrollDisclosureRowToTop } from '../../utils/scrollDisclosureRowToTop';
import {
  ADMIN_INSERT_STRIP_CHIP_BTN_PERSIST,
  ADMIN_INSERT_STRIP_OUTER_EXPAND_HOVER,
  PATH_INSERT_STRIP_CHIP_BTN_EXPAND_ROW,
  PATH_INSERT_STRIP_CHIP_BTN_EXPAND_ROW_PAIR,
} from './adminInsertStripClasses';
import {
  CourseHierarchyVisibilityCells,
  PATH_OUTLINE_ROW_VISIBILITY_SHOW_TIP,
} from './CourseHierarchyVisibilityControls';
import { AdminListboxSelect } from './AdminListboxSelect';
import { catalogMiniRichPlainText } from '../../utils/catalogMiniRichHtml';

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [removed] = next.splice(from, 1);
  next.splice(to, 0, removed);
  return next;
}

/** Tree node for path outline — synced to `pathMindmap` on save. Top-level outline modules (`kind: 'label'`) or catalog units (`kind: 'module'`), plus sub-rows; `divider` rows may group a flat list of sub-rows (no deeper nesting under non-divider rows). */
type PathBranchNode =
  | {
      id: string;
      kind: 'label';
      label: string;
      children: PathBranchNode[];
      locked?: boolean;
      visibleToRoles?: PathOutlineAudienceRole[];
    }
  | {
      id: string;
      kind: 'divider';
      label: string;
      children: PathBranchNode[];
      /** Small caps line above the main title on the learner path (e.g. “NCERT BOOK”). */
      dividerEyebrow?: string;
      visibleToRoles?: PathOutlineAudienceRole[];
    }
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
  if (v.includes('learner') && v.includes('admin')) return {};
  return { visibleToRoles: [...new Set(v)] };
}

/** Promote legacy nested rows into section-level dividers + flat siblings (admin “Flatten”). */
function flattenPathBranchSectionChildren(nodes: PathBranchNode[], publishedList: Course[]): PathBranchNode[] {
  const out: PathBranchNode[] = [];
  const walk = (ns: PathBranchNode[]) => {
    for (const n of ns) {
      if (n.kind === 'divider') {
        out.push({ ...n, children: [] });
        if (n.children.length > 0) walk(n.children);
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
        issues.push('A divider cannot be a top-level module — move it under a module or delete it.');
      } else {
        issues.push(
          `Top-level rows must be an outline module or a catalog unit. “${display}” is a ${root.kind} row — use Change type, or add a module / unit at the top level first.`
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
        if (row.kind === 'divider') {
          for (const inner of row.children) {
            if (inner.children.length > 0) {
              issues.push(
                `Under divider “${branchNodeDisplayLabel(row, publishedList)}”, “${branchNodeDisplayLabel(inner, publishedList)}” has nested rows — only a flat list is allowed inside a divider group.`
              );
            }
            if (inner.kind === 'module') {
              issues.push(
                `Catalog units belong at the top level only — move “${branchNodeDisplayLabel(inner, publishedList)}” out from under “${secLabel}”.`
              );
            }
          }
          continue;
        }
        if (row.children.length > 0) {
          issues.push(
            `Under “${secLabel}”, “${branchNodeDisplayLabel(row, publishedList)}” has nested rows. Paths must be module → flat list only—flatten or remove nesting.`
          );
        }
        if (row.kind === 'module') {
          issues.push(
            `Catalog units belong at the top level only — move “${branchNodeDisplayLabel(row, publishedList)}” out from under “${secLabel}”.`
          );
        }
      }
    }
  }
  issues.push(...collectPathBranchSiblingTitleDuplicateIssues(roots, publishedList));
  return issues;
}

/** True if `id` is a root row in the outline (not nested under a section). */
function isRootBranchId(roots: PathBranchNode[], id: string): boolean {
  return roots.some((r) => r.id === id);
}

function updateNodeChildren(n: PathBranchNode, children: PathBranchNode[]): PathBranchNode {
  if (n.kind === 'divider') return { ...n, children };
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
      walk(n.children);
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
  return outlineVisibleToRolesVisibleToViewer(p, false, false);
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
        walk(n.children);
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

/**
 * Remove a section divider and splice its children into the parent list at the same index (outline “move up” out of the group).
 * Returns null if the divider id is not found.
 */
function hoistDividerChildrenInForest(roots: PathBranchNode[], dividerId: string): PathBranchNode[] | null {
  function hoistInList(siblings: PathBranchNode[]): PathBranchNode[] | null {
    const i = siblings.findIndex((c) => c.id === dividerId);
    if (i >= 0) {
      const d = siblings[i]!;
      if (d.kind !== 'divider') return null;
      return [...siblings.slice(0, i), ...d.children, ...siblings.slice(i + 1)];
    }
    let changed = false;
    const out = siblings.map((n) => {
      const inner = hoistInList(n.children);
      if (inner != null) {
        changed = true;
        return updateNodeChildren(n, inner);
      }
      return n;
    });
    return changed ? out : null;
  }
  return hoistInList(roots);
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
    const eb = n.dividerEyebrow?.trim();
    return {
      id: n.id,
      label: n.label.trim() || 'Untitled',
      children,
      kind: 'divider',
      ...(eb ? { dividerEyebrow: eb } : {}),
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
        lessonLabel = catalogMiniRichPlainText(les.title ?? '') || n.lessonId;
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

function branchNodeDisplayLabel(n: PathBranchNode, publishedList: readonly Course[]): string {
  if (n.kind === 'label') return n.label || 'Untitled';
  if (n.kind === 'divider') return n.label.trim() || 'Divider';
  if (n.kind === 'link') return n.label.trim() || n.href || 'Link';
  if (n.kind === 'module') {
    const c = publishedList.find((x) => x.id === n.courseId);
    const mod = courseModuleById(c, n.moduleId);
    if (c && mod) return `${c.title} · ${catalogMiniRichPlainText(mod.title ?? '') || n.moduleId}`;
    return catalogMiniRichPlainText(mod?.title ?? '') || n.moduleId || n.courseId;
  }
  if (n.kind === 'course') return publishedList.find((c) => c.id === n.courseId)?.title ?? n.courseId;
  const c = publishedList.find((x) => x.id === n.courseId);
  let t = n.lessonId;
  if (c) {
    for (const m of c.modules) {
      const les = m.lessons.find((l) => l.id === n.lessonId);
      if (les) {
        t = catalogMiniRichPlainText(les.title ?? '') || n.lessonId;
        break;
      }
    }
  }
  return t;
}

/** Case-insensitive plain text — duplicate title checks among sibling path rows (titles may store mini-HTML). */
function normPathBranchSiblingDisplayKey(display: string): string {
  return catalogMiniRichPlainText(display).toLowerCase();
}

function findFirstPathSiblingTitleDuplicatePair(
  siblings: PathBranchNode[],
  publishedList: Course[]
): { earlier: number; later: number } | null {
  const seen = new Map<string, number>();
  for (let i = 0; i < siblings.length; i += 1) {
    const key = normPathBranchSiblingDisplayKey(branchNodeDisplayLabel(siblings[i], publishedList));
    if (!key) continue;
    const ord = i + 1;
    const prevOrd = seen.get(key);
    if (prevOrd !== undefined) return { earlier: prevOrd, later: ord };
    seen.set(key, ord);
  }
  return null;
}

function pathSiblingTitleDuplicateMessage(parentDisplay: string, hit: { earlier: number; later: number }): string {
  return `Under “${parentDisplay}”, two rows share the same title — rename one (same name as row ${hit.earlier} and row ${hit.later}).`;
}

function collectPathBranchSiblingTitleDuplicateIssues(roots: PathBranchNode[], publishedList: Course[]): string[] {
  const issues: string[] = [];
  function visitChildLists(parentDisplay: string, children: PathBranchNode[]) {
    const dup = findFirstPathSiblingTitleDuplicatePair(children, publishedList);
    if (dup) issues.push(pathSiblingTitleDuplicateMessage(parentDisplay, dup));
    for (const ch of children) {
      if (ch.kind === 'divider' && ch.children.length > 0) {
        const sec = branchNodeDisplayLabel(ch, publishedList).trim() || 'Section';
        visitChildLists(sec, ch.children);
      }
    }
  }
  for (const root of roots) {
    if (!root.children.length) continue;
    if (root.kind === 'label' || root.kind === 'module' || root.kind === 'course') {
      visitChildLists(branchNodeDisplayLabel(root, publishedList), root.children);
    }
  }
  return issues;
}

/** When `parentId` is null (top-level row), titles may match other top-level modules — no sibling constraint. */
function pathSiblingTitleConflictAfterEdit(
  next: PathBranchNode[],
  parentId: string | null,
  publishedList: Course[]
): string | null {
  if (parentId === null) return null;
  const parent = findBranchNode(next, parentId);
  if (!parent) return null;
  const pd = branchNodeDisplayLabel(parent, publishedList);
  const dup = findFirstPathSiblingTitleDuplicatePair(parent.children, publishedList);
  return dup ? pathSiblingTitleDuplicateMessage(pd, dup) : null;
}

function findBranchNode(roots: PathBranchNode[], id: string): PathBranchNode | null {
  for (const n of roots) {
    if (n.id === id) return n;
    const sub = findBranchNode(n.children, id);
    if (sub) return sub;
  }
  return null;
}

/** Depth 0 = top-level root; used with {@link pathBranchRowHasExpandableNested} for accordion expand rules. */
function findBranchNodeDepth(
  roots: PathBranchNode[],
  id: string,
  depth = 0
): { node: PathBranchNode; depth: number } | null {
  for (const n of roots) {
    if (n.id === id) return { node: n, depth };
    const sub = findBranchNodeDepth(n.children, id, depth + 1);
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

/** Path from a top-level root to `targetId` (inclusive), or `null` if not found. */
function findBranchPath(roots: PathBranchNode[], targetId: string): PathBranchNode[] | null {
  for (const n of roots) {
    if (n.id === targetId) return [n];
    const sub = findBranchPath(n.children, targetId);
    if (sub) return [n, ...sub];
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

/** Top-level sections and divider rows may list child outline rows (divider groups are one extra level). */
function parentAllowsChildRows(roots: PathBranchNode[], parentId: string | null): boolean {
  if (parentId === null) return true;
  const p = findBranchNode(roots, parentId);
  if (p?.kind === 'divider') return true;
  return findDepthOfBranchId(roots, parentId) === 0;
}

/** Reassign every node id in a subtree (new IDs for Firestore). */
function remapBranchSubtreeIds(node: PathBranchNode): PathBranchNode {
  const walk = (n: PathBranchNode): PathBranchNode => {
    const id = newMindmapNodeId();
    if (n.kind === 'divider') {
      return { ...n, id, children: n.children.map(walk) };
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

/** Outline module or catalog row with no nested outline rows — copy may only be placed on the top-level list (see `collectPlaceParentOptions`). */
function leafOutlineModuleOrCatalogWithoutChildren(node: PathBranchNode): boolean {
  return (node.kind === 'label' || node.kind === 'module') && node.children.length === 0;
}

function countSubtreeRows(node: PathBranchNode): number {
  return 1 + node.children.reduce((sum, c) => sum + countSubtreeRows(c), 0);
}

/** Top-level rows that can accept child outline rows (dividers cannot). */
function topLevelParentsForDuplicate(roots: PathBranchNode[]): PathBranchNode[] {
  return roots.filter((r) => r.kind !== 'divider');
}

/** Section dividers under an outline module (and nested dividers) for copy/move placement — labels match catalog “section” wording. */
function collectDividerDuplicateParentsUnderSection(
  roots: PathBranchNode[],
  section: PathBranchNode,
  publishedList: Course[]
): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const sectionTitle = branchNodeDisplayLabel(section, publishedList);
  const walk = (prefix: string, nodes: PathBranchNode[]) => {
    for (const n of nodes) {
      if (n.kind !== 'divider') continue;
      if (!parentAllowsChildRows(roots, n.id)) continue;
      const path = `${prefix} · Divider: ${branchNodeDisplayLabel(n, publishedList)}`;
      out.push({ id: n.id, label: path });
      walk(path, n.children);
    }
  };
  walk(`Module: ${sectionTitle}`, section.children);
  return out;
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

function collectPlaceParentOptions(
  placeMode: 'copy' | 'move',
  sourceSnapshot: PathBranchNode,
  roots: PathBranchNode[],
  publishedList: Course[],
  topLevelOnly: boolean,
  forceNonRootPlacement: boolean
): { id: string | null; label: string }[] {
  const opts: { id: string | null; label: string }[] = [];
  if (!forceNonRootPlacement && (sourceSnapshot.kind === 'label' || sourceSnapshot.kind === 'module')) {
    opts.push({ id: null, label: 'Top of outline' });
  }
  if (topLevelOnly) return opts;
  for (const r of topLevelParentsForDuplicate(roots)) {
    if (!parentAllowsChildRows(roots, r.id)) continue;
    opts.push({
      id: r.id,
      label: `Module: ${branchNodeDisplayLabel(r, publishedList)}`,
    });
    if (r.kind === 'label') {
      opts.push(...collectDividerDuplicateParentsUnderSection(roots, r, publishedList));
    }
  }

  const hideDividerTargets =
    sourceSnapshot.kind === 'module' || duplicateSubtreeRequiresTopLevelOnly(sourceSnapshot);
  const moveDescendants =
    placeMode === 'move' ? collectDescendantBranchIds(roots, sourceSnapshot.id) : null;

  return opts.filter((o) => {
    if (o.id === null) return true;
    const node = findBranchNode(roots, o.id);
    if (!node) return false;
    if (hideDividerTargets && node.kind === 'divider') return false;
    if (moveDescendants != null && moveDescendants.has(o.id)) return false;
    if (placeMode === 'move' && o.id === sourceSnapshot.id) return false;
    return true;
  });
}

function outlineNodeKindShortLabel(n: PathBranchNode): string {
  switch (n.kind) {
    case 'label':
      return 'Module';
    case 'module':
      return 'Catalog';
    case 'divider':
      return 'Section';
    case 'link':
      return 'Link';
    case 'course':
      return 'Course';
    case 'lesson':
      return 'Lesson';
  }
}

/** Outline module / link / divider rows can get a distinct title on duplicate; course & lesson titles come from the catalog. */
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
  const finalLabel = trimmed.length > 0 ? trimmed : base;
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

type PlaceBranchRememberedInsert =
  | { kind: 'end' }
  | { kind: 'index'; value: number };

function PlaceDuplicateBranchModal({
  open,
  onClose,
  sourceSnapshot,
  roots,
  publishedList,
  defaultTopParentId,
  initialMode: _initialMode,
  initialParentId,
  initialInsert,
  fixedMode,
  forceNonRootPlacement,
  onRemember,
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
  /** Optional: restore the last-used mode (copy/move) when opening (ignored when fixedMode is set). */
  initialMode?: 'move' | 'copy';
  /** Optional: restore the last-used destination parent for the active mode. */
  initialParentId?: string | null;
  /** Optional: restore the last-used insert position for the active mode. */
  initialInsert?: PlaceBranchRememberedInsert | null;
  /** Optional: lock the dialog in one mode (used by change-type placement). */
  fixedMode?: 'move' | 'copy';
  /** Optional: disallow placing at root (used when top-level types are invalid). */
  forceNonRootPlacement?: boolean;
  /** Optional: persist last-used mode/selection for the next open. */
  onRemember?: (prefs: { parentId: string | null; insert: PlaceBranchRememberedInsert }) => void;
  onCommit: (parentId: string | null, insertIndex: number, payload: PlaceBranchCommitPayload) => void;
}) {
  const subtreeForcesTopLevelOnly = duplicateSubtreeRequiresTopLevelOnly(sourceSnapshot);
  const leafModuleOrCatalogNoNested = leafOutlineModuleOrCatalogWithoutChildren(sourceSnapshot);
  /** Restrict destination parent to the top-level outline (not inside a module or divider). */
  const placementTopOutlineOnly =
    subtreeForcesTopLevelOnly || (!forceNonRootPlacement && leafModuleOrCatalogNoNested);
  /** Leaf outline/catalog row with no children: only Copy at top level from this dialog (reorder with ↑↓). */
  const copyOnlyAtTopFromDialog =
    !forceNonRootPlacement && leafModuleOrCatalogNoNested && !subtreeForcesTopLevelOnly;
  const [parentId, setParentId] = useState<string | null>(null);
  const [insertIndex, setInsertIndex] = useState(0);
  const [copyNameInput, setCopyNameInput] = useState('');
  /** Bumps when the copy name field is (re)seeded so layout can focus + select all after DOM matches state. */
  const [copyNameFocusKey, setCopyNameFocusKey] = useState(0);
  const copyNameInputRef = useRef<HTMLInputElement>(null);

  const rootsRef = useRef(roots);
  rootsRef.current = roots;

  const parentOptions = useMemo(
    () =>
      collectPlaceParentOptions(
        'copy',
        sourceSnapshot,
        roots,
        publishedList,
        placementTopOutlineOnly,
        forceNonRootPlacement
      ),
    [sourceSnapshot, roots, publishedList, placementTopOutlineOnly, forceNonRootPlacement]
  );

  const parentOptionsMove = useMemo(
    () =>
      collectPlaceParentOptions(
        'move',
        sourceSnapshot,
        roots,
        publishedList,
        placementTopOutlineOnly,
        forceNonRootPlacement
      ),
    [sourceSnapshot, roots, publishedList, placementTopOutlineOnly, forceNonRootPlacement]
  );

  const effectiveParentId = placementTopOutlineOnly ? null : parentId;

  const siblings = useMemo(() => {
    if (effectiveParentId === null) return roots;
    const p = findBranchNode(roots, effectiveParentId);
    return p?.children ?? [];
  }, [roots, effectiveParentId]);

  /** Only when the dialog opens or the duplicate source changes — not on every outline edit (avoids resetting Top parent and showing stale sibling labels). */
  useEffect(() => {
    if (!open) return;
    if (placementTopOutlineOnly) {
      setParentId(null);
      return;
    }
    const r = rootsRef.current;
    const isValidParent = (candidate: string | null) => {
      if (candidate == null) return true;
      const n = findBranchNode(r, candidate);
      if (!n) return false;
      if (!parentAllowsChildRows(r, candidate)) return false;
      if (!(findDepthOfBranchId(r, candidate) === 0 || n.kind === 'divider')) return false;
      if (sourceSnapshot.kind === 'module' && n.kind === 'divider') return false;
      if (duplicateSubtreeRequiresTopLevelOnly(sourceSnapshot) && n.kind === 'divider') return false;
      return true;
    };

    if (initialParentId !== undefined && isValidParent(initialParentId ?? null)) {
      setParentId(initialParentId ?? null);
      return;
    }

    const defNode = defaultTopParentId != null ? findBranchNode(r, defaultTopParentId) : null;
    const validDefault =
      defaultTopParentId != null &&
      defNode != null &&
      parentAllowsChildRows(r, defaultTopParentId) &&
      (findDepthOfBranchId(r, defaultTopParentId) === 0 || defNode.kind === 'divider');
    setParentId(validDefault ? defaultTopParentId : null);
  }, [
    open,
    sourceSnapshot.id,
    placementTopOutlineOnly,
    defaultTopParentId,
    initialParentId,
    forceNonRootPlacement,
  ]);

  /** If the selected parent disappears or becomes invalid (tree reload, divider rules), clear it. */
  useEffect(() => {
    if (!open || placementTopOutlineOnly) return;
    setParentId((prev) => {
      if (prev == null) return null;
      const r = rootsRef.current;
      const n = findBranchNode(r, prev);
      let valid =
        n != null &&
        parentAllowsChildRows(r, prev) &&
        (findDepthOfBranchId(r, prev) === 0 || n.kind === 'divider');
      if (!valid) return null;
      if (sourceSnapshot.kind === 'module' && n.kind === 'divider') return null;
      if (duplicateSubtreeRequiresTopLevelOnly(sourceSnapshot) && n.kind === 'divider') return null;
      return prev;
    });
  }, [roots, open, placementTopOutlineOnly, sourceSnapshot.id, sourceSnapshot.kind]);

  useEffect(() => {
    if (!open) return;
    const wanted =
      initialInsert?.kind === 'end'
        ? siblings.length
        : initialInsert?.kind === 'index'
          ? initialInsert.value
          : siblings.length;
    setInsertIndex(Math.max(0, Math.min(wanted, siblings.length)));
  }, [open, effectiveParentId, siblings.length, initialInsert]);

  useEffect(() => {
    if (!open) return;
    const clampedIdx = Math.max(0, Math.min(insertIndex, siblings.length));
    onRemember?.({
      parentId: effectiveParentId,
      insert:
        clampedIdx >= siblings.length ? { kind: 'end' } : { kind: 'index', value: clampedIdx },
    });
  }, [open, onRemember, effectiveParentId, insertIndex, siblings.length]);

  useEffect(() => {
    if (!open) {
      setCopyNameInput('');
      setCopyNameFocusKey(0);
      return;
    }
    if (duplicateRootHasEditableTitle(sourceSnapshot)) {
      setCopyNameInput(duplicateRootEditableTitleBase(sourceSnapshot, publishedList));
      setCopyNameFocusKey((k) => k + 1);
    } else {
      setCopyNameInput('');
      setCopyNameFocusKey(0);
    }
  }, [open, sourceSnapshot.id, sourceSnapshot, publishedList]);

  useLayoutEffect(() => {
    if (!open || fixedMode || !duplicateRootHasEditableTitle(sourceSnapshot)) return;
    if (copyNameFocusKey === 0) return;
    const el = copyNameInputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const len = el.value.length;
    if (len > 0) {
      el.setSelectionRange(0, len);
    }
  }, [open, fixedMode, sourceSnapshot.id, sourceSnapshot.kind, copyNameFocusKey]);

  /** Remount selects when sibling titles change so option text never stays stale (browser/React edge cases). */
  const positionSelectKey = useMemo(
    () =>
      siblings.map((n) => `${n.id}:${branchNodeDisplayLabel(n, publishedList)}`).join('|'),
    [siblings, publishedList]
  );

  const placeDupOrderOptions = useMemo(
    () =>
      Array.from({ length: siblings.length + 1 }, (_, i) => ({
        value: String(i),
        label: insertSlotLabel(siblings, i, publishedList),
      })),
    [siblings, publishedList, positionSelectKey]
  );

  const copyNamePlaceholder = useMemo(() => {
    if (sourceSnapshot.kind === 'label') return 'Enter module name…';
    if (sourceSnapshot.kind === 'divider') return 'Enter divider text…';
    return 'Enter link title…';
  }, [sourceSnapshot.kind]);

  const showCopyNameField = !fixedMode && duplicateRootHasEditableTitle(sourceSnapshot);

  useDialogKeyboard({ open, onClose });

  if (!open) return null;

  const summary = branchNodeDisplayLabel(sourceSnapshot, publishedList);
  const totalRows = countSubtreeRows(sourceSnapshot);
  const canCommit =
    parentOptions.length > 0 && parentOptions.some((o) => o.id === effectiveParentId);
  const moveTargetOk = parentOptionsMove.some((o) => o.id === effectiveParentId);
  const moveDisabledDuplicateDialog = !canCommit || !moveTargetOk || copyOnlyAtTopFromDialog;
  const moveTitleDuplicateDialog =
    copyOnlyAtTopFromDialog
      ? 'This outline module or catalog row has no nested rows — only Copy on the top-level outline applies here. Use the row ↑↓ controls to move it.'
      : !canCommit || !moveTargetOk
        ? 'This destination is valid for a copy, but you cannot move the branch into its own subtree. Go up in the list or change destination.'
        : undefined;
  const validDestinationFolderIds = new Set(
    parentOptions.map((o) => o.id).filter((id): id is string => id !== null)
  );
  const sourceInTree = findBranchNode(roots, sourceSnapshot.id);
  const sourceParentInTree = sourceInTree ? findParentIdOfBranch(roots, sourceSnapshot.id) : null;
  const destinationBreadcrumb = effectiveParentId
    ? findBranchPath(roots, effectiveParentId)
    : null;
  const upOneId =
    effectiveParentId == null || placementTopOutlineOnly
      ? null
      : findParentIdOfBranch(roots, effectiveParentId);
  const subtreeHint =
    effectiveParentId === null
      ? 'Order among top-level rows.'
      : (() => {
          const p = findBranchNode(roots, effectiveParentId);
          if (!p) return '';
          if (p.kind === 'divider') {
            return `Order among rows inside the divider group “${branchNodeDisplayLabel(p, publishedList)}”.`;
          }
          return `Order among rows inside “${branchNodeDisplayLabel(p, publishedList)}”.`;
        })();

  const insertIdx = Math.min(insertIndex, siblings.length);
  const primaryCtaClass =
    'inline-flex min-h-11 min-w-0 flex-1 touch-manipulation items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-40 sm:min-w-[6.5rem] sm:flex-none';
  const gdriveBlue = 'bg-[#1a73e8] hover:bg-[#1557b0]';

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-[#272828]/70 p-0 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="place-duplicate-branch-title"
        className="relative flex min-h-0 max-h-[min(92dvh,640px)] w-full max-w-2xl flex-col rounded-t-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl sm:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          className="absolute right-2 top-2 z-10 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]"
          onClick={onClose}
        >
          <X size={22} aria-hidden />
        </button>
        <div className="shrink-0 border-b border-[var(--border-color)] px-4 pb-3 pl-3 pr-12 pt-3 sm:pl-4">
          <h2
            id="place-duplicate-branch-title"
            className="min-w-0 pr-0 text-left text-sm font-bold leading-tight text-[var(--text-primary)] sm:text-base"
          >
            {fixedMode === 'move' ? (
              <span>Move “{summary}”</span>
            ) : (
              <span>
                <span className="font-normal text-[var(--text-secondary)]">Copy or move </span>
                <span className="line-clamp-2">“{summary}”</span>
              </span>
            )}
          </h2>
          {sourceInTree ? (
            <>
              <p className="mt-1.5 text-left text-xs text-[var(--text-muted)]">Current location:</p>
              <div className="mt-1.5">
                <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)]/45 px-2.5 py-1 text-xs text-[var(--text-secondary)]">
                  <Folder size={14} className="shrink-0 opacity-85" aria-hidden />
                  <span className="min-w-0 truncate">
                    {sourceParentInTree == null
                      ? 'Path outline (top level)'
                      : branchNodeDisplayLabel(findBranchNode(roots, sourceParentInTree)!, publishedList)}
                  </span>
                </span>
              </div>
            </>
          ) : (
            <p className="mt-2 text-left text-xs text-[var(--text-muted)]">Choose where to place this row in the path outline.</p>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {showCopyNameField ? (
            <div className="shrink-0 border-b border-[var(--border-color)]/70 px-3 py-3 sm:px-4">
              <label className="block text-xs font-semibold text-[var(--text-secondary)]" htmlFor="place-dup-copy-name">
                Name for the duplicate
              </label>
              <p id="place-dup-copy-name-hint" className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                Used if you press <strong className="text-[var(--text-secondary)]">Copy</strong> below. Move ignores this field.
              </p>
              <input
                ref={copyNameInputRef}
                id="place-dup-copy-name"
                type="text"
                value={copyNameInput}
                onChange={(e) => setCopyNameInput(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                placeholder={copyNamePlaceholder}
                aria-describedby="place-dup-copy-name-hint"
                className={`mt-1.5 ${PATH_BRANCH_SINGLE_LINE_INPUT_CLASS} font-normal`}
                autoComplete="off"
              />
            </div>
          ) : null}

          {parentOptions.length === 0 ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
              <p className="rounded-lg border border-[#616161]/80 bg-[#757676]/12 px-3 py-2 text-xs leading-relaxed text-[var(--text-primary)]">
                No valid placement target. Top-level outline only accepts outline modules or catalog units — fix the branch
                type or outline structure first.
              </p>
            </div>
          ) : (
            <>
              <div className="shrink-0 space-y-0 px-3 pt-3 sm:px-4">
              <p className="mb-1 text-[11px] leading-relaxed text-[var(--text-muted)] sm:text-xs">
                {placementTopOutlineOnly ? (
                  <>
                    Destination is the <strong className="text-[var(--text-secondary)]">top-level</strong> path outline
                    only — set order below. Copy adds new outline ids.
                    {copyOnlyAtTopFromDialog ? ' Move is not available here; use the row ↑↓ controls to change position.' : ''}
                  </>
                ) : (
                  <>
                    Open a folder in the list to set <strong className="text-[var(--text-secondary)]">Destination</strong>
                    , then set order. Copy adds new outline ids; Move keeps the same ids.
                  </>
                )}
                {totalRows > 1 ? ` (${totalRows} rows in this branch, including nested.)` : null}
              </p>
              {subtreeForcesTopLevelOnly ? (
                <p className="mb-3 mt-1 rounded-lg border border-[#8b8c8c]/70 bg-[#757676]/12 px-3 py-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                  This branch has nested rows, so it can only be placed in the <strong>top-level</strong> outline (two
                  levels max: module → sub-rows).
                </p>
              ) : null}
              {copyOnlyAtTopFromDialog ? (
                <p className="mb-3 mt-1 rounded-lg border border-[#8b8c8c]/70 bg-[#757676]/12 px-3 py-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                  This outline module or catalog row has no nested rows — you can only place a <strong>copy</strong> on the
                  top-level outline. Use the row ↑↓ controls if you need to change its position.
                </p>
              ) : null}
              {placementTopOutlineOnly ? null : upOneId !== null && effectiveParentId !== null ? (
                <div className="mb-1">
                  <button
                    type="button"
                    onClick={() => setParentId(upOneId)}
                    className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-1.5 text-sm text-[#8ab4f8] hover:underline"
                  >
                    <ChevronLeft size={18} className="shrink-0" aria-hidden />
                    <span className="min-w-0 truncate">One level up</span>
                  </button>
                </div>
              ) : null}
              {placementTopOutlineOnly ? null : (
                <div className="mb-3 min-w-0 overflow-x-auto border-b border-[var(--border-color)] pb-2">
                  <nav
                    className="flex min-w-0 flex-wrap items-center gap-x-0.5 gap-y-1 text-xs text-[var(--text-secondary)]"
                    aria-label="Destination path"
                  >
                    <button
                      type="button"
                      className="shrink-0 text-[#8ab4f8] hover:underline"
                      onClick={() => setParentId(null)}
                    >
                      Path outline
                    </button>
                    {destinationBreadcrumb
                      ? destinationBreadcrumb.map((node) => {
                          const isLast = node.id === effectiveParentId;
                          return (
                            <Fragment key={node.id}>
                              <span className="text-[var(--text-muted)]" aria-hidden>
                                &gt;{' '}
                              </span>
                              <button
                                type="button"
                                disabled={isLast}
                                onClick={() => {
                                  if (!isLast) setParentId(node.id);
                                }}
                                className={`min-w-0 max-w-[9rem] truncate text-left sm:max-w-[12rem] ${
                                  isLast
                                    ? 'font-semibold text-[var(--text-primary)]'
                                    : 'text-[#8ab4f8] hover:underline'
                                }`}
                              >
                                {branchNodeDisplayLabel(node, publishedList)}
                              </button>
                            </Fragment>
                          );
                        })
                      : null}
                  </nav>
                </div>
              )}
              </div>

              <div className="mx-3 flex min-h-0 min-w-0 flex-1 flex-col sm:mx-4">
              <div className="mb-0.5 grid shrink-0 grid-cols-[minmax(0,1fr)_4.5rem_auto] gap-1.5 border-b border-[var(--border-color)]/90 pb-1.5 pl-0.5 pr-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] sm:text-xs">
                <div>Name</div>
                <div className="text-left">Type</div>
                <div className="w-4 shrink-0" aria-hidden />
              </div>
              <ul className={ADMIN_EMBEDDED_SCROLL_LIST_DIVIDED}>
                {siblings.length === 0 ? (
                  <li className={`block ${CUSTOM_LISTBOX_LOADING} text-[var(--text-secondary)]`}>
                    Empty here — the branch will be the first in this list.
                  </li>
                ) : null}
                {siblings.map((s) => {
                  const canDrill = !placementTopOutlineOnly && validDestinationFolderIds.has(s.id);
                  const name = branchNodeDisplayLabel(s, publishedList);
                  const rowIcon =
                    s.kind === 'module' || s.kind === 'label' || s.kind === 'divider' ? (
                      <Folder size={16} className="opacity-80" aria-hidden />
                    ) : s.kind === 'link' ? (
                      <Link2 size={16} className="opacity-80" aria-hidden />
                    ) : (
                      <FileText size={16} className="opacity-80" aria-hidden />
                    );
                  return (
                    <li key={s.id} className="min-w-0">
                      <button
                        type="button"
                        disabled={!canDrill}
                        onClick={() => {
                          if (canDrill) setParentId(s.id);
                        }}
                        className={`grid w-full min-w-0 grid-cols-[minmax(0,1fr)_4.5rem_auto] items-center gap-1.5 px-2 py-1.5 text-left text-sm leading-none ${
                          canDrill ? 'hover:bg-[var(--hover-bg)]' : 'cursor-default opacity-80'
                        }`}
                        title={canDrill ? 'View contents' : undefined}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="shrink-0 text-[var(--text-muted)]">{rowIcon}</span>
                          <span className="min-w-0 truncate text-[var(--text-primary)]">{name}</span>
                        </span>
                        <span className="shrink-0 text-[10px] text-[var(--text-muted)] sm:text-xs">
                          {outlineNodeKindShortLabel(s)}
                        </span>
                        <span
                          className="flex w-4 shrink-0 items-center justify-end text-[var(--text-muted)]"
                          aria-hidden
                        >
                          {canDrill ? <ChevronRight size={16} /> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              </div>

              <p className="shrink-0 px-3 pt-1.5 text-[10px] leading-snug text-[var(--text-muted)] min-[400px]:hidden sm:px-4">
                When a row shows ›, tap to open that folder, then set order.
              </p>

              <div className="shrink-0 border-t border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-3 shadow-[0_-6px_16px_rgba(0,0,0,0.18)] sm:px-4">
                <label className="block text-xs font-semibold text-[var(--text-secondary)]" htmlFor="place-dup-index">
                  Order in this list
                </label>
                <p id="place-dup-subtree-hint" className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                  {subtreeHint}
                </p>
                <AdminListboxSelect
                  key={positionSelectKey}
                  id="place-dup-index"
                  aria-describedby="place-dup-subtree-hint"
                  value={String(insertIdx)}
                  onChange={(next) => setInsertIndex(Number(next))}
                  options={placeDupOrderOptions}
                  placeholder="Order in list"
                  triggerClassName={`mt-1.5 w-full min-w-0 ${PATH_BRANCH_COMPACT_SELECT_CLASS}`}
                />
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-[var(--border-color)] px-3 py-3 sm:px-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 w-full min-w-0 text-center text-sm font-medium text-[#8ab4f8] hover:underline sm:order-1 sm:mr-auto sm:w-auto"
            >
              Cancel
            </button>
            {fixedMode === 'move' ? (
              <button
                type="button"
                title={!canCommit || !moveTargetOk ? 'Pick a valid destination in this outline for a move, or re-open the list.' : undefined}
                disabled={!canCommit || !moveTargetOk}
                onClick={() => onCommit(effectiveParentId, insertIdx, { mode: 'move', sourceId: sourceSnapshot.id })}
                className={`${primaryCtaClass} ${gdriveBlue}`}
              >
                <ArrowRightLeft size={16} className="shrink-0 opacity-95" aria-hidden />
                Move
              </button>
            ) : fixedMode === 'copy' ? (
              <button
                type="button"
                disabled={!canCommit}
                onClick={() => {
                  const remapped = remapBranchSubtreeIds(deepClone(sourceSnapshot));
                  const named = applyCopyNameToBranchRoot(remapped, copyNameInput, publishedList);
                  onCommit(effectiveParentId, insertIdx, { mode: 'copy', branch: named });
                }}
                className={`${primaryCtaClass} ${gdriveBlue}`}
              >
                <Copy size={16} className="shrink-0 opacity-95" aria-hidden />
                Copy
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!canCommit}
                  onClick={() => {
                    const remapped = remapBranchSubtreeIds(deepClone(sourceSnapshot));
                    const named = applyCopyNameToBranchRoot(remapped, copyNameInput, publishedList);
                    onCommit(effectiveParentId, insertIdx, { mode: 'copy', branch: named });
                  }}
                  className={`${primaryCtaClass} ${gdriveBlue}`}
                >
                  <Copy size={16} className="shrink-0 opacity-95" aria-hidden />
                  Copy
                </button>
                <button
                  type="button"
                  title={moveTitleDuplicateDialog}
                  disabled={moveDisabledDuplicateDialog}
                  onClick={() => onCommit(effectiveParentId, insertIdx, { mode: 'move', sourceId: sourceSnapshot.id })}
                  className={`${primaryCtaClass} ${gdriveBlue}`}
                >
                  <ArrowRightLeft size={16} className="shrink-0 opacity-95" aria-hidden />
                  Move
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlaceConvertedTopLevelModal({
  open,
  onClose,
  converted,
  roots,
  publishedList,
  onCommit,
}: {
  open: boolean;
  onClose: () => void;
  converted: PathBranchNode;
  roots: PathBranchNode[];
  publishedList: Course[];
  onCommit: (insertIndex: number) => void;
}) {
  const [insertIndex, setInsertIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setInsertIndex(roots.length);
  }, [open, roots.length]);

  useDialogKeyboard({ open, onClose });

  const placeConvertedTopLevelOptions = useMemo(
    () => [
      { value: '0', label: 'Top of outline' },
      ...roots.map((r, idx) => ({
        value: String(idx + 1),
        label: branchNodeDisplayLabel(r, publishedList),
      })),
    ],
    [roots, publishedList]
  );

  if (!open) return null;

  const rows = roots;
  const summary = branchNodeDisplayLabel(converted, publishedList);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-[#272828]/70 p-0 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="place-converted-top-level-title"
        className="flex max-h-[min(90dvh,520px)] w-full max-w-lg flex-col rounded-t-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl sm:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
          <h2
            id="place-converted-top-level-title"
            className="min-w-0 flex-1 text-center text-base font-bold text-[var(--text-primary)] sm:text-lg"
          >
            Place module
          </h2>
          <button
            type="button"
            aria-label="Close"
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]"
            onClick={onClose}
          >
            <X size={22} aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          <p className="mb-3 text-xs leading-relaxed text-[var(--text-muted)]">
            You changed <strong className="text-[var(--text-secondary)]">{summary}</strong> into a module. Modules can only
            live at the <strong>top level</strong> of the outline—choose where to place it.
          </p>

          <label className="block text-xs font-semibold text-[var(--text-secondary)]" htmlFor="place-converted-top-level">
            After
          </label>
          <AdminListboxSelect
            id="place-converted-top-level"
            value={String(insertIndex)}
            onChange={(next) => {
              const n = parseInt(next, 10);
              setInsertIndex(Number.isFinite(n) ? n : rows.length);
            }}
            options={placeConvertedTopLevelOptions}
            placeholder="Placement"
            triggerClassName={`mt-1.5 ${PATH_BRANCH_COMPACT_SELECT_CLASS}`}
          />

          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-5 py-3 text-sm font-bold text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] sm:w-auto"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onCommit(Math.max(0, Math.min(insertIndex, rows.length)))}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#616161] px-5 py-3 text-sm font-bold text-[#e7e7e7] transition-colors hover:bg-[#757676] sm:w-auto"
            >
              Place module
            </button>
          </div>
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

/** First index at or after `from` that is a path section divider, or `L` if none (end of child list). */
function indexOfNextPathDividerOrEnd(children: readonly PathBranchNode[], from: number): number {
  let j = from;
  while (j < children.length && children[j]!.kind !== 'divider') j += 1;
  return j;
}

function dedupePathOutlineMergePositions(
  opts: { insertAt: number; label: string }[]
): { insertAt: number; label: string }[] {
  const seen = new Set<number>();
  const out: { insertAt: number; label: string }[] = [];
  for (const o of opts) {
    if (seen.has(o.insertAt)) continue;
    seen.add(o.insertAt);
    out.push(o);
  }
  return out;
}

/**
 * Insert positions when merging one top-level outline module (`label`) into another as a nested **section divider**
 * holding the source’s nested rows — mirrors the course catalog “Change module type” / “Place divider … after” UX.
 */
function pathOutlineMergePositionOptions(
  targetSection: PathBranchNode,
  publishedList: Course[]
): { insertAt: number; label: string }[] {
  if (targetSection.kind !== 'label') return [];
  const children = targetSection.children;
  const L = children.length;
  if (L === 0) {
    return [{ insertAt: 0, label: 'Only position in this outline section' }];
  }
  const out: { insertAt: number; label: string }[] = [];
  out.push({ insertAt: 0, label: 'Start of section (before first row)' });
  for (let i = 0; i < L; i++) {
    const row = children[i]!;
    if (row.kind === 'divider') {
      const raw = branchNodeDisplayLabel(row, publishedList).trim();
      const t = raw.length > 0 ? raw : 'Untitled divider';
      const insertAt = indexOfNextPathDividerOrEnd(children, i + 1);
      out.push({
        insertAt,
        label: `After section “${t}” (after its rows, before next divider)`,
      });
    }
  }
  if (!out.some((o) => o.insertAt === L)) {
    out.push({ insertAt: L, label: 'End of section (after last row)' });
  }
  return dedupePathOutlineMergePositions(out);
}

/** Merge top-level outline module `sourceId` into top-level outline module `targetId` as a new divider row + moved children. */
function applyMergeOutlineLabelIntoDividerAt(
  roots: PathBranchNode[],
  sourceId: string,
  targetId: string,
  insertAt: number
): PathBranchNode[] | null {
  if (sourceId === targetId) return null;
  const srcIdx = roots.findIndex((r) => r.id === sourceId);
  const tgtIdx = roots.findIndex((r) => r.id === targetId);
  if (srcIdx < 0 || tgtIdx < 0) return null;
  const src = roots[srcIdx]!;
  const tgt = roots[tgtIdx]!;
  if (src.kind !== 'label' || tgt.kind !== 'label') return null;
  if (insertAt < 0 || insertAt > tgt.children.length) return null;

  const vis =
    src.visibleToRoles !== undefined ? ({ visibleToRoles: src.visibleToRoles } as const) : {};
  const newDivider: PathBranchNode = {
    id: newMindmapNodeId(),
    kind: 'divider',
    label: src.label.trim() || 'Section',
    children: [...src.children],
    ...vis,
  };

  const newTargetChildren = [
    ...tgt.children.slice(0, insertAt),
    newDivider,
    ...tgt.children.slice(insertAt),
  ];
  const newTarget: PathBranchNode = { ...tgt, children: newTargetChildren };

  return roots
    .map((r, i) => (i === tgtIdx ? newTarget : r))
    .filter((r) => r.id !== sourceId);
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

/** Collapse sibling branches (and their open descendants); expand `id` when it may show nested outline (incl. empty top-level modules). */
function accordionExpandBranchRow(prev: Set<string>, tree: PathBranchNode[], id: string): Set<string> {
  const located = findBranchNodeDepth(tree, id);
  const siblings = findSiblingBranchIds(tree, id);
  const next = new Set(prev);
  if (siblings) {
    for (const sid of siblings) {
      if (sid !== id) stripBranchExpandState(next, tree, sid);
    }
  }
  if (located && pathBranchRowHasExpandableNested(located.node, located.depth)) {
    next.add(id);
  }
  return next;
}

/** Total outline rows (every branch node, including nested). */
function countPathBranchTreeNodes(nodes: readonly PathBranchNode[]): number {
  let n = 0;
  for (const node of nodes) {
    n += 1;
    n += countPathBranchTreeNodes(node.children);
  }
  return n;
}

/** Restore admin branch tree from Firestore mind map nodes. */
function mindmapNodeToPathBranch(n: MindmapTreeNode): PathBranchNode {
  const children = n.children.map(mindmapNodeToPathBranch);
  const vis = pathBranchVisibilityFromMindmap(n);
  if (n.kind === 'divider') {
    const eb = n.dividerEyebrow?.trim();
    return {
      id: n.id,
      kind: 'divider',
      label: n.label,
      children,
      ...vis,
      ...(eb ? { dividerEyebrow: eb } : {}),
    };
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

const PATH_OUTLINE_MERGE_SELECT_CLASS =
  'min-h-11 w-full max-w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[#8b8c8c]/80 focus:ring-2 focus:ring-[#a1a2a2]/25';

/** Catalog-style “Change module type” for top-level outline modules: merge into another section as a divider + nested rows. */
function ChangePathOutlineModuleMergeModal({
  open,
  sourceId,
  roots,
  publishedList,
  onClose,
  onConfirm,
  onPickOtherType,
}: {
  open: boolean;
  sourceId: string;
  roots: PathBranchNode[];
  publishedList: Course[];
  onClose: () => void;
  onConfirm: (targetId: string, insertAt: number) => void;
  onPickOtherType: () => void;
}) {
  const targets = useMemo(
    () => roots.filter((r) => r.kind === 'label' && r.id !== sourceId),
    [roots, sourceId]
  );

  const [targetId, setTargetId] = useState('');
  const [insertAt, setInsertAt] = useState(0);

  useEffect(() => {
    if (!open || targets.length === 0) return;
    setTargetId((prev) => (targets.some((t) => t.id === prev) ? prev : targets[0]!.id));
  }, [open, targets]);

  const targetNode = useMemo(
    () => targets.find((t) => t.id === targetId) ?? targets[0] ?? null,
    [targets, targetId]
  );

  const positionOptions = useMemo(() => {
    if (!targetNode) return [] as { insertAt: number; label: string }[];
    return pathOutlineMergePositionOptions(targetNode, publishedList);
  }, [targetNode, publishedList]);

  useEffect(() => {
    if (!open || !targetNode || positionOptions.length === 0) return;
    setInsertAt((prev) => (positionOptions.some((o) => o.insertAt === prev) ? prev : positionOptions[0]!.insertAt));
  }, [open, targetNode, positionOptions, targetId]);

  const mergeTargetListboxOptions = useMemo(
    () => targets.map((t) => ({ value: t.id, label: branchNodeDisplayLabel(t, publishedList) })),
    [targets, publishedList]
  );
  const mergeInsertListboxOptions = useMemo(
    () => positionOptions.map((o) => ({ value: String(o.insertAt), label: o.label })),
    [positionOptions]
  );

  useDialogKeyboard({ open, onClose });

  if (!open) return null;

  const mergeDialogShell = (body: React.ReactNode) => (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-[#272828]/70 p-0 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="path-outline-merge-module-title"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="flex max-h-[min(90dvh,640px)] w-full max-w-lg flex-col rounded-t-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl sm:max-h-[min(85dvh,560px)] sm:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
          <span className="w-10 shrink-0" aria-hidden />
          <h2
            id="path-outline-merge-module-title"
            className="min-w-0 flex-1 text-center text-base font-bold text-[var(--text-primary)] sm:text-lg"
          >
            Change module type
          </h2>
          <button
            type="button"
            aria-label="Close"
            className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]"
            onClick={onClose}
          >
            <X size={22} aria-hidden />
          </button>
        </div>
        {body}
      </motion.div>
    </div>
  );

  if (targets.length === 0) {
    return mergeDialogShell(
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
        <p className="text-xs leading-relaxed text-[var(--text-muted)]">
          Add another <span className="font-semibold text-[var(--text-secondary)]">top-level outline module</span> first
          (use <span className="font-semibold text-[var(--text-secondary)]">Add module here</span> in a gutter) — then you
          can merge this section into it as a <span className="font-semibold text-[var(--text-secondary)]">section divider</span>
          , same as <span className="font-semibold text-[var(--text-secondary)]">Change module type</span> in the course
          catalog. Or pick another branch type for this row below.
        </p>
        <button
          type="button"
          className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5 text-center text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
          onClick={onPickOtherType}
        >
          Pick a different branch type instead…
        </button>
      </div>
    );
  }

  if (!targetNode) return null;

  return mergeDialogShell(
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
      <p className="text-xs leading-relaxed text-[var(--text-muted)]">
        This module’s title becomes a <span className="font-semibold text-[var(--text-secondary)]">section divider</span>{' '}
        inside the module you pick. All nested rows from this outline section move under that divider. This top-level
        module is removed — same idea as merging a course catalog module into another as a section divider.
      </p>
      <div className="space-y-3">
        <label className="block min-w-0">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
            Merge into module
          </span>
          <AdminListboxSelect
            id="path-outline-merge-target"
            value={targetId}
            onChange={setTargetId}
            options={mergeTargetListboxOptions}
            placeholder="Target module"
            triggerClassName={PATH_OUTLINE_MERGE_SELECT_CLASS}
          />
        </label>
        <label className="block min-w-0">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
            Place divider and lessons after
          </span>
          <AdminListboxSelect
            id="path-outline-merge-insert"
            value={String(insertAt)}
            onChange={(next) => setInsertAt(Number(next))}
            options={mergeInsertListboxOptions}
            placeholder="Position"
            triggerClassName={PATH_OUTLINE_MERGE_SELECT_CLASS}
          />
        </label>
      </div>
      <button
        type="button"
        className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-[#8b8c8c]/80 hover:bg-[var(--hover-bg)]"
        onClick={() => onConfirm(targetId, insertAt)}
      >
        <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
          <Minus size={20} className="shrink-0 text-[#616161] app-dark:text-[#a1a2a2]" aria-hidden />
          Merge as section divider
          <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">Confirm</span>
        </span>
        <span className="pl-8 text-xs text-[var(--text-muted)]">
          Same learner outline behavior as changing a lesson row to a section divider in the catalog.
        </span>
      </button>
      <button
        type="button"
        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5 text-center text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
        onClick={onPickOtherType}
      >
        Pick a different branch type instead…
      </button>
    </div>
  );
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
  changeTypeRootRowLabelOnly = false,
  allowSectionDivider = false,
  replaceSource = null,
  lessonAddContext = null,
  showModuleInKindPicker = false,
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
  /** Root-row change type: only converting to an outline module (no course/link/lesson/divider picker). */
  changeTypeRootRowLabelOnly?: boolean;
  /** Section divider rows only make sense under a top-level section, not at the root list. */
  allowSectionDivider?: boolean;
  /** When changing an existing row’s type: keep id, visibility, and children when allowed. */
  replaceSource?: PathBranchNode | null;
  /** Under a module row: skip to picking a lesson in that module only. */
  lessonAddContext?: { courseId: string; moduleId: string } | null;
  /** Show “Catalog unit” in the kind step (top-level outline rows only). */
  showModuleInKindPicker?: boolean;
}) {
  const labelCatalog = catalogCoursesForLabels ?? catalogCourses;
  const [step, setStep] = useState<BranchModalStep>('kind');
  const [query, setQuery] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [dividerEyebrowInput, setDividerEyebrowInput] = useState('');
  const [linkLabelInput, setLinkLabelInput] = useState('');
  const [linkHrefInput, setLinkHrefInput] = useState('');
  const [lessonCourse, setLessonCourse] = useState<Course | null>(null);
  const [moduleCoursePick, setModuleCoursePick] = useState<Course | null>(null);
  const selectAllOnFocus = mode === 'changeType';

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setLabelInput('');
    setDividerEyebrowInput(
      replaceSource?.kind === 'divider' ? (replaceSource.dividerEyebrow ?? '') : ''
    );
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
        } else {
          // When converting e.g. Module → Web link, carry over the visible name into the link title.
          setLinkLabelInput(branchNodeDisplayLabel(replaceSource, [...labelCatalog]).trim());
        }
      } else {
        setStep('kind');
        if (replaceSource.kind === 'label' || replaceSource.kind === 'divider') {
          setLabelInput(replaceSource.label);
        } else {
          // When converting e.g. Web link → Module, carry over the visible name into the module title.
          setLabelInput(branchNodeDisplayLabel(replaceSource, [...labelCatalog]).trim());
        }
        if (replaceSource.kind === 'link') {
          setLinkLabelInput(replaceSource.label);
          setLinkHrefInput(replaceSource.href);
        } else {
          // When converting e.g. Module → Web link, carry over the visible name into the link title.
          setLinkLabelInput(branchNodeDisplayLabel(replaceSource, [...labelCatalog]).trim());
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
          catalogMiniRichPlainText(m.title).toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          m.lessons.some((l) =>
            `${catalogMiniRichPlainText(l.title ?? '') || l.id}`.toLowerCase().includes(q)
          )
      );
    }
    return mods;
  }, [moduleCoursePick, query]);

  const filteredLessons = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lessonRows;
    return lessonRows.filter(
      (r) =>
        catalogMiniRichPlainText(r.lesson.title ?? '').toLowerCase().includes(q) ||
        catalogMiniRichPlainText(r.moduleTitle).toLowerCase().includes(q)
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
    const ch = replaceSource?.kind === 'divider' ? replaceSource.children : [];
    const eb = dividerEyebrowInput.trim();
    onCommit({
      id: replaceSource?.id ?? newMindmapNodeId(),
      kind: 'divider',
      label: t,
      children: ch,
      ...(eb ? { dividerEyebrow: eb } : {}),
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
      className="fixed inset-0 z-[200] flex items-end justify-center bg-[#272828]/70 p-0 sm:items-center sm:p-4"
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
              (mode === 'changeType'
                ? replaceSource?.kind === 'label'
                  ? 'Change module type'
                  : 'Change branch type'
                : 'Add a branch')}
            {step === 'label' && (replacing ? 'Rename module' : 'Add module')}
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
            aria-label="Close"
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]"
            onClick={onClose}
          >
            <X size={22} aria-hidden />
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
              {mode === 'changeType' || (mode === 'add' && showModuleInKindPicker) ? (
                <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                  {mode === 'changeType' && replaceSource?.kind === 'label' ? (
                    <>
                      Pick a new branch type for this outline module. Visibility settings stay the same. Nested rows stay when
                      the new type allows it. <strong className="text-[var(--text-secondary)]">Section divider</strong> drops
                      nested rows — same rules as the course catalog when you change module type.
                    </>
                  ) : mode === 'changeType' ? (
                    <>
                      Pick a new type. Visibility settings stay the same. Nested rows stay under this branch when the new type
                      allows it. <strong className="text-[var(--text-secondary)]">Section divider</strong> drops nested rows.
                    </>
                  ) : (
                    <>
                      Choose what to add. For a new <strong className="text-[var(--text-secondary)]">outline module</strong>{' '}
                      (section title only), use <strong className="text-[var(--text-secondary)]">Add module here</strong> on a
                      top-level gutter. Here you can add a catalog unit, whole course, single lesson, web link, or section
                      divider — same choices as <strong className="text-[var(--text-secondary)]">Change module type</strong>{' '}
                      except converting to that outline module type.
                    </>
                  )}
                </p>
              ) : null}
              {mode === 'changeType' ? (
                <button
                  type="button"
                  className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-light)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-[#8b8c8c]/80 hover:bg-[var(--hover-bg)]"
                  onClick={() => setStep('label')}
                >
                  <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                    <Type size={20} className="shrink-0 text-admin-icon" aria-hidden />
                    Module
                    <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">Fastest</span>
                  </span>
                  <span className="pl-8 text-xs text-[var(--text-muted)]">
                    Outline section title or topic (e.g. &quot;Foundations&quot;) — no catalog link yet.
                  </span>
                </button>
              ) : null}
              {showModuleInKindPicker ? (
                <button
                  type="button"
                  disabled={!canLink}
                  className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-light)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-[#8b8c8c]/80 hover:bg-[var(--hover-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    setStep('moduleCourse');
                    setQuery('');
                  }}
                >
                  <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                    <Layers size={20} className="shrink-0 text-[#616161]" aria-hidden />
                    Catalog unit
                    <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">Top level</span>
                  </span>
                  <span className="pl-8 text-xs text-[var(--text-muted)]">
                    A module from the catalog as a section; add only lessons from that unit underneath.
                  </span>
                </button>
              ) : null}
              <button
                type="button"
                disabled={!canLink}
                className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-light)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-[#8b8c8c]/80 hover:bg-[var(--hover-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  setStep('course');
                  setQuery('');
                }}
              >
                <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                  <GraduationCap size={20} className="shrink-0 text-[#616161]" aria-hidden />
                  Whole course
                  <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">From catalog</span>
                </span>
                <span className="pl-8 text-xs text-[var(--text-muted)]">
                  Links the full course; course and lesson order still follow your path.
                </span>
              </button>
              <button
                type="button"
                className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-light)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-[#8b8c8c]/80 hover:bg-[var(--hover-bg)]"
                onClick={() => {
                  setStep('linkForm');
                  setQuery('');
                }}
              >
                <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                  <Link2 size={20} className="shrink-0 text-[#616161]" aria-hidden />
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
                  className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-light)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-[#8b8c8c]/80 hover:bg-[var(--hover-bg)]"
                  onClick={() => setStep('divider')}
                >
                  <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                    <Minus size={20} className="shrink-0 text-[#616161] app-dark:text-[#a1a2a2]" aria-hidden />
                    Section divider
                    <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">Non-collapsible</span>
                  </span>
                  <span className="pl-8 text-xs text-[var(--text-muted)]">
                    Subheading inside this section — not a nested group. Use course tags for skills and level.
                  </span>
                </button>
              ) : null}
              {mode === 'changeType' || mode === 'add' ? (
                <button
                  type="button"
                  disabled={!canLink}
                  className="flex min-h-[3.25rem] w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-light)] bg-[var(--bg-primary)] px-4 py-3 text-left hover:border-[#8b8c8c]/80 hover:bg-[var(--hover-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    setStep('lessonCourse');
                    setQuery('');
                  }}
                >
                  <span className="flex w-full items-center gap-3 text-sm font-semibold text-[var(--text-primary)]">
                    <GraduationCap size={20} className="shrink-0 text-[#616161]" aria-hidden />
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
                  tab to add <strong className="text-[var(--text-secondary)]">Whole course</strong>,{' '}
                  <strong className="text-[var(--text-secondary)]">Single lesson</strong>, or{' '}
                  <strong className="text-[var(--text-secondary)]">Catalog unit</strong> branches.
                </p>
              )}
            </div>
          )}

          {step === 'label' && (
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-[var(--text-secondary)]" htmlFor="path-branch-label-input">
                Module title
              </label>
              <input
                id="path-branch-label-input"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onFocus={(e) => {
                  if (selectAllOnFocus) e.currentTarget.select();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && labelInput.trim()) {
                    e.preventDefault();
                    commitLabel();
                  }
                }}
                placeholder="Enter module name…"
                className={PATH_BRANCH_SINGLE_LINE_INPUT_CLASS}
                autoFocus
              />
              <p className="text-xs text-[var(--text-muted)]">
                {replacing ? 'Press Enter to save, or tap the button.' : 'Press Enter to add, or tap the button.'}
              </p>
              <button
                type="button"
                disabled={!labelInput.trim()}
                onClick={commitLabel}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#616161] px-4 py-2 text-sm font-bold text-[#e7e7e7] hover:bg-[#757676] disabled:opacity-40"
              >
                {replacing ? 'Save module' : 'Add branch'}
              </button>
            </div>
          )}

          {step === 'divider' && (
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-[var(--text-secondary)]" htmlFor="path-branch-divider-eyebrow">
                Small label (optional)
              </label>
              <input
                id="path-branch-divider-eyebrow"
                value={dividerEyebrowInput}
                onChange={(e) => setDividerEyebrowInput(e.target.value)}
                placeholder="e.g. NCERT BOOK"
                className={PATH_BRANCH_SINGLE_LINE_INPUT_CLASS}
                maxLength={80}
              />
              <p className="text-[11px] leading-snug text-[var(--text-muted)]">
                Shown in small caps above the main heading on the path (like a product or series line).
              </p>
              <label className="block text-xs font-semibold text-[var(--text-secondary)]" htmlFor="path-branch-divider-input">
                Main heading
              </label>
              <input
                id="path-branch-divider-input"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onFocus={(e) => {
                  if (selectAllOnFocus) e.currentTarget.select();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && labelInput.trim()) {
                    e.preventDefault();
                    commitDivider();
                  }
                }}
                placeholder="e.g. Chapter 01 — Introduction to Accounting"
                className={PATH_BRANCH_SINGLE_LINE_INPUT_CLASS}
                autoFocus
              />
              <p className="text-xs text-[var(--text-muted)]">
                Shown as the bold title in the learner path. Learners tap the card to show or hide links under this
                divider.
              </p>
              <button
                type="button"
                disabled={!labelInput.trim()}
                onClick={commitDivider}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#616161] px-4 py-2 text-sm font-bold text-[#e7e7e7] hover:bg-[#757676] disabled:opacity-40"
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
                onFocus={(e) => {
                  if (selectAllOnFocus) e.currentTarget.select();
                }}
                placeholder="e.g. Read this blog post"
                className={`${PATH_BRANCH_SINGLE_LINE_INPUT_CLASS} font-normal`}
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
                className={`${PATH_BRANCH_SINGLE_LINE_INPUT_CLASS} font-mono font-normal`}
              />
              <p className="text-xs text-[var(--text-muted)]">
                Opens in a new browser tab for learners. Use a full URL or a domain (https:// is added when omitted).
              </p>
              <button
                type="button"
                disabled={!linkFormValid}
                onClick={commitWebLink}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#616161] px-4 py-2 text-sm font-bold text-[#e7e7e7] hover:bg-[#757676] disabled:opacity-40"
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
                className={PATH_BRANCH_COMPACT_SEARCH_INPUT_CLASS}
                autoFocus
              />
              {filteredCourses.length === 0 ? (
                <p className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]/50 px-3 py-6 text-center text-sm text-[var(--text-muted)]">
                  {sortedCourses.length === 0
                    ? 'No published courses in the catalog.'
                    : 'No courses match your search. Try another term.'}
                </p>
              ) : (
                <ul className="space-y-0">
                  {filteredCourses.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={PATH_MODAL_LIST_ROW_COURSE}
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
                className={PATH_BRANCH_COMPACT_SEARCH_INPUT_CLASS}
                autoFocus
              />
              {filteredModules.length === 0 ? (
                <p className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]/50 px-3 py-6 text-center text-sm text-[var(--text-muted)]">
                  {moduleCoursePick.modules.every((m) => m.lessons.length === 0)
                    ? 'This course has no lessons in any module yet.'
                    : 'No modules match your search.'}
                </p>
              ) : (
                <ul className="max-h-[min(50dvh,320px)] space-y-0 overflow-y-auto overscroll-contain pr-1">
                  {filteredModules.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        className={PATH_MODAL_LIST_ROW_TWO_LINE}
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
                className={PATH_BRANCH_COMPACT_SEARCH_INPUT_CLASS}
                autoFocus
              />
              {filteredLessons.length === 0 ? (
                <p className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]/50 px-3 py-6 text-center text-sm text-[var(--text-muted)]">
                  {lessonRows.length === 0
                    ? 'This course has no lessons yet.'
                    : 'No lessons match your search. Try another term.'}
                </p>
              ) : (
                <ul className="max-h-[min(50dvh,320px)] space-y-0 overflow-y-auto overscroll-contain pr-1">
                  {filteredLessons.map((r) => (
                    <li key={r.lesson.id}>
                      <button
                        type="button"
                        className={PATH_MODAL_LIST_ROW_TWO_LINE}
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

function PathBranchKindIcon({ kind, className }: { kind: PathBranchNode['kind']; className?: string }) {
  const cn = `shrink-0 opacity-90 ${className ?? ''}`;
  const s = 14;
  switch (kind) {
    case 'label':
      return <Layers size={s} className={cn} aria-hidden />;
    case 'divider':
      return <Minus size={s} className={cn} aria-hidden />;
    case 'module':
      return <Package size={s} className={cn} aria-hidden />;
    case 'course':
      return <GraduationCap size={s} className={cn} aria-hidden />;
    case 'link':
      return <Link2 size={s} className={cn} aria-hidden />;
    case 'lesson':
      return <FileText size={s} className={cn} aria-hidden />;
  }
}

function pathBranchKindBadgeShortLabel(kind: PathBranchNode['kind']): string {
  switch (kind) {
    case 'label':
      return 'Module';
    case 'divider':
      return 'Divider';
    /** Catalog-backed module row (distinct from a text `Module` / `kind: 'label'` section). */
    case 'module':
      return 'Unit';
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

/** Top-level path inserts: two chips on one gutter (mirrors catalog lesson/module boundary layout). */
const PATH_TOP_LEVEL_INSERT_PAIR_INNER =
  'flex w-full min-w-0 flex-col gap-1.5 @max-[35.999rem]/path-outline:!pl-0 @min-[36rem]/path-outline:flex-row @min-[36rem]/path-outline:flex-wrap @min-[36rem]/path-outline:items-stretch @min-[36rem]/path-outline:justify-center @min-[36rem]/path-outline:gap-1.5 @min-[36rem]/path-outline:py-0.5';

/** Nested path “Add branch here” inner — keep in sync with `CATALOG_LESSON_INSERT_INNER_*` in the course catalog. */
const PATH_NESTED_BRANCH_INSERT_INNER =
  'flex w-full pl-3 @max-[35.999rem]/path-outline:!pl-0 items-center justify-center @min-[36rem]/path-outline:min-h-0 @min-[36rem]/path-outline:py-0.5';
const PATH_NESTED_BRANCH_INSERT_INNER_PERSIST =
  'flex w-full pl-3 @max-[35.999rem]/path-outline:!pl-0 justify-center';
/** md+: strip always expanded (matches catalog lesson insert when module has no rows). */
const PATH_INSERT_OUTER_PERSIST =
  'group/pathStrip relative z-0 mb-0 min-h-0 min-w-0 list-none overflow-visible py-0';

type PathInsertBranchAtOpts = {
  /** When adding from a gutter, skip the kind picker and open the matching step (e.g. module name for `preset: 'label'`). */
  preset?: 'label' | 'course' | 'link' | 'divider' | 'module';
};

/** Top-level row that may show nested outline rows (matches `PathBranchRow` disclosure rules). */
function topLevelRowAllowsChildBranches(row: PathBranchNode): boolean {
  return row.kind !== 'divider';
}

/** Mirrors `PathBranchRow` disclosure: section + divider rows may expand/collapse nested children. */
function pathBranchRowHasExpandableNested(b: PathBranchNode, depth: number): boolean {
  const canNestBranches = (depth === 0 && b.kind !== 'divider') || (b.kind === 'divider' && depth >= 1);
  const hasNestedRows = b.children.length > 0;
  // Top-level outline modules (`label`) always show a disclosure chevron, even before adding children.
  return canNestBranches && (hasNestedRows || (b.kind === 'divider' && depth >= 1) || (depth === 0 && b.kind === 'label'));
}

function pathBranchNodeIsCollapsed(
  b: PathBranchNode,
  depth: number,
  expandedBranchIds: ReadonlySet<string>
): boolean {
  const hasNestedRows = b.children.length > 0;
  const hasExpandableNested = pathBranchRowHasExpandableNested(b, depth);
  // Outline modules (top-level `label`) should show a disclosure chevron even before they have children,
  // matching the catalog module affordance.
  if (depth === 0 && b.kind === 'label') return hasExpandableNested && !expandedBranchIds.has(b.id);
  return hasNestedRows && hasExpandableNested && !expandedBranchIds.has(b.id);
}

/** Ids that may appear in `expandedBranchIds` — aligned with {@link pathBranchRowHasExpandableNested} (includes empty top-level outline modules). */
function collectBranchIdsEligibleForExpandState(nodes: PathBranchNode[], depth = 0): Set<string> {
  const out = new Set<string>();
  function walk(ns: PathBranchNode[], d: number) {
    for (const n of ns) {
      if (pathBranchRowHasExpandableNested(n, d)) out.add(n.id);
      if (n.children.length > 0) walk(n.children, d + 1);
    }
  }
  walk(nodes, depth);
  return out;
}

/** Shorten outline titles for insert-strip buttons (mobile-friendly). */
function pathInsertStripQuoteName(raw: string, maxLen = 44): string {
  const t = raw.trim() || 'this outline section';
  return t.length <= maxLen ? t : `${t.slice(0, maxLen - 1)}…`;
}

function pathInsertAddBranchUnderLabel(sectionDisplayName: string): string {
  return `Add branch under “${pathInsertStripQuoteName(sectionDisplayName)}”`;
}

/** Insert control between sibling rows in the path outline list. `parentId === null` = top-level path rows; else = inside that section’s child list. */
function PathBranchInsertSlot({
  parentId,
  insertIndex,
  expandedBranchIds,
  previousRow,
  previousRowDepth,
  publishedList,
  insertListOwnerDisplayName,
  persistVisibleOnMd = false,
  onInsertBranchAt,
}: {
  parentId: string | null;
  insertIndex: number;
  expandedBranchIds: ReadonlySet<string>;
  /** Row directly above this gutter (omit for the leading slot). */
  previousRow?: PathBranchNode | null;
  /** Depth of `previousRow` in the outline tree (0 for top-level rows). */
  previousRowDepth?: number;
  /** Resolve labels for “Add branch under …” on top-level gutters. */
  publishedList: readonly Course[];
  /**
   * Display name of the outline row whose child list receives the nested “Add branch” action
   * (outline module or section divider when its nested list is open).
   */
  insertListOwnerDisplayName?: string;
  /** When true (nested list with no children yet): chip stays visible on md+ like course catalog lesson insert. */
  persistVisibleOnMd?: boolean;
  onInsertBranchAt: (
    parentId: string | null,
    insertIndex: number,
    opts?: PathInsertBranchAtOpts
  ) => void;
}) {
  const atTopLevel = parentId == null;
  const nestedLabelFallback = 'Add branch here';
  const prev = previousRow ?? null;
  const prevDepth = previousRowDepth ?? 0;
  const prevCollapsedWithChildren =
    prev != null && pathBranchNodeIsCollapsed(prev, prevDepth, expandedBranchIds);
  const branchUnderAbove =
    atTopLevel &&
    prev != null &&
    topLevelRowAllowsChildBranches(prev) &&
    !prevCollapsedWithChildren;
  const nestedListOwnerName = (insertListOwnerDisplayName ?? '').trim();
  const nestedAddBranchLabel =
    nestedListOwnerName.length > 0
      ? pathInsertAddBranchUnderLabel(nestedListOwnerName)
      : nestedLabelFallback;
  const topLevelAddBranchIntoLabel =
    branchUnderAbove && prev
      ? pathInsertAddBranchUnderLabel(branchNodeDisplayLabel(prev, publishedList))
      : nestedLabelFallback;
  const nestedStripTitle =
    'Adds a row inside this outline section at this position among its items.';
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
  const outerLiClass = persistVisibleOnMd
    ? `${PATH_INSERT_OUTER_PERSIST} ${stripOuterCursorClass}`.trim()
    : `group/pathStrip relative z-0 mb-0 min-h-0 min-w-0 list-none ${ADMIN_INSERT_STRIP_OUTER_EXPAND_HOVER} ${stripOuterCursorClass}`.trim();
  return (
    <>
      <InsertStripWaitCursorPortal
        open={waitCursorOverlayOpen}
        clientX={waitCursorClientX}
        clientY={waitCursorClientY}
      />
      <li
        className={outerLiClass}
        title={!atTopLevel && !persistVisibleOnMd ? nestedStripTitle : undefined}
        onPointerEnter={onPointerEnter}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onFocusCapture={onFocusCapture}
        onBlurCapture={onBlurCapture}
      >
        {atTopLevel ? (
          branchUnderAbove && prev != null && prev.children.length > 0 ? (
            <div className={PATH_TOP_LEVEL_INSERT_PAIR_INNER}>
              <button
                type="button"
                aria-label="Add module here"
                onClick={() => onInsertBranchAt(parentId, insertIndex, { preset: 'label' })}
                className={PATH_INSERT_STRIP_CHIP_BTN_EXPAND_ROW_PAIR}
              >
                <Plus size={14} className="shrink-0 opacity-90" aria-hidden />
                <span className="text-center">Add module here</span>
              </button>
              <button
                type="button"
                aria-label={topLevelAddBranchIntoLabel}
                onClick={() =>
                  onInsertBranchAt(prev!.id, prev!.children.length)
                }
                className={PATH_INSERT_STRIP_CHIP_BTN_EXPAND_ROW_PAIR}
              >
                <Plus size={14} className="shrink-0 opacity-90" aria-hidden />
                <span className="min-w-0 text-center [overflow-wrap:anywhere]">{topLevelAddBranchIntoLabel}</span>
              </button>
            </div>
          ) : (
            <div className="flex w-full @max-[35.999rem]/path-outline:!pl-0 items-center justify-center @min-[36rem]/path-outline:min-h-0 @min-[36rem]/path-outline:py-0.5">
              <button
                type="button"
                aria-label="Add module here"
                onClick={() => onInsertBranchAt(parentId, insertIndex, { preset: 'label' })}
                className={PATH_INSERT_STRIP_CHIP_BTN_EXPAND_ROW}
              >
                <Plus size={14} className="shrink-0 opacity-90" aria-hidden />
                <span>Add module here</span>
              </button>
            </div>
          )
        ) : (
          <div
            className={
              persistVisibleOnMd ? PATH_NESTED_BRANCH_INSERT_INNER_PERSIST : PATH_NESTED_BRANCH_INSERT_INNER
            }
          >
            <button
              type="button"
              title={persistVisibleOnMd ? nestedStripTitle : undefined}
              aria-label={nestedAddBranchLabel}
              onClick={() => onInsertBranchAt(parentId, insertIndex)}
              className={
                persistVisibleOnMd
                  ? ADMIN_INSERT_STRIP_CHIP_BTN_PERSIST
                  : PATH_INSERT_STRIP_CHIP_BTN_EXPAND_ROW
              }
            >
              <Plus size={14} className="shrink-0 opacity-90" aria-hidden />
              <span className="min-w-0 text-center [overflow-wrap:anywhere]">{nestedAddBranchLabel}</span>
            </button>
          </div>
        )}
      </li>
    </>
  );
}

/** After the last nested row under a section: append a branch; optional quick “add under last divider”. */
function PathNestedOutlineBoundaryInsertRow({
  sectionDisplayName,
  onAddBranch,
  lastDividerDisplayName,
  onAddBranchUnderLastDivider,
}: {
  /** Outline module or section divider title — shown in “Add branch under …”. */
  sectionDisplayName: string;
  onAddBranch: () => void;
  /** When the last row in this list is a divider, offer a quick “add under divider” action. */
  lastDividerDisplayName?: string;
  onAddBranchUnderLastDivider?: () => void;
}) {
  const addBranchLabel = pathInsertAddBranchUnderLabel(sectionDisplayName);
  const lastDividerName = (lastDividerDisplayName ?? '').trim();
  const addUnderDividerLabel =
    lastDividerName.length > 0 ? pathInsertAddBranchUnderLabel(lastDividerName) : 'Add under divider';
  const useMultiChipRow = !!onAddBranchUnderLastDivider;
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
  } = useInsertStripRevealCursor(true);
  return (
    <>
      <InsertStripWaitCursorPortal
        open={waitCursorOverlayOpen}
        clientX={waitCursorClientX}
        clientY={waitCursorClientY}
      />
      <li
        className={`group/pathStrip relative z-0 mb-0 min-h-0 min-w-0 list-none ${ADMIN_INSERT_STRIP_OUTER_EXPAND_HOVER} ${stripOuterCursorClass}`.trim()}
        onPointerEnter={onPointerEnter}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onFocusCapture={onFocusCapture}
        onBlurCapture={onBlurCapture}
      >
        {useMultiChipRow ? (
          <div className={PATH_TOP_LEVEL_INSERT_PAIR_INNER}>
            <button
              type="button"
              aria-label={addBranchLabel}
              onClick={onAddBranch}
              className={PATH_INSERT_STRIP_CHIP_BTN_EXPAND_ROW_PAIR}
            >
              <Plus size={14} className="shrink-0 opacity-90" aria-hidden />
              <span className="min-w-0 text-center [overflow-wrap:anywhere]">{addBranchLabel}</span>
            </button>
            <button
              type="button"
              aria-label={addUnderDividerLabel}
              onClick={onAddBranchUnderLastDivider}
              className={PATH_INSERT_STRIP_CHIP_BTN_EXPAND_ROW_PAIR}
            >
              <Plus size={14} className="shrink-0 opacity-90" aria-hidden />
              <span className="min-w-0 text-center [overflow-wrap:anywhere]">{addUnderDividerLabel}</span>
            </button>
          </div>
        ) : (
          <div className={PATH_NESTED_BRANCH_INSERT_INNER}>
            <button
              type="button"
              aria-label={addBranchLabel}
              onClick={onAddBranch}
              className={PATH_INSERT_STRIP_CHIP_BTN_EXPAND_ROW}
            >
              <Plus size={14} className="shrink-0 opacity-90" aria-hidden />
              <span className="min-w-0 text-center [overflow-wrap:anywhere]">{addBranchLabel}</span>
            </button>
          </div>
        )}
      </li>
    </>
  );
}

/** Outline row (nested): one compact row on md — badge, field(s), show, audience, actions (no separate “Title” header row). */
const PATH_BRANCH_OUTLINE_ROW_GRID =
  'grid w-full min-w-0 grid-cols-1 gap-y-1 @max-[35.999rem]/path-outline:gap-y-1 @min-[36rem]/path-outline:grid-cols-[auto_minmax(0,1fr)_8.25rem_14rem_minmax(7.25rem,max-content)] @min-[36rem]/path-outline:grid-rows-1 @min-[36rem]/path-outline:items-center @min-[36rem]/path-outline:gap-x-3 @min-[36rem]/path-outline:gap-y-0';

/**
 * Same vertical envelope as catalog module title + `ADMIN_CATALOG_KIND_BADGE_BASE` (min-h-11, sm:h-7).
 * Use for single-line outline fields so rows align with MODULE / LESSON pills.
 */
const PATH_BRANCH_SINGLE_LINE_INPUT_CLASS =
  'box-border min-h-11 w-full min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-0 text-sm font-semibold leading-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)] sm:h-7 sm:min-h-0';

/** Compact search fields in add-branch dialogs (same envelope as outline single-line fields). */
const PATH_BRANCH_COMPACT_SEARCH_INPUT_CLASS =
  'box-border min-h-11 w-full min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-0 text-sm font-normal leading-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)] sm:h-7 sm:min-h-0';

/** Compact selects in path modals (matches outline audience select density). */
const PATH_BRANCH_COMPACT_SELECT_CLASS =
  'box-border min-h-11 w-full min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-0.5 text-sm leading-none text-[var(--text-primary)] sm:h-7 sm:min-h-0';

/** Path outline row icon buttons (reorder, copy, delete) — same sm+ envelope as single-line fields (`sm:h-7`). */
const PATH_BRANCH_ROW_ICON_BTN_CLASS =
  'inline-flex min-h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg text-xs font-semibold disabled:opacity-30 sm:h-7 sm:w-7 sm:min-h-0 sm:min-w-0';

function PathBranchRow({
  b,
  depth,
  siblingIndex,
  siblingsLen,
  outlineListParentId,
  publishedList,
  expandedBranchIds,
  rootOutlineLabelCount,
  onToggleCollapse,
  onInsertBranchAt,
  onRemove,
  onCopyBranch,
  onMove,
  onLabelChange,
  onLinkBranchChange,
  onDividerEyebrowChange,
  onRequestChangeType,
  onBranchRowFocus,
  onVisibleToRolesChange,
}: {
  b: PathBranchNode;
  depth: number;
  siblingIndex: number;
  siblingsLen: number;
  /** Parent id of this row in the outline (`null` for top-level rows). */
  outlineListParentId: string | null;
  publishedList: Course[];
  /** Branch shows nested rows only when its id is in this set. */
  expandedBranchIds: ReadonlySet<string>;
  /** Depth 0 only: number of top-level `label` rows (for merge-into-module tooltip like the course catalog). */
  rootOutlineLabelCount?: number;
  onToggleCollapse: (id: string) => void;
  onInsertBranchAt: (
    parentId: string | null,
    insertIndex: number,
    opts?: PathInsertBranchAtOpts
  ) => void;
  onRemove: (id: string) => void;
  onCopyBranch: (id: string) => void;
  onMove: (id: string, delta: -1 | 1, scrollAnchor?: HTMLElement | null) => void;
  onLabelChange: (id: string, label: string) => void;
  onLinkBranchChange: (id: string, patch: { label?: string; href?: string }) => void;
  onDividerEyebrowChange: (id: string, dividerEyebrow: string) => void;
  onRequestChangeType: (id: string) => void;
  onBranchRowFocus: (id: string) => void;
  onVisibleToRolesChange: (id: string, roles: PathOutlineAudienceRole[]) => void;
}) {
  /** Section rows (depth 0) and divider rows (grouping) may list sub-branches; other rows are leaves. */
  const canNestBranches = (depth === 0 && b.kind !== 'divider') || (b.kind === 'divider' && depth >= 1);
  const hasNestedRows = b.children.length > 0;
  /** Dividers always use the disclosure control so grouped rows are obvious; collapse only hides when there are children. */
  const hasExpandableNested = pathBranchRowHasExpandableNested(b, depth);
  const isCollapsed = pathBranchNodeIsCollapsed(b, depth, expandedBranchIds);
  /**
   * Show nested list + insert slots when:
   * - Top-level outline modules are expanded (even if empty) so the chevron can hide/show the empty state.
   * - Other nestable rows: always show when empty (so the first insert is visible), or when expanded with children.
   */
  const showNestedBranchList =
    canNestBranches &&
    (depth === 0 && b.kind === 'label' ? !isCollapsed : !hasNestedRows || !isCollapsed);

  const kindBadgeClass = 'bg-[#757676]/15 text-[#393a3a] app-dark:text-[#cfcfcf]';

  const rowDivider =
    depth === 0
      ? ''
      : siblingIndex === 0
        ? 'pt-0 pb-0.5'
        : 'py-0.5';

  const onBranchRowFocusCapture = (e: React.FocusEvent<HTMLDivElement | HTMLLIElement>) => {
    const target = e.target as HTMLElement | null;
    /** Avoid racing expand (focus) + toggle (click) on the section disclosure control — same gesture would expand then collapse. */
    if (target?.closest?.('[data-path-branch-disclosure]')) return;
    /** Avoid auto-expand when focusing Show / audience visibility (checkbox must not toggle disclosure). */
    if (target?.closest?.('[data-path-branch-outline-visibility]')) return;
    /** Avoid auto-expand/scroll when focusing row action controls (copy/move, reorder, delete, change-type, etc.). */
    if (target?.closest?.('[data-path-branch-row-action]')) return;
    const header = e.currentTarget;
    const related = e.relatedTarget as Node | null;
    if (related && header.contains(related)) return;
    onBranchRowFocus(b.id);
  };

  /** Matches catalog module/lesson/divider: kind + chevron on disclosure; sliders open change-type (see `AdminCourseCatalogSection`). */
  const pathKindBadgeText = pathBranchKindBadgeShortLabel(b.kind);
  /** Match `ADMIN_CATALOG_KIND_BADGE_BASE`: tall tap target & sm+ fixed height like module pills. */
  const kindPillSpanClass = `inline-flex min-h-11 min-w-[3.5rem] shrink-0 items-center justify-center gap-1 rounded-md px-2.5 text-[10px] font-bold uppercase leading-none sm:h-7 sm:min-h-0 sm:min-w-[4.25rem] sm:px-3 ${kindBadgeClass}`;

  const isTopLevelOutlineModuleRow = depth === 0 && b.kind === 'label';
  const hasAnotherOutlineModuleForMerge =
    (rootOutlineLabelCount ?? 0) >= 2;

  const changeTypeSlidersButton = (
    <button
      type="button"
      data-path-branch-row-action
      onClick={(e) => {
        e.stopPropagation();
        onRequestChangeType(b.id);
      }}
      className="inline-flex min-h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/45 sm:h-7 sm:w-7 sm:min-h-0 sm:min-w-0"
      title={
        isTopLevelOutlineModuleRow
          ? hasAnotherOutlineModuleForMerge
            ? 'Change module — merge as section divider into another outline module (pick target and position), or pick another branch type from the next step.'
            : 'Add another top-level outline module first — then you can merge this section into it as a section divider. You can still pick another branch type from the dialog.'
          : 'Change branch type'
      }
      aria-label={
        isTopLevelOutlineModuleRow
          ? `Change module type, now ${pathKindBadgeText}`
          : `Change branch type, now ${pathKindBadgeText}`
      }
    >
      <SlidersHorizontal size={18} aria-hidden />
    </button>
  );

  const branchBadgeGroup = (
    <div className="flex shrink-0 items-center gap-x-1.5">
      {hasExpandableNested ? (
        <>
          <button
            type="button"
            data-path-branch-disclosure
            onMouseDown={(e) => {
              if (e.button === 0) e.preventDefault();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(b.id);
            }}
            className={`inline-flex min-h-11 min-w-[3.5rem] shrink-0 items-center justify-center gap-1 rounded-md px-2.5 text-[10px] font-bold uppercase leading-none transition-colors hover:bg-[var(--hover-bg)]/80 focus:outline-none focus:ring-2 focus:ring-[#a1a2a2]/45 sm:h-7 sm:min-h-0 sm:min-w-[4.75rem] sm:px-3 ${kindBadgeClass}`}
            aria-expanded={!isCollapsed}
            title={isCollapsed ? 'Show nested branches' : 'Hide nested branches'}
            aria-label={
              isCollapsed
                ? `Expand nested branches (${pathKindBadgeText})`
                : `Collapse nested branches (${pathKindBadgeText})`
            }
          >
            <PathBranchKindIcon kind={b.kind} />
            {pathKindBadgeText}
            {!isCollapsed ? (
              <ChevronDown size={14} className="shrink-0 opacity-90" aria-hidden />
            ) : (
              <ChevronRight size={14} className="shrink-0 opacity-90" aria-hidden />
            )}
          </button>
          {changeTypeSlidersButton}
        </>
      ) : depth === 0 && b.kind === 'label' ? (
        <>
          <span
            className={kindPillSpanClass}
            title="Module title (edit in the field)"
            aria-label={`Branch type: ${pathKindBadgeText}`}
          >
            <PathBranchKindIcon kind={b.kind} />
            {pathKindBadgeText}
          </span>
          {changeTypeSlidersButton}
        </>
      ) : (
        <>
          <span className={kindPillSpanClass} aria-label={`Branch type: ${pathKindBadgeText}`}>
            <PathBranchKindIcon kind={b.kind} />
            {pathKindBadgeText}
          </span>
          {changeTypeSlidersButton}
        </>
      )}
    </div>
  );

  const renderOutlineRowMainCells = () => {
    if (b.kind === 'label') {
      return (
        <div className="@max-[35.999rem]/path-outline:flex @max-[35.999rem]/path-outline:min-w-0 @max-[35.999rem]/path-outline:flex-row @max-[35.999rem]/path-outline:flex-wrap @max-[35.999rem]/path-outline:items-center @max-[35.999rem]/path-outline:gap-2 @min-[36rem]/path-outline:contents">
          <div className="flex shrink-0 items-center @min-[36rem]/path-outline:col-start-1 @min-[36rem]/path-outline:row-start-1">
            {branchBadgeGroup}
          </div>
          <input
            type="text"
            value={b.label}
            onChange={(e) => onLabelChange(b.id, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label="Module title"
            className={`${PATH_BRANCH_SINGLE_LINE_INPUT_CLASS} @max-[35.999rem]/path-outline:flex-1 @min-[36rem]/path-outline:col-start-2 @min-[36rem]/path-outline:row-start-1`}
            placeholder="Enter module name…"
          />
        </div>
      );
    }
    if (b.kind === 'divider') {
      return (
        <div className="@max-[35.999rem]/path-outline:flex @max-[35.999rem]/path-outline:min-w-0 @max-[35.999rem]/path-outline:flex-col @max-[35.999rem]/path-outline:gap-2 @min-[36rem]/path-outline:contents">
          <div className="flex shrink-0 items-center @min-[36rem]/path-outline:col-start-1 @min-[36rem]/path-outline:row-start-1">
            {branchBadgeGroup}
          </div>
          <div className="min-w-0 w-full @min-[36rem]/path-outline:col-start-2 @min-[36rem]/path-outline:row-start-1">
            <PathSectionDividerCard
              showEyebrow
              eyebrow={
                <input
                  type="text"
                  value={b.dividerEyebrow ?? ''}
                  onChange={(e) => onDividerEyebrowChange(b.id, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  aria-label="Divider small label (optional)"
                  placeholder="e.g. NCERT BOOK"
                  maxLength={80}
                  className="m-0 w-full min-w-0 border-0 bg-transparent p-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)] shadow-none ring-0 placeholder:normal-case placeholder:tracking-normal placeholder:text-[var(--text-muted)] focus:border-0 focus:ring-0 focus-visible:ring-0 sm:text-[11px]"
                />
              }
              title={
                <input
                  type="text"
                  value={b.label}
                  onChange={(e) => onLabelChange(b.id, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  aria-label="Divider main heading"
                  className={`${PATH_BRANCH_SINGLE_LINE_INPUT_CLASS} w-full min-w-0 border-0 bg-transparent p-0 font-bold shadow-none ring-0 focus:border-0 focus:ring-0 focus-visible:ring-0 sm:text-base`}
                  placeholder="Main heading (e.g. Chapter 01 — …)"
                />
              }
            />
          </div>
        </div>
      );
    }
    if (b.kind === 'link') {
      const normalizedHref = normalizeExternalHref(b.href);
      const hrefForOpen = normalizedHref ?? b.href.trim();
      return (
        <>
          <div className="@max-[35.999rem]/path-outline:flex @max-[35.999rem]/path-outline:min-w-0 @max-[35.999rem]/path-outline:flex-col @max-[35.999rem]/path-outline:items-stretch @max-[35.999rem]/path-outline:gap-1.5 @min-[36rem]/path-outline:contents">
            <div className="flex items-center @min-[36rem]/path-outline:col-start-1 @min-[36rem]/path-outline:row-start-1">
              {branchBadgeGroup}
            </div>
            <div className="flex min-w-0 w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-3 sm:gap-y-2 @min-[36rem]/path-outline:col-start-2 @min-[36rem]/path-outline:row-start-1">
              <input
                type="text"
                value={b.label}
                onChange={(e) => onLinkBranchChange(b.id, { label: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label="Web link title"
                className={`${PATH_BRANCH_SINGLE_LINE_INPUT_CLASS} font-normal`}
                placeholder="Shown in the path outline"
              />
              <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
                <input
                  type="url"
                  inputMode="url"
                  value={b.href}
                  onChange={(e) => onLinkBranchChange(b.id, { href: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  aria-label="Web link URL"
                  className={`${PATH_BRANCH_SINGLE_LINE_INPUT_CLASS} min-w-0 font-mono font-normal sm:flex-1`}
                  placeholder="https://…"
                />
                <button
                  type="button"
                  disabled={!hrefForOpen || normalizeExternalHref(hrefForOpen) == null}
                  onClick={(e) => {
                    e.stopPropagation();
                    const url = normalizeExternalHref(hrefForOpen);
                    if (!url) return;
                    window.open(url, '_blank', 'noopener,noreferrer');
                  }}
                  className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center rounded-lg border border-brand-500/40 bg-[var(--bg-primary)] px-3 text-sm font-bold text-brand-500 transition-colors hover:bg-brand-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)] disabled:pointer-events-none disabled:opacity-40 sm:min-h-7 sm:w-auto sm:px-3 sm:text-xs"
                  aria-label="Open link in a new tab"
                  title="Open in new tab"
                >
                  Open
                </button>
              </div>
            </div>
          </div>
        </>
      );
    }
    return (
      <div className="@max-[35.999rem]/path-outline:flex @max-[35.999rem]/path-outline:min-w-0 @max-[35.999rem]/path-outline:flex-row @max-[35.999rem]/path-outline:flex-wrap @max-[35.999rem]/path-outline:items-center @max-[35.999rem]/path-outline:gap-2 @min-[36rem]/path-outline:contents">
        <div className="flex shrink-0 items-center @min-[36rem]/path-outline:col-start-1 @min-[36rem]/path-outline:row-start-1">
          {branchBadgeGroup}
        </div>
        <span className="flex min-h-11 min-w-0 flex-1 items-center truncate text-sm font-bold leading-none text-[var(--text-primary)] sm:h-7 sm:min-h-0 @min-[36rem]/path-outline:col-start-2 @min-[36rem]/path-outline:row-start-1">
          {branchNodeDisplayLabel(b, publishedList)}
        </span>
      </div>
    );
  };

  const branchActionButtons = (
    <>
      <button
        type="button"
        data-path-branch-row-action
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
        className={`${PATH_BRANCH_ROW_ICON_BTN_CLASS} border border-[var(--border-color)]`}
        aria-label="Move up among siblings"
      >
        ↑
      </button>
      <button
        type="button"
        data-path-branch-row-action
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
        className={`${PATH_BRANCH_ROW_ICON_BTN_CLASS} border border-[var(--border-color)]`}
        aria-label="Move down among siblings"
      >
        ↓
      </button>
      <button
        type="button"
        data-path-branch-row-action
        onClick={(e) => {
          e.stopPropagation();
          onCopyBranch(b.id);
        }}
        className={`${PATH_BRANCH_ROW_ICON_BTN_CLASS} text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[#616161] app-dark:hover:text-[var(--tone-100)]`}
        aria-label="Copy or move this branch — choose destination in the dialog"
        title="Copy or move branch"
      >
        <Copy size={16} aria-hidden />
      </button>
      <button
        type="button"
        data-path-branch-row-action
        onClick={() => onRemove(b.id)}
        className={`${PATH_BRANCH_ROW_ICON_BTN_CLASS} text-[#a1a2a2] hover:bg-[#757676]/12`}
        aria-label="Remove branch and nested items"
      >
        <Trash2 size={16} />
      </button>
    </>
  );

  return (
    <li
      data-path-branch-node-id={b.id}
      className={`min-w-0 list-none ${rowDivider}${
        depth === 0
          ? `grid grid-cols-1 gap-y-1 px-2 py-1 @max-[35.999rem]/path-outline:gap-y-1 @max-[35.999rem]/path-outline:px-2 @max-[35.999rem]/path-outline:py-1 sm:px-3 @min-[36rem]/path-outline:grid @min-[36rem]/path-outline:grid-cols-[auto_minmax(0,1fr)_8.25rem_14rem_minmax(7.25rem,max-content)] @min-[36rem]/path-outline:items-stretch @min-[36rem]/path-outline:gap-x-3 @min-[36rem]/path-outline:px-4 @min-[36rem]/path-outline:py-1 ${
              showNestedBranchList
                ? '@min-[36rem]/path-outline:grid-rows-[auto_auto] @min-[36rem]/path-outline:gap-y-0'
                : '@min-[36rem]/path-outline:grid-rows-1 @min-[36rem]/path-outline:gap-y-0'
            }`
          : showNestedBranchList
            ? 'flex w-full min-w-0 flex-col'
            : ''
      }`}
      onFocusCapture={depth === 0 ? onBranchRowFocusCapture : undefined}
    >
      {depth === 0 ? (
        <div className="contents">
          {renderOutlineRowMainCells()}
          <CourseHierarchyVisibilityCells
            visibleToRoles={b.visibleToRoles}
            onChange={(next) => onVisibleToRolesChange(b.id, next)}
            nested={false}
            topLevelGridSecondRow
            audienceListboxId={`path-outline-vis-${b.id}`}
            showColumnTip={PATH_OUTLINE_ROW_VISIBILITY_SHOW_TIP}
            audienceTitle="Learner = everyone. Without Learner, toggle admin and/or creator (admin only, creator for admins+creators, or both)."
            showAriaLabel="Show in catalog path outline"
            audienceAriaLabel="Who can see this in the catalog outline"
          />
          <div className="@max-[35.999rem]/path-outline:flex @max-[35.999rem]/path-outline:w-full @max-[35.999rem]/path-outline:justify-end @min-[36rem]/path-outline:contents">
            <div className="flex items-center justify-end gap-1 @max-[35.999rem]/path-outline:col-span-full @max-[35.999rem]/path-outline:col-start-1 @max-[35.999rem]/path-outline:row-auto @min-[36rem]/path-outline:col-start-5 @min-[36rem]/path-outline:row-start-1 @min-[36rem]/path-outline:justify-end">
              {branchActionButtons}
            </div>
          </div>
        </div>
      ) : (
        <div
          className={`${PATH_BRANCH_OUTLINE_ROW_GRID} ${
            siblingIndex === 0
              ? '@max-[35.999rem]/path-outline:pb-1 @max-[35.999rem]/path-outline:pt-0 pb-1.5 pt-0 sm:pb-1.5 sm:pt-0'
              : '@max-[35.999rem]/path-outline:py-1 py-1.5 sm:py-1.5'
          }`}
          onFocusCapture={onBranchRowFocusCapture}
          role="group"
          aria-label="Catalog outline visibility"
        >
          {renderOutlineRowMainCells()}
          <CourseHierarchyVisibilityCells
            visibleToRoles={b.visibleToRoles}
            onChange={(next) => onVisibleToRolesChange(b.id, next)}
            nested
            nestedGridSecondRow
            audienceListboxId={`path-outline-vis-${b.id}`}
            showColumnTip={PATH_OUTLINE_ROW_VISIBILITY_SHOW_TIP}
            audienceTitle="Learner = everyone. Without Learner, toggle admin and/or creator (admin only, creator for admins+creators, or both)."
            showAriaLabel="Show in catalog path outline"
            audienceAriaLabel="Who can see this in the catalog outline"
          />
          <div className="@max-[35.999rem]/path-outline:flex @max-[35.999rem]/path-outline:w-full @max-[35.999rem]/path-outline:justify-end @min-[36rem]/path-outline:contents">
            <div className="flex items-center justify-end gap-1 @max-[35.999rem]/path-outline:col-span-full @max-[35.999rem]/path-outline:col-start-1 @max-[35.999rem]/path-outline:row-auto @max-[35.999rem]/path-outline:pt-0 @min-[36rem]/path-outline:col-start-5 @min-[36rem]/path-outline:row-start-1 @min-[36rem]/path-outline:self-center">
              {branchActionButtons}
            </div>
          </div>
        </div>
      )}
      {showNestedBranchList ? (
        <div className="col-span-full min-w-0 w-full @min-[36rem]/path-outline:row-start-2">
          <PathBranchTreeList
            parentId={b.id}
            insertListOwnerDisplayName={branchNodeDisplayLabel(b, publishedList)}
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
            onDividerEyebrowChange={onDividerEyebrowChange}
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
  insertListOwnerDisplayName,
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
  onDividerEyebrowChange,
  onRequestChangeType,
  onBranchRowFocus,
  onVisibleToRolesChange,
}: {
  parentId: string | null;
  /** Title of the row that owns this list (outline module or divider) for “Add branch under …”. Omit at root. */
  insertListOwnerDisplayName?: string;
  nodes: PathBranchNode[];
  depth: number;
  publishedList: Course[];
  expandedBranchIds: ReadonlySet<string>;
  onToggleCollapse: (id: string) => void;
  onInsertBranchAt: (
    parentId: string | null,
    insertIndex: number,
    opts?: PathInsertBranchAtOpts
  ) => void;
  onRemove: (id: string) => void;
  onCopyBranch: (id: string) => void;
  onMove: (id: string, delta: -1 | 1, scrollAnchor?: HTMLElement | null) => void;
  onLabelChange: (id: string, label: string) => void;
  onLinkBranchChange: (id: string, patch: { label?: string; href?: string }) => void;
  onDividerEyebrowChange: (id: string, dividerEyebrow: string) => void;
  onRequestChangeType: (id: string) => void;
  onBranchRowFocus: (id: string) => void;
  onVisibleToRolesChange: (id: string, roles: PathOutlineAudienceRole[]) => void;
}) {
  const insKey = parentId ?? 'root';
  /** At depth 0 only: count of top-level outline modules (`label`), for catalog-style “Change module type” merge UX. */
  const rootOutlineLabelCount =
    depth === 0 ? nodes.filter((n) => n.kind === 'label').length : undefined;
  const list = (
    <ul
      className={
        depth > 0
          ? 'space-y-0 border-l border-[var(--border-color)]/50 pl-2 sm:pl-3'
            : // Reserve a little space so the first wide-outline “between rows” insert strip does not overlap controls above the list.
            'space-y-0 pt-0 sm:pt-0.5 @min-[36rem]/path-outline:pt-1'
      }
    >
      <Fragment key={`ins-${insKey}-0`}>
        {/* Always show leading insert (including empty nested lists) so outline modules match catalog “add branch at start of module”. */}
        <PathBranchInsertSlot
          parentId={parentId}
          insertIndex={0}
          expandedBranchIds={expandedBranchIds}
          previousRow={parentId === null ? null : undefined}
          publishedList={publishedList}
          insertListOwnerDisplayName={parentId != null ? insertListOwnerDisplayName : undefined}
          persistVisibleOnMd={parentId !== null && nodes.length === 0}
          onInsertBranchAt={onInsertBranchAt}
        />
      </Fragment>
      {nodes.map((b, i) => {
        const omitNestedTrailingSlot = parentId !== null && depth > 0 && i === nodes.length - 1;
        /** Last top-level row with visible nested children already ends with `PathNestedOutlineBoundaryInsertRow` — skip duplicate top-level dual strip. */
        const omitTopLevelTrailingSlot =
          parentId === null &&
          i === nodes.length - 1 &&
          b.children.length > 0 &&
          pathBranchRowHasExpandableNested(b, depth) &&
          !pathBranchNodeIsCollapsed(b, depth, expandedBranchIds);
        /**
         * Expanded divider with children: the nested `PathBranchTreeList` already ends with
         * `PathNestedOutlineBoundaryInsertRow` — skip this trailing strip or it duplicates “add at end of divider”.
         */
        const omitTrailingAfterExpandedDividerWithChildren =
          b.kind === 'divider' &&
          b.children.length > 0 &&
          !pathBranchNodeIsCollapsed(b, depth, expandedBranchIds);
        const showTrailingInsertSlot =
          !omitNestedTrailingSlot &&
          !omitTopLevelTrailingSlot &&
          !omitTrailingAfterExpandedDividerWithChildren;
        const dividerTrailingTargetsInnerList =
          b.kind === 'divider' &&
          !pathBranchNodeIsCollapsed(b, depth, expandedBranchIds);
        const trailingInsertParentId = dividerTrailingTargetsInnerList ? b.id : parentId;
        const trailingInsertIndex = dividerTrailingTargetsInnerList ? b.children.length : i + 1;
        const trailingInsertListOwnerDisplayName =
          dividerTrailingTargetsInnerList && b.kind === 'divider'
            ? branchNodeDisplayLabel(b, publishedList)
            : insertListOwnerDisplayName;
        return (
          <Fragment key={b.id}>
            <PathBranchRow
              b={b}
              depth={depth}
              siblingIndex={i}
              siblingsLen={nodes.length}
              outlineListParentId={parentId}
              publishedList={publishedList}
              expandedBranchIds={expandedBranchIds}
              rootOutlineLabelCount={rootOutlineLabelCount}
              onToggleCollapse={onToggleCollapse}
              onInsertBranchAt={onInsertBranchAt}
              onRemove={onRemove}
              onCopyBranch={onCopyBranch}
              onMove={onMove}
              onLabelChange={onLabelChange}
              onLinkBranchChange={onLinkBranchChange}
              onDividerEyebrowChange={onDividerEyebrowChange}
              onRequestChangeType={onRequestChangeType}
              onBranchRowFocus={onBranchRowFocus}
              onVisibleToRolesChange={onVisibleToRolesChange}
            />
            {showTrailingInsertSlot ? (
              <PathBranchInsertSlot
                parentId={trailingInsertParentId}
                insertIndex={trailingInsertIndex}
                expandedBranchIds={expandedBranchIds}
                previousRow={b}
                previousRowDepth={depth}
                publishedList={publishedList}
                insertListOwnerDisplayName={
                  parentId != null ? trailingInsertListOwnerDisplayName : undefined
                }
                onInsertBranchAt={onInsertBranchAt}
              />
            ) : null}
          </Fragment>
        );
      })}
      {parentId !== null && depth > 0 && nodes.length > 0 ? (
        (() => {
          const last = nodes[nodes.length - 1] ?? null;
          const lastIsDivider = last?.kind === 'divider';
          const lastDividerDisplayName =
            lastIsDivider ? branchNodeDisplayLabel(last, publishedList) : undefined;
          const onAddBranchUnderLastDivider =
            lastIsDivider ? () => onInsertBranchAt(last!.id, last!.children.length) : undefined;
          return (
        <PathNestedOutlineBoundaryInsertRow
          sectionDisplayName={
            (insertListOwnerDisplayName ?? '').trim() || 'this outline section'
          }
          onAddBranch={() => onInsertBranchAt(parentId, nodes.length)}
          lastDividerDisplayName={lastDividerDisplayName}
          onAddBranchUnderLastDivider={onAddBranchUnderLastDivider}
        />
          );
        })()
      ) : null}
    </ul>
  );
  return list;
}

export type PathPersistenceMode =
  | { kind: 'published' }
  | { kind: 'creator'; ownerUid: string };

export interface PathBuilderSectionProps {
  publishedList: Course[];
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
  /** Collapsible path title / description (matches Course details in the catalog). */
  const [pathDetailsOpen, setPathDetailsOpen] = useState(false);
  const pathDetailsDisclosureRef = useRef<HTMLDivElement | null>(null);
  const prevPathDetailsOpenRef = useRef(false);
  /** Mirrors catalog picker state so we keep Path details open after first save (`__new__` → same id). */
  const prevPathPickerRef = useRef<{ selector: string; draftId?: string }>({ selector: '' });
  /** Set when save rejected empty title — red border until the user edits the title. */
  const [showPathTitleRequiredHint, setShowPathTitleRequiredHint] = useState(false);
  /** Shown after Save when the path has no courses (inline hint like module field errors). */
  const [showPathCourseRequiredHint, setShowPathCourseRequiredHint] = useState(false);
  const [pathDraft, setPathDraft] = useState<LearningPath | null>(null);
  const [pathBaselineJson, setPathBaselineJson] = useState<string | null>(null);
  /** Top-level mind map branches — editable for new and saved paths; synced to `pathMindmap` on save. */
  const [pathBranchTree, setPathBranchTree] = useState<PathBranchNode[]>([]);
  const pathBranchTreeRef = useRef<PathBranchNode[]>([]);
  pathBranchTreeRef.current = pathBranchTree;
  const pathBranchMindMapRootRef = useRef<HTMLDivElement | null>(null);
  const pendingPathBranchReorderFocusRef = useRef<{
    nodeId: string;
    control: 'up' | 'down';
    beforeTop: number;
  } | null>(null);
  const [pathBranchReorderLayoutTick, setPathBranchReorderLayoutTick] = useState(0);
  const [pathBranchTreeBaselineJson, setPathBranchTreeBaselineJson] = useState('[]');
  const [pathMindmapLoading, setPathMindmapLoading] = useState(false);
  const suppressBranchModalCloseOnceRef = useRef(false);
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
    | {
        kind: 'changeTypePlaceTopLevel';
        sourceId: string;
        converted: PathBranchNode;
      }
    | {
        kind: 'changeTypePlaceNonRoot';
        sourceId: string;
        converted: PathBranchNode;
        defaultTopParentId: string | null;
      }
    | { kind: 'changeOutlineModuleMerge'; nodeId: string }
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

  /** Divider delete: choose hoist nested rows vs delete subtree (only when divider has children). */
  const [dividerRemovePending, setDividerRemovePending] = useState<{
    id: string;
    label: string;
    nestedCount: number;
  } | null>(null);

  const duplicatePlaceRememberRef = useRef<{
    mode: 'copy' | 'move';
    perMode: {
      copy: { parentId: string | null; insert: PlaceBranchRememberedInsert };
      move: { parentId: string | null; insert: PlaceBranchRememberedInsert };
    };
  }>({
    mode: 'copy',
    perMode: {
      copy: { parentId: null, insert: { kind: 'end' } },
      move: { parentId: null, insert: { kind: 'end' } },
    },
  });

  const closeDividerRemoveDialog = useCallback(() => setDividerRemovePending(null), []);

  const toggleBranchCollapse = useCallback(
    (id: string) => {
      setExpandedBranchIds((prev) => {
        if (prev.has(id)) {
          const next = new Set<string>(prev);
          stripBranchExpandState(next, pathBranchTree, id);
          return next;
        }
        return accordionExpandBranchRow(prev, pathBranchTree, id);
      });
    },
    [pathBranchTree]
  );

  const focusBranchRow = useCallback(
    (id: string) => {
      setExpandedBranchIds((prev) => accordionExpandBranchRow(prev, pathBranchTree, id));
    },
    [pathBranchTree]
  );

  const handleRemoveBranch = useCallback(
    (id: string) => {
      const roots = pathBranchTreeRef.current;
      const removed = findBranchNode(roots, id);
      if (removed?.kind === 'divider' && removed.children.length > 0) {
        const raw = branchNodeDisplayLabel(removed, publishedList);
        const label = raw.length > 72 ? `${raw.slice(0, 70)}…` : raw;
        setDividerRemovePending({
          id,
          label,
          nestedCount: removed.children.length,
        });
        return;
      }
      const before = deepClone(roots);
      const raw = removed ? branchNodeDisplayLabel(removed, publishedList) : 'Branch';
      const label = raw.length > 72 ? `${raw.slice(0, 70)}…` : raw;
      setPathBranchTree((r) => removeNodeById(r, id));
      showActionToast(`“${label}” removed.`, {
        variant: 'neutral',
        undo: () => setPathBranchTree(before),
        undoLabel: 'Undo',
      });
    },
    [publishedList, showActionToast]
  );

  const confirmDividerRemoveHoistNested = useCallback(() => {
    const pending = dividerRemovePending;
    if (!pending) return;
    const beforeOp = deepClone(pathBranchTreeRef.current);
    const next = hoistDividerChildrenInForest(beforeOp, pending.id);
    if (next == null) {
      showActionToast('Could not remove that divider from the outline.', 'danger');
      setDividerRemovePending(null);
      return;
    }
    setPathBranchTree(next);
    setExpandedBranchIds((prev) => {
      const n = new Set(prev);
      n.delete(pending.id);
      return n;
    });
    setDividerRemovePending(null);
    showActionToast(`Divider removed; ${pending.nestedCount} row(s) kept in the module list.`, {
      variant: 'neutral',
      undo: () => setPathBranchTree(beforeOp),
      undoLabel: 'Undo',
    });
  }, [dividerRemovePending, showActionToast]);

  const confirmDividerRemoveDeleteNested = useCallback(() => {
    const pending = dividerRemovePending;
    if (!pending) return;
    const beforeOp = deepClone(pathBranchTreeRef.current);
    const removed = findBranchNode(beforeOp, pending.id);
    setPathBranchTree((r) => removeNodeById(r, pending.id));
    setExpandedBranchIds((prev) => {
      const n = new Set(prev);
      stripBranchExpandState(n, beforeOp, pending.id);
      return n;
    });
    setDividerRemovePending(null);
    const raw = removed ? branchNodeDisplayLabel(removed, publishedList) : 'Divider';
    const label = raw.length > 72 ? `${raw.slice(0, 70)}…` : raw;
    showActionToast(`“${label}” and all rows under it removed.`, {
      variant: 'neutral',
      undo: () => setPathBranchTree(beforeOp),
      undoLabel: 'Undo',
    });
  }, [dividerRemovePending, publishedList, showActionToast]);

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
    // `applyPickNewPath` seeds `expandedBranchIds` for the default outline module — do not wipe on `__new__`.
    if (pathSelector === '__new__') return;
    setExpandedBranchIds(new Set());
  }, [pathSelector]);

  /** Remove expand state for ids that are not valid for the current tree (e.g. removed rows). */
  useEffect(() => {
    const valid = collectBranchIdsEligibleForExpandState(pathBranchTree);
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
    if (!pathDetailsOpen) return;
    const rafId = requestAnimationFrame(() => {
      const el = document.getElementById('admin-path-title') as HTMLInputElement | null;
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus({ preventScroll: true });
      el.select();
    });
    return () => cancelAnimationFrame(rafId);
  }, [pathSelector, pathDraft?.id, pathTitleFocusKey, pathDetailsOpen]);

  /** Match catalog: new path shows details expanded; switching paths collapses unless first save keeps same id. */
  useEffect(() => {
    const prev = prevPathPickerRef.current;
    const did = pathDraft?.id;

    if (pathSelector === '__new__') {
      setPathDetailsOpen(true);
      prevPathPickerRef.current = { selector: '__new__', draftId: did };
      return;
    }
    if (!pathSelector) {
      setPathDetailsOpen(false);
      setShowPathTitleRequiredHint(false);
      prevPathPickerRef.current = { selector: '', draftId: undefined };
      return;
    }

    if (prev.selector === '__new__' && did && pathSelector === did) {
      prevPathPickerRef.current = { selector: pathSelector, draftId: did };
      return;
    }

    setPathDetailsOpen(false);
    setShowPathTitleRequiredHint(false);
    prevPathPickerRef.current = { selector: pathSelector, draftId: did };
  }, [pathSelector, pathDraft?.id]);

  /** Whenever Path details goes from collapsed → expanded, scroll the panel to the top. */
  useLayoutEffect(() => {
    const wasOpen = prevPathDetailsOpenRef.current;
    prevPathDetailsOpenRef.current = pathDetailsOpen;
    if (!pathDetailsOpen || wasOpen) return;
    scrollDisclosureRowToTop(null, pathDetailsDisclosureRef.current);
  }, [pathDetailsOpen]);

  const tipsNarrowViewport = useTipsNarrowViewport();
  const pathOutlineTipsWrapRef = useRef<HTMLSpanElement | null>(null);
  const pathOutlineTipBtnRef = useRef<HTMLButtonElement | null>(null);
  const [pathOutlineTipsOpen, setPathOutlineTipsOpen] = useState(false);
  const [pathOutlineTipFixedTop, setPathOutlineTipFixedTop] = useState(-1);

  const syncPathOutlineTipTop = useCallback(() => {
    if (!tipsNarrowViewport || !pathOutlineTipsOpen || !pathOutlineTipBtnRef.current) return;
    setPathOutlineTipFixedTop(readFixedTipTopBelowAnchor(pathOutlineTipBtnRef.current));
  }, [tipsNarrowViewport, pathOutlineTipsOpen]);

  useLayoutEffect(() => {
    if (!pathOutlineTipsOpen) {
      setPathOutlineTipFixedTop(-1);
      return;
    }
    if (!tipsNarrowViewport || !pathOutlineTipBtnRef.current) {
      setPathOutlineTipFixedTop(-1);
      return;
    }
    setPathOutlineTipFixedTop(readFixedTipTopBelowAnchor(pathOutlineTipBtnRef.current));
  }, [pathOutlineTipsOpen, tipsNarrowViewport]);

  useEffect(() => {
    if (!tipsNarrowViewport) {
      setPathOutlineTipFixedTop(-1);
    }
  }, [tipsNarrowViewport]);

  useEffect(() => {
    if (!pathDraft) setPathOutlineTipsOpen(false);
  }, [pathDraft]);

  useEffect(() => {
    setPathOutlineTipsOpen(false);
  }, [pathSelector]);

  useEffect(() => {
    if (!pathOutlineTipsOpen) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (pathOutlineTipsWrapRef.current?.contains(t)) return;
      setPathOutlineTipsOpen(false);
    };
    document.addEventListener('pointerdown', onDoc, true);
    return () => document.removeEventListener('pointerdown', onDoc, true);
  }, [pathOutlineTipsOpen]);

  useEffect(() => {
    if (!pathOutlineTipsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPathOutlineTipsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pathOutlineTipsOpen]);

  useEffect(() => {
    if (!tipsNarrowViewport || !pathOutlineTipsOpen || pathOutlineTipFixedTop < 0) return;
    const onMove = () => syncPathOutlineTipTop();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [tipsNarrowViewport, pathOutlineTipsOpen, pathOutlineTipFixedTop, syncPathOutlineTipTop]);

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

  const pathToolbarListboxOptions = useMemo(() => {
    if (pathsLoading) return [];
    return [
      { value: '__new__', label: '+ Create new path' },
      ...sortedPaths.map((p) => ({
        value: p.id,
        label: `${p.title || p.id} (${p.id})`,
      })),
    ];
  }, [pathsLoading, sortedPaths]);

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
    if (branchModal.kind !== 'changeType' && branchModal.kind !== 'changeOutlineModuleMerge') return;
    if (!findBranchNode(pathBranchTree, branchModal.nodeId)) {
      setBranchModal({ kind: 'closed' });
    }
  }, [branchModal, pathBranchTree]);

  const branchModalContextHint = useMemo(() => {
    if (branchModal.kind === 'changeType') {
      const src = findBranchNode(pathBranchTree, branchModal.nodeId);
      if (isRootBranchId(pathBranchTree, branchModal.nodeId) && src?.kind === 'label') {
        return 'Outline module: pick a new branch type. Nested rows stay when the new type allows; a section divider drops nested rows.';
      }
      if (isRootBranchId(pathBranchTree, branchModal.nodeId)) {
        return 'Top-level rows are an outline module or a catalog unit. Pick a new type; nested rows stay when the new type allows.';
      }
      return 'Pick a new type. Nested rows are removed if you choose a section divider; otherwise they stay when the new type allows.';
    }
    if (branchModal.kind === 'add') {
      const pos =
        branchModal.insertIndex !== undefined
          ? ' Inserts at the position you chose in the list.'
          : '';
      if (branchModal.parentId == null) {
        return `Top level: Add module here opens the name step first; or pick catalog unit, whole course, link, or (where allowed) divider below.${pos}`;
      }
      return undefined;
    }
    return undefined;
  }, [branchModal, pathBranchTree, publishedList]);

  const pathBranchFlatnessIssues = useMemo(
    () => collectPathBranchStructureIssues(pathBranchTree, publishedList),
    [pathBranchTree, publishedList]
  );

  const pathOutlineCounts = useMemo(() => {
    const topLevelCount = pathBranchTree.length;
    const totalRowCount = countPathBranchTreeNodes(pathBranchTree);
    return { topLevelCount, totalRowCount };
  }, [pathBranchTree]);

  const applyPickNewPath = useCallback(async () => {
    const reserveIds = pathSelector === '__new__' && pathDraft?.id ? [pathDraft.id] : [];
    const docIds = await pathDocumentIdsForAllocation();
    const newId = firstAvailableStructuredLearningPathIdFromDocIds(docIds, reserveIds);
    const fresh: LearningPath = { id: newId, title: '', courseIds: [], catalogPublished: false };
    const defaultModule: PathBranchNode = {
      id: newMindmapNodeId(),
      kind: 'label',
      label: '',
      children: [],
    };
    setShowPathCourseRequiredHint(false);
    setPathBranchTree([defaultModule]);
    setPathBranchTreeBaselineJson(JSON.stringify([defaultModule]));
    setBranchModal({ kind: 'closed' });
    setPathTitleFocusKey((k) => k + 1);
    setPathSelector('__new__');
    setPathDraft(fresh);
    setPathBaselineJson(JSON.stringify(fresh));
    setExpandedBranchIds(new Set([defaultModule.id]));
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
        title: t,
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

  useBodyScrollLock(
    !!pathConfirmDialog ||
      branchModal.kind !== 'closed' ||
      pathTitleConflict !== null ||
      dividerRemovePending !== null
  );

  useDialogKeyboard({
    open: !!pathConfirmDialog,
    onClose: closePathConfirmDialog,
    onPrimaryAction: confirmPathDialogPrimary,
  });

  useDialogKeyboard({
    open: !!dividerRemovePending,
    onClose: closeDividerRemoveDialog,
    /** Safe default: keep nested rows (same as the primary “Keep rows” action). */
    onPrimaryAction: confirmDividerRemoveHoistNested,
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
      setShowPathTitleRequiredHint(true);
      setPathDetailsOpen(true);
      showActionToast('Add a path title before saving.', 'danger');
      requestAnimationFrame(() => {
        const el = document.getElementById('admin-path-title') as HTMLInputElement | null;
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus({ preventScroll: true });
      });
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
      const titleHit = findPathSaveTitleConflict(pathDraft.title, pathDraft.id, pathRows);
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

  return (
    <div className="min-w-0 w-full space-y-4">
      <AdminDisplayNameConflictDialog
        open={pathTitleConflict !== null}
        savingLabel="path"
        conflict={pathTitleConflict}
        renameFieldId="admin-path-title"
        onPrepareRenameField={() => setPathDetailsOpen(true)}
        onClose={() => setPathTitleConflict(null)}
      />
      {actionToast}

      {isCreatorPaths && publishedList.length === 0 && (
        <p
          className="rounded-xl border border-[#8b8c8c]/65 bg-[#757676]/12 px-3 py-2.5 text-xs leading-relaxed text-[var(--text-secondary)] sm:text-sm"
          role="status"
        >
          You have no courses yet. Open the <strong className="font-semibold text-[var(--text-primary)]">Catalog</strong>{' '}
          tab, create a course, then return here to add it to a path outline.
        </p>
      )}

      <div className="space-y-3">
        <div className="min-w-0 pb-0.5 md:overflow-x-auto md:overflow-y-visible md:[-webkit-overflow-scrolling:touch]">
          <div className="flex w-full min-w-0 flex-col gap-3 md:min-w-[min(100%,920px)] lg:flex-row lg:flex-nowrap lg:items-center lg:gap-3 lg:overflow-x-auto lg:overflow-y-visible lg:[-webkit-overflow-scrolling:touch] lg:[scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden">
            <div className="flex min-h-6 min-w-0 shrink-0 flex-wrap items-center gap-x-1.5 gap-y-1 lg:shrink-0">
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
                    <code className="text-[#616161] app-dark:text-[var(--tone-200)]">P1</code>, <code className="text-[#616161] app-dark:text-[var(--tone-200)]">P2</code>…; list
                    A–Z.
                  </li>
                )}
                <li>
                  {isCreatorPaths
                    ? 'Add courses from the Catalog tab to the outline — path rows only offer courses you have created there.'
                    : 'Add any course from the live catalog. Learners only see course/lesson rows when the course is published in the Catalog tab and Show is on for that row.'}
                </li>
              </AdminLabelInfoTip>
            </div>
            <AdminListboxSelect
              id="admin-learning-path-select"
              value={pathSelector}
              onChange={pickPath}
              options={pathToolbarListboxOptions}
              disabled={pathsLoading}
              placeholder={pathsLoading ? 'Loading paths…' : 'Choose a path…'}
              emptyMessage="No paths in list"
              triggerClassName="admin-toolbar-main-select box-border min-h-11 min-w-0 w-full touch-manipulation rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-base text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm lg:min-w-[12rem] lg:flex-1 lg:max-w-none"
            />
            <div className="flex min-w-0 flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-x-4 md:gap-y-2 lg:flex-row lg:flex-nowrap lg:items-center lg:justify-start lg:gap-x-3 lg:gap-y-0 lg:shrink-0">
              <div className="flex w-full min-w-0 flex-row flex-nowrap items-center gap-2 overflow-x-auto overflow-y-visible overscroll-x-contain border-t border-[var(--border-color)]/60 pt-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] md:w-auto md:max-w-[min(100%,42rem)] md:flex-wrap md:overflow-visible md:border-t-0 md:pt-0 lg:w-auto lg:max-w-none lg:flex-nowrap lg:shrink-0 [&::-webkit-scrollbar]:hidden">
                <div className="flex min-w-0 shrink-0 flex-nowrap items-center gap-2">
                  <div
                    className="box-border flex min-w-0 max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-2 text-sm font-mono text-[var(--text-primary)] md:px-2.5"
                    aria-live="polite"
                    title="Firestore document id"
                  >
                    <Hash size={16} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
                    {pathDraft ? (
                      <span className="truncate text-[#616161] app-dark:text-[var(--tone-200)]">{pathDraft.id}</span>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </div>
                  {pathSelector !== '__new__' && pathSelector !== '' ? (
                    <button
                      type="button"
                      disabled={
                        pathsLoading || !pathSelector || !paths.some((p) => p.id === pathSelector)
                      }
                      onClick={requestDuplicatePathOrConfirm}
                      title="Clone the selected path into a new draft with a new path id"
                      aria-label="Duplicate path as new draft"
                      className="inline-flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-lg border border-[var(--border-color)] hover:bg-[var(--hover-bg)] disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Copy size={18} aria-hidden />
                    </button>
                  ) : null}
                </div>
                <div
                  className="box-border flex min-h-11 min-w-[7.5rem] max-w-[min(100%,16rem)] shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-2 text-sm text-[var(--text-primary)] md:max-w-none md:px-2.5"
                  aria-live="polite"
                  title="Distinct courses referenced in this path outline"
                >
                  <Layers size={16} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
                  {pathDraft ? (
                    <span className="min-w-0 truncate">
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
              <div
                className="flex w-full min-w-0 shrink-0 flex-row flex-nowrap items-center gap-1.5 overflow-x-auto overflow-y-visible overscroll-x-contain border-t border-[var(--border-color)]/60 py-1 pt-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] md:ml-auto md:w-auto md:flex-wrap md:justify-end md:gap-2 md:overflow-visible md:border-t-0 md:py-0 md:pt-0 lg:ml-0 lg:w-auto lg:shrink-0 lg:justify-start [&::-webkit-scrollbar]:hidden"
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
                  className="inline-flex min-h-11 shrink-0 touch-manipulation items-center justify-center gap-2 rounded-xl bg-[#616161] px-4 py-2 text-sm font-bold text-[#e7e7e7] hover:bg-[#757676] disabled:opacity-40 sm:px-5"
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
                    className="inline-flex size-11 shrink-0 items-center justify-center text-[#616161] app-dark:text-[#a1a2a2]"
                    title="Unsaved changes"
                  >
                    <AlertCircle size={20} strokeWidth={2} aria-hidden />
                    <span className="sr-only">Unsaved changes</span>
                  </span>
                ) : pathDraft && !pathDirty && pathSelector !== '__new__' ? (
                  <span
                    role="status"
                    className="inline-flex size-11 shrink-0 items-center justify-center text-[#616161] app-dark:text-[#a1a2a2]"
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
                      className="h-4 w-4 shrink-0 rounded border-[var(--border-color)] checkbox-accent-theme"
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
                className="flex items-center border-l-2 border-[#616161]/25 pl-3 md:pl-4"
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
                  className="inline-flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-md border-2 border-[#616161]/50 bg-transparent px-3 py-2 text-sm font-semibold text-[#616161] hover:bg-[#757676]/12 app-dark:text-[#cfcfcf] disabled:opacity-40"
                >
                  <Trash2 size={17} className="shrink-0" aria-hidden />
                  <span className="max-sm:sr-only">Delete</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        </div>
        {!isCreatorPaths &&
        pathDraft &&
        isLearningPathCatalogPublished(pathDraft) &&
        platformPathHasUnpublishedCourse ? (
          <p
            className="whitespace-pre-line rounded-lg border border-[#8b8c8c]/75 bg-[#757676]/12 px-3 py-2 text-xs font-medium text-[#393a3a] app-dark:text-[#e7e7e7] sm:text-sm"
            role="status"
          >
            {formatPathPublishBlockedByCoursesMessage(platformPathLearnerVisibleUnpublishedCourses)}
          </p>
        ) : null}
      </div>

      {!pathDraft && !pathsLoading ? (
        <div className="rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)]/35 px-4 py-8 text-center sm:py-10">
          <Route size={28} className="mx-auto mb-3 text-admin-icon opacity-70" aria-hidden />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Select or create a path</p>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-[var(--text-muted)]">
            Pick an existing path from the menu, or choose <span className="font-medium text-[var(--text-secondary)]">Create new path</span> to start fresh.
          </p>
        </div>
      ) : null}

      {pathDraft ? (
        <div className="space-y-3">
          <div
            ref={pathDetailsDisclosureRef}
            className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/20"
          >
            <button
              type="button"
              onClick={() => setPathDetailsOpen((v) => !v)}
              className="flex w-full min-w-0 items-center justify-between gap-2 px-4 py-3 text-left"
              aria-expanded={pathDetailsOpen}
              aria-label={`Path details, ${pathOutlineCounts.topLevelCount} top-level outline row${
                pathOutlineCounts.topLevelCount === 1 ? '' : 's'
              }, ${pathOutlineCounts.totalRowCount} total row${pathOutlineCounts.totalRowCount === 1 ? '' : 's'}`}
            >
              <span className="min-w-0 truncate text-sm font-bold text-[var(--text-primary)]">Path details</span>
              <span className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
                <span className="text-right text-xs font-medium tabular-nums text-[var(--text-muted)]">
                  {pathOutlineCounts.topLevelCount}{' '}
                  {pathOutlineCounts.topLevelCount === 1 ? 'top-level row' : 'top-level rows'}
                  <span aria-hidden> . </span>
                  {pathOutlineCounts.totalRowCount}{' '}
                  {pathOutlineCounts.totalRowCount === 1 ? 'row' : 'rows'} total
                </span>
                {pathDetailsOpen ? (
                  <ChevronDown size={16} className="shrink-0 text-[var(--text-secondary)]" aria-hidden />
                ) : (
                  <ChevronRight size={16} className="shrink-0 text-[var(--text-secondary)]" aria-hidden />
                )}
              </span>
            </button>
            {pathDetailsOpen && (
              <div className="border-t border-[var(--border-color)] p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block min-w-0 space-y-1 sm:col-span-2" htmlFor="admin-path-title">
                    <span className="text-xs font-semibold text-[var(--text-secondary)]">Path title</span>
                    <input
                      id="admin-path-title"
                      value={pathDraft.title}
                      onChange={(e) => {
                        setShowPathTitleRequiredHint(false);
                        setPathDraft((p) => (p ? { ...p, title: e.target.value } : p));
                      }}
                      placeholder="Short name shown to learners (e.g. Full-Stack Track)"
                      className={`w-full min-w-0 rounded-lg border bg-[var(--bg-primary)] px-3 py-2 text-sm ${
                        showPathTitleRequiredHint ? 'border-[#616161]' : 'border-[var(--border-color)]'
                      }`}
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
              </div>
            )}
          </div>

          <div
            id="admin-path-branches"
            className={`space-y-1.5 ${pathMindmapLoading ? 'pointer-events-none opacity-60' : ''}`}
          >
            <div className="space-y-1">
              <div className="relative z-20 mb-1 flex flex-wrap items-start gap-2 pb-0 sm:mb-1.5 sm:pb-0">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                  <h3 className="text-xs font-semibold text-[var(--text-secondary)]">Outline</h3>
                  <span ref={pathOutlineTipsWrapRef} className="relative z-10 inline-flex shrink-0 items-center gap-1">
                    <button
                      ref={pathOutlineTipBtnRef}
                      type="button"
                      onClick={() => setPathOutlineTipsOpen((o) => !o)}
                      aria-expanded={pathOutlineTipsOpen}
                      aria-controls="admin-path-outline-tips"
                      aria-label={pathOutlineTipsOpen ? 'Close outline tips' : 'Open outline tips'}
                      className={`inline-flex size-6 shrink-0 touch-manipulation items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/45 active:opacity-90 ${
                        pathOutlineTipsOpen ? 'border-[#8b8c8c]/90 text-[#616161] app-dark:border-[var(--tone-400)] app-dark:text-[var(--tone-100)]' : ''
                      }`}
                    >
                      <Info size={14} className="text-admin-icon opacity-90" aria-hidden />
                    </button>
                    <div
                      id="admin-path-outline-tips"
                      role="region"
                      aria-label="Path outline tips"
                      tabIndex={
                        pathOutlineTipsOpen && tipsNarrowViewport && pathOutlineTipFixedTop >= 0
                          ? -1
                          : undefined
                      }
                      onPointerDown={
                        pathOutlineTipsOpen && tipsNarrowViewport && pathOutlineTipFixedTop >= 0
                          ? (e) => (e.currentTarget as HTMLElement).focus({ preventScroll: true })
                          : undefined
                      }
                      className={
                        !pathOutlineTipsOpen
                          ? 'hidden'
                          : tipsNarrowViewport
                            ? pathOutlineTipFixedTop >= 0
                              ? 'fixed z-[120] left-3 right-3 w-auto max-w-none translate-x-0 overflow-y-auto overflow-x-hidden overscroll-y-contain [-webkit-overflow-scrolling:touch] touch-pan-y max-h-[calc(100dvh-var(--admin-tip-top)-env(safe-area-inset-bottom,0px)-0.75rem)] rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3.5 text-left text-sm leading-relaxed text-[var(--text-primary)] shadow-xl pointer-events-auto outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/45'
                              : 'hidden'
                            : 'absolute left-0 top-full z-[100] mt-2 w-[min(22rem,calc(100vw-2rem))] max-w-sm rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-left text-xs leading-snug text-[var(--text-primary)] shadow-lg pointer-events-auto'
                      }
                      style={
                        pathOutlineTipsOpen && tipsNarrowViewport && pathOutlineTipFixedTop >= 0
                          ? narrowAdminTipPanelStyle(pathOutlineTipFixedTop)
                          : undefined
                      }
                    >
                      <ul className="list-disc space-y-1.5 pl-4 text-[var(--text-muted)] marker:text-[#757676]/90 app-dark:marker:text-[var(--tone-300)] sm:space-y-1">
                        <li>
                          <strong className="font-semibold text-[var(--text-secondary)]">Add module here</strong> before
                          the first top-level row and between rows. On desktop, when the path already has rows, hover or
                          focus the gap between cards to reveal the control.
                        </li>
                        <li>
                          <strong className="font-semibold text-[var(--text-secondary)]">Add branch here</strong> at the
                          start and between rows (hover or focus the gap on desktop) — pick catalog unit, whole course,
                          link, lesson, or (where allowed) section divider.
                        </li>
                        <li>
                          <strong className="font-semibold text-[var(--text-secondary)]">Section divider</strong> groups
                          rows beneath it; use the kind badge chevron to expand or collapse that group in the builder
                          (learners get the same on desktop).
                        </li>
                        <li>
                          Courses and lessons in the outline update{' '}
                          <strong className="font-semibold text-[var(--text-secondary)]">Linked courses</strong> in the path
                          toolbar.
                        </li>
                        <li>
                          <strong className="font-semibold text-[var(--text-secondary)]">Show</strong> off hides the row
                          for everyone. On: <strong className="font-semibold text-[var(--text-secondary)]">User</strong> or{' '}
                          <strong className="font-semibold text-[var(--text-secondary)]">Administrators only</strong>.
                          Course rows: learners need the course published in the Catalog tab too.
                        </li>
                        <li>Reorder: row ↑/↓, or Arrow keys when a reorder control is focused.</li>
                        <li>
                          <strong className="font-semibold text-[var(--text-secondary)]">Copy</strong> on a row opens
                          placement for duplicate or move (same idea as the course catalog).
                        </li>
                      </ul>
                    </div>
                  </span>
                </div>
              </div>
              {pathBranchFlatnessIssues.length > 0 ? (
                <div
                  role="status"
                  className="rounded-lg border border-[#8b8c8c]/80 bg-[#757676]/12 px-3 py-2 text-xs leading-relaxed text-[var(--text-primary)]"
                >
                  <p className="font-semibold text-[#393a3a] app-dark:text-[#cfcfcf]">Outline needs flattening</p>
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
                    className="mt-2 inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-[#616161] px-3 py-2 text-xs font-bold text-[#e7e7e7] hover:bg-[#4c4d4d] disabled:opacity-40 sm:w-auto"
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
                  <div className="rounded-xl border border-dashed border-[#8b8c8c]/75 bg-[#757676]/12 px-4 py-6 sm:px-6">
                    <p className="text-center text-sm font-semibold text-[var(--text-primary)]">Start your outline</p>
                    <p className="mt-2 text-center text-xs leading-relaxed text-[var(--text-muted)]">
                      {pathSelector === '__new__' ? (
                        <>
                          Add your first outline module with{' '}
                          <strong className="text-[var(--text-secondary)]">Add module here</strong> — you type the name in
                          the dialog. Then use gutters between top-level rows or{' '}
                          <strong className="text-[var(--text-secondary)]">Add branch here</strong> under a module for nested
                          items. After you save, you can add a top-level{' '}
                          <strong className="text-[var(--text-secondary)]">catalog unit</strong> from the branch picker.
                        </>
                      ) : (
                        <>
                          Top-level rows are usually an <strong className="text-[var(--text-secondary)]">outline module</strong> or a{' '}
                          <strong className="text-[var(--text-secondary)]">catalog unit</strong>. Under an outline module, add courses,
                          lessons, links, or dividers. Under a catalog unit, add{' '}
                          <strong className="text-[var(--text-secondary)]">only lessons</strong> from that unit.
                        </>
                      )}
                    </p>
                    <div className="mt-4 flex flex-col gap-2">
                      <button
                        type="button"
                        disabled={!!pathMindmapLoading && pathSelector !== '__new__'}
                        onClick={() => setBranchModal({ kind: 'add', parentId: null, insertIndex: 0, preset: 'label' })}
                        className="flex min-h-12 w-full flex-col items-start gap-0.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-3 text-left transition-colors hover:border-[#8b8c8c]/80 hover:bg-[var(--hover-bg)] disabled:opacity-40"
                      >
                        <span className="flex w-full items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                          <Plus size={18} className="shrink-0 text-admin-icon" aria-hidden />
                          Add module here
                        </span>
                        <span className="pl-[1.625rem] text-xs text-[var(--text-muted)]">
                          Opens the dialog to enter the module name before it appears in the outline
                        </span>
                      </button>
                    </div>
                    <p className="mt-4 text-center text-[11px] leading-relaxed text-[var(--text-muted)]">
                      {pathSelector === '__new__' ? (
                        <>
                          More outline modules: hover a top-level gutter for{' '}
                          <strong className="text-[var(--text-secondary)]">Add module here</strong>
                          {', '}
                          or <strong className="text-[var(--text-secondary)]">Add branch here</strong> to append under the row above.
                        </>
                      ) : (
                        <>
                          More top-level modules: hover for{' '}
                          <strong className="text-[var(--text-secondary)]">Add module here</strong>. Under a module, use{' '}
                          <strong className="text-[var(--text-secondary)]">Add branch here</strong> for lessons only.
                        </>
                      )}
                    </p>
                  </div>
                ) : (
                  <div ref={pathBranchMindMapRootRef} className="@container/path-outline min-w-0">
                    <PathBranchTreeList
                      parentId={null}
                      nodes={pathBranchTree}
                      depth={0}
                      publishedList={publishedList}
                      expandedBranchIds={expandedBranchIds}
                      onToggleCollapse={toggleBranchCollapse}
                      onBranchRowFocus={focusBranchRow}
                      onInsertBranchAt={(pid, insertIndex, opts) => {
                        const roots = pathBranchTreeRef.current;
                        const preset = opts?.preset;
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
                            ? {
                                kind: 'add',
                                parentId: null,
                                insertIndex,
                                ...(preset ? { preset } : {}),
                              }
                            : {
                                kind: 'add',
                                parentId: pid,
                                insertIndex,
                                ...(preset ? { preset } : {}),
                              }
                        );
                      }}
                      onRemove={handleRemoveBranch}
                      onCopyBranch={handleDuplicateBranch}
                      onMove={moveBranchAmongSiblings}
                      onLabelChange={(id, label) =>
                        setPathBranchTree((roots) => {
                          const next = mapBranchNodeById(roots, id, (n) =>
                            n.kind === 'label' || n.kind === 'divider' ? { ...n, label } : n
                          );
                          const pid = findParentIdOfBranch(next, id);
                          const msg = pathSiblingTitleConflictAfterEdit(next, pid, publishedList);
                          if (msg) {
                            queueMicrotask(() => showActionToast(msg, 'danger'));
                            return roots;
                          }
                          return next;
                        })
                      }
                      onLinkBranchChange={(id, patch) =>
                        setPathBranchTree((roots) => {
                          const next = mapBranchNodeById(roots, id, (n) =>
                            n.kind === 'link' ? { ...n, ...patch } : n
                          );
                          const pid = findParentIdOfBranch(next, id);
                          const msg = pathSiblingTitleConflictAfterEdit(next, pid, publishedList);
                          if (msg) {
                            queueMicrotask(() => showActionToast(msg, 'danger'));
                            return roots;
                          }
                          return next;
                        })
                      }
                      onDividerEyebrowChange={(id, dividerEyebrow) =>
                        setPathBranchTree((roots) =>
                          mapBranchNodeById(roots, id, (n) => {
                            if (n.kind !== 'divider') return n;
                            const t = dividerEyebrow.trim();
                            if (!t) {
                              const { dividerEyebrow: _removed, ...rest } = n;
                              return rest as PathBranchNode;
                            }
                            return { ...n, dividerEyebrow: t };
                          })
                        )
                      }
                      onRequestChangeType={(id) => {
                        const roots = pathBranchTreeRef.current;
                        // Always ask for the target type first (then run specialized flows as needed).
                        setBranchModal({ kind: 'changeType', nodeId: id });
                      }}
                      onVisibleToRolesChange={(id, roles) =>
                        setPathBranchTree((roots) =>
                          mapBranchNodeById(roots, id, (n) => ({
                            ...n,
                            visibleToRoles: compactVisibleToRolesForPersist(roles),
                          }))
                        )
                      }
                    />
                  </div>
                )
            )}
          </div>

          {pathDraft.courseIds.length === 0 && showPathCourseRequiredHint ? (
            <p id="admin-path-course-required-hint" className="text-xs font-medium text-[#616161] app-dark:text-[#cfcfcf]">
              Link at least one course (or lesson) before saving. Links alone do not count as catalog courses.
            </p>
          ) : null}

          <AddPathBranchModal
            open={
              branchModal.kind === 'add' ||
              (branchModal.kind === 'changeType' && changeTypeSource != null)
            }
            onClose={() => {
              if (suppressBranchModalCloseOnceRef.current) {
                suppressBranchModalCloseOnceRef.current = false;
                return;
              }
              setBranchModal({ kind: 'closed' });
            }}
            catalogCourses={catalogCoursesForPathPicker}
            catalogCoursesForLabels={publishedList}
            contextHint={branchModalContextHint}
            addPreset={branchModal.kind === 'add' ? branchModal.preset : undefined}
            changeTypeRootRowLabelOnly={addPathBranchModalChangeTypeRootLabelOnly}
            allowSectionDivider={addPathBranchModalAllowDivider}
            lessonAddContext={branchModal.kind === 'add' ? branchModal.lessonAddContext ?? null : null}
            showModuleInKindPicker={addPathBranchModalShowModuleKind}
            replaceSource={changeTypeSource}
            mode={branchModal.kind === 'changeType' ? 'changeType' : 'add'}
            onCommit={(branch) => {
              if (branchModal.kind === 'changeType') {
                const roots = pathBranchTreeRef.current;
                const currentParentId = findParentIdOfBranch(roots, branchModal.nodeId);
                const typeChangeMustMoveToTopLevel =
                  currentParentId !== null && (branch.kind === 'label' || branch.kind === 'module');
                if (typeChangeMustMoveToTopLevel) {
                  // Prompt for placement instead of silently appending at end.
                  suppressBranchModalCloseOnceRef.current = true;
                  setBranchModal({
                    kind: 'changeTypePlaceTopLevel',
                    sourceId: branchModal.nodeId,
                    converted: branch,
                  });
                  return;
                }
                const typeChangeMustMoveUnderAParent =
                  currentParentId === null && branch.kind !== 'label' && branch.kind !== 'module';
                if (typeChangeMustMoveUnderAParent) {
                  const top = roots.find((r) => r.kind === 'label')?.id ?? null;
                  suppressBranchModalCloseOnceRef.current = true;
                  setBranchModal({
                    kind: 'changeTypePlaceNonRoot',
                    sourceId: branchModal.nodeId,
                    converted: branch,
                    defaultTopParentId: top,
                  });
                  return;
                }
                const next = mapBranchNodeById(roots, branchModal.nodeId, () => branch);
                const pid = findParentIdOfBranch(next, branchModal.nodeId);
                const msg = pathSiblingTitleConflictAfterEdit(next, pid, publishedList);
                if (msg) {
                  showActionToast(msg, 'danger');
                  return;
                }
                setPathBranchTree(next);
                setBranchModal({ kind: 'closed' });
                return;
              }
              if (branchModal.kind === 'add') {
                const roots = pathBranchTreeRef.current;
                const next =
                  branchModal.insertIndex !== undefined
                    ? insertChildAtParent(roots, branchModal.parentId, branchModal.insertIndex, branch)
                    : addChildAtParent(roots, branchModal.parentId, branch);
                if (branchModal.parentId != null) {
                  const msg = pathSiblingTitleConflictAfterEdit(next, branchModal.parentId, publishedList);
                  if (msg) {
                    showActionToast(msg, 'danger');
                    return;
                  }
                }
                setPathBranchTree(next);
                if (branchModal.parentId != null) {
                  setExpandedBranchIds((prev) => accordionExpandBranchRow(prev, next, branchModal.parentId!));
                }
                setBranchModal({ kind: 'closed' });
              }
            }}
          />

          {branchModal.kind === 'changeTypePlaceTopLevel' ? (
            <PlaceConvertedTopLevelModal
              open
              roots={pathBranchTree}
              publishedList={publishedList}
              converted={branchModal.converted}
              onClose={() => setBranchModal({ kind: 'closed' })}
              onCommit={(insertIndex) => {
                const roots = pathBranchTreeRef.current;
                const { next: without } = extractNodeById(roots, branchModal.sourceId);
                const next = insertChildAtParent(without, null, insertIndex, branchModal.converted);
                const msg = pathSiblingTitleConflictAfterEdit(next, null, publishedList);
                if (msg) {
                  showActionToast(msg, 'danger');
                  return;
                }
                setPathBranchTree(next);
                setBranchModal({ kind: 'closed' });
              }}
            />
          ) : null}

          {branchModal.kind === 'changeTypePlaceNonRoot' ? (
            <PlaceDuplicateBranchModal
              open
              sourceSnapshot={branchModal.converted}
              // Hide the soon-to-be-removed top-level row while picking a destination.
              roots={removeNodeById(pathBranchTree, branchModal.sourceId)}
              publishedList={publishedList}
              defaultTopParentId={branchModal.defaultTopParentId}
              fixedMode="move"
              forceNonRootPlacement
              onClose={() => setBranchModal({ kind: 'closed' })}
              onRemember={(prefs) => {
                const next = duplicatePlaceRememberRef.current;
                const slot = { parentId: prefs.parentId, insert: prefs.insert };
                next.perMode.copy = slot;
                next.perMode.move = slot;
              }}
              onCommit={(parentId, insertIndex) => {
                if (parentId == null) return;
                const roots = pathBranchTreeRef.current;
                const { next: without } = extractNodeById(roots, branchModal.sourceId);
                const next = insertChildAtParent(without, parentId, insertIndex, branchModal.converted);
                const msg = pathSiblingTitleConflictAfterEdit(next, parentId, publishedList);
                if (msg) {
                  showActionToast(msg, 'danger');
                  return;
                }
                setPathBranchTree(next);
                setExpandedBranchIds((prev) => accordionExpandBranchRow(prev, next, parentId));
                setBranchModal({ kind: 'closed' });
              }}
            />
          ) : null}

          {branchModal.kind === 'changeOutlineModuleMerge' ? (
            <ChangePathOutlineModuleMergeModal
              open
              sourceId={branchModal.nodeId}
              roots={pathBranchTree}
              publishedList={publishedList}
              onClose={() => setBranchModal({ kind: 'closed' })}
              onPickOtherType={() => setBranchModal({ kind: 'changeType', nodeId: branchModal.nodeId })}
              onConfirm={(targetId, insertAt) => {
                const sourceId = branchModal.nodeId;
                const next = applyMergeOutlineLabelIntoDividerAt(
                  pathBranchTreeRef.current,
                  sourceId,
                  targetId,
                  insertAt
                );
                if (!next) {
                  showActionToast(
                    'Could not merge — pick another outline module or position. Source and target must be different outline modules.',
                    'danger'
                  );
                  return;
                }
                setPathBranchTree(next);
                setExpandedBranchIds((prev) => {
                  const n = new Set(prev);
                  stripBranchExpandState(n, next, sourceId);
                  return accordionExpandBranchRow(n, next, targetId);
                });
                setBranchModal({ kind: 'closed' });
                showActionToast('Outline module merged as a section divider at the position you chose.', 'neutral');
              }}
            />
          ) : null}

          {branchModal.kind === 'duplicatePlace' ? (
            <PlaceDuplicateBranchModal
              open
              sourceSnapshot={branchModal.sourceSnapshot}
              roots={pathBranchTree}
              publishedList={publishedList}
              defaultTopParentId={branchModal.sourceParentId}
              initialMode={duplicatePlaceRememberRef.current.mode}
              initialParentId={
                duplicatePlaceRememberRef.current.perMode[duplicatePlaceRememberRef.current.mode].parentId
              }
              initialInsert={duplicatePlaceRememberRef.current.perMode[duplicatePlaceRememberRef.current.mode].insert}
              onClose={() => setBranchModal({ kind: 'closed' })}
              onRemember={(prefs) => {
                const next = duplicatePlaceRememberRef.current;
                const slot = { parentId: prefs.parentId, insert: prefs.insert };
                next.perMode.copy = slot;
                next.perMode.move = slot;
              }}
              onCommit={(parentId, insertIndex, payload) => {
                duplicatePlaceRememberRef.current.mode = payload.mode;
                const roots = pathBranchTreeRef.current;
                if (payload.mode === 'copy') {
                  const br = payload.branch;
                  if (parentId === null && br.kind !== 'label' && br.kind !== 'module') {
                    showActionToast('Only outline modules or catalog units can be placed at the top level.', 'danger');
                    return;
                  }
                  if (br.kind === 'module' && parentId !== null) {
                    showActionToast('Catalog units can only be placed at the top level.', 'danger');
                    return;
                  }
                  if (
                    leafOutlineModuleOrCatalogWithoutChildren(br) &&
                    !duplicateSubtreeRequiresTopLevelOnly(br) &&
                    parentId !== null
                  ) {
                    showActionToast(
                      'This outline module or catalog row can only be copied onto the top-level outline.',
                      'danger'
                    );
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
                  if (parentId != null) {
                    const msg = pathSiblingTitleConflictAfterEdit(next, parentId, publishedList);
                    if (msg) {
                      showActionToast(msg, 'danger');
                      return;
                    }
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
                if (
                  leafOutlineModuleOrCatalogWithoutChildren(snap) &&
                  !duplicateSubtreeRequiresTopLevelOnly(snap)
                ) {
                  showActionToast(
                    'This outline module or catalog row has no nested rows — only a top-level copy is available from here. Use ↑↓ on the row to change position.',
                    'danger'
                  );
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
                  showActionToast('Only outline modules or catalog units can be placed at the top level.', 'danger');
                  return;
                }
                if (snap.kind === 'module' && parentId !== null) {
                  showActionToast('Catalog units can only be placed at the top level.', 'danger');
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
                if (parentId != null) {
                  const msg = pathSiblingTitleConflictAfterEdit(next, parentId, publishedList);
                  if (msg) {
                    showActionToast(msg, 'danger');
                    return;
                  }
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
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#272828]/70"
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
                  <X size={20} aria-hidden />
                </button>
              </div>
              <div className="space-y-4 p-6">
                <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{pathConfirmCopy.body}</p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    autoFocus
                    onClick={() => void confirmPathDialogPrimary()}
                    className={`inline-flex min-h-11 w-full items-center justify-center rounded-xl px-5 py-3 text-sm font-bold text-[#e7e7e7] transition-colors sm:w-auto ${
                      pathConfirmDialog.kind === 'deletePublished'
                        ? 'bg-[#616161] hover:bg-[#4c4d4d]'
                        : 'bg-[#616161] hover:bg-[#757676]'
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

      {dividerRemovePending ? (
        <div
          className="fixed inset-0 z-[190] flex items-end justify-center bg-[#272828]/70 p-0 sm:items-center sm:p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeDividerRemoveDialog();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="path-divider-remove-title"
            className="flex max-h-[min(90dvh,520px)] w-full max-w-lg flex-col rounded-t-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl sm:rounded-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
              <span className="inline-flex min-h-10 min-w-10 shrink-0" aria-hidden />
              <h2
                id="path-divider-remove-title"
                className="min-w-0 flex-1 text-center text-base font-bold text-[var(--text-primary)] sm:text-lg"
              >
                Remove divider?
              </h2>
              <button
                type="button"
                onClick={closeDividerRemoveDialog}
                className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-full text-[#616161] transition-colors hover:bg-[#757676]/15 hover:text-[#4c4d4d] app-dark:text-[#cfcfcf] app-dark:hover:text-[#cfcfcf]"
                aria-label="Close"
              >
                <X size={20} strokeWidth={2.25} aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
              <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                <strong className="text-[var(--text-primary)]">“{dividerRemovePending.label}”</strong> groups{' '}
                <strong className="text-[var(--text-primary)]">{dividerRemovePending.nestedCount}</strong> nested outline
                row{dividerRemovePending.nestedCount === 1 ? '' : 's'} (courses, lessons, links, etc.).
              </p>
              <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                <strong className="text-[var(--text-primary)]">Keep rows</strong> — drop the divider and leave those rows
                in the module list. <strong className="text-[var(--text-primary)]">Delete all</strong> — remove the divider
                and everything under it. Use the close control above to dismiss without changes.
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end sm:gap-3">
                <button
                  type="button"
                  onClick={() => void confirmDividerRemoveDeleteNested()}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[#616161]/50 bg-[#757676]/12 px-4 py-3 text-sm font-bold text-[#4c4d4d] transition-colors hover:bg-[#757676]/18 app-dark:text-[#cfcfcf] sm:w-auto"
                >
                  Delete all
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => void confirmDividerRemoveHoistNested()}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#616161] px-4 py-3 text-sm font-bold text-[#e7e7e7] shadow-sm transition-colors hover:bg-[#757676] sm:w-auto"
                >
                  Keep rows
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
});
