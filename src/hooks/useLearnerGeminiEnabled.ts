import { useCallback, useEffect, useState } from 'react';
import {
  LEARNER_GEMINI_PREFERENCE_CHANGED,
  readLearnerGeminiEnabled,
  writeLearnerGeminiEnabled,
} from '../utils/learnerGeminiPreference';

/**
 * Live preference for whether the learner allows in-app Gemini calls (quiz AI, assistant).
 */
export function useLearnerGeminiEnabled(): {
  enabled: boolean;
  setEnabled: (next: boolean) => void;
} {
  const [enabled, setState] = useState(readLearnerGeminiEnabled);

  useEffect(() => {
    const sync = () => setState(readLearnerGeminiEnabled());
    window.addEventListener(LEARNER_GEMINI_PREFERENCE_CHANGED, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(LEARNER_GEMINI_PREFERENCE_CHANGED, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    writeLearnerGeminiEnabled(next);
  }, []);

  return { enabled, setEnabled };
}
