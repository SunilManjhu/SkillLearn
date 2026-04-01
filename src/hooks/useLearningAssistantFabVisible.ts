import { useLearningAssistantSiteEnabled } from './useLearningAssistantSiteEnabled';
import { useLearnerAssistantVisible } from './useLearnerAssistantVisible';

/** Floating learning assistant: on only when enabled site-wide and on this device. */
export function useLearningAssistantFabVisible(): boolean {
  const { siteAssistantEnabled, siteAssistantLoading } = useLearningAssistantSiteEnabled();
  const { visible: userWantsAssistant } = useLearnerAssistantVisible();
  // Do not show until Firestore snapshot: initial state was `true`, which flashed the FAB when admin disabled it.
  if (siteAssistantLoading) return false;
  return siteAssistantEnabled && userWantsAssistant;
}
