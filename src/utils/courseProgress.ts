import { Course, Lesson } from '../data/courses';
import { flattenLessons } from './courseLessons';
import { isPlayableCatalogLesson } from './lessonContent';
import {
  clearCourseCompletionTimestamp,
  loadCompletionTimestamps,
  mergeCompletionTimestampFromRemote,
} from './courseCompletionLog';
import { clearCourseRating } from './courseRating';
import { db, handleFirestoreError, isFirestorePermissionDenied, OperationType } from '../firebase';
import {
  collection,
  doc,
  deleteField,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';

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

/**
 * When a course is republished with new lesson ids, progress keys may go stale.
 * With no bundled catalog stub, callers rely on stable lesson ids from Firestore.
 */
export function reconcileLessonProgressMap(
  _course: Course,
  map: Record<string, LessonProgress>
): { map: Record<string, LessonProgress>; migrated: boolean } {
  return { map, migrated: false };
}

/**
 * Lesson reached the end: checkmarks, resume, course completion, and “Replay from start” all use this.
 *
 * 1) **True end:** within ~250ms of reported duration (float / last-frame).
 * 2) **Embed gap:** YouTube/iframes often stop before `getDuration()`. If **≤3s** remain **and** ≥**80%**
 *    watched, count as complete.
 *
 * We intentionally do **not** treat “≥99.5% watched” alone as complete: on long videos that can be many
 * seconds before the real end and desyncs the replay overlay from the scrub clock.
 */
export function isLessonPlaybackComplete(p: LessonProgress | undefined): boolean {
  if (!p || !(p.duration > 0)) return false;
  const t = p.currentTime;
  const d = p.duration;
  const ratio = t / d;
  const remaining = d - t;
  if (remaining <= 0.25 || t >= d - 0.25) return true;
  return remaining <= 3 && ratio >= 0.8;
}

/**
 * Saved progress that is neither complete nor plausibly intentional viewing (YouTube iframe often reports
 * PLAYING with a few seconds after load/autoplay without the user meaningfully watching).
 */
export function isTrivialLessonProgress(p: LessonProgress | undefined): boolean {
  if (!p || !(p.duration > 0)) return true;
  if (isLessonPlaybackComplete(p)) return false;
  const t = p.currentTime;
  if (t <= 0) return true;
  const ratio = t / p.duration;
  return t < 3 && ratio < 0.12;
}

/** Sidebar/overview bar: **100%** whenever `isLessonPlaybackComplete` (including embed-gap completion). */
export function progressPercent(p: LessonProgress | undefined): number {
  if (!p || !(p.duration > 0)) return 0;
  if (isLessonPlaybackComplete(p)) return 100;
  if (isTrivialLessonProgress(p)) return 0;
  return Math.min(100, Math.round((p.currentTime / p.duration) * 100));
}

/** @deprecated Prefer `isLessonPlaybackComplete` — identical semantics (replay overlay + finalize). */
export function isLessonActuallyFinished(p: LessonProgress | undefined): boolean {
  return isLessonPlaybackComplete(p);
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
  return course.modules.every((module) =>
    module.lessons.every(
      (lesson) =>
        !isPlayableCatalogLesson(lesson) || isLessonPlaybackComplete(progressByLesson[lesson.id])
    )
  );
}

export type CourseLessonProgressSummary = {
  totalLessons: number;
  completedLessons: number;
  percent: number;
};

/**
 * Lesson counts and bar percent (same formula as CourseOverview): each lesson counts complete only when
 * `isLessonPlaybackComplete`.
 */
export function getCourseLessonProgressSummaryFromMap(
  course: Course,
  progressByLesson: Record<string, LessonProgress>
): CourseLessonProgressSummary {
  const totalLessons = course.modules.reduce(
    (acc, m) => acc + m.lessons.filter((l) => isPlayableCatalogLesson(l)).length,
    0
  );
  if (totalLessons === 0) {
    return { totalLessons: 0, completedLessons: 0, percent: 0 };
  }
  const completedLessons = course.modules.reduce(
    (acc, m) =>
      acc +
      m.lessons.filter(
        (l) => isPlayableCatalogLesson(l) && isLessonPlaybackComplete(progressByLesson[l.id])
      ).length,
    0
  );
  const percent = Math.min(100, Math.round((completedLessons / totalLessons) * 100));
  return { totalLessons, completedLessons, percent };
}

/** Loads from storage, reconciles stub ids, then same aggregate as the overview. */
export function getCourseLessonProgressSummary(
  course: Course,
  userId: string | null | undefined
): CourseLessonProgressSummary {
  const raw = loadLessonProgressMap(course.id, userId ?? null);
  const { map } = reconcileLessonProgressMap(course, raw);
  return getCourseLessonProgressSummaryFromMap(course, map);
}

/** First lesson in catalog order that is not yet playback-complete; null if every lesson is complete or the course has no lessons. */
export function getFirstIncompleteLesson(
  course: Course,
  progressByLesson: Record<string, LessonProgress>
): Lesson | null {
  for (const module of course.modules) {
    for (const lesson of module.lessons) {
      if (!isPlayableCatalogLesson(lesson)) continue;
      if (!isLessonPlaybackComplete(progressByLesson[lesson.id])) {
        return lesson;
      }
    }
  }
  return null;
}

/** Matches course player startup: first incomplete lesson in order, else first lesson (e.g. completed course / empty map). */
export function getResumeOrStartLesson(
  course: Course,
  progressByLesson: Record<string, LessonProgress>
): Lesson | null {
  const next = getFirstIncompleteLesson(course, progressByLesson);
  if (next) return next;
  const first =
    course.modules[0]?.lessons.find((l) => isPlayableCatalogLesson(l)) ?? course.modules[0]?.lessons[0];
  return first ?? null;
}

/**
 * Auto-advance: first lesson after `current` in catalog order that is not playback-complete.
 * Skips lessons already finished (e.g. user completed later lessons before an earlier one).
 */
export function getNextIncompleteLessonAfter(
  course: Course,
  current: Lesson,
  progressByLesson: Record<string, LessonProgress>
): Lesson | null {
  const flat = flattenLessons(course);
  const i = flat.findIndex((l) => l.id === current.id);
  if (i < 0) return null;
  for (let j = i + 1; j < flat.length; j++) {
    const l = flat[j]!;
    if (!isPlayableCatalogLesson(l)) continue;
    if (!isLessonPlaybackComplete(progressByLesson[l.id])) {
      return l;
    }
  }
  return null;
}

/** True when the course is not finished but the learner has at least one completed lesson or partial playback on a lesson. */
export function hasResumableCourseProgress(course: Course, progressByLesson: Record<string, LessonProgress>): boolean {
  if (isCourseComplete(course, progressByLesson)) return false;
  for (const module of course.modules) {
    for (const lesson of module.lessons) {
      if (!isPlayableCatalogLesson(lesson)) continue;
      const p = progressByLesson[lesson.id];
      if (!p) continue;
      if (isLessonPlaybackComplete(p)) return true;
      if (p.duration > 0 && p.currentTime > 0 && !isTrivialLessonProgress(p)) return true;
    }
  }
  return false;
}

/** Every lesson satisfies `isLessonPlaybackComplete` (same as `isCourseComplete`). */
export function isCourseActuallyFinished(course: Course, progressByLesson: Record<string, LessonProgress>): boolean {
  return isCourseComplete(course, progressByLesson);
}

/** End-of-course flow (rating / overview): unified completion bar on every lesson. */
export function isCourseReadyToFinalize(course: Course, progressByLesson: Record<string, LessonProgress>): boolean {
  return isCourseComplete(course, progressByLesson);
}

export function clearCourseProgress(courseId: string, userId?: string | null): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(progressStorageKey(courseId, userId));
  // Also clear legacy if it exists and we're the same user context
  if (userId) {
    localStorage.removeItem(legacyProgressStorageKey(courseId));
  }
}

