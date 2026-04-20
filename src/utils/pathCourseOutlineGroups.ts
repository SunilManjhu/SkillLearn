import { collectCourseIdsFromMindmapTree, type MindmapTreeNode } from '../data/pathMindmap';

export type PathCourseRowSegment =
  | { type: 'divider'; id: string; label: string }
  | { type: 'label'; id: string; label: string }
  | { type: 'link'; id: string; label: string; href: string }
  | { type: 'courses'; courseIds: string[] };

export type PathCourseRowSectionBlock = {
  sectionLabel: string;
  segments: PathCourseRowSegment[];
};

/**
 * Row kind for flat course-list layout. Must match {@link PathMindmapOutline} `nodeKind`:
 * structural label rows often omit `kind` in Firestore (see `normalizeMindmapNode` else branch).
 */
function nodeRowKind(n: MindmapTreeNode): 'divider' | 'label' | 'link' | 'course' | 'skip' {
  if (n.kind === 'divider') return 'divider';
  if (n.kind === 'course' && n.courseId) return 'course';
  if (n.kind === 'lesson' && n.courseId && n.lessonId) return 'skip';
  if (n.kind === 'link' && n.externalUrl?.trim()) return 'link';
  if (n.kind === 'label') return 'label';
  // Default label / title row (no `kind` field on legacy or normalized nodes)
  if (n.kind === undefined) return 'label';
  return 'skip';
}

/** Outline order under a section (matches filtered `sec.children` — dividers + courses on path). */
function walkSectionToSegments(children: MindmapTreeNode[], pathSet: Set<string>): PathCourseRowSegment[] {
  const segments: PathCourseRowSegment[] = [];
  const batch: string[] = [];
  const flush = () => {
    if (batch.length) {
      segments.push({ type: 'courses', courseIds: [...batch] });
      batch.length = 0;
    }
  };
  for (const n of children) {
    const k = nodeRowKind(n);
    if (k === 'divider') {
      flush();
      segments.push({ type: 'divider', id: n.id, label: n.label.trim() || 'Divider' });
      if (n.children.length > 0) {
        segments.push(...walkSectionToSegments(n.children, pathSet));
      }
    } else if (k === 'label') {
      flush();
      segments.push({ type: 'label', id: n.id, label: n.label.trim() || 'Module' });
    } else if (k === 'link' && n.externalUrl?.trim()) {
      flush();
      segments.push({
        type: 'link',
        id: n.id,
        label: n.label.trim() || 'Link',
        href: n.externalUrl.trim(),
      });
    } else if (k === 'course' && n.courseId && pathSet.has(n.courseId)) {
      batch.push(n.courseId);
    }
  }
  flush();
  return segments;
}

function removeCoursesFromRemaining(segments: PathCourseRowSegment[], remaining: Set<string>) {
  for (const seg of segments) {
    if (seg.type === 'courses') {
      for (const id of seg.courseIds) remaining.delete(id);
    }
  }
}

/**
 * Tail “remaining” courses: show only orphans (in `pathCourseIds` but not placed in the raw mindmap).
 * Drop ids that exist only under a section hidden from this viewer — they must not leak via the tail block.
 */
function filterTailCourseIdsForOutlineVisibility(
  rest: string[],
  rawOutlineBranches: MindmapTreeNode[],
  filteredSections: MindmapTreeNode[]
): string[] {
  const allIds = collectCourseIdsFromMindmapTree(rawOutlineBranches);
  const visibleIds = collectCourseIdsFromMindmapTree(filteredSections);
  return rest.filter((id) => !allIds.has(id) || visibleIds.has(id));
}

/**
 * Build learner “flat list” layout: section headings, then interleaved dividers and course row groups
 * in outline order. `pathCourseIds` limits which courses appear; tail block holds courses not under any section.
 *
 * @param rawOutlineBranches Unfiltered mindmap top-level branches — used so hidden top-level sections’
 *   courses are not shown in the tail block.
 */
export function buildPathCourseRowLayoutBlocks(
  pathCourseIds: readonly string[],
  filteredSections: MindmapTreeNode[],
  rawOutlineBranches?: MindmapTreeNode[] | null
): PathCourseRowSectionBlock[] {
  if (pathCourseIds.length === 0) return [];
  const pathSet = new Set(pathCourseIds);
  const raw = rawOutlineBranches && rawOutlineBranches.length > 0 ? rawOutlineBranches : null;

  if (filteredSections.length === 0) {
    if (raw == null) {
      return [{ sectionLabel: '', segments: [{ type: 'courses', courseIds: [...pathCourseIds] }] }];
    }
    const allIds = collectCourseIdsFromMindmapTree(raw);
    const orphanOnly = pathCourseIds.filter((id) => !allIds.has(id));
    if (orphanOnly.length === 0) return [];
    return [{ sectionLabel: '', segments: [{ type: 'courses', courseIds: orphanOnly }] }];
  }

  const remaining = new Set(pathCourseIds);
  const blocks: PathCourseRowSectionBlock[] = [];

  for (const sec of filteredSections) {
    const segments = walkSectionToSegments(sec.children, pathSet);
    if (segments.length === 0) continue;
    removeCoursesFromRemaining(segments, remaining);
    blocks.push({ sectionLabel: sec.label.trim(), segments });
  }

  if (remaining.size > 0) {
    const rest = pathCourseIds.filter((id) => remaining.has(id));
    const tailIds =
      raw != null ? filterTailCourseIdsForOutlineVisibility(rest, raw, filteredSections) : rest;
    if (tailIds.length > 0) {
      blocks.push({ sectionLabel: '', segments: [{ type: 'courses', courseIds: tailIds }] });
    }
  }

  if (blocks.length > 0) return blocks;

  if (raw == null) {
    return [{ sectionLabel: '', segments: [{ type: 'courses', courseIds: [...pathCourseIds] }] }];
  }
  const allIds = collectCourseIdsFromMindmapTree(raw);
  const orphanOnly = pathCourseIds.filter((id) => !allIds.has(id));
  if (orphanOnly.length === 0) return [];
  return [{ sectionLabel: '', segments: [{ type: 'courses', courseIds: orphanOnly }] }];
}
