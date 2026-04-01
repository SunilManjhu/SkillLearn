import { useEffect, useState } from 'react';
import { subscribeLearnerAiModelsSiteEnabled } from '../utils/learnerAiModelsSettingsFirestore';

/**
 * Site-wide flag from Firestore `siteSettings/learnerAiModels` for quiz AI, hints, and assistant API calls (default on when doc missing).
 */
export function useLearnerAiModelsSiteEnabled(): {
  siteLearnerAiModelsEnabled: boolean;
  siteLearnerAiModelsLoading: boolean;
} {
  const [siteLearnerAiModelsEnabled, setSiteLearnerAiModelsEnabled] = useState(true);
  const [siteLearnerAiModelsLoading, setSiteLearnerAiModelsLoading] = useState(true);

  useEffect(() => {
    setSiteLearnerAiModelsLoading(true);
    const unsub = subscribeLearnerAiModelsSiteEnabled(
      (enabled) => {
        setSiteLearnerAiModelsEnabled(enabled);
        setSiteLearnerAiModelsLoading(false);
      },
      () => setSiteLearnerAiModelsLoading(false)
    );
    return () => unsub();
  }, []);

  return { siteLearnerAiModelsEnabled, siteLearnerAiModelsLoading };
}
