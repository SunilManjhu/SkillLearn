import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Shield, Send, BookOpen, Flag, Users, X, Sparkles, Megaphone, Library } from 'lucide-react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useDialogKeyboard } from '../hooks/useDialogKeyboard';
import type { Course } from '../data/courses';
import type { LearningPath } from '../data/learningPaths';
import type { AdminHistoryTab } from '../utils/appHistory';
import { createBroadcastAlert, type BroadcastAlertType } from '../utils/alertsFirestore';
import { AdminCourseCatalogSection } from './admin/AdminCourseCatalogSection';
import { AdminModerationSection } from './admin/AdminModerationSection';
import { AdminGeminiModelsSection } from './admin/AdminGeminiModelsSection';
import { AdminAiSiteControlsSection } from './admin/AdminAiSiteControlsSection';
import { AdminUserRolesSection } from './admin/AdminUserRolesSection';
import { AdminCreatorInventorySection } from './admin/AdminCreatorInventorySection';
import { AdminHeroPhoneAdsSection } from './admin/AdminHeroPhoneAdsSection';
import { AdminLabelInfoTip } from './admin/adminLabelInfoTip';
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
  /** Same asset URL as the home hero phone mockup (for live preview in Marketing tab). */
  heroPhoneMockupSrc: string;
  /** Notifies parent when Alerts/Content drafts have unsaved work (for leaving admin via shell navigation). */
  onUnsavedWorkChange?: (dirty: boolean) => void;
  /** Same bell mute preference as Profile → Smart Hub (per signed-in account). */
  alertsMuted?: boolean;
  onAlertsMutedChange?: (muted: boolean) => void;
  /** Creators tab: open another user’s private course in learner overview. */
  onAdminPreviewCreatorCourse?: (ownerUid: string, course: Course) => void;
  /** Creators tab: open another user’s private path in Browse Catalog. */
  onAdminPreviewCreatorPath?: (ownerUid: string, path: LearningPath) => void;
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
  heroPhoneMockupSrc,
  onUnsavedWorkChange,
  alertsMuted = false,
  onAlertsMutedChange,
  onAdminPreviewCreatorCourse,
  onAdminPreviewCreatorPath,
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
  const [phoneAdsDirty, setPhoneAdsDirty] = useState(false);
  const [navigationGuardOpen, setNavigationGuardOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingAdminNavigation | null>(null);
  const courseRef = useRef<HTMLSelectElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);

  const sortedCourses = useMemo(
    () =>
      [...courses].sort((a, b) =>
        (a.title || a.id).localeCompare(b.title || b.id, undefined, { sensitivity: 'base' })
      ),
    [courses]
  );

  useEffect(() => {
    if (sortedCourses.length === 0) {
      setCourseId('');
      return;
    }
    setCourseId((current) =>
      sortedCourses.some((c) => c.id === current) ? current : sortedCourses[0].id
    );
  }, [sortedCourses]);

  useEffect(() => {
    setModuleId('');
    setLessonId('');
  }, [courseId]);

  const alertsDirty = useMemo(() => {
    if (tab !== 'alerts') return false;
    return (
      title.trim() !== '' ||
      message.trim() !== '' ||
      moduleId.trim() !== '' ||
      lessonId.trim() !== ''
    );
  }, [tab, title, message, moduleId, lessonId]);

  const hasUnsavedWork = alertsDirty || catalogDirty || pathDirty || aiModelsDirty || phoneAdsDirty;

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

  const selectedCourse = sortedCourses.find((c) => c.id === courseId);
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
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] px-3 pb-20 pt-24 sm:px-6 sm:pb-16">
      <div
        className="mx-auto min-w-0 max-w-6xl space-y-5 sm:space-y-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <div className="shrink-0 rounded-lg bg-orange-500/15 p-2 text-orange-500">
              <Shield size={22} />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold tracking-tight sm:text-xl">Admin portal</h1>
              <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-secondary)] sm:text-sm sm:line-clamp-none">
                Alerts, Smart Hub, catalog, marketing, moderation, roles, creator inventory. Not visible to learners.
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
          {tabBtn('ai', 'Smart Hub', <Sparkles size={16} />)}
          {tabBtn('catalog', 'Content', <BookOpen size={16} />)}
          {tabBtn('marketing', 'Marketing', <Megaphone size={16} />)}
          {tabBtn('moderation', 'Moderation', <Flag size={16} />)}
          {tabBtn('roles', 'Roles', <Users size={16} />)}
          {tabBtn('creators', 'Creators', <Library size={16} />)}
        </div>

        {tab === 'alerts' && (
        <div
          className="min-w-0 space-y-6 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 sm:p-6"
          role="region"
          aria-labelledby="admin-alerts-heading"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                <h2 id="admin-alerts-heading" className="m-0 flex items-center gap-2 text-lg font-bold leading-none">
                  <Send size={20} className="shrink-0 text-orange-500" aria-hidden />
                  Send course alert
                </h2>
                <AdminLabelInfoTip
                  controlOnly
                  tipId="admin-tip-alerts-send"
                  tipRegionAriaLabel="Send course alert tips"
                  tipSubject="Send course alert"
                >
                  <li>Only learners enrolled in the selected course see this in their bell.</li>
                  <li>Optional targeting narrows it to one module or lesson.</li>
                </AdminLabelInfoTip>
              </div>
            </div>
            {alertsDirty && sortedCourses.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setTitle('');
                  setMessage('');
                  setModuleId('');
                  setLessonId('');
                  setTargetingOpen(false);
                  setShowValidationHints(false);
                }}
                className="inline-flex min-h-11 shrink-0 touch-manipulation items-center justify-center self-start rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] sm:self-auto"
              >
                Clear draft
              </button>
            ) : null}
          </div>

          {sortedCourses.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)]/35 px-4 py-8 text-center sm:px-6">
              <p className="text-sm font-semibold text-[var(--text-primary)]">No courses yet</p>
              <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-[var(--text-muted)]">
                Publish at least one course in Content before you can target an alert.
              </p>
              <button
                type="button"
                onClick={() => requestAdminNavigation({ kind: 'tab', tab: 'catalog' })}
                className="mt-5 inline-flex min-h-11 w-full max-w-xs touch-manipulation items-center justify-center rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600 sm:w-auto"
              >
                Open Content
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor="admin-alerts-type" className="block text-xs font-semibold text-[var(--text-secondary)]">
                    Type
                  </label>
                  <select
                    id="admin-alerts-type"
                    value={type}
                    onChange={(e) => setType(e.target.value as BroadcastAlertType)}
                    className="box-border min-h-11 w-full touch-manipulation rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-base text-[var(--text-primary)] sm:text-sm"
                  >
                    {ALERT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="admin-alerts-course" className="block text-xs font-semibold text-[var(--text-secondary)]">
                    Course
                  </label>
                  <select
                    id="admin-alerts-course"
                    ref={courseRef}
                    value={courseId}
                    onChange={(e) => setCourseId(e.target.value)}
                    aria-invalid={showValidationHints && courseMissing ? true : undefined}
                    aria-describedby={showValidationHints && courseMissing ? 'admin-alerts-course-err' : undefined}
                    className={`box-border min-h-11 w-full touch-manipulation rounded-lg border bg-[var(--bg-primary)] px-3 py-2 text-base text-[var(--text-primary)] sm:text-sm ${
                      showValidationHints && courseMissing ? 'border-red-500/70' : 'border-[var(--border-color)]'
                    }`}
                  >
                    {sortedCourses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title} ({c.id})
                      </option>
                    ))}
                  </select>
                  {showValidationHints && courseMissing ? (
                    <p id="admin-alerts-course-err" className="text-xs text-red-400" role="alert">
                      Course is required.
                    </p>
                  ) : null}
                </div>
              </div>

              <details
                open={targetingOpen}
                onToggle={(e) => setTargetingOpen(e.currentTarget.open)}
                className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5"
              >
                <summary className="cursor-pointer list-none text-xs font-semibold text-[var(--text-secondary)] [&::-webkit-details-marker]:hidden">
                  <span className="flex w-full items-center justify-between gap-2">
                    <span>Optional targeting (module / lesson)</span>
                    <span className="text-[10px] font-normal text-[var(--text-muted)]">
                      {targetingOpen ? 'Hide' : 'Show'}
                    </span>
                  </span>
                </summary>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label htmlFor="admin-alerts-module" className="block text-xs font-semibold text-[var(--text-secondary)]">
                      Module (optional)
                    </label>
                    <select
                      id="admin-alerts-module"
                      value={moduleId}
                      onChange={(e) => setModuleId(e.target.value)}
                      className="box-border min-h-11 w-full touch-manipulation rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-base text-[var(--text-primary)] sm:text-sm"
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
                    <label htmlFor="admin-alerts-lesson" className="block text-xs font-semibold text-[var(--text-secondary)]">
                      Lesson (optional)
                    </label>
                    <select
                      id="admin-alerts-lesson"
                      value={lessonId}
                      onChange={(e) => setLessonId(e.target.value)}
                      className="box-border min-h-11 w-full touch-manipulation rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-base text-[var(--text-primary)] sm:text-sm"
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
              </details>

              <div className="space-y-1">
                <label htmlFor="admin-alerts-title" className="block text-xs font-semibold text-[var(--text-secondary)]">
                  Title
                </label>
                <input
                  id="admin-alerts-title"
                  ref={titleRef}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  autoComplete="off"
                  aria-invalid={showValidationHints && titleMissing ? true : undefined}
                  aria-describedby={showValidationHints && titleMissing ? 'admin-alerts-title-err' : undefined}
                  className={`box-border min-h-11 w-full touch-manipulation rounded-lg border bg-[var(--bg-primary)] px-3 py-2 text-base text-[var(--text-primary)] sm:text-sm ${
                    showValidationHints && titleMissing ? 'border-red-500/70' : 'border-[var(--border-color)]'
                  }`}
                  placeholder="Short headline"
                />
                {showValidationHints && titleMissing ? (
                  <p id="admin-alerts-title-err" className="text-xs text-red-400" role="alert">
                    Title is required.
                  </p>
                ) : null}
              </div>

              <div className="space-y-1">
                <label htmlFor="admin-alerts-message" className="block text-xs font-semibold text-[var(--text-secondary)]">
                  Message
                </label>
                <textarea
                  id="admin-alerts-message"
                  ref={messageRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  aria-invalid={showValidationHints && messageMissing ? true : undefined}
                  aria-describedby={showValidationHints && messageMissing ? 'admin-alerts-message-err' : undefined}
                  className={`box-border min-h-[5.5rem] w-full touch-manipulation resize-y rounded-lg border bg-[var(--bg-primary)] px-3 py-2 text-base text-[var(--text-primary)] sm:text-sm ${
                    showValidationHints && messageMissing ? 'border-red-500/70' : 'border-[var(--border-color)]'
                  }`}
                  placeholder="What changed?"
                />
                {showValidationHints && messageMissing ? (
                  <p id="admin-alerts-message-err" className="text-xs text-red-400" role="alert">
                    Message is required.
                  </p>
                ) : null}
              </div>

              <button
                type="button"
                disabled={busy || sortedCourses.length === 0}
                aria-busy={busy}
                onClick={() => void handleSend()}
                className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:pointer-events-none disabled:opacity-50"
              >
                {busy ? 'Publishing…' : 'Publish alert'}
              </button>
            </>
          )}
        </div>
        )}

        {tab === 'ai' && (
          <div className="min-w-0 space-y-6 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 sm:p-6">
            <AdminAiSiteControlsSection
              alertsMuted={alertsMuted}
              onAlertsMutedChange={onAlertsMutedChange}
            >
              <AdminGeminiModelsSection onDirtyChange={setAiModelsDirty} />
            </AdminAiSiteControlsSection>
          </div>
        )}

        {tab === 'catalog' && (
          <AdminCourseCatalogSection
            includeCreatorDraftCourses
            onCatalogChanged={onCatalogChanged}
            onDraftDirtyChange={setCatalogDirty}
            onPathsDirtyChange={setPathDirty}
          />
        )}

        {tab === 'marketing' && (
          <AdminHeroPhoneAdsSection phoneMockupSrc={heroPhoneMockupSrc} onDirtyChange={setPhoneAdsDirty} />
        )}

        {tab === 'moderation' && (
          <AdminModerationSection
            initialSubTab={moderationInitialSubTab ?? undefined}
            onInitialSubTabConsumed={onModerationInitialSubTabConsumed}
          />
        )}
        {tab === 'roles' && <AdminUserRolesSection currentAdminUid={currentAdminUid} />}
        {tab === 'creators' && (
          <AdminCreatorInventorySection
            onPreviewCreatorCourse={onAdminPreviewCreatorCourse}
            onPreviewCreatorPath={onAdminPreviewCreatorPath}
          />
        )}

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
