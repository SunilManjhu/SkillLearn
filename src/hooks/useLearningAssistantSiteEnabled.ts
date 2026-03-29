import { useEffect, useState } from 'react';
import { subscribeLearningAssistantSiteEnabled } from '../utils/learningAssistantSettingsFirestore';

/**
 * Live site-wide flag from Firestore `siteSettings/learningAssistant` (default enabled when doc missing).
 */
export function useLearningAssistantSiteEnabled(): {
  siteAssistantEnabled: boolean;
  siteAssistantLoading: boolean;
} {
  const [siteAssistantEnabled, setSiteAssistantEnabled] = useState(true);
  const [siteAssistantLoading, setSiteAssistantLoading] = useState(true);

  useEffect(() => {
    setSiteAssistantLoading(true);
    const unsub = subscribeLearningAssistantSiteEnabled(
      (enabled) => {
        setSiteAssistantEnabled(enabled);
        setSiteAssistantLoading(false);
      },
      () => setSiteAssistantLoading(false)
    );
    return () => unsub();
  }, []);

  return { siteAssistantEnabled, siteAssistantLoading };
}
