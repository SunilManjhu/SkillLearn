import type { MindmapTreeNode } from '../data/pathMindmap';

const SESSION_KEY = 'skilllearn:pathOutlinesPublished:v1';
const MAX_NODE_DEPTH = 48;

type StoredPayload = { uid: string | null; outlines: Record<string, MindmapTreeNode[]> };

let lastPublishedInMemory: StoredPayload | null = null;

const NODE_KINDS = new Set(['label', 'course', 'lesson', 'link', 'divider', 'module']);

function validateMindmapTreeNode(x: unknown, depth: number): x is MindmapTreeNode {
  if (depth > MAX_NODE_DEPTH) return false;
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.label !== 'string') return false;
  if (!Array.isArray(o.children)) return false;
  if (o.kind !== undefined && (typeof o.kind !== 'string' || !NODE_KINDS.has(o.kind))) return false;
  if (o.courseId !== undefined && typeof o.courseId !== 'string') return false;
  if (o.lessonId !== undefined && typeof o.lessonId !== 'string') return false;
  if (o.moduleId !== undefined && typeof o.moduleId !== 'string') return false;
  if (o.externalUrl !== undefined && typeof o.externalUrl !== 'string') return false;
  if (o.locked !== undefined && typeof o.locked !== 'boolean') return false;
  if (o.visibleToRoles !== undefined) {
    if (!Array.isArray(o.visibleToRoles)) return false;
    for (const r of o.visibleToRoles) {
      if (r !== 'user' && r !== 'admin') return false;
    }
  }
  for (const c of o.children) {
    if (!validateMindmapTreeNode(c, depth + 1)) return false;
  }
  return true;
}

/** Validates session/cache JSON for `pathId` → top-level outline branch arrays. */
export function validatePathOutlineChildrenByPathId(raw: unknown): Record<string, MindmapTreeNode[]> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, MindmapTreeNode[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== 'string' || k.length === 0 || k.length > 200) return null;
    if (!Array.isArray(v)) return null;
    const branches: MindmapTreeNode[] = [];
    for (const item of v) {
      if (!validateMindmapTreeNode(item, 0)) return null;
      branches.push(item);
    }
    out[k] = branches;
  }
  return out;
}

function readPayloadFromSession(): StoredPayload | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    if (o.uid !== null && typeof o.uid !== 'string') return null;
    const uidStored: string | null = typeof o.uid === 'string' ? o.uid : null;
    const outlines = validatePathOutlineChildrenByPathId(o.outlines);
    if (!outlines) return null;
    return { uid: uidStored, outlines };
  } catch {
    return null;
  }
}

/**
 * Last published `learningPaths` outline branches keyed by path id (same uid contract as merged navbar paths).
 */
export function peekPublishedPathOutlines(expectedUid: string | null): Record<string, MindmapTreeNode[]> | null {
  if (lastPublishedInMemory && lastPublishedInMemory.uid === expectedUid) {
    return lastPublishedInMemory.outlines;
  }
  const m = readPayloadFromSession();
  if (!m || m.uid !== expectedUid) return null;
  lastPublishedInMemory = m;
  return m.outlines;
}

export function writePublishedPathOutlines(
  uid: string | null,
  outlines: Record<string, MindmapTreeNode[]>
): void {
  lastPublishedInMemory = { uid, outlines };
  if (typeof sessionStorage === 'undefined') return;
  try {
    const payload: StoredPayload = { uid, outlines };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}
