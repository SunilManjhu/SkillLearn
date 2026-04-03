import { db, handleFirestoreError, isFirestorePermissionDenied, OperationType } from '../firebase';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';

export interface CourseRating {
  stars: number;
  comment?: string;
  dismissedAt?: number;
  remindLaterUntil?: number;
}

function legacyRatingStorageKey(courseId: string): string {
  return `skilllearn-course-rating:${courseId}`;
}

export function ratingStorageKey(courseId: string, userId?: string | null): string {
  if (userId) return `skilllearn-course-rating:user:${userId}:${courseId}`;
  return legacyRatingStorageKey(courseId);
}

function readRatingRaw(courseId: string, userId?: string | null): string | null {
  if (typeof localStorage === 'undefined') return null;
  if (userId) {
    const scoped = localStorage.getItem(ratingStorageKey(courseId, userId));
    if (scoped) return scoped;
    return localStorage.getItem(legacyRatingStorageKey(courseId));
  }
  return localStorage.getItem(legacyRatingStorageKey(courseId));
}

export function loadCourseRating(courseId: string, userId?: string | null): CourseRating | null {
  try {
    const raw = readRatingRaw(courseId, userId);
    if (!raw) return null;
    return JSON.parse(raw) as CourseRating;
  } catch {
    return null;
  }
}

export function courseRatingDocId(courseId: string, userId: string): string {
  return `${userId}_${courseId}`;
}

/** Persists a real star rating (stars 1–5) to Firestore for logged-in users. */
export async function syncCourseRatingToFirestore(
  courseId: string,
  userId: string,
  rating: CourseRating
): Promise<void> {
  if (rating.stars <= 0) return;
  try {
    const id = courseRatingDocId(courseId, userId);
    const payload: Record<string, unknown> = {
      courseId,
      userId,
      stars: rating.stars,
      submittedAt: serverTimestamp(),
    };
    if (rating.comment && rating.comment.trim()) {
      payload.comment = rating.comment.trim();
    }
    await setDoc(doc(db, 'courseRatings', id), payload, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'courseRatings');
  }
}

export async function deleteCourseRatingFromFirestore(courseId: string, userId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'courseRatings', courseRatingDocId(courseId, userId)));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'courseRatings');
  }
}

export type LoadCourseRatingFromFirestoreResult =
  | { ok: true; absent: boolean; rating: CourseRating | null }
  | { ok: false };

export async function loadCourseRatingFromFirestore(
  courseId: string,
  userId: string
): Promise<LoadCourseRatingFromFirestoreResult> {
  try {
    const snap = await getDoc(doc(db, 'courseRatings', courseRatingDocId(courseId, userId)));
    if (!snap.exists()) {
      console.debug('[debug:courseReuse]', 'Firestore courseRating doc missing', { courseId });
      return { ok: true, absent: true, rating: null };
    }
    const data = snap.data();
    const stars = data.stars as number;
    if (!(stars >= 1 && stars <= 5)) {
      return { ok: true, absent: false, rating: null };
    }
    const comment = data.comment as string | undefined;
    return { ok: true, absent: false, rating: { stars, ...(comment ? { comment } : {}) } };
  } catch (error) {
    if (isFirestorePermissionDenied(error)) {
      console.debug('[debug:courseReuse]', 'courseRating load permission denied', { courseId });
      return { ok: false };
    }
    handleFirestoreError(error, OperationType.GET, 'courseRatings');
    return { ok: false };
  }
}

export async function hydrateAllCourseRatingsFromFirestore(userId: string): Promise<void> {
  try {
    const q = query(collection(db, 'courseRatings'), where('userId', '==', userId));
    const snapshot = await getDocs(q);
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const courseId = data.courseId as string;
      const stars = data.stars as number;
      const comment = data.comment as string | undefined;
      if (stars >= 1 && stars <= 5) {
        saveCourseRating(courseId, { stars, ...(comment ? { comment } : {}) }, userId, { skipFirestoreSync: true });
      }
    }
  } catch (error) {
    if (isFirestorePermissionDenied(error)) return;
    handleFirestoreError(error, OperationType.GET, 'courseRatings');
  }
}

export function saveCourseRating(
  courseId: string,
  rating: CourseRating,
  userId?: string | null,
  options?: { skipFirestoreSync?: boolean }
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ratingStorageKey(courseId, userId), JSON.stringify(rating));
  } catch {
    /* ignore */
  }
  if (rating.stars > 0 && userId && !options?.skipFirestoreSync) {
    void syncCourseRatingToFirestore(courseId, userId, rating);
  }
}

export function dismissCourseRating(courseId: string, userId?: string | null): void {
  const existing = loadCourseRating(courseId, userId);
  if (existing && existing.stars > 0) return; // Don't overwrite a real rating
  saveCourseRating(courseId, { stars: 0, dismissedAt: Date.now() }, userId);
}

export function remindLaterCourseRating(courseId: string, userId?: string | null): void {
  const existing = loadCourseRating(courseId, userId);
  if (existing && existing.stars > 0) return;
  // Remind again in 24 hours
  saveCourseRating(courseId, { stars: 0, remindLaterUntil: Date.now() + 24 * 60 * 60 * 1000 }, userId);
}

export function hasRatedOrDismissed(courseId: string, userId?: string | null): boolean {
  const rating = loadCourseRating(courseId, userId);
  if (!rating) return false;
  if (rating.stars > 0 || !!rating.dismissedAt) return true;
  if (rating.remindLaterUntil && Date.now() < rating.remindLaterUntil) return true;
  return false;
}

export function clearCourseRating(courseId: string, userId?: string | null): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(ratingStorageKey(courseId, userId));
  // Also clear legacy if it exists and we're the same user context
  if (userId) {
    localStorage.removeItem(legacyRatingStorageKey(courseId));
    void deleteCourseRatingFromFirestore(courseId, userId);
  }
}
