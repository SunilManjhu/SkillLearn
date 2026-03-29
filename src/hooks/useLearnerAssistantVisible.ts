import { useCallback, useEffect, useState } from 'react';
import {
  LEARNER_ASSISTANT_PREFERENCE_CHANGED,
  readLearnerAssistantVisible,
  writeLearnerAssistantVisible,
} from '../utils/learnerAssistantPreference';

/**
 * Per-device preference for showing the floating learning assistant (when enabled site-wide).
 */
export function useLearnerAssistantVisible(): {
  visible: boolean;
  setVisible: (next: boolean) => void;
} {
  const [visible, setState] = useState(readLearnerAssistantVisible);

  useEffect(() => {
    const sync = () => setState(readLearnerAssistantVisible());
    window.addEventListener(LEARNER_ASSISTANT_PREFERENCE_CHANGED, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(LEARNER_ASSISTANT_PREFERENCE_CHANGED, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setVisible = useCallback((next: boolean) => {
    writeLearnerAssistantVisible(next);
  }, []);

  return { visible, setVisible };
}
