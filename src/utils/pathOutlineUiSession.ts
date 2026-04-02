/**
 * Persist learning-path outline UI (which sections/branches are open).
 * Uses localStorage so expansion survives hard refresh, new tabs, and revisits; migrates
 * older sessionStorage-only data on first read.
 */

const COURSE_ROW_KEY = 'skilllearn-path-course-rows:';
const OUTLINE_KEY = 'skilllearn-path-mindmap-outline:';

function readRawPersistent(storageKey: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const fromLocal = localStorage.getItem(storageKey);
    if (fromLocal != null && fromLocal.length > 0) return fromLocal;
    const fromSession = sessionStorage.getItem(storageKey);
    if (fromSession != null && fromSession.length > 0) {
      try {
        localStorage.setItem(storageKey, fromSession);
      } catch {
        /* quota / private mode */
      }
      return fromSession;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeRawPersistent(storageKey: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    /* quota / private mode */
  }
  try {
    sessionStorage.setItem(storageKey, value);
  } catch {
    /* ignore */
  }
}

export function readPathCourseRowExpandedBlockKey(pathId: string): string | null {
  try {
    const raw = readRawPersistent(`${COURSE_ROW_KEY}${pathId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { expandedBlockKey?: unknown };
    const k = parsed.expandedBlockKey;
    if (k === null) return null;
    if (typeof k === 'string' && k.length > 0) return k;
  } catch {
    /* ignore */
  }
  return null;
}

export function writePathCourseRowExpandedBlockKey(pathId: string, expandedBlockKey: string | null): void {
  try {
    writeRawPersistent(`${COURSE_ROW_KEY}${pathId}`, JSON.stringify({ expandedBlockKey }));
  } catch {
    /* ignore */
  }
}

export type PathMindmapOutlineExpandSnapshot = {
  sectionExpanded: Record<string, boolean>;
  branchExpanded: Record<string, boolean>;
};

export function readPathMindmapOutlineExpand(pathId: string): PathMindmapOutlineExpandSnapshot | null {
  try {
    const raw = readRawPersistent(`${OUTLINE_KEY}${pathId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PathMindmapOutlineExpandSnapshot;
    if (!parsed || typeof parsed !== 'object') return null;
    const se = parsed.sectionExpanded;
    const be = parsed.branchExpanded;
    if (se && typeof se !== 'object') return null;
    if (be && typeof be !== 'object') return null;
    return {
      sectionExpanded: se && typeof se === 'object' ? { ...se } : {},
      branchExpanded: be && typeof be === 'object' ? { ...be } : {},
    };
  } catch {
    return null;
  }
}

export function writePathMindmapOutlineExpand(pathId: string, snap: PathMindmapOutlineExpandSnapshot): void {
  try {
    writeRawPersistent(`${OUTLINE_KEY}${pathId}`, JSON.stringify(snap));
  } catch {
    /* ignore */
  }
}
