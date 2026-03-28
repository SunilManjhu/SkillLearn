import type { Course } from '../data/courses';
import { isCourseLevel } from './courseTaxonomy';

/** Same rules as admin catalog `validateDraft`. */
export function validateCourseDraft(c: Course): string | null {
  if (!c.title.trim()) return 'Title is required.';
  if (!c.author.trim()) return 'Author is required.';
  if (!c.thumbnail.trim()) return 'Thumbnail URL is required.';
  if (!c.categories?.length || !c.categories.some((x) => x.trim())) {
    return 'At least one category is required.';
  }
  if (!isCourseLevel(c.level)) return 'Level must be Beginner, Intermediate, Advanced, or Proficient.';
  if (!c.modules.length) return 'At least one module is required.';
  for (let mi = 0; mi < c.modules.length; mi += 1) {
    const m = c.modules[mi];
    if (!m.id.trim()) return `Module ${mi + 1}: Module ID is required.`;
    if (!m.title.trim()) return `Module ${mi + 1}: Module title is required.`;
    if (!m.lessons.length) return 'Each module needs at least one lesson.';
    for (let li = 0; li < m.lessons.length; li += 1) {
      const l = m.lessons[li];
      if (!l.id.trim()) return `Module ${mi + 1}, Lesson ${li + 1}: Lesson ID is required.`;
      if (!l.title.trim()) return `Module ${mi + 1}, Lesson ${li + 1}: Lesson title is required.`;
      if (!l.videoUrl.trim() || !l.videoUrl.startsWith('http')) {
        return `Module ${mi + 1}, Lesson ${li + 1}: Video URL is required and must start with http.`;
      }
    }
  }
  if (c.rating < 0 || c.rating > 5) return 'Rating must be 0–5.';
  return null;
}
