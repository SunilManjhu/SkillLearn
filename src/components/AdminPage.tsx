import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Shield, Send, Database, BookOpen, Flag, Users, X, Sparkles } from 'lucide-react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useDialogKeyboard } from '../hooks/useDialogKeyboard';
import type { Course } from '../data/courses';
import { STATIC_CATALOG_FALLBACK } from '../data/courses';
import type { AdminHistoryTab } from '../utils/appHistory';
import { createBroadcastAlert, type BroadcastAlertType } from '../utils/alertsFirestore';
import { seedPublishedCoursesFromStaticCatalog } from '../utils/publishedCoursesFirestore';
import { AdminCourseCatalogSection } from './admin/AdminCourseCatalogSection';
import { AdminModerationSection } from './admin/AdminModerationSection';
import { AdminGeminiModelsSection } from './admin/AdminGeminiModelsSection';
import { AdminAiSiteControlsSection } from './admin/AdminAiSiteControlsSection';
import { AdminUserRolesSection } from './admin/AdminUserRolesSection';
import { useAdminActionToast } from './admin/useAdminActionToast';

interface AdminPageProps {
  courses: Course[];
  activeTab: AdminHistoryTab;
  currentAdminUid?: string;
  /** One-shot: open Moderation inbox on this sub-tab (e.g. from navbar notification). */
  moderationInitialSubTab?: 'reports' | 'suggestions' | 'contact' | null;
  onModerationInitialSubTabConsumed?: () => void;
  onTabChange: (tab: AdminHistoryTab) => void;
  onDismiss: () => void;
  onCatalogChanged: () => void | Promise<void>;
  /** Notifies parent when Alerts/Content drafts have unsaved work (for leaving admin via shell navigation). */
  onUnsavedWorkChange?: (dirty: boolean) => void;
}

const ALERT_TYPES: { value: BroadcastAlertType; label: string }[] = [
  { value: 'course_update', label: 'Course update' },
  { value: 'topic_update', label: 'Topic / module update' },
  { value: 'video_update', label: 'New or updated video' },
  { value: 'course_change', label: 'Other course change' },
];

type PendingAdminNavigation =
  | { kind: 'tab'; tab: AdminHistoryTab }
  | { kind: 'dismiss' };