/**
 * Same-tab listeners (path UI, etc.) — `storage` events do not fire for writes from this document.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event
 */
export const SKILLLEARN_LOCAL_LEARNER_CLEARED_EVENT = 'skilllearn-local-learner-cleared' as const;

/** Clears browser progress, completion timestamp map entry, and rating for this course+user (e.g. Firestore progress was purged). */
export function clearLocalLearnerStateForCourseId(courseId: string, userId: string): void {
  clearCourseProgress(courseId, userId);
  clearCourseCompletionTimestamp(courseId, userId);
  clearCourseRating(courseId, userId);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SKILLLEARN_LOCAL_LEARNER_CLEARED_EVENT, { detail: { courseId } }));
  }
}

/**
 * If there is no `progress/{userId}_{courseId}` document, clears local copies so path rows and overview match a republished id.
 * Returns true if local learner state was cleared.
 */
export async function alignLocalLearnerStateIfFirestoreProgressMissing(
  courseId: string,
  userId: string
): Promise<boolean> {
  const res = await loadProgressFromFirestore(courseId, userId);
  if (!res.ok || !res.absent) return false;
  clearLocalLearnerStateForCourseId(courseId, userId);
  return true;
}

export type SyncProgressOptions = {
  /** Clear `completedAt` on the progress doc (e.g. course retake). */
  completedAt?: 'delete';
};

