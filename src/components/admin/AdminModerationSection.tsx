import React, { useState, useCallback } from 'react';
import { CheckCircle2, Flag, Lightbulb, RefreshCw, Trash2 } from 'lucide-react';
import {
  listReportsForAdmin,
  listSuggestionsForAdmin,
  deleteReportAsAdmin,
  deleteSuggestionAsAdmin,
  type AdminReportRow,
  type AdminSuggestionRow,
} from '../../utils/adminModerationFirestore';
import { createReportResolvedNotice } from '../../utils/alertsFirestore';

function formatWhen(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

export const AdminModerationSection: React.FC = () => {
  const [subTab, setSubTab] = useState<'reports' | 'suggestions'>('reports');
  const [reports, setReports] = useState<AdminReportRow[]>([]);
  const [suggestions, setSuggestions] = useState<AdminSuggestionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<
    | { type: 'delete-report'; reportId: string }
    | { type: 'resolve-report'; report: AdminReportRow }
    | { type: 'delete-suggestion'; suggestionId: string }
    | null
  >(null);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    const [r, s] = await Promise.all([listReportsForAdmin(), listSuggestionsForAdmin()]);
    setReports(r);
    setSuggestions(s);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const removeReport = async (id: string) => {
    setConfirmState({ type: 'delete-report', reportId: id });
  };

  const removeSuggestion = async (id: string) => {
    setConfirmState({ type: 'delete-suggestion', suggestionId: id });
  };

  const resolveReport = async (r: AdminReportRow) => {
    setConfirmState({ type: 'resolve-report', report: r });
  };

  const runDeleteReport = async (id: string) => {
    const ok = await deleteReportAsAdmin(id);
    if (ok) {
      setReports((prev) => prev.filter((x) => x.id !== id));
      setMsg('Report deleted.');
    } else setMsg('Failed to delete report.');
  };

  const runDeleteSuggestion = async (id: string) => {
    const ok = await deleteSuggestionAsAdmin(id);
    if (ok) {
      setSuggestions((prev) => prev.filter((x) => x.id !== id));
      setMsg('Suggestion deleted.');
    } else setMsg('Failed to delete suggestion.');
  };

  const runResolveReport = async (r: AdminReportRow) => {
    const lessonLabel = r.lessonTitle || r.lessonId;
    const courseLabel = r.courseTitle || r.courseId;
    const message = courseLabel
      ? `Your report for "${lessonLabel}" in "${courseLabel}" has been reviewed and marked resolved.`
      : `Your report for lesson "${lessonLabel}" has been reviewed and marked resolved.`;
    const notice = await createReportResolvedNotice({
      forUserId: r.userId,
      title: 'Report resolved',
      message,
      lessonId: r.lessonId,
    });
    if (notice.ok === false) {
      setMsg(`${notice.userMessage} Report not resolved.`);
      return;
    }
    const deleted = await deleteReportAsAdmin(r.id);
    if (!deleted) {
      setMsg('User was notified, but report could not be removed from inbox.');
      return;
    }
    setReports((prev) => prev.filter((x) => x.id !== r.id));
    setMsg('Report resolved and user notified.');
  };

  const closeConfirm = useCallback(() => {
    if (confirmSubmitting) return;
    setConfirmState(null);
  }, [confirmSubmitting]);

  const submitConfirm = useCallback(async () => {
    if (!confirmState) return;
    setConfirmSubmitting(true);
    try {
      if (confirmState.type === 'delete-report') {
        await runDeleteReport(confirmState.reportId);
      } else if (confirmState.type === 'delete-suggestion') {
        await runDeleteSuggestion(confirmState.suggestionId);
      } else {
        await runResolveReport(confirmState.report);
      }
      setConfirmState(null);
    } finally {
      setConfirmSubmitting(false);
    }
  }, [confirmState]);

  return (
    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Flag size={20} className="text-orange-500" />
          Moderation inbox
        </h2>
        <button
          type="button"
          disabled={loading}
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--hover-bg)] disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="flex gap-2 border-b border-[var(--border-color)] pb-2">
        <button
          type="button"
          onClick={() => setSubTab('reports')}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
            subTab === 'reports' ? 'bg-orange-500/20 text-orange-500' : 'text-[var(--text-secondary)]'
          }`}
        >
          Reports ({reports.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab('suggestions')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${
            subTab === 'suggestions' ? 'bg-orange-500/20 text-orange-500' : 'text-[var(--text-secondary)]'
          }`}
        >
          <Lightbulb size={14} />
          URL suggestions ({suggestions.length})
        </button>
      </div>

      {msg && <p className="text-xs text-[var(--text-secondary)]">{msg}</p>}

      {subTab === 'reports' && (
        <div className="max-h-[min(28rem,55vh)] space-y-2 overflow-y-auto overscroll-contain">
          {reports.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] py-6 text-center">No reports yet.</p>
          ) : (
            reports.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-4 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="font-semibold text-[var(--text-primary)]">{r.reason}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      Lesson <code className="text-orange-500/90">{r.lessonId}</code> · User{' '}
                      <code className="text-orange-500/90">{r.userId}</code>
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">{formatWhen(r.timestampMs)}</p>
                    {r.details ? (
                      <p className="mt-2 text-[var(--text-secondary)] whitespace-pre-wrap">{r.details}</p>
                    ) : null}
                  </div>
                  <div className="shrink-0 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void resolveReport(r)}
                      className="rounded-lg p-2 text-emerald-400 hover:bg-emerald-500/10"
                      aria-label="Resolve report"
                      title="Resolve and notify user"
                    >
                      <CheckCircle2 size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeReport(r.id)}
                      className="rounded-lg p-2 text-red-400 hover:bg-red-500/10"
                      aria-label="Delete report"
                      title="Delete without notifying"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {subTab === 'suggestions' && (
        <div className="max-h-[min(28rem,55vh)] space-y-2 overflow-y-auto overscroll-contain">
          {suggestions.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] py-6 text-center">No suggestions yet.</p>
          ) : (
            suggestions.map((s) => (
              <div
                key={s.id}
                className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-4 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <a
                      href={s.suggestedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-orange-500 hover:underline break-all"
                    >
                      {s.suggestedUrl}
                    </a>
                    <p className="text-xs text-[var(--text-muted)]">
                      Lesson <code className="text-orange-500/90">{s.lessonId}</code> · User{' '}
                      <code className="text-orange-500/90">{s.userId}</code>
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">{formatWhen(s.timestampMs)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeSuggestion(s.id)}
                    className="shrink-0 rounded-lg p-2 text-red-400 hover:bg-red-500/10"
                    aria-label="Delete suggestion"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
      {confirmState && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-moderation-confirm-title"
        >
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-[var(--border-color)] flex items-center justify-between">
              <h3 id="admin-moderation-confirm-title" className="text-base font-bold text-[var(--text-primary)]">
                {confirmState.type === 'resolve-report' ? 'Resolve report?' : 'Confirm delete?'}
              </h3>
              <button
                type="button"
                onClick={closeConfirm}
                disabled={confirmSubmitting}
                className="rounded-full p-2 hover:bg-[var(--hover-bg)] disabled:opacity-60"
                aria-label="Close confirmation"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-[var(--text-secondary)]">
                {confirmState.type === 'resolve-report'
                  ? 'This will notify the reporting user and remove the report from the moderation inbox.'
                  : confirmState.type === 'delete-report'
                    ? 'This will remove the report without notifying the user.'
                    : 'This will permanently remove the URL suggestion from the inbox.'}
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={closeConfirm}
                  disabled={confirmSubmitting}
                  className="flex-1 border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--hover-bg)] py-2.5 rounded-lg text-sm font-semibold disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void submitConfirm()}
                  disabled={confirmSubmitting}
                  className={`flex-[1.4] py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-60 ${
                    confirmState.type === 'resolve-report' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'
                  }`}
                >
                  {confirmSubmitting
                    ? 'Working...'
                    : confirmState.type === 'resolve-report'
                      ? 'Resolve and notify'
                      : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
