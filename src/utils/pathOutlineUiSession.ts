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

export type PathCourseRowUiPersisted = {
  expandedBlockKey: string | null;
  /** Explicit `false` = section divider’s nested links/rows are collapsed. */
  dividerExpanded: Record<string, boolean>;
};

function parsePathCourseRowUi(raw: string | null): PathCourseRowUiPersisted {
  if (!raw) return { expandedBlockKey: null, dividerExpanded: {} };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    let expandedBlockKey: string | null = null;
    const ek = parsed.expandedBlockKey;
    if (ek === null) expandedBlockKey = null;
    else if (typeof ek === 'string' && ek.length > 0) expandedBlockKey = ek;

    const dividerExpanded: Record<string, boolean> = {};
    const de = parsed.dividerExpanded;
    if (de && typeof de === 'object' && !Array.isArray(de)) {
      for (const [k, v] of Object.entries(de as Record<string, unknown>)) {
        if (typeof v === 'boolean') dividerExpanded[k] = v;
      }
    }
    return { expandedBlockKey, dividerExpanded };
  } catch {
    return { expandedBlockKey: null, dividerExpanded: {} };
  }
}

export function readPathCourseRowUiPersisted(pathId: string): PathCourseRowUiPersisted {
  return parsePathCourseRowUi(readRawPersistent(`${COURSE_ROW_KEY}${pathId}`));
}

export function writePathCourseRowUiPersisted(pathId: string, state: PathCourseRowUiPersisted): void {
  try {
    writeRawPersistent(
      `${COURSE_ROW_KEY}${pathId}`,
      JSON.stringify({
        expandedBlockKey: state.expandedBlockKey,
        dividerExpanded: state.dividerExpanded,
      })
    );
  } catch {
    /* ignore */
  }
}

export function readPathCourseRowExpandedBlockKey(pathId: string): string | null {
  return readPathCourseRowUiPersisted(pathId).expandedBlockKey;
}

export function writePathCourseRowExpandedBlockKey(pathId: string, expandedBlockKey: string | null): void {
  const prev = readPathCourseRowUiPersisted(pathId);
  writePathCourseRowUiPersisted(pathId, { ...prev, expandedBlockKey });
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

/** Drop persisted outline / row UI for a path (e.g. after the path doc is deleted) so reusing the id does not restore old UI. */
export function clearPathOutlineUiSessionForPathId(pathId: string): void {
  if (typeof window === 'undefined') return;
  const keys = [`${COURSE_ROW_KEY}${pathId}`, `${OUTLINE_KEY}${pathId}`];
  for (const k of keys) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
    try {
      sessionStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}
