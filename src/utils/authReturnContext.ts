const STORAGE_KEY = 'skilllearn-auth-return';

/** Snapshot of navigation context written before Google redirect sign-in; consumed after auth. */
export interface AuthReturnPayload {
  v: 1;
  view: string;
  courseId?: string | null;
  initialLessonId?: string | null;
}

export function stashAuthReturnState(payload: Omit<AuthReturnPayload, 'v'>): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const full: AuthReturnPayload = { v: 1, ...payload };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(full));
  } catch {
    /* ignore quota / private mode */
  }
}

export function consumeAuthReturnState(): AuthReturnPayload | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || (parsed as AuthReturnPayload).v !== 1) {
      return null;
    }
    return parsed as AuthReturnPayload;
  } catch {
    return null;
  }
}
