import type { Lesson, QuizDefinition } from '../data/courses';
import { normalizeExternalHref } from './externalUrl';

/** Safe external URL for a web (non-video) lesson, or null. */
export function lessonWebHref(l: Lesson): string | null {
  if (l.contentKind !== 'web') return null;
  return normalizeExternalHref(l.webUrl ?? '');
}

export function isWebLesson(l: Lesson): boolean {
  return lessonWebHref(l) != null;
}

export function isQuizLesson(l: Lesson): boolean {
  return l.contentKind === 'quiz';
}

export function isDividerLesson(l: Lesson): boolean {
  return l.contentKind === 'divider';
}

/** Lessons the learner can open in the player (not section dividers). */
export function isPlayableCatalogLesson(l: Lesson): boolean {
  return !isDividerLesson(l);
}

/** Quiz payload suitable for the player when defined and non-empty. */
export function lessonQuizDefinition(l: Lesson): QuizDefinition | null {
  if (!isQuizLesson(l) || !l.quiz?.questions?.length) return null;
  return l.quiz;
}

/** Lesson uses the alternate player surface (no embedded video timeline). */
export function lessonBlocksVideoPlayback(l: Lesson): boolean {
  return isWebLesson(l) || l.contentKind === 'quiz' || isDividerLesson(l);
}

/** Default / explicit `video` — normal embedded playback (not web/quiz/divider overlay). */
export function isVideoLesson(l: Lesson): boolean {
  return (!l.contentKind || l.contentKind === 'video') && !isDividerLesson(l);
}
