import { useLearningAssistantSiteEnabled } from './useLearningAssistantSiteEnabled';
import { useLearnerAssistantVisible } from './useLearnerAssistantVisible';

/** Floating learning assistant: on only when enabled site-wide and on this device. */
export function useLearningAssistantFabVisible(): boolean {
  const { siteAssistantEnabled } = useLearningAssistantSiteEnabled();
  const { visible: userWantsAssistant } = useLearnerAssistantVisible();
  return siteAssistantEnabled && userWantsAssistant;
}
