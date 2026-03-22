import { Course } from '../data/courses';
import { getLastLessonInCourse } from './courseLessons';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

const PREFIX = 'skilllearn-progress:';

export type LessonProgress = { currentTime: number; duration: number };

function legacyProgressStorageKey(courseId: string): string {
  return `${PREFIX}${courseId}`;
}

/** Logged-in users get a per-account key; signed-out uses the legacy single-browser key. */
export function progressStorageKey(courseId: string, userId?: string | null): string {
  if (userId) return `${PREFIX}user:${userId}:${courseId}`;
  return legacyProgressStorageKey(courseId);
}

function readProgressRaw(courseId: string, userId?: string | null): string | null {
  if (typeof localStorage === 'undefined') return null;
  if (userId) {
    const scoped = localStorage.getItem(progressStorageKey(courseId, userId));
    if (scoped) return scoped;
    return localStorage.getItem(legacyProgressStorageKey(courseId));
  }
  return localStorage.getItem(legacyProgressStorageKey(courseId));
}

export function loadLessonProgressMap(courseId: string, userId?: string | null): Record<string, LessonProgress> {
  try {
    const raw = readProgressRaw(courseId, userId);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, LessonProgress>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function progressPercent(p: LessonProgress | undefined): number {
  if (!p || !(p.duration > 0)) return 0;
  return Math.min(100, Math.round((p.currentTime / p.duration) * 100));
}

/**
 * ≥95% of the saved timeline (ratio, not rounded percent) so “done” matches the scrubber and
 * doesn’t flicker 94% vs 95% when currentTime/duration almost match.
 */
export function isLessonPlaybackComplete(p: LessonProgress | undefined): boolean {
  if (!p || !(p.duration > 0)) return false;
  // Lenient threshold for checkmarks and course completion
  return p.currentTime >= p.duration * 0.95 || p.currentTime >= p.duration - 10;
}

/**
 * Strict check for UI elements that should only appear when the video is truly at the end
 * (e.g., the "Replay from start" overlay).
 */
export function isLessonActuallyFinished(p: LessonProgress | undefined): boolean {
  if (!p || !(p.duration > 0)) return false;
  return p.currentTime >= p.duration - 1.5;
}

/**
 * Saved progress often lags the real end (throttled timeupdate). If we only resume using that
 * timestamp, the player jumps backward. Use this for seek + autoplay: treat as “finished” when
 * we’re clearly in the last stretch of the stored timeline.
 */
export function savedProgressLooksFinished(p: LessonProgress | undefined): boolean {
  if (!p || !(p.duration > 0) || !(p.currentTime >= 0)) return false;
  if (isLessonPlaybackComplete(p)) return true;
  const remaining = p.duration - p.currentTime;
  if (remaining <= 5) return true;
  return false;
}

export function isCourseComplete(course: Course, progressByLesson: Record<string, LessonProgress>): boolean {
  return course.modules.every(module => 
    module.lessons.every(lesson => 
      isLessonPlaybackComplete(progressByLesson[lesson.id])
    )
  );
}

/**
 * Strict check: every lesson within ~1.5s of its video end (used only where full timeline strictness matters).
 */
export function isCourseActuallyFinished(course: Course, progressByLesson: Record<string, LessonProgress>): boolean {
  return course.modules.every(module =>
    module.lessons.every(lesson => isLessonActuallyFinished(progressByLesson[lesson.id]))
  );
}

/**
 * End-of-course flow (rating / overview): same “done” bar as lesson checkmarks (≥95% / near-end rules),
 * plus the final curriculum lesson must be truly at the end so we don’t finalize mid-last-video.
 */
export function isCourseReadyToFinalize(course: Course, progressByLesson: Record<string, LessonProgress>): boolean {
  if (!isCourseComplete(course, progressByLesson)) return false;
  const last = getLastLessonInCourse(course);
  if (!last) return false;
  return isLessonActuallyFinished(progressByLesson[last.id]);
}

export function clearCourseProgress(courseId: string, userId?: string | null): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(progressStorageKey(courseId, userId));
  // Also clear legacy if it exists and we're the same user context
  if (userId) {
    localStorage.removeItem(legacyProgressStorageKey(courseId));
  }
}

/** Syncs progress to Firestore for logged-in users. */
export async function syncProgressToFirestore(courseId: string, userId: string, lessonProgress: Record<string, LessonProgress>): Promise<void> {
  try {
    const progressId = `${userId}_${courseId}`;
    await setDoc(doc(db, 'progress', progressId), {
      courseId,
      userId,
      lessonProgress,
      lastUpdated: serverTimestamp()
    }, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'progress');
  }
}

/** Loads progress from Firestore for logged-in users. */
export async function loadProgressFromFirestore(courseId: string, userId: string): Promise<Record<string, LessonProgress> | null> {
  try {
    const progressId = `${userId}_${courseId}`;
    const snap = await getDoc(doc(db, 'progress', progressId));
    if (snap.exists()) {
      return snap.data().lessonProgress as Record<string, LessonProgress>;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'progress');
  }
  return null;
}
