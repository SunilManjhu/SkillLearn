import type { MindmapTreeNode } from '../data/pathMindmap';

export type PathCourseRowSegment =
  | { type: 'divider'; id: string; label: string }
  | { type: 'courses'; courseIds: string[] };

export type PathCourseRowSectionBlock = {
  sectionLabel: string;
  segments: PathCourseRowSegment[];
};

function nodeRowKind(n: MindmapTreeNode): 'divider' | 'course' | 'skip' {
  if (n.kind === 'divider') return 'divider';
  if (n.kind === 'course' && n.courseId) return 'course';
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
 * Build learner “flat list” layout: section headings, then interleaved dividers and course row groups
 * in outline order. `pathCourseIds` limits which courses appear; tail block holds courses not under any section.
 */
export function buildPathCourseRowLayoutBlocks(
  pathCourseIds: readonly string[],
  filteredSections: MindmapTreeNode[]
): PathCourseRowSectionBlock[] {
  if (pathCourseIds.length === 0) return [];
  const pathSet = new Set(pathCourseIds);
  if (filteredSections.length === 0) {
    return [{ sectionLabel: '', segments: [{ type: 'courses', courseIds: [...pathCourseIds] }] }];
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
    if (rest.length > 0) {
      blocks.push({ sectionLabel: '', segments: [{ type: 'courses', courseIds: rest }] });
    }
  }

  return blocks.length > 0 ? blocks : [{ sectionLabel: '', segments: [{ type: 'courses', courseIds: [...pathCourseIds] }] }];
}
