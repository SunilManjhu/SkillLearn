/** Model for Path mind map (Firestore `pathMindmap`). */

export const PATH_MINDMAP_CENTER_LABEL = 'Learning Path' as const;

export type MindmapNodeKind = 'label' | 'course' | 'lesson' | 'link' | 'divider';

/** Who may see an outline row in the learner UI. Omit on a node = visible to both (default). */
export type PathOutlineAudienceRole = 'user' | 'admin';

export type MindmapTreeNode = {
  id: string;
  label: string;
  children: MindmapTreeNode[];
  kind?: MindmapNodeKind;
  courseId?: string;
  lessonId?: string;
  /** When true, learners see an explicit “locked” message (e.g. empty section not yet available). */
  locked?: boolean;
  /** `kind: 'link'` — opens in a new tab in the path outline (blog, article, etc.). */
  externalUrl?: string;
  /** `kind: 'divider'` — non-collapsible subheading under a section; must have no children. */
  /**
   * Restrict visibility to these roles. Omit or both roles = everyone (signed-in admin or user, and guests count as user).
   * `[]` = hidden from everyone in the catalog outline (including admins). `['admin']` = administrators only.
   */
  visibleToRoles?: PathOutlineAudienceRole[];
};

export type MindmapDocument = {
  v: 1;
  root: MindmapTreeNode;
};

function newNodeId(): string {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function parseVisibleToRolesField(o: Record<string, unknown>): PathOutlineAudienceRole[] | undefined {
  if (!Array.isArray(o.visibleToRoles)) return undefined;
  if (o.visibleToRoles.length === 0) return [];
  const r = o.visibleToRoles.filter((x) => x === 'user' || x === 'admin') as PathOutlineAudienceRole[];
  if (r.length === 0) return [];
  if (r.includes('user') && r.includes('admin')) return undefined;
  return [...new Set(r)];
}

function mergeVisibleToRoles(
  node: MindmapTreeNode,
  o: Record<string, unknown>
): MindmapTreeNode {
  const vr = parseVisibleToRolesField(o);
  if (vr === undefined) return node;
  return { ...node, visibleToRoles: vr };
}

/** Learner outline: guests and signed-in non-admins are treated as `user`. */
export function mindmapNodeVisibleToViewer(
  node: MindmapTreeNode,
  viewerIsAdmin: boolean
): boolean {
  const r = node.visibleToRoles;
  if (r !== undefined && r.length === 0) return false;
  if (!r || r.length === 0) return true;
  if (viewerIsAdmin) {
    return r.includes('admin') || r.includes('user');
  }
  return r.includes('user');
}

function nodeKindForFlatten(n: MindmapTreeNode): 'label' | 'course' | 'lesson' | 'link' | 'divider' {
  if (n.kind === 'divider') return 'divider';
  if (n.kind === 'course' && n.courseId) return 'course';
  if (n.kind === 'lesson' && n.courseId && n.lessonId) return 'lesson';
  if (n.kind === 'link' && n.externalUrl) return 'link';
  return 'label';
}

/**
 * Flatten legacy nested rows under a section for display (learner + filter pipeline).
 * Copies `visibleToRoles` onto synthetic dividers from structural labels.
 */
export function flattenSectionChildrenForOutline(children: MindmapTreeNode[]): MindmapTreeNode[] {
  const out: MindmapTreeNode[] = [];
  const walk = (nodes: MindmapTreeNode[]) => {
    for (const n of nodes) {
      if (n.kind === 'divider') {
        out.push({ ...n, children: [] });
        continue;
      }
      const nk = nodeKindForFlatten(n);
      if (nk === 'label' && n.children.length > 0) {
        const div: MindmapTreeNode = {
          id: `legacy-div-${n.id}`,
          label: n.label.trim() || 'Topic',
          children: [],
          kind: 'divider',
        };
        if (n.visibleToRoles) div.visibleToRoles = n.visibleToRoles;
        out.push(div);
        walk(n.children);
        continue;
      }
      if (nk !== 'label' && n.children.length > 0) {
        out.push({ ...n, children: [] });
        walk(n.children);
        continue;
      }
      out.push({ ...n, children: [] });
    }
  };
  walk(children);
  return out;
}

/** Top-level sections and each section’s flat rows, visibility-filtered for the current viewer. */
export function filterOutlineBranchesForViewer(
  branches: MindmapTreeNode[],
  viewerIsAdmin: boolean
): MindmapTreeNode[] {
  return branches
    .filter((sec) => mindmapNodeVisibleToViewer(sec, viewerIsAdmin))
    .map((sec) => ({
      ...sec,
      children: flattenSectionChildrenForOutline(sec.children).filter((row) =>
        mindmapNodeVisibleToViewer(row, viewerIsAdmin)
      ),
    }));
}

/** Persist: omit when default (both roles); keep `[]` for hidden-from-all. */
export function compactVisibleToRolesForPersist(
  roles: PathOutlineAudienceRole[] | undefined
): PathOutlineAudienceRole[] | undefined {
  if (roles === undefined) return undefined;
  if (roles.length === 0) return [];
  if (roles.includes('user') && roles.includes('admin')) return undefined;
  return [...new Set(roles)].sort();
}

/** Stable ids for mind map nodes (Firestore / admin). */
export function newMindmapNodeId(): string {
  return newNodeId();
}

function cloneDocInternal(doc: MindmapDocument): MindmapDocument {
  return JSON.parse(JSON.stringify(doc)) as MindmapDocument;
}

/** Root label is always the canonical center text (plan: fixed “Learning Path”). */
export function ensureCanonicalCenter(doc: MindmapDocument): MindmapDocument {
  const next = cloneDocInternal(doc);
  next.root.label = PATH_MINDMAP_CENTER_LABEL;
  return next;
}

export function normalizeMindmapNode(raw: unknown): MindmapTreeNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.label !== 'string') return null;
  if (!Array.isArray(o.children)) return null;
  const parsedChildren: MindmapTreeNode[] = [];
  for (const ch of o.children) {
    const n = normalizeMindmapNode(ch);
    if (n) parsedChildren.push(n);
  }
  if (o.kind === 'divider') {
    return mergeVisibleToRoles({ id: o.id, label: o.label, children: [], kind: 'divider' }, o);
  }
  const base: MindmapTreeNode = { id: o.id, label: o.label, children: parsedChildren };
  let node: MindmapTreeNode;
  if (o.kind === 'course' && typeof o.courseId === 'string' && o.courseId.length > 0) {
    node = { ...base, kind: 'course', courseId: o.courseId };
  } else if (
    o.kind === 'lesson' &&
    typeof o.courseId === 'string' &&
    o.courseId.length > 0 &&
    typeof o.lessonId === 'string' &&
    o.lessonId.length > 0
  ) {
    node = { ...base, kind: 'lesson', courseId: o.courseId, lessonId: o.lessonId };
  } else if (o.kind === 'link' && typeof o.externalUrl === 'string' && o.externalUrl.trim().length > 0) {
    node = { ...base, kind: 'link', externalUrl: o.externalUrl.trim() };
  } else {
    node = { ...base, kind: 'label' };
  }
  node = mergeVisibleToRoles(node, o);
  if (o.locked === true) {
    return { ...node, locked: true };
  }
  return node;
}

