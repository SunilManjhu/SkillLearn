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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  GraduationCap,
  Link2,
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
import type { Course, Lesson } from '../../data/courses';
import { formatCourseTaxonomyForSearch } from '../../utils/courseTaxonomy';
import {
  compactVisibleToRolesForPersist,
  mindmapDocumentWithCenterChildren,
  newMindmapNodeId,
  type MindmapTreeNode,
  type PathOutlineAudienceRole,
} from '../../data/pathMindmap';
import type { LearningPath } from '../../data/learningPaths';
import { firstAvailableStructuredLearningPathId } from '../../utils/learningPathStructuredIds';
import {
  deleteLearningPath,
  loadLearningPathsFromFirestore,
  saveLearningPath,
} from '../../utils/learningPathsFirestore';
import { fetchPathMindmapFromFirestore, savePathMindmapToFirestore } from '../../utils/pathMindmapFirestore';
import { normalizeExternalHref } from '../../utils/externalUrl';
import { AdminLabelInfoTip } from './adminLabelInfoTip';
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

function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [removed] = next.splice(from, 1);
  next.splice(to, 0, removed);
  return next;
}

/** Tree node for path outline — synced to `pathMindmap` on save. Two levels only: top-level sections and sub-rows under each section (sub-rows cannot nest further). */
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
function flattenPathBranchSectionChildren(nodes: PathBranchNode[]): PathBranchNode[] {
  const out: PathBranchNode[] = [];
  const walk = (ns: PathBranchNode[]) => {
    for (const n of ns) {
      if (n.kind === 'divider') {
        out.push({ ...n, children: [] });
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
  for (const section of roots) {
    if (section.kind === 'divider') {
      issues.push('A divider cannot be a top-level section — move it under a section or delete it.');
      continue;
    }
    const secLabel = branchNodeDisplayLabel(section, publishedList);
    for (const row of section.children) {
      if (row.children.length > 0) {
        issues.push(
          `Under “${secLabel}”, “${branchNodeDisplayLabel(row, publishedList)}” has nested rows. Paths must be section → flat list only—flatten or remove nesting.`
        );
      }
    }
  }
  return issues;
}

function updateNodeChildren(n: PathBranchNode, children: PathBranchNode[]): PathBranchNode {
  if (n.kind === 'divider') return { ...n, children: [] };
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

function PlaceDuplicateBranchModal({
  open,
  onClose,
  branch,
  roots,
  publishedList,
  defaultTopParentId,
  onCommit,
}: {
  open: boolean;
  onClose: () => void;
  branch: PathBranchNode;
  roots: PathBranchNode[];
  publishedList: Course[];
  /** When duplicating a nested row, prefer its current top-level section as the first dropdown. */
  defaultTopParentId: string | null;
  onCommit: (parentId: string | null, insertIndex: number, namedBranch: PathBranchNode) => void;
}) {
  const topLevelOnly = duplicateSubtreeRequiresTopLevelOnly(branch);
  const [parentId, setParentId] = useState<string | null>(null);
  const [insertIndex, setInsertIndex] = useState(0);
  const [copyNameInput, setCopyNameInput] = useState('');

  const rootsRef = useRef(roots);
  rootsRef.current = roots;

  const parentOptions = useMemo(() => {
    const opts: { id: string | null; label: string }[] = [{ id: null, label: 'Top of outline' }];
    if (topLevelOnly) return opts;
    for (const r of topLevelParentsForDuplicate(roots)) {
      if (!parentAllowsChildRows(roots, r.id)) continue;
      opts.push({
        id: r.id,
        label: branchNodeDisplayLabel(r, publishedList),
      });
    }
    return opts;
  }, [roots, publishedList, topLevelOnly]);

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
  }, [open, branch.id, topLevelOnly, defaultTopParentId]);

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
  }, [open, branch.id]);

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
    () => duplicateRootEditableTitleBase(branch, publishedList) + ' (copy)',
    [branch, publishedList]
  );

  const showCopyNameField = duplicateRootHasEditableTitle(branch);

  useDialogKeyboard({ open, onClose });

  if (!open) return null;

  const summary = branchNodeDisplayLabel(branch, publishedList);
  const totalRows = countSubtreeRows(branch);
  const canCommit = effectiveParentId === null || findBranchNode(roots, effectiveParentId) != null;
  const subtreeHint =
    effectiveParentId === null
      ? 'Order among top-level rows.'
      : (() => {
          const p = findBranchNode(roots, effectiveParentId);
          return p
            ? `Order among rows inside “${branchNodeDisplayLabel(p, publishedList)}”.`
            : '';
        })();

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
            Place copy
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
          <p className="mb-3 text-xs leading-relaxed text-[var(--text-muted)]">
            Duplicating <strong className="text-[var(--text-secondary)]">{summary}</strong>
            {totalRows > 1 ? (
              <>
                {' '}
                ({totalRows} rows including nested)
              </>
            ) : null}
            . Choose where the new copy should appear.
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
              Course and lesson rows keep the catalog title; only the outline position changes.
            </p>
          )}

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)]" htmlFor="place-dup-parent">
                Top parent
              </label>
              <p id="place-dup-parent-hint" className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                Top-level outline row that will contain the copy, or the main list.
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
                value={Math.min(insertIndex, siblings.length)}
                onChange={(e) => setInsertIndex(Number(e.target.value))}
              >
                {Array.from({ length: siblings.length + 1 }, (_, i) => (
                  <option key={i} value={i}>
                    {insertSlotLabel(siblings, i, publishedList)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            disabled={!canCommit}
            onClick={() => {
              const named = applyCopyNameToBranchRoot(branch, copyNameInput, publishedList);
              onCommit(effectiveParentId, Math.min(insertIndex, siblings.length), named);
            }}
            className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-40"
          >
            Place copy
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

type BranchModalStep = 'kind' | 'label' | 'divider' | 'course' | 'linkForm' | 'lessonCourse' | 'lessonPick';

function AddPathBranchModal({
  open,
  onClose,
  catalogCourses,
  onCommit,
  contextHint,
  mode = 'add',
  addPreset,
  allowSectionDivider = false,
  replaceSource = null,
}: {
  open: boolean;
  onClose: () => void;
  catalogCourses: readonly Course[];
  onCommit: (branch: PathBranchNode) => void;
  /** Where the new node will attach (top level vs nested). */
  contextHint?: string;
  mode?: 'add' | 'changeType';
  /** When `mode === 'add'`, skip the kind picker and open the matching step. */
  addPreset?: 'label' | 'course' | 'link' | 'divider';
  /** Section divider rows only make sense under a top-level section, not at the root list. */
  allowSectionDivider?: boolean;
  /** When changing an existing row’s type: keep id, visibility, and children when allowed. */
  replaceSource?: PathBranchNode | null;
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
    if (mode === 'changeType' && replaceSource) {
      setStep('kind');
      setLessonCourse(null);
      if (replaceSource.kind === 'label' || replaceSource.kind === 'divider') {
        setLabelInput(replaceSource.label);
      } else {
        setLabelInput('');
      }
      if (replaceSource.kind === 'link') {
        setLinkLabelInput(replaceSource.label);
        setLinkHrefInput(replaceSource.href);
      }
    } else {
      if (addPreset === 'label') {
        setStep('label');
      } else if (addPreset === 'divider') {
        setStep('divider');
      } else if (addPreset === 'course') {
        setStep('course');
      } else if (addPreset === 'link') {
        setStep('linkForm');
      } else {
        setStep('kind');
      }
      setLessonCourse(null);
    }
  }, [open, mode, catalogCourses, addPreset, allowSectionDivider, replaceSource]);

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
                if (step === 'course') {
                  setStep('kind');
                  return;
                }
                if (step === 'lessonCourse') {
                  setStep('kind');
                  return;
                }
                if (step === 'label' || step === 'divider') setStep('kind');
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
            {step === 'kind' && (mode === 'changeType' ? 'Change branch type' : 'Add a branch')}
            {step === 'label' && (replacing ? 'Text label' : 'Label')}
            {step === 'divider' && 'Section divider'}
            {step === 'linkForm' && 'Web link'}
            {step === 'course' && 'Choose course'}
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

function pathBranchKindBadgeShortLabel(kind: PathBranchNode['kind']): string {
  switch (kind) {
    case 'label':
      return 'Label';
    case 'divider':
      return 'Divider';
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
  const label = atTopLevel ? 'Add top-level branch here' : 'Add branch here';
  const title = atTopLevel
    ? 'Adds a new top-level row in the outline (a section with its own list).'
    : 'Adds a row inside this section at this position among its items.';
  const pad =
    depth > 0 ? ({ paddingLeft: `${Math.min(depth, 8) * 0.75}rem` } as const) : undefined;
  return (
    <li
      className={`group/ins relative min-w-0 list-none overflow-visible py-0.5 ${
        persistVisibleOnMd ? '' : 'md:h-0 md:py-0'
      }`}
    >
      {/* md+: zero list height; hover/focus hit strip straddles the gap between rows */}
      <div
        className={
          persistVisibleOnMd
            ? 'w-full'
            : 'w-full md:pointer-events-auto md:absolute md:inset-x-0 md:top-0 md:z-[5] md:flex md:min-h-11 md:-translate-y-1/2 md:items-center md:justify-center'
        }
        style={pad}
      >
        <button
          type="button"
          title={title}
          onClick={() => onInsertBranchAt(parentId, insertIndex)}
          className={
            persistVisibleOnMd
              ? 'flex w-full min-h-10 touch-manipulation items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border-color)]/50 bg-[var(--bg-secondary)]/25 px-2 text-[11px] font-semibold text-[var(--text-muted)] opacity-90 transition-all duration-150 ease-out hover:border-orange-500/45 hover:bg-orange-500/10 hover:text-orange-600 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 dark:hover:text-orange-400'
              : 'flex w-full min-h-10 touch-manipulation items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border-color)]/50 bg-[var(--bg-secondary)]/25 px-2 text-[11px] font-semibold text-[var(--text-muted)] opacity-90 transition-all duration-150 ease-out hover:border-orange-500/45 hover:bg-orange-500/10 hover:text-orange-600 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 dark:hover:text-orange-400 md:h-0 md:min-h-0 md:overflow-hidden md:border-transparent md:bg-transparent md:opacity-0 md:shadow-none md:pointer-events-none md:ring-0 md:group-hover/ins:pointer-events-auto md:group-hover/ins:h-auto md:group-hover/ins:min-h-10 md:group-hover/ins:overflow-visible md:group-hover/ins:border-[var(--border-color)]/50 md:group-hover/ins:bg-[var(--bg-secondary)]/25 md:group-hover/ins:opacity-100 md:group-focus-within/ins:pointer-events-auto md:group-focus-within/ins:h-auto md:group-focus-within/ins:min-h-10 md:group-focus-within/ins:overflow-visible md:group-focus-within/ins:border-[var(--border-color)]/50 md:group-focus-within/ins:bg-[var(--bg-secondary)]/25 md:group-focus-within/ins:opacity-100 md:focus-visible:pointer-events-auto md:focus-visible:h-auto md:focus-visible:min-h-10 md:focus-visible:overflow-visible md:focus-visible:border-[var(--border-color)]/50 md:focus-visible:bg-[var(--bg-secondary)]/25 md:focus-visible:opacity-100'
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
  'grid w-full min-w-0 grid-cols-1 gap-y-2 md:grid-cols-[auto_minmax(0,1fr)_8.25rem_14rem_minmax(7.25rem,max-content)] md:grid-rows-[auto_auto] md:gap-x-3 md:gap-y-1';

/** Hover / long-press tip for the catalog outline visibility checkbox column. */
const PATH_BRANCH_SHOW_COLUMN_TIP =
  'When on, this row appears in the catalog path outline (and learner views that use it). Use the audience menu to limit who sees it there. When off, the row is hidden from that outline for everyone, including admins—you can still edit it here.';

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
      <>
        <div className="col-start-3 row-start-2 flex min-w-0 items-center justify-center justify-self-center">
          {showCell}
        </div>
        <div className="col-start-4 row-start-2 flex min-w-0 w-full max-w-[16rem] items-center justify-self-stretch sm:min-w-[12rem]">
          {roleCell}
        </div>
      </>
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
      <button
        type="button"
        onClick={() => onRequestChangeType(b.id)}
        className={`inline-flex h-7 min-w-[3.25rem] shrink-0 items-center justify-center rounded-md px-3.5 text-[10px] font-bold uppercase leading-none transition-colors hover:ring-2 hover:ring-orange-500/40 focus:outline-none focus:ring-2 focus:ring-orange-500/40 ${kindBadgeClass}`}
        title="Change branch type"
        aria-label={`Change branch type, now ${pathBranchKindBadgeShortLabel(b.kind)}`}
      >
        {pathBranchKindBadgeShortLabel(b.kind)}
      </button>
    </div>
  );

  const branchFieldInputClass =
    'min-h-10 w-full min-w-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]';

  const renderOutlineRowMainCells = () => {
    if (b.kind === 'label') {
      return (
        <>
          <span
            className={`min-w-0 md:col-start-2 md:row-start-1 ${PATH_BRANCH_TITLE_FIELD_LABEL_CLASS}`}
          >
            Title
          </span>
          <div className="max-md:flex max-md:min-w-0 max-md:flex-row max-md:items-center max-md:gap-2 md:contents">
            <div className="flex items-center md:col-start-1 md:row-start-2">{branchBadgeGroup}</div>
            <input
              type="text"
              value={b.label}
              onChange={(e) => onLabelChange(b.id, e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              aria-label="Branch label"
              className={`${branchFieldInputClass} min-w-0 md:col-start-2 md:row-start-2`}
              placeholder="Label text"
            />
          </div>
        </>
      );
    }
    if (b.kind === 'divider') {
      return (
        <>
          <span
            className={`min-w-0 md:col-start-2 md:row-start-1 ${PATH_BRANCH_TITLE_FIELD_LABEL_CLASS}`}
          >
            Title
          </span>
          <div className="max-md:flex max-md:min-w-0 max-md:flex-row max-md:items-center max-md:gap-2 md:contents">
            <div className="flex items-center md:col-start-1 md:row-start-2">{branchBadgeGroup}</div>
            <input
              type="text"
              value={b.label}
              onChange={(e) => onLabelChange(b.id, e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              aria-label="Divider text"
              className={`${branchFieldInputClass} min-w-0 md:col-start-2 md:row-start-2`}
              placeholder="Divider text (shown in learner outline)"
            />
          </div>
        </>
      );
    }
    if (b.kind === 'link') {
      return (
        <>
          <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 md:col-start-2 md:row-start-1">
            <span className={PATH_BRANCH_TITLE_FIELD_LABEL_CLASS}>Title</span>
            <span className={PATH_BRANCH_TITLE_FIELD_LABEL_CLASS}>URL</span>
          </div>
          <div className="max-md:flex max-md:min-w-0 max-md:flex-row max-md:flex-wrap max-md:items-center max-md:gap-2 md:contents">
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
      <>
        <span
          className={`min-w-0 md:col-start-2 md:row-start-1 ${PATH_BRANCH_TITLE_FIELD_LABEL_CLASS}`}
        >
          Title
        </span>
        <div className="max-md:flex max-md:min-w-0 max-md:flex-row max-md:items-center max-md:gap-2 md:contents">
          <div className="flex items-center md:col-start-1 md:row-start-2">{branchBadgeGroup}</div>
          <span className="flex min-h-10 min-w-0 items-center truncate text-sm font-bold text-[var(--text-primary)] md:col-start-2 md:row-start-2">
            {branchNodeDisplayLabel(b, publishedList)}
          </span>
        </div>
      </>
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
        aria-label="Duplicate this branch — choose where to place the copy"
        title="Duplicate branch"
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
          ? 'grid grid-cols-1 gap-y-3 px-3 py-3 sm:px-4 md:grid md:grid-cols-[auto_minmax(0,1fr)_8.25rem_14rem_minmax(7.25rem,max-content)] md:grid-rows-[auto_auto] md:gap-x-3 md:gap-y-1'
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
            <div className="flex items-center justify-end gap-1 md:col-start-5 md:row-start-2">
              {branchActionButtons}
            </div>
          </div>
        </div>
      ) : (
        <div
          className={`${PATH_BRANCH_OUTLINE_ROW_GRID} px-1 py-2 sm:px-2 sm:py-2`}
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
            <div className="flex items-center justify-end gap-1 max-md:pt-0 md:col-start-5 md:row-start-2">
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
          ? 'space-y-0 border-l-2 border-orange-500/30 pl-3 sm:pl-4'
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
      onRefreshPublishedList: _onRefreshPublishedList,
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
        preset?: 'label' | 'course' | 'link' | 'divider';
      }
    | { kind: 'changeType'; nodeId: string }
    | { kind: 'duplicatePlace'; branch: PathBranchNode; sourceParentId: string | null };
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
      showActionToast('Could not find that branch to duplicate.', 'danger');
      return;
    }
    const sourceParentId = findParentIdOfBranch(roots, id);
    const remapped = remapBranchSubtreeIds(deepClone(node));
    setBranchModal({ kind: 'duplicatePlace', branch: remapped, sourceParentId });
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

  useEffect(() => {
    if (branchModal.kind !== 'changeType') return;
    if (!findBranchNode(pathBranchTree, branchModal.nodeId)) {
      setBranchModal({ kind: 'closed' });
    }
  }, [branchModal, pathBranchTree]);

  const branchModalContextHint = useMemo(() => {
    if (branchModal.kind === 'changeType') {
      return 'Pick a new type. Nested rows are removed if you choose a section divider; otherwise they stay when the new type allows.';
    }
    if (branchModal.kind === 'add') {
      const pos =
        branchModal.insertIndex !== undefined
          ? ' Inserts at the position you chose in the list.'
          : '';
      if (branchModal.parentId == null) {
        return `Top level: each row is a section with a flat list inside.${pos}`;
      }
      const p = findBranchNode(pathBranchTree, branchModal.parentId);
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

  const applyPickNewPath = useCallback(() => {
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
        if (pathDirty) {
          setPathConfirmDialog({ kind: 'pickNewPath' });
          return;
        }
        applyPickNewPath();
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
    (sourcePath: LearningPath, sourceTree: PathBranchNode[]) => {
      if (!paths.some((p) => p.id === sourcePath.id)) {
        showActionToast('Path not found. Reload the list and try again.', 'danger');
        return;
      }
      const reserveIds = pathSelector === '__new__' && pathDraft?.id ? [pathDraft.id] : [];
      const newId = firstAvailableStructuredLearningPathId(paths, reserveIds);
      const t = sourcePath.title.trim();
      const newPath: LearningPath = {
        ...deepClone(sourcePath),
        id: newId,
        title: t.endsWith(' (copy)') ? t : `${t} (copy)`,
        courseIds: [...sourcePath.courseIds],
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
    [paths, pathSelector, pathDraft?.id, showActionToast]
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
    performPathDuplicate(pathDraft, pathBranchTree);
  }, [pathSelector, pathDirty, pathDraft, pathBranchTree, paths, performPathDuplicate, showActionToast]);

  const closePathConfirmDialog = useCallback(() => setPathConfirmDialog(null), []);

  const confirmPathDialogPrimary = useCallback(() => {
    const d = pathConfirmDialog;
    if (!d) return;
    setPathConfirmDialog(null);

    if (d.kind === 'pickNewPath') {
      applyPickNewPath();
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
        const deleted = await deleteLearningPath(id);
        setPathBusy(false);
        if (deleted) {
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
      performPathDuplicate(sourceDraft, sourceTree);
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

  useBodyScrollLock(!!pathConfirmDialog || branchModal.kind !== 'closed');

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
      {actionToast}

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
              <li>Saves go to the live path and outline (Firestore).</li>
              <li>
                Open <strong className="font-semibold text-[var(--text-secondary)]">Path</strong> once to load titles.
              </li>
              <li>
                <strong className="font-semibold text-[var(--text-secondary)]">Create new path</strong>: next id{' '}
                <code className="text-orange-500/90">P1</code>, <code className="text-orange-500/90">P2</code>…; list
                A–Z.
              </li>
              <li>Use published courses in the outline—add or publish them in the Catalog tab first.</li>
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
            <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
              <button
                type="button"
                disabled={pathBusy || !pathDraft || !pathDirty}
                onClick={() => void handleSavePath()}
                aria-busy={pathBusy}
                aria-label={pathBusy ? 'Saving…' : 'Save path to catalog'}
                className="inline-flex min-h-11 shrink-0 touch-manipulation items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-40 sm:px-5"
              >
                {pathBusy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Save size={18} aria-hidden />}
                Save
              </button>
              <button
                type="button"
                disabled={pathBusy || !pathDraft}
                onClick={requestDeletePath}
                aria-label="Delete path from catalog"
                className="inline-flex min-h-11 shrink-0 touch-manipulation items-center justify-center gap-2 rounded-xl border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-500 hover:bg-red-500/10 dark:text-red-400 disabled:opacity-40 sm:px-5"
              >
                <Trash2 size={18} aria-hidden />
                Delete
              </button>
            </div>
            {pathDraft && pathDirty ? (
              <p
                className="text-xs font-medium text-amber-800 dark:text-amber-200"
                role="status"
              >
                Unsaved changes
              </p>
            ) : pathDraft && !pathDirty && pathSelector !== '__new__' ? (
              <p className="text-xs text-[var(--text-muted)]" role="status">
                All changes saved
              </p>
            ) : null}
          </div>
        </div>
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
                    <strong className="font-semibold text-[var(--text-secondary)]">Administrators only</strong>.
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
                          children: flattenPathBranchSectionChildren(sec.children),
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
                      Add a section label, a course, or a link. You can reorder and refine anytime.
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
                    <p className="mt-4 text-center text-[11px] leading-relaxed text-[var(--text-muted)]">
                      After the first row, use the dashed controls between rows:{' '}
                      <strong className="text-[var(--text-secondary)]">Add top-level branch here</strong> on the main outline, or{' '}
                      <strong className="text-[var(--text-secondary)]">Add branch here</strong> inside a section—for other types
                      (divider, lesson, etc.).
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
                      onInsertBranchAt={(pid, insertIndex) =>
                        setBranchModal({ kind: 'add', parentId: pid, insertIndex })
                      }
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
            catalogCourses={publishedList}
            contextHint={branchModalContextHint}
            addPreset={branchModal.kind === 'add' ? branchModal.preset : undefined}
            allowSectionDivider={
              (branchModal.kind === 'add' && branchModal.parentId != null) ||
              (branchModal.kind === 'changeType' &&
                findParentIdOfBranch(pathBranchTree, branchModal.nodeId) != null)
            }
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
              branch={branchModal.branch}
              roots={pathBranchTree}
              publishedList={publishedList}
              defaultTopParentId={branchModal.sourceParentId}
              onClose={() => setBranchModal({ kind: 'closed' })}
              onCommit={(parentId, insertIndex, namedBranch) => {
                const br = namedBranch;
                const roots = pathBranchTreeRef.current;
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
