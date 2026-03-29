import type { Lesson } from '../data/courses';
import { normalizeExternalHref } from './externalUrl';

/** Safe external URL for a web (non-video) lesson, or null. */
export function lessonWebHref(l: Lesson): string | null {
  if (l.contentKind !== 'web') return null;
  return normalizeExternalHref(l.webUrl ?? '');
}

export function isWebLesson(l: Lesson): boolean {
  return lessonWebHref(l) != null;
}
