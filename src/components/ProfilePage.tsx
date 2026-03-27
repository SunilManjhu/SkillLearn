import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useDialogKeyboard } from '../hooks/useDialogKeyboard';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { reload, updateProfile } from 'firebase/auth';
import { User, auth } from '../firebase';
import { computeLearningStats } from '../utils/learningStats';
import { loadCompletionTimestamps } from '../utils/courseCompletionLog';
import { buildCertificateId } from '../utils/certificateFirestore';
import type { Course } from '../data/courses';
import { motion, AnimatePresence } from 'motion/react';
import { X, CheckCircle2, BellOff, Trash2, Info } from 'lucide-react';

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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const stats = useMemo(
    () => computeLearningStats(user?.uid, courses),
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
    open: !showCompletedModal && !showDeleteConfirm,
    onClose: onDismiss,
    onPrimaryAction: user ? () => void handleSave() : onLogin,
  });

  useBodyScrollLock(showCompletedModal || showDeleteConfirm);

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
        className="w-full max-w-2xl pb-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-dialog-title"
      >
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl overflow-hidden shadow-2xl">
          <div className="px-5 py-3.5 border-b border-[var(--border-color)] flex items-center justify-between">
            <h2 id="profile-dialog-title" className="text-lg font-semibold text-[var(--text-primary)]">
              Profile
            </h2>
            <button
              type="button"
              onClick={onDismiss}
              className="p-2 hover:bg-[var(--hover-bg)] rounded-lg transition-colors text-[var(--text-secondary)] shrink-0"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
          <div className="px-5 py-5">
            <p className="text-[var(--text-secondary)]">Loading account…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className="w-full max-w-2xl pb-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-dialog-title"
      >
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl overflow-hidden shadow-2xl">
          <div className="px-5 py-3.5 border-b border-[var(--border-color)] flex items-center justify-between">
            <h2 id="profile-dialog-title" className="text-lg font-semibold text-[var(--text-primary)]">
              Your profile
            </h2>
            <button
              type="button"
              onClick={onDismiss}
              className="p-2 hover:bg-[var(--hover-bg)] rounded-lg transition-colors text-[var(--text-secondary)] shrink-0"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
          <div className="px-5 py-8 text-center">
            <p className="text-[var(--text-secondary)] mb-5">Sign in to see your details and learning stats.</p>
            <button
              type="button"
              onClick={onLogin}
              className="bg-orange-500 text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-orange-600 transition-colors"
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
      className="w-full max-w-2xl pb-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-dialog-title"
    >
      <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl overflow-hidden shadow-2xl">
        <div className="px-5 py-3.5 border-b border-[var(--border-color)] flex items-center justify-between gap-2">
          <h2 id="profile-dialog-title" className="text-lg font-semibold text-[var(--text-primary)]">
            Profile
          </h2>
          <button
            type="button"
            onClick={onDismiss}
            className="p-2 hover:bg-[var(--hover-bg)] rounded-lg transition-colors text-[var(--text-secondary)] shrink-0"
            aria-label="Close profile"
          >
            <X size={20} />
          </button>
        </div>
        <div className="px-5 py-5 md:px-6 md:py-6">
        {/* Identity + stats — single compact band */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5 pb-5 mb-5 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-[4.5rem] h-[4.5rem] rounded-full overflow-hidden border-2 border-orange-500/25 bg-[var(--hover-bg)] shrink-0">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt=""
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-orange-500">
                {heroName.slice(0, 1).toUpperCase()}
              </div>
            )}
            </div>
            <div className="min-w-0 text-left">
              <h1 className="text-lg font-semibold text-[var(--text-primary)] truncate">{heroName}</h1>
              <p className="text-sm text-[var(--text-secondary)] break-all line-clamp-2">{user.email}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5 sm:justify-end sm:ml-auto">
            <button
              type="button"
              onClick={() => setShowCompletedModal(true)}
              className="inline-flex items-baseline gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-3 py-1.5 text-left text-sm hover:border-orange-500/40 transition-colors"
            >
              <span className="text-[var(--text-muted)]">Courses</span>
              <span className="font-semibold tabular-nums text-[var(--text-primary)]">{stats.completedCourses}</span>
            </button>
            <div className="inline-flex items-baseline gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-3 py-1.5 text-sm">
              <span className="text-[var(--text-muted)]">Pts</span>
              <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                {stats.skillPoints.toLocaleString()}
              </span>
            </div>
            <div className="inline-flex items-baseline gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] px-3 py-1.5 text-sm">
              <span className="text-[var(--text-muted)]">Certs</span>
              <span className="font-semibold tabular-nums text-[var(--text-primary)]">{stats.certificates}</span>
            </div>
          </div>
        </div>

        <section aria-labelledby="profile-details-heading">
          <h2 id="profile-details-heading" className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-3">
            Profile details
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-4">
            <div className="sm:col-span-1">
              <label className="block text-xs text-[var(--text-secondary)] mb-1">Full name</label>
              <input
                type="text"
                value={displayNameEdit}
                onChange={(e) => setDisplayNameEdit(e.target.value)}
                className="w-full bg-[var(--hover-bg)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-orange-500/50"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="block text-xs text-[var(--text-secondary)] mb-1">Email</label>
              <input
                type="email"
                value={user.email || ''}
                readOnly
                className="w-full bg-[var(--hover-bg)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm text-[var(--text-muted)] cursor-not-allowed"
              />
            </div>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1.5">Email is managed by your sign-in provider.</p>
          <div className="mt-3">
            <label className="block text-xs text-[var(--text-secondary)] mb-1">Bio</label>
            <textarea
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Short note (this device only)…"
              className="w-full bg-[var(--hover-bg)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-orange-500/50 resize-none"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saveState === 'saving'}
              className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-orange-600 transition-colors disabled:opacity-60"
            >
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save'}
            </button>
            {saveError && <p className="text-sm text-red-500">{saveError}</p>}
          </div>
        </section>

        <p className="mt-4 text-sm text-[var(--text-secondary)] leading-relaxed border-t border-[var(--border-color)] pt-4">
          Completions and progress sync to your account; more activity insights may appear here later.
        </p>

        {user && (onAlertsMutedChange || onDeleteAccount) && (
          <div className="mt-5 space-y-5 border-t border-[var(--border-color)] pt-5">
            {onAlertsMutedChange && (
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2.5 flex items-center gap-2">
                  <BellOff size={16} className="text-orange-500 shrink-0" aria-hidden />
                  Notifications
                </h3>
                <div className="rounded-xl border border-[var(--border-color)] bg-[var(--hover-bg)]/50 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <p className="text-sm text-[var(--text-secondary)] min-w-0">
                    <span className="font-medium text-[var(--text-primary)]">Mute in-app alerts</span>
                    {' — '}
                    hides course/admin bell items; certificates still show.
                  </p>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={alertsMuted}
                    onClick={() => onAlertsMutedChange(!alertsMuted)}
                    className={`relative h-9 w-14 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500/60 self-end sm:self-auto ${
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
                  className={`rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
                    accountDeletionBlockedMessage || accountDeletionBlockLoading ? 'mt-3' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)]">Delete account</p>
                    <p className="text-xs text-[var(--text-secondary)] mt-1 leading-snug">
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
                    className="inline-flex items-center justify-center gap-2 shrink-0 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-500 hover:bg-red-500/20 transition-colors disabled:pointer-events-none disabled:opacity-45"
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
        {showCompletedModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-completed-courses-title"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-[var(--border-color)] flex items-center justify-between">
                <h2 id="profile-completed-courses-title" className="text-xl font-bold text-[var(--text-primary)]">
                  Completed Courses
                </h2>
                <button
                  type="button"
                  onClick={closeCompletedModal}
                  className="p-2 hover:bg-[var(--hover-bg)] rounded-lg transition-colors text-[var(--text-secondary)]"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 max-h-[60vh] overflow-y-auto">
                {completedCoursesList.length > 0 ? (
                  <div className="space-y-4">
                    {completedCoursesList.map(course => (
                      <div
                        key={course.id}
                        className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 bg-[var(--hover-bg)] rounded-xl border border-[var(--border-color)]"
                      >
                        <div className="w-16 h-10 rounded-lg overflow-hidden shrink-0">
                          <img
                            src={course.thumbnail}
                            alt=""
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-[var(--text-primary)] truncate">{course.title}</h3>
                          <p className="text-xs text-[var(--text-secondary)]">{course.author}</p>
                        </div>
                        <div className="flex items-center gap-3 w-full sm:w-auto mt-2 sm:mt-0">
                          <button
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
                            className="flex-1 sm:flex-none px-4 py-2 bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 rounded-lg text-xs font-bold transition-colors"
                          >
                            View Certificate
                          </button>
                          <CheckCircle2 size={20} className="text-orange-500 shrink-0" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-[var(--text-secondary)]">No courses completed yet. Keep learning!</p>
                  </div>
                )}
              </div>
              <div className="p-6 border-t border-[var(--border-color)] bg-[var(--hover-bg)]/50">
                <button
                  type="button"
                  onClick={closeCompletedModal}
                  className="w-full bg-orange-500 text-white py-3 rounded-xl font-bold hover:bg-orange-600 transition-colors"
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
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-delete-title"
        >
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-[var(--border-color)]">
              <h3 id="profile-delete-title" className="text-lg font-bold text-[var(--text-primary)]">
                Delete your account?
              </h3>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-[var(--text-secondary)]">
                Your Google-linked account will be removed from SkillStream. Admins must set their role to
                user in Admin → Roles before deletion; if you are the only admin, promote someone else to
                admin first.
              </p>
              {deleteError && <p className="text-sm text-red-500">{deleteError}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={deleteBusy}
                  onClick={closeDeleteConfirm}
                  className="flex-1 border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--hover-bg)] py-2.5 rounded-lg text-sm font-semibold disabled:opacity-60"
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
                  className="flex-[1.2] py-2.5 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-60"
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
