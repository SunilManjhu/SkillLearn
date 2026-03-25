import React, { useState, useCallback } from 'react';
import { Flag, Lightbulb, RefreshCw, Trash2 } from 'lucide-react';
import {
  listReportsForAdmin,
  listSuggestionsForAdmin,
  deleteReportAsAdmin,
  deleteSuggestionAsAdmin,
  type AdminReportRow,
  type AdminSuggestionRow,
} from '../../utils/adminModerationFirestore';

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
    if (!window.confirm('Delete this report?')) return;
    const ok = await deleteReportAsAdmin(id);
    if (ok) {
      setReports((prev) => prev.filter((x) => x.id !== id));
      setMsg('Report deleted.');
    } else setMsg('Failed to delete report.');
  };

  const removeSuggestion = async (id: string) => {
    if (!window.confirm('Delete this suggestion?')) return;
    const ok = await deleteSuggestionAsAdmin(id);
    if (ok) {
      setSuggestions((prev) => prev.filter((x) => x.id !== id));
      setMsg('Suggestion deleted.');
    } else setMsg('Failed to delete suggestion.');
  };

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
                  <button
                    type="button"
                    onClick={() => void removeReport(r.id)}
                    className="shrink-0 rounded-lg p-2 text-red-400 hover:bg-red-500/10"
                    aria-label="Delete report"
                  >
                    <Trash2 size={16} />
                  </button>
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
    </div>
  );
};
