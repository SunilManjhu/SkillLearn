import { useEffect, useState } from 'react';
import { subscribeNotificationsSiteEnabled } from '../utils/notificationsSettingsFirestore';

/**
 * Live site-wide flag from Firestore `siteSettings/notifications` (default enabled when doc missing).
 */
export function useNotificationsSiteEnabled(): {
  siteNotificationsEnabled: boolean;
  siteNotificationsLoading: boolean;
} {
  const [siteNotificationsEnabled, setSiteNotificationsEnabled] = useState(true);
  const [siteNotificationsLoading, setSiteNotificationsLoading] = useState(true);

  useEffect(() => {
    setSiteNotificationsLoading(true);
    const unsub = subscribeNotificationsSiteEnabled(
      (enabled) => {
        setSiteNotificationsEnabled(enabled);
        setSiteNotificationsLoading(false);
      },
      () => setSiteNotificationsLoading(false)
    );
    return () => unsub();
  }, []);

  return { siteNotificationsEnabled, siteNotificationsLoading };
}

