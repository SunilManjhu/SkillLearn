import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useDialogKeyboard } from '../hooks/useDialogKeyboard';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useLearnerGeminiEnabled } from '../hooks/useLearnerGeminiEnabled';
import { useLearnerAssistantVisible } from '../hooks/useLearnerAssistantVisible';
import { useLearningAssistantSiteEnabled } from '../hooks/useLearningAssistantSiteEnabled';
import { useLearnerAiModelsSiteEnabled } from '../hooks/useLearnerAiModelsSiteEnabled';
import { useNotificationsSiteEnabled } from '../hooks/useNotificationsSiteEnabled';
import { User, auth } from '../firebase';
import { computeCourseEnrollmentCounts, computeLearningStats } from '../utils/learningStats';
import { loadCompletionTimestamps } from '../utils/courseCompletionLog';
import { buildCertificateId } from '../utils/certificateFirestore';
import type { Course } from '../data/courses';
import { motion, AnimatePresence } from 'motion/react';
import { X, CheckCircle2, Trash2, Info } from 'lucide-react';
import { AdminLabelInfoTip } from './admin/adminLabelInfoTip';
import { useAdminActionToast } from './admin/useAdminActionToast';
import { useCourseStockThumbnail } from '../hooks/useCourseStockThumbnail';

const bioStorageKey = (uid: string) => `skilllearn-profile-bio:${uid}`;

function ProfileCompletedCourseThumbnail({ course }: { course: Course }) {
  const { imageUrl, imageCreditTitle } = useCourseStockThumbnail(course);
  return (
    <img
      src={imageUrl}
      alt=""
      title={imageCreditTitle}
      className="h-full w-full object-cover"
      referrerPolicy="no-referrer"
    />
  );
}

/** Match Courses / Points / Certificates cells; used for stats row only. */
const profilePrefStatCellClass =
  'inline-flex min-h-11 w-full min-w-0 touch-manipulation flex-col items-center justify-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-1.5 py-1.5 text-center sm:min-h-0 sm:w-full sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:border-0 sm:bg-transparent sm:px-0 sm:py-1.5 sm:text-left sm:hover:bg-[var(--hover-bg)] sm:rounded-md';

/** Compact track aligned with label scale; outer min 44px for touch. */
const profilePrefSwitchOuterClass =
  'inline-flex min-h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a1a2a2]/60 disabled:cursor-not-allowed disabled:opacity-50';
