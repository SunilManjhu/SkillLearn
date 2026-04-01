const STORAGE_KEY = 'skilllearn:learnerGeminiEnabled';

/** Dispatched on this window after the preference is written (same-tab updates). */
export const LEARNER_GEMINI_PREFERENCE_CHANGED = 'skilllearn:learnerGeminiPreferenceChanged';

/**
 * When unset, AI features are allowed (matches deployments that already rely on Gemini).
 */
export function readLearnerGeminiEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === null) return true;
    return v === '1';
  } catch {
    return true;
  }
}

export function writeLearnerGeminiEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    window.dispatchEvent(new Event(LEARNER_GEMINI_PREFERENCE_CHANGED));
  } catch {
    /* ignore quota */
  }
}