export const AdminPage: React.FC<AdminPageProps> = ({
  courses,
  activeTab: tab,
  currentAdminUid,
  moderationInitialSubTab,
  onModerationInitialSubTabConsumed,
  onTabChange,
  onDismiss,
  onCatalogChanged,
  onUnsavedWorkChange,
}) => {
  const [type, setType] = useState<BroadcastAlertType>('course_update');
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [busy, setBusy] = useState(false);
  const { showActionToast, actionToast } = useAdminActionToast();
  const [showValidationHints, setShowValidationHints] = useState(false);
  const [targetingOpen, setTargetingOpen] = useState(false);
  const [catalogDirty, setCatalogDirty] = useState(false);
  const [pathDirty, setPathDirty] = useState(false);
  const [aiModelsDirty, setAiModelsDirty] = useState(false);
  const [navigationGuardOpen, setNavigationGuardOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingAdminNavigation | null>(null);
  const courseRef = useRef<HTMLSelectElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);

  const alertsDirty = useMemo(() => {
    if (tab !== 'alerts') return false;
    return (
      title.trim() !== '' ||
      message.trim() !== '' ||
      moduleId.trim() !== '' ||
      lessonId.trim() !== ''
    );
  }, [tab, title, message, moduleId, lessonId]);

  const hasUnsavedWork = alertsDirty || catalogDirty || pathDirty || aiModelsDirty;

  useEffect(() => {
    onUnsavedWorkChange?.(hasUnsavedWork);
  }, [hasUnsavedWork, onUnsavedWorkChange]);

  useEffect(() => {
    return () => onUnsavedWorkChange?.(false);
  }, [onUnsavedWorkChange]);

  const closeNavigationGuard = useCallback(() => {
    setNavigationGuardOpen(false);
    setPendingNavigation(null);
  }, []);

  const requestAdminNavigation = useCallback(
    (target: PendingAdminNavigation) => {
      if (target.kind === 'tab' && target.tab === tab) return;
      if (!hasUnsavedWork) {
        if (target.kind === 'tab') {
          onTabChange(target.tab);
          setShowValidationHints(false);
        } else {
          onDismiss();
        }
        return;
      }
      setPendingNavigation(target);
      setNavigationGuardOpen(true);
    },
    [hasUnsavedWork, tab, onTabChange, onDismiss]
  );

  const confirmLeaveAdmin = useCallback(() => {
    const pending = pendingNavigation;
    const wasAlertsDirty = tab === 'alerts' && alertsDirty;
    setNavigationGuardOpen(false);
    setPendingNavigation(null);
    if (!pending) return;
    if (wasAlertsDirty) {
      setTitle('');
      setMessage('');
      setModuleId('');
      setLessonId('');
      setTargetingOpen(false);
      setShowValidationHints(false);
    }
    if (pending.kind === 'tab') {
      onTabChange(pending.tab);
      setShowValidationHints(false);
    } else {
      onDismiss();
    }
  }, [pendingNavigation, tab, alertsDirty, onTabChange, onDismiss]);

  useBodyScrollLock(navigationGuardOpen);

  useDialogKeyboard({
    open: navigationGuardOpen,
    onClose: closeNavigationGuard,
  });

  const selectedCourse = courses.find((c) => c.id === courseId);
  const courseMissing = !courseId;
  const titleMissing = !title.trim();
  const messageMissing = !message.trim();

  const handleSend = async () => {
    if (courseMissing) {
      setShowValidationHints(true);
      showActionToast('Course is required.', 'danger');
      courseRef.current?.focus();
      return;
    }
    if (titleMissing) {
      setShowValidationHints(true);
      showActionToast('Title is required.', 'danger');
      titleRef.current?.focus();
      return;
    }
    if (messageMissing) {
      setShowValidationHints(true);
      showActionToast('Message is required.', 'danger');
      messageRef.current?.focus();
      return;
    }
    setBusy(true);
    setShowValidationHints(false);
    const id = await createBroadcastAlert({
      type,
      title: title.trim(),
      message: message.trim(),
      courseId,
      moduleId: moduleId.trim() || undefined,
      lessonId: lessonId.trim() || undefined,
    });
    setBusy(false);
    if (id) {
      showActionToast('Alert published.');
      setTitle('');
      setMessage('');
      setModuleId('');
      setLessonId('');
      setShowValidationHints(false);
    } else {
      showActionToast('Failed to publish (check console / rules).', 'danger');
    }
  };

  const handleSeedCatalog = async () => {
    setBusy(true);
    try {
      await seedPublishedCoursesFromStaticCatalog(STATIC_CATALOG_FALLBACK);
      await onCatalogChanged();
      showActionToast('Seeded. Catalog updated in this session.');
    } catch {
      showActionToast('Seed failed (check console / rules).', 'danger');
    }
    setBusy(false);
  };

  const tabBtn = (id: AdminHistoryTab, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => requestAdminNavigation({ kind: 'tab', tab: id })}
      className={`inline-flex shrink-0 min-h-10 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition-colors sm:min-h-11 sm:gap-2 sm:px-4 ${
        tab === id
          ? 'bg-orange-500 text-white'
          : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border border-[var(--border-color)] hover:bg-[var(--hover-bg)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] px-4 pb-16 pt-24 sm:px-6">
      <div className="mx-auto max-w-4xl min-w-0 space-y-5 sm:space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <div className="shrink-0 rounded-lg bg-orange-500/15 p-2 text-orange-500">
              <Shield size={22} />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold tracking-tight sm:text-xl">Admin portal</h1>
              <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-secondary)] sm:text-sm sm:line-clamp-none">
                Alerts, AI, catalog, moderation, roles. Not visible to learners.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => requestAdminNavigation({ kind: 'dismiss' })}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-orange-500 hover:bg-orange-500/10 hover:text-orange-400"
            aria-label="Close admin portal"
            title="Close"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <div className="-mx-1 flex gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain px-1 py-0.5 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
          {tabBtn('alerts', 'Alerts', <Send size={16} />)}
          {tabBtn('ai', 'AI', <Sparkles size={16} />)}
          {tabBtn('catalog', 'Content', <BookOpen size={16} />)}
          {tabBtn('moderation', 'Moderation', <Flag size={16} />)}
          {tabBtn('roles', 'Roles', <Users size={16} />)}
        </div>

        {tab === 'alerts' && (
        <div className="space-y-8">
        <div className="space-y-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 sm:p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Send size={20} className="text-orange-500" />
            Send course alert
          </h2>
          <p className="text-xs text-[var(--text-muted)]">
            Only users enrolled in the selected course receive this in their notification bell.
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-[var(--text-secondary)]">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as BroadcastAlertType)}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
              >
                {ALERT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-[var(--text-secondary)]">Course</label>
              <select
                ref={courseRef}
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                aria-invalid={showValidationHints && courseMissing ? true : undefined}
                className={`w-full bg-[var(--bg-primary)] border rounded-lg px-3 py-2 text-sm ${
                  showValidationHints && courseMissing ? 'border-red-500/70' : 'border-[var(--border-color)]'
                }`}
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              {showValidationHints && courseMissing && (
                <p className="text-xs text-red-400">Course is required.</p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-[var(--text-secondary)]">Title</label>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-invalid={showValidationHints && titleMissing ? true : undefined}
              className={`w-full bg-[var(--bg-primary)] border rounded-lg px-3 py-2 text-sm ${
                showValidationHints && titleMissing ? 'border-red-500/70' : 'border-[var(--border-color)]'
              }`}
              placeholder="Short headline"
            />
            {showValidationHints && titleMissing && (
              <p className="text-xs text-red-400">Title is required.</p>
            )}
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-[var(--text-secondary)]">Message</label>
            <textarea
              ref={messageRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              aria-invalid={showValidationHints && messageMissing ? true : undefined}
              className={`w-full bg-[var(--bg-primary)] border rounded-lg px-3 py-2 text-sm resize-none ${
                showValidationHints && messageMissing ? 'border-red-500/70' : 'border-[var(--border-color)]'
              }`}
              placeholder="What changed?"
            />
            {showValidationHints && messageMissing && (
              <p className="text-xs text-red-400">Message is required.</p>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5">
            <button
              type="button"
              onClick={() => setTargetingOpen((v) => !v)}
              className="w-full flex items-center justify-between text-xs font-semibold text-[var(--text-secondary)]"
            >
              Optional targeting (module / lesson)
              <span className="text-[10px]">{targetingOpen ? 'Hide' : 'Show'}</span>
            </button>
            {targetingOpen && (
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-[var(--text-secondary)]">
                    Module ID (optional)
                  </label>
                  <select
                    value={moduleId}
                    onChange={(e) => setModuleId(e.target.value)}
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">— None —</option>
                    {(selectedCourse?.modules ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title} ({m.id})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-[var(--text-secondary)]">
                    Lesson ID (optional)
                  </label>
                  <select
                    value={lessonId}
                    onChange={(e) => setLessonId(e.target.value)}
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">— None —</option>
                    {(selectedCourse?.modules ?? []).flatMap((m) =>
                      m.lessons.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.title} ({l.id})
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSend()}
            className="min-h-11 w-full rounded-xl bg-orange-500 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-50"
          >
            {busy ? 'Publishing…' : 'Publish alert'}
          </button>
        </div>

        <div className="space-y-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 sm:p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Database size={20} className="text-orange-500" />
            Catalog bootstrap
          </h2>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            One-time: populate the live course catalog from the bundled default courses so learners can browse them.
            Requires admin access and deployed security rules. If seed fails, check the browser console.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSeedCatalog()}
            className="min-h-11 w-full rounded-xl border border-[var(--border-color)] py-3 text-sm font-bold hover:bg-[var(--hover-bg)] disabled:opacity-50"
          >
            Sync bundled courses into catalog
          </button>
        </div>
        </div>
        )}

        {tab === 'ai' && (
          <div className="space-y-4">
            <AdminAiSiteControlsSection />
            <AdminGeminiModelsSection onDirtyChange={setAiModelsDirty} />
          </div>
        )}

        {tab === 'catalog' && (
          <AdminCourseCatalogSection
            onCatalogChanged={onCatalogChanged}
            onDraftDirtyChange={setCatalogDirty}
            onPathsDirtyChange={setPathDirty}
          />
        )}

        {tab === 'moderation' && (
          <AdminModerationSection
            initialSubTab={moderationInitialSubTab ?? undefined}
            onInitialSubTabConsumed={onModerationInitialSubTabConsumed}
          />
        )}
        {tab === 'roles' && <AdminUserRolesSection currentAdminUid={currentAdminUid} />}

        <AnimatePresence>
          {navigationGuardOpen && (
            <div
              className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-nav-guard-title"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="w-full max-w-lg overflow-hidden rounded-3xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
              >
                <div className="flex items-center justify-between gap-4 border-b border-[var(--border-color)] p-6">
                  <h2
                    id="admin-nav-guard-title"
                    className="text-xl font-bold text-[var(--text-primary)]"
                  >
                    Leave without saving?
                  </h2>
                  <button
                    type="button"
                    onClick={closeNavigationGuard}
                    className="shrink-0 rounded-full p-2 transition-colors hover:bg-[var(--hover-bg)]"
                    aria-label="Close"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="space-y-4 p-6">
                  <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                    You have unsaved changes. If you leave this tab or close the admin portal now, that work will be
                    lost.
                  </p>
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      autoFocus
                      onClick={closeNavigationGuard}
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-5 py-3 text-sm font-bold text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] sm:w-auto"
                    >
                      Keep editing
                    </button>
                    <button
                      type="button"
                      onClick={confirmLeaveAdmin}
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-orange-600 sm:w-auto"
                    >
                      Leave anyway
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {actionToast}
      </div>
    </div>
  );
};
