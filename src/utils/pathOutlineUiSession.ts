/**
 * Persist learning-path outline UI (which sections/branches are open) in sessionStorage
 * so browser back/forward restores expansion after leaving for a course or lesson.
 */

const COURSE_ROW_KEY = 'skilllearn-path-course-rows:';
const OUTLINE_KEY = 'skilllearn-path-mindmap-outline:';

export function readPathCourseRowExpandedBlockKey(pathId: string): string | null {
  try {
    const raw = sessionStorage.getItem(`${COURSE_ROW_KEY}${pathId}`);
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
    sessionStorage.setItem(`${COURSE_ROW_KEY}${pathId}`, JSON.stringify({ expandedBlockKey }));
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
    const raw = sessionStorage.getItem(`${OUTLINE_KEY}${pathId}`);
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
    sessionStorage.setItem(`${OUTLINE_KEY}${pathId}`, JSON.stringify(snap));
  } catch {
    /* ignore */
  }
}
