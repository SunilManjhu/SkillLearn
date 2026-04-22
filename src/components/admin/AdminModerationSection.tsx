import React, { useState, useCallback } from 'react';
import { CheckCircle2, Flag, Lightbulb, Mail, RefreshCw, Trash2, X } from 'lucide-react';
import {
  listReportsForAdmin,
  listSuggestionsForAdmin,
  listContactMessagesForAdmin,
  subscribeReportsForAdmin,
  subscribeSuggestionsForAdmin,
  subscribeContactMessagesForAdmin,
  deleteReportAsAdmin,
  deleteSuggestionAsAdmin,
  deleteContactMessageAsAdmin,
  type AdminReportRow,
  type AdminSuggestionRow,
  type AdminContactMessageRow,
} from '../../utils/adminModerationFirestore';
import { createReportResolvedNotice } from '../../utils/alertsFirestore';
import { useAdminActionToast } from './useAdminActionToast';

function formatWhen(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

function senderLine(c: AdminContactMessageRow): string {
  const parts: string[] = [];
  if (c.senderDisplayName.trim()) parts.push(c.senderDisplayName.trim());
  if (c.senderEmail.trim()) parts.push(c.senderEmail.trim());
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export interface AdminModerationSectionProps {
  /** One-shot: switch to this sub-tab when set (e.g. from navbar notification). */
  initialSubTab?: 'reports' | 'suggestions' | 'contact';
  onInitialSubTabConsumed?: () => void;
}

export const AdminModerationSection: React.FC<AdminModerationSectionProps> = ({
  initialSubTab,
  onInitialSubTabConsumed,
}) => {
  const [subTab, setSubTab] = useState<'reports' | 'suggestions' | 'contact'>('reports');
  const [reports, setReports] = useState<AdminReportRow[]>([]);
  const [suggestions, setSuggestions] = useState<AdminSuggestionRow[]>([]);
  const [contactMessages, setContactMessages] = useState<AdminContactMessageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const { showActionToast, actionToast } = useAdminActionToast();
  const [confirmState, setConfirmState] = useState<
    | { type: 'delete-report'; reportId: string }
    | { type: 'resolve-report'; report: AdminReportRow }
    | { type: 'delete-suggestion'; suggestionId: string }
    | { type: 'delete-contact'; messageId: string }
    | null
  >(null);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [r, s, c] = await Promise.all([
      listReportsForAdmin(),
      listSuggestionsForAdmin(),
      listContactMessagesForAdmin(),
    ]);
    setReports(r);
    setSuggestions(s);
    setContactMessages(c);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    if (!initialSubTab) return;
    setSubTab(initialSubTab);
    onInitialSubTabConsumed?.();
  }, [initialSubTab, onInitialSubTabConsumed]);

  React.useEffect(() => {
    setLoading(true);
    let firstReportsSeen = false;
    let firstSuggestionsSeen = false;
    let firstContactSeen = false;
    const markReady = () => {
      if (firstReportsSeen && firstSuggestionsSeen && firstContactSeen) setLoading(false);
    };

    const unsubReports = subscribeReportsForAdmin(
      (rows) => {
        setReports(rows);
        firstReportsSeen = true;
        markReady();
      },
      () => showActionToast('Failed to subscribe to reports.', 'danger')
    );
    const unsubSuggestions = subscribeSuggestionsForAdmin(
      (rows) => {
        setSuggestions(rows);
        firstSuggestionsSeen = true;
        markReady();
      },
      () => showActionToast('Failed to subscribe to suggestions.', 'danger')
    );
    const unsubContact = subscribeContactMessagesForAdmin(
      (rows) => {
        setContactMessages(rows);
        firstContactSeen = true;
        markReady();
      },
      () => showActionToast('Failed to subscribe to contact messages.', 'danger')
    );

    return () => {
      unsubReports();
      unsubSuggestions();
      unsubContact();
    };
  }, [showActionToast]);

  const removeReport = async (id: string) => {
    setConfirmState({ type: 'delete-report', reportId: id });
  };

  const removeSuggestion = async (id: string) => {
    setConfirmState({ type: 'delete-suggestion', suggestionId: id });
  };

  const removeContact = async (id: string) => {
    setConfirmState({ type: 'delete-contact', messageId: id });
  };

  const resolveReport = async (r: AdminReportRow) => {
    setConfirmState({ type: 'resolve-report', report: r });
  };

  const runDeleteReport = async (id: string) => {
    const ok = await deleteReportAsAdmin(id);
    if (ok) {
      setReports((prev) => prev.filter((x) => x.id !== id));
      showActionToast('Report deleted.');
    } else showActionToast('Failed to delete report.', 'danger');
  };

  const runDeleteSuggestion = async (id: string) => {
    const ok = await deleteSuggestionAsAdmin(id);
    if (ok) {
      setSuggestions((prev) => prev.filter((x) => x.id !== id));
      showActionToast('Suggestion deleted.');
    } else showActionToast('Failed to delete suggestion.', 'danger');
  };

  const runDeleteContact = async (id: string) => {
    const ok = await deleteContactMessageAsAdmin(id);
    if (ok) {
      setContactMessages((prev) => prev.filter((x) => x.id !== id));
      showActionToast('Contact message deleted.');
    } else showActionToast('Failed to delete contact message.', 'danger');
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
      showActionToast(`${notice.userMessage} Report not resolved.`, 'danger');
      return;
    }
    const deleted = await deleteReportAsAdmin(r.id);
    if (!deleted) {
      showActionToast('User was notified, but report could not be removed from inbox.', 'danger');
      return;
    }
    setReports((prev) => prev.filter((x) => x.id !== r.id));
    showActionToast('Report resolved and user notified.');
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
      } else if (confirmState.type === 'delete-contact') {
        await runDeleteContact(confirmState.messageId);
      } else {
        await runResolveReport(confirmState.report);
      }
      setConfirmState(null);
    } finally {
      setConfirmSubmitting(false);
    }
  }, [confirmState]);

  const confirmBody =
    confirmState?.type === 'resolve-report'
      ? 'This will notify the reporting user and remove the report from the moderation inbox.'
      : confirmState?.type === 'delete-report'
        ? 'This will remove the report without notifying the user.'
        : confirmState?.type === 'delete-contact'
          ? 'This will permanently remove the contact message from the inbox.'
          : 'This will permanently remove the URL suggestion from the inbox.';

  return (
    <div className="min-w-0 space-y-6 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Flag size={20} className="text-admin-icon" />
          Moderation inbox
        </h2>
        <button
          type="button"
          disabled={loading}
          onClick={() => void load()}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs font-semibold hover:bg-[var(--hover-bg)] disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-[var(--border-color)] px-1 pb-2 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => setSubTab('reports')}
          className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold min-h-10 sm:min-h-0 ${
            subTab === 'reports'
              ? 'bg-[#616161]/10 text-[var(--text-primary)] ring-1 ring-[#a1a2a2]/45 app-dark:bg-[var(--tone-800)] app-dark:ring-[var(--tone-500)]'
              : 'text-[var(--text-secondary)]'
          }`}
        >
          Reports ({reports.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab('suggestions')}
          className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold sm:min-h-0 ${
            subTab === 'suggestions'
              ? 'bg-[#616161]/10 text-[var(--text-primary)] ring-1 ring-[#a1a2a2]/45 app-dark:bg-[var(--tone-800)] app-dark:ring-[var(--tone-500)]'
              : 'text-[var(--text-secondary)]'
          }`}
        >
          <Lightbulb size={14} />
          URL suggestions ({suggestions.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab('contact')}
          className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold sm:min-h-0 ${
            subTab === 'contact'
              ? 'bg-[#616161]/10 text-[var(--text-primary)] ring-1 ring-[#a1a2a2]/45 app-dark:bg-[var(--tone-800)] app-dark:ring-[var(--tone-500)]'
              : 'text-[var(--text-secondary)]'
          }`}
        >
          <Mail size={14} />
          Contact ({contactMessages.length})
        </button>
      </div>

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
                      Lesson <code className="text-[#616161] app-dark:text-[var(--tone-200)]">{r.lessonId}</code> · User{' '}
                      <code className="text-[#616161] app-dark:text-[var(--tone-200)]">{r.userId}</code>
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">{formatWhen(r.timestampMs)}</p>
                    {r.details ? (
                      <p className="mt-2 text-[var(--text-secondary)] whitespace-pre-wrap">{r.details}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void resolveReport(r)}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[#a1a2a2] hover:bg-[#757676]/12"
                      aria-label="Resolve report"
                      title="Resolve and notify user"
                    >
                      <CheckCircle2 size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeReport(r.id)}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[#a1a2a2] hover:bg-[#757676]/12"
                      aria-label="Delete report"
                      title="Delete without notifying"
                    >
                      <Trash2 size={18} />
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
                      className="font-medium text-[#616161] hover:underline break-all app-dark:text-[var(--tone-100)]"
                    >
                      {s.suggestedUrl}
                    </a>
                    <p className="text-xs text-[var(--text-muted)]">
                      Lesson <code className="text-[#616161] app-dark:text-[var(--tone-200)]">{s.lessonId}</code> · User{' '}
                      <code className="text-[#616161] app-dark:text-[var(--tone-200)]">{s.userId}</code>
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">{formatWhen(s.timestampMs)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeSuggestion(s.id)}
                    className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-[#a1a2a2] hover:bg-[#757676]/12"
                    aria-label="Delete suggestion"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {subTab === 'contact' && (
        <div className="max-h-[min(28rem,55vh)] space-y-2 overflow-y-auto overscroll-contain">
          {contactMessages.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] py-6 text-center">No contact messages yet.</p>
          ) : (
            contactMessages.map((c) => (
              <div
                key={c.id}
                className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-4 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="font-semibold text-[var(--text-primary)]">{c.subject}</p>
                    <p className="text-xs text-[var(--text-muted)]">{senderLine(c)}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      User <code className="text-[#616161] app-dark:text-[var(--tone-200)]">{c.userId}</code>
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">{formatWhen(c.timestampMs)}</p>
                    <p className="mt-2 text-[var(--text-secondary)] whitespace-pre-wrap">{c.message}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeContact(c.id)}
                    className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-[#a1a2a2] hover:bg-[#757676]/12"
                    aria-label="Delete contact message"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {confirmState && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-[#272828]/75 backdrop-blur-sm"
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
                aria-label="Close"
              >
                <X size={20} className="text-[var(--text-secondary)]" aria-hidden />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-[var(--text-secondary)]">{confirmBody}</p>
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => void submitConfirm()}
                  disabled={confirmSubmitting}
                  className={`min-h-11 w-full rounded-lg py-2.5 text-sm font-semibold text-[#e7e7e7] disabled:opacity-60 sm:w-auto sm:min-w-[12rem] ${
                    confirmState.type === 'resolve-report' ? 'bg-[#616161] hover:bg-[#757676]' : 'bg-[#616161] hover:bg-[#4c4d4d]'
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
      {actionToast}
    </div>
  );
};
