import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useDialogKeyboard } from '../hooks/useDialogKeyboard';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useLearnerGeminiEnabled } from '../hooks/useLearnerGeminiEnabled';
import { useLearnerAssistantVisible } from '../hooks/useLearnerAssistantVisible';
import { useLearningAssistantSiteEnabled } from '../hooks/useLearningAssistantSiteEnabled';
import { reload, updateProfile } from 'firebase/auth';
import { User, auth } from '../firebase';
import { computeCourseEnrollmentCounts, computeLearningStats } from '../utils/learningStats';
import { loadCompletionTimestamps } from '../utils/courseCompletionLog';
import { buildCertificateId } from '../utils/certificateFirestore';
import type { Course } from '../data/courses';
import { motion, AnimatePresence } from 'motion/react';
import { X, CheckCircle2, BellOff, Trash2, Info, Save, Loader2, Sparkles, MessageCircle } from 'lucide-react';

const bioStorageKey = (uid: string) => `skilllearn-profile-bio:${uid}`;

interface ProfilePageProps {
  courses: Course[];
  user: User | null;
  isAuthReady: boolean;
  onLogin: () => void;
  onShowCertificate: (courseId: string, userName: string, date: string, certId: string) => void;
  /** Increment (e.g. from navbar certificate notification) to open Completed Courses modal. */
  openCompletedCoursesSignal?: number;
  /** Leave profile (e.g. return to catalog), like closing other full-screen flows. */
  onDismiss: () => void;
  /** Increment when Firestore progress/ratings are merged into localStorage (e.g. after login). */
  remoteProfileDataVersion?: number;
  /** Hide course/admin bell items; certificates still appear in the bell. */
  alertsMuted?: boolean;
  onAlertsMutedChange?: (muted: boolean) => void;
  /** Permanently delete Firebase Auth user (Google users get an in-app re-auth prompt when needed). */
  onDeleteAccount?: () => Promise<{ ok: true } | { ok: false; error?: string }>;
  /** When set, delete is disabled and this explanation is shown (e.g. Firestore role is still admin). */
  accountDeletionBlockedMessage?: string | null;
  /** True while resolving admin count for delete-account messaging. */
  accountDeletionBlockLoading?: boolean;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({
  courses,
  user,
  isAuthReady,
  onLogin,
  onShowCertificate,
  openCompletedCoursesSignal = 0,
  onDismiss,
  remoteProfileDataVersion = 0,
  alertsMuted = false,
  onAlertsMutedChange,
  onDeleteAccount,
  accountDeletionBlockedMessage = null,
  accountDeletionBlockLoading = false,
}) => {
  const [displayNameEdit, setDisplayNameEdit] = useState('');
  const [bio, setBio] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showCompletedModal, setShowCompletedModal] = useState(false);
  const [showCoursesOverviewModal, setShowCoursesOverviewModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { enabled: aiModelsEnabled, setEnabled: setAiModelsEnabled } = useLearnerGeminiEnabled();
  const { visible: assistantVisible, setVisible: setAssistantVisible } = useLearnerAssistantVisible();
  const { siteAssistantEnabled, siteAssistantLoading } = useLearningAssistantSiteEnabled();
  const assistantToggleDisabled = siteAssistantLoading;

  const stats = useMemo(
    () => computeLearningStats(user?.uid, courses),
    [user?.uid, remoteProfileDataVersion, courses]
  );

  const courseCounts = useMemo(
    () => computeCourseEnrollmentCounts(user?.uid, courses),
    [user?.uid, remoteProfileDataVersion, courses]
  );

  const completedCoursesList = useMemo((): Course[] => {
    return stats.completedCourseIds
      .map((id) => courses.find((c) => c.id === id))
      .filter((c): c is Course => c != null);
  }, [stats.completedCourseIds, courses]);

  useEffect(() => {
    if (openCompletedCoursesSignal > 0) {
      setShowCompletedModal(true);
    }
  }, [openCompletedCoursesSignal]);

  const closeCompletedModal = useCallback(() => setShowCompletedModal(false), []);

  const closeCoursesOverviewModal = useCallback(() => setShowCoursesOverviewModal(false), []);

  const handleSave = useCallback(async () => {
    const u = auth.currentUser;
    if (!u) return;
    setSaveState('saving');
    setSaveError(null);
    try {
      const trimmed = displayNameEdit.trim();
      if (trimmed && trimmed !== (u.displayName || '')) {
        await updateProfile(u, { displayName: trimmed });
        await reload(u);
      }
      try {
        localStorage.setItem(bioStorageKey(u.uid), bio);
      } catch {
        /* ignore quota */
      }
      setSaveState('saved');
      window.setTimeout(() => setSaveState('idle'), 2000);
    } catch (e) {
      setSaveState('error');
      setSaveError(e instanceof Error ? e.message : 'Could not save profile.');
    }
  }, [displayNameEdit, bio]);

  useDialogKeyboard({
    open: showCompletedModal,
    onClose: closeCompletedModal,
    onPrimaryAction: closeCompletedModal,
  });

  useDialogKeyboard({
    open: showCoursesOverviewModal,
    onClose: closeCoursesOverviewModal,
    onPrimaryAction: closeCoursesOverviewModal,
  });

  const closeDeleteConfirm = useCallback(() => {
    if (deleteBusy) return;
    setShowDeleteConfirm(false);
    setDeleteError(null);
  }, [deleteBusy]);

  useDialogKeyboard({
    open: showDeleteConfirm,
    onClose: closeDeleteConfirm,
  });

  useDialogKeyboard({
    open: !showCompletedModal && !showCoursesOverviewModal && !showDeleteConfirm,
    onClose: onDismiss,
    onPrimaryAction: user ? () => void handleSave() : onLogin,
  });

  useBodyScrollLock(showCompletedModal || showCoursesOverviewModal || showDeleteConfirm);

  useEffect(() => {
    if (!user) {
      setDisplayNameEdit('');
      setBio('');
      return;
    }
    setDisplayNameEdit(user.displayName || '');
    try {
      const raw = localStorage.getItem(bioStorageKey(user.uid));
      setBio(typeof raw === 'string' ? raw : '');
    } catch {
      setBio('');
    }
  }, [user]);

  const heroName =
    displayNameEdit.trim() || user?.displayName || user?.email?.split('@')[0] || 'User';
  const photoUrl = user?.photoURL;

  if (!isAuthReady) {
    return (
      <div
        className="w-full min-w-0 max-w-2xl pb-4 sm:pb-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-dialog-title"
      >
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl overflow-hidden shadow-2xl">
          <div className="flex min-h-12 items-center justify-between gap-2 border-b border-[var(--border-color)] px-4 py-3 sm:min-h-0 sm:px-5 sm:py-3.5">
            <h2 id="profile-dialog-title" className="min-w-0 text-base font-semibold text-[var(--text-primary)] sm:text-lg">
              Profile
            </h2>
            <button
              type="button"
              onClick={onDismiss}
              className="-mr-1 inline-flex min-h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)]"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
          <div className="px-4 py-4 sm:px-5 sm:py-5">
            <p className="text-[var(--text-secondary)]">Loading account…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className="w-full min-w-0 max-w-2xl pb-4 sm:pb-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-dialog-title"
      >
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl overflow-hidden shadow-2xl">
          <div className="flex min-h-12 items-center justify-between gap-2 border-b border-[var(--border-color)] px-4 py-3 sm:min-h-0 sm:px-5 sm:py-3.5">
            <h2 id="profile-dialog-title" className="min-w-0 text-base font-semibold text-[var(--text-primary)] sm:text-lg">
              Your profile
            </h2>
            <button
              type="button"
              onClick={onDismiss}
              className="-mr-1 inline-flex min-h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)]"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
          <div className="px-4 py-8 text-center sm:px-5">
            <p className="mb-5 text-sm text-[var(--text-secondary)] sm:text-base">
              Sign in to see your details and learning stats.
            </p>
            <button
              type="button"
              onClick={onLogin}
              className="min-h-11 touch-manipulation rounded-lg bg-orange-500 px-6 py-2.5 font-semibold text-white transition-colors hover:bg-orange-600"
            >
              Sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="w-full min-w-0 max-w-2xl pb-4 sm:pb-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-dialog-title"
    >
      <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl overflow-hidden shadow-2xl">
        <div className="flex min-h-12 items-center justify-between gap-2 border-b border-[var(--border-color)] px-4 py-3 sm:min-h-0 sm:px-5 sm:py-3.5">
          <h2 id="profile-dialog-title" className="min-w-0 text-base font-semibold text-[var(--text-primary)] sm:text-lg">
            Profile
          </h2>
          <button
            type="button"
            onClick={onDismiss}
            className="-mr-1 inline-flex min-h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)]"
            aria-label="Close profile"
          >
            <X size={20} />
          </button>
        </div>
        <div className="px-4 py-4 sm:px-5 md:px-6 md:py-6">
        {/* Identity + stats — single compact band */}
        <div className="mb-5 flex flex-col gap-4 border-b border-[var(--border-color)] pb-5 sm:flex-row sm:items-start sm:gap-6 md:gap-8">
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-orange-500/25 bg-[var(--hover-bg)] sm:h-[4.5rem] sm:w-[4.5rem]">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xl font-bold text-orange-500 sm:text-2xl">
                {heroName.slice(0, 1).toUpperCase()}
              </div>
            )}
            </div>
            <div className="min-w-0 flex-1 text-left">
              <h1 className="truncate text-base font-semibold text-[var(--text-primary)] sm:text-lg">{heroName}</h1>
              <p className="line-clamp-2 break-words text-xs text-[var(--text-secondary)] sm:text-sm">{user.email}</p>
            </div>
          </div>
          <div className="grid w-full grid-cols-3 gap-2 sm:ml-auto sm:flex sm:w-auto sm:min-w-[13rem] sm:max-w-[16rem] sm:flex-none sm:flex-col sm:gap-0 sm:gap-y-0.5 sm:pt-0.5">
            <button
              type="button"
              onClick={() => setShowCoursesOverviewModal(true)}
              className="inline-flex min-h-11 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-2 py-1.5 text-center text-xs transition-colors hover:border-orange-500/40 sm:min-h-0 sm:w-full sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:border-0 sm:bg-transparent sm:px-0 sm:py-1.5 sm:text-left sm:text-sm sm:hover:bg-[var(--hover-bg)] sm:rounded-md"
            >
              <span className="text-[var(--text-muted)] sm:text-[var(--text-secondary)]">Courses</span>
              <span className="font-semibold tabular-nums text-[var(--text-primary)]">{courses.length}</span>
            </button>
            <div className="inline-flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-2 py-1.5 text-center text-xs sm:min-h-0 sm:w-full sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:border-0 sm:bg-transparent sm:px-0 sm:py-1.5 sm:text-sm">
              <span className="text-[var(--text-muted)] sm:text-[var(--text-secondary)]">Points</span>
              <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                {stats.skillPoints.toLocaleString()}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowCompletedModal(true)}
              className="inline-flex min-h-11 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-2 py-1.5 text-center text-xs transition-colors hover:border-orange-500/40 sm:min-h-0 sm:w-full sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:border-0 sm:bg-transparent sm:px-0 sm:py-1.5 sm:text-sm sm:hover:bg-[var(--hover-bg)] sm:rounded-md"
            >
              <span className="text-[var(--text-muted)] sm:text-[var(--text-secondary)]">Certificates</span>
              <span className="font-semibold tabular-nums text-[var(--text-primary)]">{stats.certificates}</span>
            </button>
          </div>
        </div>

