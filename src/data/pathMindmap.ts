/** Model for Path mind map (Firestore `pathMindmap`). */

export const PATH_MINDMAP_CENTER_LABEL = 'Learning Path' as const;

export type MindmapNodeKind = 'label' | 'course' | 'lesson';

export type MindmapTreeNode = {
  id: string;
  label: string;
  children: MindmapTreeNode[];
  kind?: MindmapNodeKind;
  courseId?: string;
  lessonId?: string;
  /** When true, learners see an explicit “locked” message (e.g. empty section not yet available). */
  locked?: boolean;
};

export type MindmapDocument = {
  v: 1;
  root: MindmapTreeNode;
};

function newNodeId(): string {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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
  const children: MindmapTreeNode[] = [];
  for (const ch of o.children) {
    const n = normalizeMindmapNode(ch);
    if (n) children.push(n);
  }
  const base: MindmapTreeNode = { id: o.id, label: o.label, children };
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
  } else {
    node = base;
  }
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
