import { Course, Lesson, STATIC_CATALOG_FALLBACK } from '../data/courses';
import { flattenLessons, getLastLessonInCourse } from './courseLessons';
import { loadCompletionTimestamps, mergeCompletionTimestampFromRemote } from './courseCompletionLog';
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
 * When a course is republished with new lesson ids, stored maps still use old keys (e.g. wd-l1).
 * For courses that exist in the bundled fallback, copy progress from stub order → current order by index.
 */
export function reconcileLessonProgressMap(
  course: Course,
  map: Record<string, LessonProgress>
): { map: Record<string, LessonProgress>; migrated: boolean } {
  const stub = STATIC_CATALOG_FALLBACK.find((c) => c.id === course.id);
  if (!stub) return { map, migrated: false };

  const stubFlat = flattenLessons(stub);
  const currentFlat = flattenLessons(course);
  if (stubFlat.length === 0 || currentFlat.length === 0) return { map, migrated: false };

  const currentIds = new Set(currentFlat.map((l) => l.id));
  const next: Record<string, LessonProgress> = { ...map };
  let migrated = false;

  for (const [legacyId, progress] of Object.entries(map)) {
    if (currentIds.has(legacyId)) continue;
    const idx = stubFlat.findIndex((l) => l.id === legacyId);
    if (idx < 0 || idx >= currentFlat.length) continue;
    const targetId = currentFlat[idx].id;
    if (next[targetId] != null) continue;
    next[targetId] = progress;
    if (legacyId !== targetId) {
      delete next[legacyId];
      migrated = true;
    }
  }

  // Second pass: title match when index alignment skipped (e.g. extra lesson shifted indices).
  for (const [legacyId, progress] of Object.entries(map)) {
    if (currentIds.has(legacyId)) continue;
    if (!(legacyId in next)) continue;
    const stubLesson = stubFlat.find((l) => l.id === legacyId);
    if (!stubLesson) continue;
    const twin = currentFlat.find((l) => l.title.trim() === stubLesson.title.trim());
    if (!twin) continue;
    if (next[twin.id] != null) {
      delete next[legacyId];
      migrated = true;
      continue;
    }
    next[twin.id] = progress;
    delete next[legacyId];
    migrated = true;
  }

  return { map: migrated ? next : map, migrated };
}

export function progressPercent(p: LessonProgress | undefined): number {
  if (!p || !(p.duration > 0)) return 0;
  return Math.min(100, Math.round((p.currentTime / p.duration) * 100));
}

/**
 * True only when progress would show ~100% and the learner reached the real end of the timeline.
 * Avoids the old `duration - 10` rule, which marked short clips “done” near 50% and broke resume.
 */
export function isLessonPlaybackComplete(p: LessonProgress | undefined): boolean {
  if (!p || !(p.duration > 0)) return false;
  const ratio = p.currentTime / p.duration;
  if (ratio >= 0.995) return true;
  if (p.currentTime >= p.duration - 0.75) return true;
  return false;
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
    module.lessons.every(lesson => isLessonPlaybackComplete(progressByLesson[lesson.id]))
  );
}

/** First lesson in catalog order that is not yet playback-complete; null if every lesson is complete or the course has no lessons. */
export function getFirstIncompleteLesson(
  course: Course,
  progressByLesson: Record<string, LessonProgress>
): Lesson | null {
  for (const module of course.modules) {
    for (const lesson of module.lessons) {
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
  const first = course.modules[0]?.lessons[0];
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
      const p = progressByLesson[lesson.id];
      if (!p) continue;
      if (isLessonPlaybackComplete(p)) return true;
      if (p.duration > 0 && p.currentTime > 0) return true;
    }
  }
  return false;
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
 * End-of-course flow (rating / overview): same rules as lesson checkmarks (`isLessonPlaybackComplete`),
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

export type LoadedProgressFromFirestore = {
  lessonProgress: Record<string, LessonProgress>;
  completedAtMs?: number;
} | null;

/** Loads progress from Firestore for logged-in users. */
export async function loadProgressFromFirestore(
  courseId: string,
  userId: string
): Promise<LoadedProgressFromFirestore> {
  try {
    const progressId = `${userId}_${courseId}`;
    const snap = await getDoc(doc(db, 'progress', progressId));
    if (snap.exists()) {
      const data = snap.data();
      const lessonProgress = (data.lessonProgress ?? {}) as Record<string, LessonProgress>;
      const ca = data.completedAt;
      let completedAtMs: number | undefined;
      if (ca && typeof (ca as { toMillis?: () => number }).toMillis === 'function') {
        completedAtMs = (ca as { toMillis: () => number }).toMillis();
      }
      return { lessonProgress, completedAtMs };
    }
  } catch (error) {
    if (isFirestorePermissionDenied(error)) return null;
    handleFirestoreError(error, OperationType.GET, 'progress');
  }
  return null;
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

export function ensureSyntheticProgressForRecordedCompletions(userId: string, courses: Course[] = STATIC_CATALOG_FALLBACK): void {
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