        <section aria-labelledby="profile-details-heading">
          <h2 id="profile-details-heading" className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-3">
            Profile details
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-4">
            <div className="sm:col-span-1">
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">Full name</label>
              <input
                type="text"
                value={displayNameEdit}
                onChange={(e) => setDisplayNameEdit(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-3 py-2 text-base text-[var(--text-primary)] focus:border-orange-500/50 focus:outline-none sm:min-h-0 sm:text-sm"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">Email</label>
              <input
                type="email"
                value={user.email || ''}
                readOnly
                className="min-h-11 w-full cursor-not-allowed rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-3 py-2 text-base text-[var(--text-muted)] sm:min-h-0 sm:text-sm"
              />
            </div>
          </div>
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">Email is managed by your sign-in provider.</p>
          <div className="mt-3">
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">Bio</label>
            <textarea
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Short note (this device only)…"
              className="w-full resize-none rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-3 py-2 text-base text-[var(--text-primary)] focus:border-orange-500/50 focus:outline-none sm:text-sm"
            />
          </div>
          <div className="mt-4 border-t border-[var(--border-color)] pt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
              {saveError && (
                <p className="text-sm text-red-500 sm:min-w-0 sm:flex-1 sm:pt-2.5">{saveError}</p>
              )}
              <div className="flex w-full sm:ml-auto sm:w-auto sm:shrink-0 sm:justify-end">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saveState === 'saving' || saveState === 'saved'}
                  className={`inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500/45 disabled:cursor-not-allowed sm:w-auto sm:min-w-[9.5rem] ${
                    saveState === 'saved'
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
                      : 'border-orange-500/40 bg-[var(--hover-bg)] text-orange-500 hover:border-orange-500/65 hover:bg-orange-500/10 disabled:opacity-60'
                  }`}
                >
                  {saveState === 'saving' ? (
                    <>
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                      Saving…
                    </>
                  ) : saveState === 'saved' ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                      Saved
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 shrink-0" aria-hidden />
                      Save changes
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-5 border-t border-[var(--border-color)] pt-5" aria-labelledby="profile-models-heading">
          <h2
            id="profile-models-heading"
            className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
          >
            Models
          </h2>
          <div className="mt-3 space-y-5">
            <div className="flex min-h-11 items-center justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                <MessageCircle size={16} className="mt-0.5 shrink-0 text-orange-500" aria-hidden />
                <div className="min-w-0">
                  <p id="profile-assistant-switch-label" className="text-sm font-semibold text-[var(--text-primary)]">
                    Show learning assistant
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                    Hides or shows the floating chat on this device when the site allows it. Your choice is saved on
                    this device.
                  </p>
                  {!siteAssistantLoading && !siteAssistantEnabled && (
                    <p className="mt-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                      Hidden for everyone right now (admin setting). When it is on again, your toggle above applies.
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={assistantVisible}
                aria-labelledby="profile-assistant-switch-label"
                disabled={assistantToggleDisabled}
                onClick={() => !assistantToggleDisabled && setAssistantVisible(!assistantVisible)}
                className={`relative h-9 w-14 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500/60 disabled:cursor-not-allowed disabled:opacity-40 ${
                  assistantVisible ? 'bg-orange-500' : 'bg-[var(--border-color)]'
                }`}
              >
                <span
                  className={`pointer-events-none absolute top-1 left-1 h-7 w-7 rounded-full bg-white shadow transition-transform ${
                    assistantVisible ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
                <span className="sr-only">
                  {assistantVisible ? 'Learning assistant shown' : 'Learning assistant hidden'}
                </span>
              </button>
            </div>

            <div className="flex min-h-11 items-center justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                <Sparkles size={16} className="mt-0.5 shrink-0 text-orange-500" aria-hidden />
                <div className="min-w-0">
                  <p id="profile-models-switch-label" className="text-sm font-semibold text-[var(--text-primary)]">
                    Use AI models
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                    When off, quiz AI grading and hints stay disabled on this device—even if a key is configured. The
                    learning assistant still follows the toggle above and site settings.
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={aiModelsEnabled}
                aria-labelledby="profile-models-switch-label"
                onClick={() => setAiModelsEnabled(!aiModelsEnabled)}
                className={`relative h-9 w-14 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500/60 ${
                  aiModelsEnabled ? 'bg-orange-500' : 'bg-[var(--border-color)]'
                }`}
              >
                <span
                  className={`pointer-events-none absolute top-1 left-1 h-7 w-7 rounded-full bg-white shadow transition-transform ${
                    aiModelsEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
                <span className="sr-only">{aiModelsEnabled ? 'AI models on' : 'AI models off'}</span>
              </button>
            </div>
          </div>
        </section>

        <p className="mt-4 border-t border-[var(--border-color)] pt-4 text-sm leading-relaxed text-[var(--text-secondary)]">
          Completions and progress sync to your account; more activity insights may appear here later.
        </p>

        {user && (onAlertsMutedChange || onDeleteAccount) && (
          <div className="mt-5 space-y-5 border-t border-[var(--border-color)] pt-5">
            {onAlertsMutedChange && (
              <div>
                <div className="flex min-h-11 items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <BellOff size={16} className="shrink-0 text-orange-500" aria-hidden />
                    <span
                      id="profile-notifications-label"
                      className="text-sm font-semibold text-[var(--text-primary)]"
                    >
                      Notifications
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={alertsMuted}
                    aria-labelledby="profile-notifications-label"
                    onClick={() => onAlertsMutedChange(!alertsMuted)}
                    className={`relative h-9 w-14 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500/60 ${
                      alertsMuted ? 'bg-orange-500' : 'bg-[var(--border-color)]'
                    }`}
                  >
                    <span
                      className={`pointer-events-none absolute top-1 left-1 h-7 w-7 rounded-full bg-white shadow transition-transform ${
                        alertsMuted ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                    <span className="sr-only">{alertsMuted ? 'Alerts muted' : 'Alerts on'}</span>
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                  When muted, course and admin items are hidden from the bell; certificate notices still appear.
                </p>
              </div>
            )}

            {onDeleteAccount && (
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2.5">Danger zone</h3>
                {accountDeletionBlockLoading ? (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex gap-3">
                    <Info size={18} className="text-amber-500 shrink-0 mt-0.5" aria-hidden />
                    <p className="text-sm text-[var(--text-secondary)] leading-snug">
                      Checking admin accounts…
                    </p>
                  </div>
                ) : accountDeletionBlockedMessage ? (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex gap-3">
                    <Info size={18} className="text-amber-500 shrink-0 mt-0.5" aria-hidden />
                    <p className="text-sm text-[var(--text-secondary)] leading-snug">
                      {accountDeletionBlockedMessage}
                    </p>
                  </div>
                ) : null}
                <div
                  className={`flex flex-col gap-3 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4 ${
                    accountDeletionBlockedMessage || accountDeletionBlockLoading ? 'mt-3' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)]">Delete account</p>
                    <p className="mt-1 text-xs leading-snug text-[var(--text-secondary)]">
                      Removes your SkillStream sign-in permanently.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!!accountDeletionBlockedMessage || accountDeletionBlockLoading}
                    aria-disabled={!!accountDeletionBlockedMessage || accountDeletionBlockLoading}
                    onClick={() => {
                      if (accountDeletionBlockedMessage || accountDeletionBlockLoading) return;
                      setDeleteError(null);
                      setShowDeleteConfirm(true);
                    }}
                    className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-500 transition-colors hover:bg-red-500/20 disabled:pointer-events-none disabled:opacity-45 sm:min-h-0 sm:w-auto"
                  >
                    <Trash2 size={16} />
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        </div>
      </div>

      <AnimatePresence>
        {showCoursesOverviewModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden bg-black/60 p-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-courses-overview-title"
          >
            <motion.div
              key="courses-overview"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="my-auto w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
            >
              <div className="flex min-h-12 items-center justify-between gap-2 border-b border-[var(--border-color)] p-4 sm:min-h-0 sm:p-6">
                <h2 id="profile-courses-overview-title" className="min-w-0 text-lg font-bold text-[var(--text-primary)] sm:text-xl">
                  Courses
                </h2>
                <button
                  type="button"
                  onClick={closeCoursesOverviewModal}
                  className="-mr-1 inline-flex min-h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)]"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-4 sm:p-6">
                <p className="mb-4 text-sm text-[var(--text-secondary)]">
                  Your status across courses in the catalog ({courses.length} total).
                </p>
                <ul className="space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--hover-bg)]/50 p-4">
                  <li className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-[var(--text-secondary)]">Completed</span>
                    <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                      {courseCounts.completed}
                    </span>
                  </li>
                  <li className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-[var(--text-secondary)]">In progress</span>
                    <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                      {courseCounts.inProgress}
                    </span>
                  </li>
                  <li className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-[var(--text-secondary)]">Not started</span>
                    <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                      {courseCounts.notStarted}
                    </span>
                  </li>
                </ul>
              </div>
              <div className="border-t border-[var(--border-color)] bg-[var(--hover-bg)]/50 p-4 sm:p-6">
                <button
                  type="button"
                  onClick={closeCoursesOverviewModal}
                  className="min-h-11 w-full touch-manipulation rounded-xl bg-orange-500 py-3 font-bold text-white transition-colors hover:bg-orange-600"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
        {showCompletedModal && (
          <div
            className="fixed inset-0 z-50 flex min-h-0 items-center justify-center overflow-y-auto overflow-x-hidden bg-black/60 px-2 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-sm sm:px-4 sm:py-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-certificates-title"
          >
            <motion.div
              key="certificates-list"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="my-auto flex max-h-[min(92dvh,100svh)] w-full max-w-lg min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl sm:max-h-[min(90vh,44rem)]"
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-color)] px-3 py-3 sm:min-h-0 sm:px-6 sm:py-4">
                <h2
                  id="profile-certificates-title"
                  className="min-w-0 pr-1 text-base font-bold leading-tight text-[var(--text-primary)] sm:text-xl"
                >
                  Certificates
                </h2>
                <button
                  type="button"
                  onClick={closeCompletedModal}
                  className="-mr-1 inline-flex min-h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)]"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-3 sm:px-6 sm:py-5">
                <p className="mb-3 text-xs leading-relaxed text-[var(--text-secondary)] sm:mb-4 sm:text-sm">
                  Completed courses — tap View certificate to open yours.
                </p>
                {completedCoursesList.length > 0 ? (
                  <div className="space-y-3 sm:space-y-4">
                    {completedCoursesList.map((course) => (
                      <div
                        key={course.id}
                        className="rounded-xl border border-[var(--border-color)] bg-[var(--hover-bg)] p-3 sm:flex sm:items-center sm:gap-4 sm:p-4"
                      >
                        <div className="flex gap-3 sm:contents">
                          <div className="h-12 w-20 shrink-0 overflow-hidden rounded-lg sm:h-10 sm:w-16">
                            <img
                              src={course.thumbnail}
                              alt=""
                              className="h-full w-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                          <div className="min-w-0 flex-1 sm:flex sm:min-w-0 sm:flex-1 sm:items-start sm:gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start gap-2">
                                <h3 className="line-clamp-2 text-[15px] font-bold leading-snug text-[var(--text-primary)] sm:line-clamp-1 sm:text-base">
                                  {course.title}
                                </h3>
                                <CheckCircle2
                                  size={18}
                                  className="mt-0.5 shrink-0 text-orange-500 sm:mt-1 sm:hidden"
                                  aria-hidden
                                />
                              </div>
                              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{course.author}</p>
                            </div>
                            <CheckCircle2
                              size={20}
                              className="mt-1 hidden shrink-0 text-orange-500 sm:block"
                              aria-hidden
                            />
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (!user?.uid) return;
                            const userName = user.displayName || user.email?.split('@')[0] || 'Learner';
                            const completedAt = loadCompletionTimestamps(user.uid)[course.id];
                            const date = completedAt
                              ? new Date(completedAt).toLocaleDateString('en-US', {
                                  month: 'long',
                                  day: 'numeric',
                                  year: 'numeric',
                                })
                              : new Date().toLocaleDateString('en-US', {
                                  month: 'long',
                                  day: 'numeric',
                                  year: 'numeric',
                                });
                            const certId = buildCertificateId(course.id, user.uid);
                            onShowCertificate(course.id, userName, date, certId);
                            closeCompletedModal();
                          }}
                          className="mt-3 w-full min-h-11 touch-manipulation rounded-lg bg-orange-500/10 px-4 py-2.5 text-sm font-bold text-orange-500 transition-colors hover:bg-orange-500/20 sm:mt-0 sm:min-h-0 sm:w-auto sm:shrink-0 sm:self-center sm:px-4 sm:py-2 sm:text-xs"
                        >
                          View certificate
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-10 text-center sm:py-8">
                    <p className="text-sm text-[var(--text-secondary)]">
                      No courses completed yet. Keep learning!
                    </p>
                  </div>
                )}
              </div>
              <div className="shrink-0 border-t border-[var(--border-color)] bg-[var(--hover-bg)]/50 px-3 py-3 sm:px-6 sm:py-5">
                <button
                  type="button"
                  onClick={closeCompletedModal}
                  className="min-h-11 w-full touch-manipulation rounded-xl bg-orange-500 py-3 text-base font-bold text-white transition-colors hover:bg-orange-600 sm:text-sm"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {showDeleteConfirm && onDeleteAccount && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto overflow-x-hidden bg-black/60 p-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-delete-title"
        >
          <div className="my-auto w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl">
            <div className="border-b border-[var(--border-color)] p-4 sm:p-5">
              <h3 id="profile-delete-title" className="text-lg font-bold text-[var(--text-primary)]">
                Delete your account?
              </h3>
            </div>
            <div className="space-y-4 p-4 sm:p-5">
              <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                Your Google-linked account will be removed from SkillStream. Admins must set their role to
                user in Admin → Roles before deletion; if you are the only admin, promote someone else to
                admin first.
              </p>
              {deleteError && <p className="text-sm text-red-500">{deleteError}</p>}
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  disabled={deleteBusy}
                  onClick={closeDeleteConfirm}
                  className="min-h-11 w-full touch-manipulation rounded-lg border border-[var(--border-color)] py-2.5 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--hover-bg)] disabled:opacity-60 sm:min-h-0 sm:flex-1"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleteBusy}
                  onClick={() => {
                    void (async () => {
                      setDeleteBusy(true);
                      setDeleteError(null);
                      const result = await onDeleteAccount();
                      setDeleteBusy(false);
                      if (!result.ok) {
                        if (result.error) setDeleteError(result.error);
                        return;
                      }
                      setShowDeleteConfirm(false);
                    })();
                  }}
                  className="min-h-11 w-full touch-manipulation rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-60 sm:min-h-0 sm:flex-[1.2]"
                >
                  {deleteBusy ? 'Deleting…' : 'Yes, delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
