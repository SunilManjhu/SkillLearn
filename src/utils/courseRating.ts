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

export function saveCourseRating(courseId: string, rating: CourseRating, userId?: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ratingStorageKey(courseId, userId), JSON.stringify(rating));
  } catch {
    /* ignore */
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
  }
}