/** Track ~1rem tall on mobile, ~text-xs cap height on sm; knob travel matches width. */
const profilePrefSwitchTrackOn = 'bg-[#a1a2a2]';
const profilePrefSwitchTrackOff = 'bg-[var(--border-color)]';
const profilePrefSwitchTrackClass = `relative h-4 w-8 shrink-0 rounded-full transition-colors sm:h-[1.125rem] sm:w-9`;
const profilePrefSwitchKnobClass = (on: boolean) =>
  `pointer-events-none absolute top-1/2 left-0.5 size-3.5 -translate-y-1/2 rounded-full bg-white shadow transition-transform sm:size-4 ${
    on ? 'translate-x-3.5 sm:translate-x-4' : 'translate-x-0'
  }`;

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
  const [bio, setBio] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showCompletedModal, setShowCompletedModal] = useState(false);
  const [showCoursesOverviewModal, setShowCoursesOverviewModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { showActionToast, actionToast } = useAdminActionToast();

  const { enabled: aiModelsEnabled, setEnabled: setAiModelsEnabled } = useLearnerGeminiEnabled();
  const { visible: assistantVisible, setVisible: setAssistantVisible } = useLearnerAssistantVisible();
  const { siteAssistantEnabled, siteAssistantLoading } = useLearningAssistantSiteEnabled();
  const { siteLearnerAiModelsEnabled, siteLearnerAiModelsLoading } = useLearnerAiModelsSiteEnabled();
  const { siteNotificationsEnabled, siteNotificationsLoading } = useNotificationsSiteEnabled();
  /** When site-wide is off, show the switch off; when on, reflect stored mute preference (preserved across site toggles). */
  const notificationsEffectiveOn = siteNotificationsEnabled && !alertsMuted;
  const assistantSwitchDisabled = siteAssistantLoading || !siteAssistantEnabled;
  const assistantEffectiveOn = siteAssistantEnabled && assistantVisible;
  const aiModelsSwitchDisabled = siteLearnerAiModelsLoading || !siteLearnerAiModelsEnabled;
  const aiModelsEffectiveOn = siteLearnerAiModelsEnabled && aiModelsEnabled;

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
    setSaveError(null);
    try {
      localStorage.setItem(bioStorageKey(u.uid), bio);
    } catch {
      setSaveError('Could not save bio on this device.');
    }
  }, [bio]);

  const dismissWithSaveIfNeeded = useCallback(() => {
    if (!user) {
      onDismiss();
      return;
    }
    void handleSave().finally(() => onDismiss());
  }, [user, handleSave, onDismiss]);

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
    onClose: dismissWithSaveIfNeeded,
    onPrimaryAction: user ? () => void handleSave() : onLogin,
  });

  useBodyScrollLock(showCompletedModal || showCoursesOverviewModal || showDeleteConfirm);

  useEffect(() => {
    if (!user) {
      setBio('');
      return;
    }
    try {
      const raw = localStorage.getItem(bioStorageKey(user.uid));
      setBio(typeof raw === 'string' ? raw : '');
    } catch {
      setBio('');
    }
  }, [user]);

  const heroName = user?.displayName?.trim() || user?.email?.split('@')[0] || 'User';
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
              Your Profile
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
            onClick={dismissWithSaveIfNeeded}
            className="-mr-1 inline-flex min-h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)]"
            aria-label="Close Profile"
          >
            <X size={20} />
          </button>
        </div>
        <div className="px-4 py-3 sm:px-5 md:px-6 md:py-5">
        {/* Identity + stats */}
        <div className="mb-4 flex flex-col gap-3 border-b border-[var(--border-color)] pb-4 sm:flex-row sm:items-start sm:gap-5 md:gap-6">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full border-2 border-orange-500/25 bg-[var(--hover-bg)] sm:h-16 sm:w-16">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg font-bold text-orange-500 sm:text-xl">
                {heroName.slice(0, 1).toUpperCase()}
              </div>
            )}
            </div>
            <div className="min-w-0 flex-1 text-left">
              <h1 className="truncate text-sm font-semibold text-[var(--text-primary)] sm:text-base">{heroName}</h1>
              <p className="line-clamp-2 break-words text-[0.7rem] leading-snug text-[var(--text-secondary)] sm:text-xs">{user.email}</p>
            </div>
          </div>
          <div className="grid w-full grid-cols-3 gap-1.5 sm:ml-auto sm:flex sm:w-auto sm:min-w-[12rem] sm:max-w-[15rem] sm:flex-none sm:flex-col sm:gap-0 sm:gap-y-0 sm:pt-0">
            <button
              type="button"
              onClick={() => setShowCoursesOverviewModal(true)}
              className="inline-flex min-h-11 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-1.5 py-1 text-center text-[0.65rem] transition-colors hover:border-orange-500/40 sm:min-h-0 sm:w-full sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:border-0 sm:bg-transparent sm:px-0 sm:py-1 sm:text-left sm:text-xs sm:hover:bg-[var(--hover-bg)] sm:rounded-md"
            >
              <span className="text-[var(--text-muted)] sm:text-[var(--text-secondary)]">Courses</span>
              <span className="font-semibold tabular-nums text-[var(--text-primary)]">{courses.length}</span>
            </button>
            <div className="inline-flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-1.5 py-1 text-center text-[0.65rem] sm:min-h-0 sm:w-full sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:border-0 sm:bg-transparent sm:px-0 sm:py-1 sm:text-xs">
              <span className="text-[var(--text-muted)] sm:text-[var(--text-secondary)]">Points</span>
              <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                {stats.skillPoints.toLocaleString()}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowCompletedModal(true)}
              className="inline-flex min-h-11 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-1.5 py-1 text-center text-[0.65rem] transition-colors hover:border-orange-500/40 sm:min-h-0 sm:w-full sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:border-0 sm:bg-transparent sm:px-0 sm:py-1 sm:text-left sm:text-xs sm:hover:bg-[var(--hover-bg)] sm:rounded-md"
            >
              <span className="text-[var(--text-muted)] sm:text-[var(--text-secondary)]">Certificates</span>
              <span className="font-semibold tabular-nums text-[var(--text-primary)]">{stats.certificates}</span>
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-[var(--border-color)] pb-4 sm:flex-row sm:items-stretch sm:gap-4 sm:pb-5 md:gap-5">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="mb-1 flex min-h-6 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              <label
                htmlFor="profile-bio"
                className="text-xs font-semibold leading-none text-[var(--text-secondary)]"
              >
                Bio
              </label>
              <AdminLabelInfoTip
                controlOnly
                tipId="profile-tip-bio-and-sync"
                tipRegionAriaLabel="Bio and Account Data Tips"
                tipSubject="Bio and Sync"
              >
                <li>Optional note stored on this device only.</li>
                <li>Completions and progress sync to your account.</li>
                <li>More activity insights may appear here later.</li>
              </AdminLabelInfoTip>
            </div>
            <textarea
              id="profile-bio"
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              onBlur={() => void handleSave()}
              placeholder="Short note (this device only)…"
              className="min-h-[5.5rem] w-full flex-1 resize-none rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:border-orange-500/50 focus:outline-none sm:min-h-0 sm:px-3 sm:py-2"
            />
            {saveError && <p className="mt-1 text-xs text-red-500">{saveError}</p>}
          </div>

          <section
            className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-[var(--border-color)] pt-3 sm:border-t-0 sm:border-l sm:pl-4 sm:pt-0 md:pl-5"
            aria-labelledby="profile-smart-hub-heading"
          >
            <h2
              id="profile-smart-hub-heading"
              className="mb-2 text-xs font-semibold tracking-wide text-[var(--text-muted)] sm:mb-2"
            >
              Smart Hub
            </h2>
            <div className="flex w-full min-w-0 flex-1 flex-col gap-2 sm:gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex min-h-6 min-w-0 items-center justify-between gap-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1">
                  <span className="flex min-w-0 items-center gap-0.5">
                    <span className="shrink-0 text-[0.85rem] leading-none sm:text-base" aria-hidden>
                      💬
                    </span>
                    <span
                      id="profile-assistant-switch-label"
                      className="text-[0.6rem] leading-tight text-[var(--text-muted)] sm:text-xs sm:text-[var(--text-secondary)]"
                    >
                      Learning Assistant
                    </span>
                  </span>
                  <AdminLabelInfoTip
                    controlOnly
                    tipId="profile-tip-learning-assistant"
                    tipRegionAriaLabel="Learning Assistant Tips"
                    tipSubject="Learning Assistant"
                  >
                    <li>Shows or hides the floating chat on this device when the site allows it.</li>
                    <li>Your choice is saved on this device.</li>
                    <li>If Guidance Chat is turned off for the site, this switch stays off until it is available again.</li>
                  </AdminLabelInfoTip>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={assistantEffectiveOn}
                  aria-labelledby="profile-assistant-switch-label"
                  aria-describedby={
                    !siteAssistantLoading && !siteAssistantEnabled
                      ? 'profile-assistant-soft-block-hint'
                      : undefined
                  }
                  title={
                    !siteAssistantLoading && !siteAssistantEnabled
                      ? 'Guidance Chat is offline. Check back later or contact support.'
                      : undefined
                  }
                  disabled={assistantSwitchDisabled}
                  onClick={() => {
                    if (assistantSwitchDisabled || !siteAssistantEnabled) return;
                    const nextVisible = !assistantVisible;
                    setAssistantVisible(nextVisible);
                    const nextEffective = siteAssistantEnabled && nextVisible;
                    showActionToast(
                      nextEffective ? 'Learning Assistant available.' : 'Learning Assistant hidden.'
                    );
                  }}
                  className={profilePrefSwitchOuterClass}
                >
                  <span
                    className={`${profilePrefSwitchTrackClass} ${
                      assistantEffectiveOn ? profilePrefSwitchTrackOn : profilePrefSwitchTrackOff
                    }`}
                  >
                    <span className={profilePrefSwitchKnobClass(assistantEffectiveOn)} />
                  </span>
                  <span className="sr-only">
                    {assistantEffectiveOn ? 'Learning Assistant shown' : 'Learning Assistant hidden'}
                  </span>
                </button>
              </div>
              {!siteAssistantLoading && !siteAssistantEnabled ? (
                <span id="profile-assistant-soft-block-hint" className="sr-only">
                  Guidance Chat is offline. Check back later or contact support.
                </span>
              ) : null}
            </div>

            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex min-h-6 min-w-0 items-center justify-between gap-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1">
                  <span className="flex min-w-0 items-center gap-0.5">
                    <span className="shrink-0 text-[0.85rem] leading-none sm:text-base" aria-hidden>
                      ✨
                    </span>
                    <span
                      id="profile-models-switch-label"
                      className="text-[0.6rem] leading-tight text-[var(--text-muted)] sm:text-xs sm:text-[var(--text-secondary)]"
                    >
                      Smart Verify
                    </span>
                  </span>
                  <AdminLabelInfoTip
                    controlOnly
                    tipId="profile-tip-use-ai-models"
                    tipRegionAriaLabel="Smart Verify Tips"
                    tipSubject="Smart Verify"
                  >
                    <li>When off, quiz AI grading and hints stay off on this device when the site allows it.</li>
                    <li>The Learning Assistant toggle above controls whether the floating chat appears.</li>
                    <li>If Smart Verify is inactive for the site, this switch stays off until it is available again.</li>
                  </AdminLabelInfoTip>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={aiModelsEffectiveOn}
                  aria-labelledby="profile-models-switch-label"
                  aria-describedby={
                    !siteLearnerAiModelsLoading && !siteLearnerAiModelsEnabled
                      ? 'profile-smartverify-soft-block-hint'
                      : undefined
                  }
                  title={
                    !siteLearnerAiModelsLoading && !siteLearnerAiModelsEnabled
                      ? 'Smart Verify is inactive. Reach out to your administrator to unlock this feature.'
                      : undefined
                  }
                  disabled={aiModelsSwitchDisabled}
                  onClick={() => {
                    if (aiModelsSwitchDisabled || !siteLearnerAiModelsEnabled) return;
                    const next = !aiModelsEnabled;
                    setAiModelsEnabled(next);
                    const nextEffective = siteLearnerAiModelsEnabled && next;
                    showActionToast(nextEffective ? 'Smart Verify available.' : 'Smart Verify off.');
                  }}
                  className={profilePrefSwitchOuterClass}
                >
                  <span
                    className={`${profilePrefSwitchTrackClass} ${
                      aiModelsEffectiveOn ? profilePrefSwitchTrackOn : profilePrefSwitchTrackOff
                    }`}
                  >
                    <span className={profilePrefSwitchKnobClass(aiModelsEffectiveOn)} />
                  </span>
                  <span className="sr-only">{aiModelsEffectiveOn ? 'Smart Verify on' : 'Smart Verify off'}</span>
                </button>
              </div>
              {!siteLearnerAiModelsLoading && !siteLearnerAiModelsEnabled ? (
                <span id="profile-smartverify-soft-block-hint" className="sr-only">
                  Smart Verify is inactive. Reach out to your administrator to unlock this feature.
                </span>
              ) : null}
            </div>

            {onAlertsMutedChange && (
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex min-h-6 min-w-0 items-center justify-between gap-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-1">
                    <span className="flex min-w-0 items-center gap-0.5">
                      <span className="shrink-0 text-[0.85rem] leading-none sm:text-base" aria-hidden>
                        🔔
                      </span>
                      <span
                        id="profile-notifications-label"
                        className="text-[0.6rem] leading-tight text-[var(--text-muted)] sm:text-xs sm:text-[var(--text-secondary)]"
                      >
                        Notifications
                      </span>
                    </span>
                    <AdminLabelInfoTip
                      controlOnly
                      tipId="profile-tip-notifications"
                      tipRegionAriaLabel="Notifications Tips"
                      tipSubject="Notifications"
                    >
                      <li>When off, course and admin items are hidden from the bell.</li>
                      <li>Certificate notices still appear.</li>
                      <li>If notifications are turned off site-wide, your choice here is kept for when they are available again.</li>
                    </AdminLabelInfoTip>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={notificationsEffectiveOn}
                    aria-labelledby="profile-notifications-label"
                    aria-describedby={
                      !siteNotificationsLoading && !siteNotificationsEnabled
                        ? 'profile-notifications-soft-block-hint'
                        : undefined
                    }
                    title={
                      !siteNotificationsLoading && !siteNotificationsEnabled
                        ? 'Notifications are disabled site-wide. Check back later or contact support.'
                        : undefined
                    }
                    disabled={siteNotificationsLoading || !siteNotificationsEnabled}
                    onClick={() => {
                      if (siteNotificationsLoading || !siteNotificationsEnabled) return;
                      const nextMuted = !alertsMuted;
                      onAlertsMutedChange(nextMuted);
                      showActionToast(nextMuted ? 'Notifications off.' : 'Notifications on.');
                    }}
                    className={profilePrefSwitchOuterClass}
                  >
                    <span
                      className={`${profilePrefSwitchTrackClass} ${
                        notificationsEffectiveOn ? profilePrefSwitchTrackOn : profilePrefSwitchTrackOff
                      }`}
                    >
                      <span className={profilePrefSwitchKnobClass(notificationsEffectiveOn)} />
                    </span>
                    <span className="sr-only">
                      {notificationsEffectiveOn ? 'Notifications on' : 'Notifications off'}
                    </span>
                  </button>
                </div>
                {!siteNotificationsLoading && !siteNotificationsEnabled ? (
                  <span id="profile-notifications-soft-block-hint" className="sr-only">
                    Notifications are disabled site-wide. Check back later or contact support.
                  </span>
                ) : null}
              </div>
            )}
          </div>
          </section>
        </div>

        {user && onDeleteAccount && (
          <div className="mt-4 space-y-3 pt-4 sm:mt-5 sm:space-y-4 sm:pt-5">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Danger Zone</h3>
            {accountDeletionBlockLoading ? (
              <div className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                <Info size={18} className="mt-0.5 shrink-0 text-amber-500" aria-hidden />
                <p className="text-sm leading-snug text-[var(--text-secondary)]">Checking admin accounts…</p>
              </div>
            ) : accountDeletionBlockedMessage ? (
              <div className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                <Info size={18} className="mt-0.5 shrink-0 text-amber-500" aria-hidden />
                <p className="text-sm leading-snug text-[var(--text-secondary)]">{accountDeletionBlockedMessage}</p>
              </div>
            ) : null}
            <div
              className={`flex flex-col gap-3 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4 ${
                accountDeletionBlockedMessage || accountDeletionBlockLoading ? 'mt-3' : ''
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">Delete Account</p>
                <p className="mt-1 text-xs leading-snug text-[var(--text-secondary)]">
                  Removes your i-Golden sign-in permanently.
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
                    <span className="text-[var(--text-secondary)]">In Progress</span>
                    <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                      {courseCounts.inProgress}
                    </span>
                  </li>
                  <li className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-[var(--text-secondary)]">Not Started</span>
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
                  Completed courses — tap View Certificate to open yours.
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
                            <ProfileCompletedCourseThumbnail course={course} />
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
                          View Certificate
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
                Delete Your Account?
              </h3>
            </div>
            <div className="space-y-4 p-4 sm:p-5">
              <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                Your Google-linked account will be removed from i-Golden. Admins must set their role to
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
                        if ('error' in result && result.error) setDeleteError(result.error);
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
      {actionToast}
    </div>
  );
};
