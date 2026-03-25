const PREFIX = 'skilllearn-course-completed-at:';

function storageKey(userId: string | null): string {
  return userId ? `${PREFIX}user:${userId}` : `${PREFIX}anon`;
}

export function recordCourseCompletion(courseId: string, userId: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const map: Record<string, number> = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    map[courseId] = Date.now();
    localStorage.setItem(storageKey(userId), JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function loadCompletionTimestamps(userId: string | null | undefined): Record<string, number> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(storageKey(userId ?? null));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, number>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

/** When hydrating from Firestore, keep the latest completion time if both local and remote exist. */
export function mergeCompletionTimestampFromRemote(courseId: string, userId: string, completedAtMs: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const map: Record<string, number> = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    const prev = map[courseId];
    map[courseId] = Math.max(prev ?? 0, completedAtMs);
    localStorage.setItem(storageKey(userId), JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** Clear a course’s completion record (e.g. after retake). */
export function clearCourseCompletionTimestamp(courseId: string, userId: string | null): void {
  if (typeof localStorage === 'undefined' || !userId) return;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return;
    const map = JSON.parse(raw) as Record<string, number>;
    delete map[courseId];
    localStorage.setItem(storageKey(userId), JSON.stringify(map));
  } catch {
    /* ignore */
  }
}
