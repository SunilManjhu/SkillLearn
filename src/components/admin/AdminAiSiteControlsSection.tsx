import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageCircle, Sparkles } from 'lucide-react';
import {
  loadLearningAssistantSiteEnabled,
  saveLearningAssistantSiteEnabled,
} from '../../utils/learningAssistantSettingsFirestore';
import {
  loadLearnerAiModelsSiteEnabled,
  saveLearnerAiModelsSiteEnabled,
} from '../../utils/learnerAiModelsSettingsFirestore';
import { useAdminActionToast } from './useAdminActionToast';

export const AdminAiSiteControlsSection: React.FC = () => {
  const [assistantOn, setAssistantOn] = useState(true);
  const [learnerAiOn, setLearnerAiOn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [savingAssistant, setSavingAssistant] = useState(false);
  const [savingLearnerAi, setSavingLearnerAi] = useState(false);
  const { showActionToast, actionToast } = useAdminActionToast();

  const reload = useCallback(async () => {
    setLoading(true);
    const [a, l] = await Promise.all([loadLearningAssistantSiteEnabled(), loadLearnerAiModelsSiteEnabled()]);
    setAssistantOn(a);
    setLearnerAiOn(l);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggleAssistant = async (next: boolean) => {
    if (savingAssistant) return;
    setSavingAssistant(true);
    const ok = await saveLearningAssistantSiteEnabled(next);
    setSavingAssistant(false);
    if (ok) {
      setAssistantOn(next);
      showActionToast(next ? 'Assistant on for everyone.' : 'Assistant off for everyone.');
    } else showActionToast('Save failed.', 'danger');
  };

  const toggleLearnerAi = async (next: boolean) => {
    if (savingLearnerAi) return;
    setSavingLearnerAi(true);
    const ok = await saveLearnerAiModelsSiteEnabled(next);
    setSavingLearnerAi(false);
    if (ok) {
      setLearnerAiOn(next);
      showActionToast(next ? 'Learner AI on.' : 'Learner AI off.');
    } else showActionToast('Save failed.', 'danger');
  };

  const SwitchRow = ({
    id,
    label,
    sub,
    icon,
    on,
    saving,
    onToggle,
  }: {
    id: string;
    label: string;
    sub: string;
    icon: React.ReactNode;
    on: boolean;
    saving: boolean;
    onToggle: (v: boolean) => void;
  }) => (
    <div className="flex min-h-11 items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 shrink-0 text-orange-500">{icon}</span>
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
        disabled={saving || loading}
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

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-3 sm:p-4">
      {actionToast}
      <p className="mb-2 text-[11px] leading-snug text-[var(--text-muted)]">
        Site-wide. Learners can narrow further in Profile when these stay on.
      </p>
      {loading ? (
        <p className="flex items-center gap-2 py-2 text-xs text-[var(--text-muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
          Loading…
        </p>
      ) : (
        <div className="divide-y divide-[var(--border-color)]">
          <SwitchRow
            id="admin-ai-assistant-toggle"
            label="Floating assistant"
            sub="Chat button + panel."
            icon={<MessageCircle size={16} aria-hidden />}
            on={assistantOn}
            saving={savingAssistant}
            onToggle={toggleAssistant}
          />
          <SwitchRow
            id="admin-ai-learner-toggle"
            label="Learner AI"
            sub="Quiz grading, hints, assistant replies."
            icon={<Sparkles size={16} aria-hidden />}
            on={learnerAiOn}
            saving={savingLearnerAi}
            onToggle={toggleLearnerAi}
          />
        </div>
      )}
    </div>
  );
};
