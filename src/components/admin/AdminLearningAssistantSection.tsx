import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageCircle } from 'lucide-react';
import {
  loadLearningAssistantSiteEnabled,
  saveLearningAssistantSiteEnabled,
} from '../../utils/learningAssistantSettingsFirestore';
import { useAdminActionToast } from './useAdminActionToast';

export const AdminLearningAssistantSection: React.FC = () => {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { showActionToast, actionToast } = useAdminActionToast();

  const reload = useCallback(async () => {
    setLoading(true);
    const v = await loadLearningAssistantSiteEnabled();
    setEnabled(v);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggle = async (next: boolean) => {
    if (saving) return;
    setSaving(true);
    const ok = await saveLearningAssistantSiteEnabled(next);
    setSaving(false);
    if (ok) {
      setEnabled(next);
      showActionToast(next ? 'Learning assistant is on for everyone.' : 'Learning assistant is off for everyone.');
    } else {
      showActionToast('Could not save (check console / rules).', 'danger');
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 sm:p-6">
      {actionToast}
      <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--text-primary)]">
        <MessageCircle size={20} className="text-orange-500" aria-hidden />
        Learning assistant
      </h2>
      <p className="text-xs leading-relaxed text-[var(--text-muted)]">
        Controls the floating learning assistant for all signed-in and anonymous visitors. When off, the chat button
        and panel are hidden everywhere. Learners can still hide it only for themselves in Profile if you leave it on.
      </p>
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
          Loading…
        </p>
      ) : (
        <div className="flex min-h-11 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span id="admin-learning-assistant-label" className="text-sm font-semibold text-[var(--text-primary)]">
            Show learning assistant
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-labelledby="admin-learning-assistant-label"
            disabled={saving}
            onClick={() => void toggle(!enabled)}
            className={`relative h-9 w-14 shrink-0 self-start rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 disabled:opacity-50 sm:self-auto ${
              enabled ? 'bg-emerald-500' : 'bg-[var(--border-color)]'
            }`}
          >
            {saving ? (
              <Loader2
                className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 animate-spin text-white"
                aria-hidden
              />
            ) : (
              <span
                className={`pointer-events-none absolute top-1 left-1 h-7 w-7 rounded-full bg-white shadow transition-transform ${
                  enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            )}
            <span className="sr-only">{enabled ? 'On' : 'Off'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
