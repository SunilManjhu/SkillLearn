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