export function parseMindmapDocument(raw: unknown): MindmapDocument | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  const root = normalizeMindmapNode(o.root);
  if (!root) return null;
  return ensureCanonicalCenter({ v: 1, root });
}

/** Build a document with fixed center label and the given top-level branches (e.g. from New path builder). */
export function mindmapDocumentWithCenterChildren(children: MindmapTreeNode[]): MindmapDocument {
  return ensureCanonicalCenter({
    v: 1,
    root: {
      id: newNodeId(),
      label: PATH_MINDMAP_CENTER_LABEL,
      children,
    },
  });
}

/** All course ids referenced in a saved path mindmap (membership for learner vs stale `learningPaths.courseIds`). */
export function collectCourseIdsFromMindmapTree(nodes: MindmapTreeNode[]): Set<string> {
  const out = new Set<string>();
  const walk = (ns: MindmapTreeNode[]) => {
    for (const n of ns) {
      if (n.kind === 'course' && n.courseId) out.add(n.courseId);
      if (n.kind === 'lesson' && n.courseId) out.add(n.courseId);
      if (n.children.length > 0) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** Drop course/lesson rows for `courseId` (used when deleting a catalog course still listed on paths). */
export function removeCourseIdFromMindmapBranchList(nodes: MindmapTreeNode[], courseId: string): MindmapTreeNode[] {
  const out: MindmapTreeNode[] = [];
  for (const n of nodes) {
    if (n.kind === 'course' && n.courseId === courseId) continue;
    if (n.kind === 'lesson' && n.courseId === courseId) continue;
    const children = removeCourseIdFromMindmapBranchList(n.children, courseId);
    out.push({ ...n, children });
  }
  return out;
}

/**
 * Align Firestore `courseIds` with the saved outline: drops ids removed from the mindmap but left in `courseIds`
 * (older saves merged instead of replacing). `mindmapOutlineChildren === null` = not loaded yet — keep `pathCourseIds`.
 */
export function filterPathCourseIdsBySavedMindmap(
  pathCourseIds: readonly string[],
  mindmapOutlineChildren: MindmapTreeNode[] | null
): string[] {
  if (pathCourseIds.length === 0) return [];
  if (mindmapOutlineChildren === null || mindmapOutlineChildren.length === 0) return [...pathCourseIds];
  const inMindmap = collectCourseIdsFromMindmapTree(mindmapOutlineChildren);
  return pathCourseIds.filter((id) => inMindmap.has(id));
}