/** Syncs progress to Firestore for logged-in users. */
export async function syncProgressToFirestore(
  courseId: string,
  userId: string,
  lessonProgress: Record<string, LessonProgress>,
  options?: SyncProgressOptions
): Promise<void> {
  try {
    const progressId = `${userId}_${courseId}`;
    const payload: Record<string, unknown> = {
      courseId,
      userId,
      lessonProgress,
      lastUpdated: serverTimestamp(),
    };
    if (options?.completedAt === 'delete') {
      payload.completedAt = deleteField();
    }
    await setDoc(doc(db, 'progress', progressId), payload, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'progress');
  }
}

export async function markCourseCompletedTimestampInFirestore(courseId: string, userId: string): Promise<void> {
  try {
    await setDoc(
      doc(db, 'progress', `${userId}_${courseId}`),
      {
        courseId,
        userId,
        completedAt: serverTimestamp(),
        lastUpdated: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'progress');
  }
}

/** `absent: true` = no `progress/{userId}_{courseId}` doc (e.g. after admin purge). Distinct from `ok: false` (error / permission). */
export type LoadProgressFromFirestoreResult =
  | { ok: true; absent: boolean; lessonProgress: Record<string, LessonProgress>; completedAtMs?: number }
  | { ok: false };

/** Loads progress from Firestore for logged-in users. */
export async function loadProgressFromFirestore(
  courseId: string,
  userId: string
): Promise<LoadProgressFromFirestoreResult> {
  try {
    const progressId = `${userId}_${courseId}`;
    const snap = await getDoc(doc(db, 'progress', progressId));
    if (!snap.exists()) {
      console.debug('[debug:courseReuse]', 'Firestore progress doc missing', { courseId, progressId });
      return { ok: true, absent: true, lessonProgress: {} };
    }
    const data = snap.data();
    const lessonProgress = (data.lessonProgress ?? {}) as Record<string, LessonProgress>;
    const ca = data.completedAt;
    let completedAtMs: number | undefined;
    if (ca && typeof (ca as { toMillis?: () => number }).toMillis === 'function') {
      completedAtMs = (ca as { toMillis: () => number }).toMillis();
    }
    return { ok: true, absent: false, lessonProgress, completedAtMs };
  } catch (error) {
    if (isFirestorePermissionDenied(error)) {
      console.debug('[debug:courseReuse]', 'progress load permission denied', { courseId });
      return { ok: false };
    }
    handleFirestoreError(error, OperationType.GET, 'progress');
    return { ok: false };
  }
}

/** Merge all remote progress + completion times into localStorage for profile/offline reads. */
export async function hydrateAllUserProgressFromFirestore(userId: string): Promise<void> {
  try {
    const q = query(collection(db, 'progress'), where('userId', '==', userId));
    const snapshot = await getDocs(q);
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const courseId = data.courseId as string;
      const lessonProgress = (data.lessonProgress ?? {}) as Record<string, LessonProgress>;
      try {
        localStorage.setItem(progressStorageKey(courseId, userId), JSON.stringify(lessonProgress));
      } catch {
        /* ignore */
      }
      const ca = data.completedAt;
      if (ca && typeof (ca as { toMillis?: () => number }).toMillis === 'function') {
        mergeCompletionTimestampFromRemote(courseId, userId, (ca as { toMillis: () => number }).toMillis());
      }
    }
  } catch (error) {
    if (isFirestorePermissionDenied(error)) return;
    handleFirestoreError(error, OperationType.GET, 'progress');
  }
}

/**
 * If we have a completion record (timestamp) but lessonProgress in Firestore was empty/incomplete
 * (common after only cert/rating synced), fill local lessonProgress so UI shows full completion.
 */
function buildSyntheticCompletedLessonMap(
  course: Course,
  existing: Record<string, LessonProgress>
): Record<string, LessonProgress> {
  const out: Record<string, LessonProgress> = { ...existing };
  for (const mod of course.modules) {
    for (const lesson of mod.lessons) {
      const p = out[lesson.id];
      if (!p || !isLessonPlaybackComplete(p)) {
        out[lesson.id] = { currentTime: 1000, duration: 1000 };
      }
    }
  }
  return out;
}

export function ensureSyntheticProgressForRecordedCompletions(userId: string, courses: Course[] = []): void {
  if (typeof localStorage === 'undefined') return;
  const completionTs = loadCompletionTimestamps(userId);
  for (const course of courses) {
    if (completionTs[course.id] == null) continue;
    const m = loadLessonProgressMap(course.id, userId);
    if (isCourseComplete(course, m)) continue;
    // Only backfill when there is no per-lesson progress yet (Firestore had completion but no breakdown).
    // If the map is non-empty, real attempts exist—do not synthesize 100% for newly added lesson IDs.
    if (Object.keys(m).length > 0) continue;
    const filled = buildSyntheticCompletedLessonMap(course, m);
    try {
      localStorage.setItem(progressStorageKey(course.id, userId), JSON.stringify(filled));
    } catch {
      /* ignore */
    }
    void syncProgressToFirestore(course.id, userId, filled);
  }
}
