import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  loadLearningAssistantSiteEnabled,
  saveLearningAssistantSiteEnabled,
} from '../../utils/learningAssistantSettingsFirestore';
import {
  loadLearnerAiModelsSiteEnabled,
  saveLearnerAiModelsSiteEnabled,
} from '../../utils/learnerAiModelsSettingsFirestore';
import {
  loadNotificationsSiteEnabled,
  saveNotificationsSiteEnabled,
} from '../../utils/notificationsSettingsFirestore';
import { useAdminActionToast } from './useAdminActionToast';

type AiSiteControlsCache = {
  assistantOn: boolean;
  learnerAiOn: boolean;
  notificationsOn: boolean;
};

let aiSiteControlsCache: AiSiteControlsCache | null = null;

export const AdminAiSiteControlsSection: React.FC<{
  children?: React.ReactNode;
  alertsMuted?: boolean;
  onAlertsMutedChange?: (muted: boolean) => void;
}> = ({ children, alertsMuted = false, onAlertsMutedChange }) => {
  const [assistantOn, setAssistantOn] = useState(() => aiSiteControlsCache?.assistantOn ?? true);
  const [learnerAiOn, setLearnerAiOn] = useState(() => aiSiteControlsCache?.learnerAiOn ?? true);
  const [notificationsOn, setNotificationsOn] = useState(() => aiSiteControlsCache?.notificationsOn ?? true);
  const [loading, setLoading] = useState(() => aiSiteControlsCache == null);
  const [savingAssistant, setSavingAssistant] = useState(false);
  const [savingLearnerAi, setSavingLearnerAi] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const { showActionToast, actionToast } = useAdminActionToast();

  const reload = useCallback(async (opts?: { showLoading?: boolean }) => {
    if (opts?.showLoading !== false) setLoading(true);
    const [a, l, n] = await Promise.all([
      loadLearningAssistantSiteEnabled(),
      loadLearnerAiModelsSiteEnabled(),
      loadNotificationsSiteEnabled(),
    ]);
    setAssistantOn(a);
    setLearnerAiOn(l);
    setNotificationsOn(n);
    aiSiteControlsCache = { assistantOn: a, learnerAiOn: l, notificationsOn: n };
    setLoading(false);
  }, []);

  useEffect(() => {
    if (aiSiteControlsCache) {
      const id = window.setTimeout(() => void reload({ showLoading: false }), 0);
      return () => window.clearTimeout(id);
    }
    void reload({ showLoading: true });
  }, [reload]);

  const toggleAssistant = async (next: boolean) => {
    if (savingAssistant) return;
    setSavingAssistant(true);
    const ok = await saveLearningAssistantSiteEnabled(next);
    setSavingAssistant(false);
    if (ok) {
      setAssistantOn(next);
      aiSiteControlsCache = { assistantOn: next, learnerAiOn, notificationsOn };
      showActionToast(next ? 'Learning Assistant on for everyone.' : 'Learning Assistant off for everyone.');
    } else showActionToast('Save failed.', 'danger');
  };

  const toggleLearnerAi = async (next: boolean) => {
    if (savingLearnerAi) return;
    setSavingLearnerAi(true);
    const ok = await saveLearnerAiModelsSiteEnabled(next);
    setSavingLearnerAi(false);
    if (ok) {
      setLearnerAiOn(next);
      aiSiteControlsCache = { assistantOn, learnerAiOn: next, notificationsOn };
      showActionToast(next ? 'Smart Verify on.' : 'Smart Verify off.');
    } else showActionToast('Save failed.', 'danger');
  };

  const toggleNotifications = async (next: boolean) => {
    if (savingNotifications) return;
    setSavingNotifications(true);
    const ok = await saveNotificationsSiteEnabled(next);
    setSavingNotifications(false);
    if (ok) {
      setNotificationsOn(next);
      aiSiteControlsCache = { assistantOn, learnerAiOn, notificationsOn: next };
      showActionToast(next ? 'Notifications on.' : 'Notifications off.');
    } else showActionToast('Save failed.', 'danger');
  };

  const SwitchRow = ({
    id,
    emoji,
    label,
    sub,
    on,
    saving,
    onToggle,
    disabled,
  }: {
    id: string;
    emoji: string;
    label: string;
    sub: string;
    on: boolean;
    saving: boolean;
    onToggle: (v: boolean) => void;
    disabled?: boolean;
  }) => (
    <div className="flex min-h-11 min-w-0 items-center justify-between gap-2 py-1 sm:gap-3 sm:py-0">
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 shrink-0 text-[1.05rem] leading-none sm:text-lg" aria-hidden>
          {emoji}
        </span>
        <div className="min-w-0">
          <p id={id} className="text-sm font-semibold text-[var(--text-primary)]">
            {label}
          </p>
          <p className="text-[11px] leading-snug text-[var(--text-muted)]">{sub}</p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={id}
        disabled={disabled || saving || loading}
        onClick={() => void onToggle(!on)}
        className={`relative h-8 w-[3.25rem] shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50 disabled:opacity-45 ${
          on ? 'bg-emerald-500' : 'bg-[var(--border-color)]'
        }`}
      >
        {saving ? (
          <Loader2 className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 animate-spin text-white" />
        ) : (
          <span
            className={`pointer-events-none absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${
              on ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        )}
        <span className="sr-only">{on ? 'On' : 'Off'}</span>
      </button>
    </div>
  );

  const notificationsRow = (
    <div className="min-w-0">
      <SwitchRow
        id="admin-smart-hub-notifications-toggle"
        emoji="🔔"
        label="Notifications"
        sub="Site-wide: when off, the notification bell is disabled for everyone."
        on={notificationsOn}
        saving={savingNotifications}
        onToggle={toggleNotifications}
      />
    </div>
  );

  return (
    <div className="min-w-0 space-y-4">
      {actionToast}
      {loading ? (
        <p className="flex items-center gap-2 py-2 text-xs text-[var(--text-muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
          Loading…
        </p>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 sm:gap-4">
          <div className="min-w-0">
            <SwitchRow
              id="admin-smart-hub-assistant-toggle"
              emoji="💬"
              label="Learning Assistant"
              sub="Site-wide: floating chat when on. Learners can still adjust visibility in Profile → Smart Hub."
              on={assistantOn}
              saving={savingAssistant}
              onToggle={toggleAssistant}
            />
          </div>
          <div className="min-w-0">
            <SwitchRow
              id="admin-smart-hub-smart-verify-toggle"
              emoji="✨"
              label="Smart Verify"
              sub="Site-wide: quiz grading, hints, and assistant replies when on."
              on={learnerAiOn}
              saving={savingLearnerAi}
              onToggle={toggleLearnerAi}
            />
          </div>
          {notificationsRow}
        </div>
      )}
      {children ? (
        <div className="border-t border-[var(--border-color)] pt-4">
          {children}
        </div>
      ) : null}
    </div>
  );
};
