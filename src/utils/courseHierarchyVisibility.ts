import type { Course, Lesson, Module } from '../data/courses';
import { outlineVisibleToRolesVisibleToViewer } from '../data/pathMindmap';

/**
 * Course document row: show in library / allow opening overview when visible to this viewer.
 * When the syllabus has exactly one module, that module’s visibility gates the whole course: if the viewer
 * cannot see that module, the course is treated as absent from the catalog (no empty shells).
 */
export function catalogCourseEntryVisibleToViewer(course: Course, viewerIsAdmin: boolean): boolean {
  if (!outlineVisibleToRolesVisibleToViewer(course.visibleToRoles, viewerIsAdmin)) {
    return false;
  }
  if (course.modules.length === 1) {
    const only = course.modules[0]!;
    if (!outlineVisibleToRolesVisibleToViewer(only.visibleToRoles, viewerIsAdmin)) {
      return false;
    }
  }
  return true;
}

function lessonVisibleWithAncestors(
  course: Course,
  module: Module,
  lesson: Lesson,
  viewerIsAdmin: boolean
): boolean {
  return (
    outlineVisibleToRolesVisibleToViewer(course.visibleToRoles, viewerIsAdmin) &&
    outlineVisibleToRolesVisibleToViewer(module.visibleToRoles, viewerIsAdmin) &&
    outlineVisibleToRolesVisibleToViewer(lesson.visibleToRoles, viewerIsAdmin)
  );
}

/**
 * Returns a shallow-cloned course tree containing only modules and lessons the viewer may see
 * (AND of course, module, and lesson `visibleToRoles`, same rules as path outlines).
 */
export function filterCourseHierarchyForViewer(course: Course, viewerIsAdmin: boolean): Course {
  if (!outlineVisibleToRolesVisibleToViewer(course.visibleToRoles, viewerIsAdmin)) {
    return { ...course, modules: [] };
  }
  const modules: Module[] = [];
  for (const mod of course.modules) {
    if (!outlineVisibleToRolesVisibleToViewer(mod.visibleToRoles, viewerIsAdmin)) {
      continue;
    }
    const lessons = mod.lessons.filter((les) => lessonVisibleWithAncestors(course, mod, les, viewerIsAdmin));
    if (lessons.length === 0) {
      continue;
    }
    modules.push({ ...mod, lessons });
  }
  return { ...course, modules };
}
