const STORAGE_KEY = 'skilllearn:learnerAssistantVisible';

/** Dispatched on this window after the preference is written (same-tab updates). */
export const LEARNER_ASSISTANT_PREFERENCE_CHANGED = 'skilllearn:learnerAssistantPreferenceChanged';

/**
 * When unset, the floating learning assistant is shown (when the site allows it).
 */
export function readLearnerAssistantVisible(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === null) return true;
    return v === '1';
  } catch {
    return true;
  }
}

export function writeLearnerAssistantVisible(visible: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, visible ? '1' : '0');
    window.dispatchEvent(new Event(LEARNER_ASSISTANT_PREFERENCE_CHANGED));
  } catch {
    /* ignore quota */
  }
}
