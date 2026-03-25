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
import { X, CheckCircle2 } from 'lucide-react';

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
}) => {
  const [displayNameEdit, setDisplayNameEdit] = useState('');
  const [bio, setBio] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showCompletedModal, setShowCompletedModal] = useState(false);

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

  useDialogKeyboard({
    open: !showCompletedModal,
    onClose: onDismiss,
    onPrimaryAction: user ? () => void handleSave() : onLogin,
  });

  useBodyScrollLock(showCompletedModal);

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
        className="w-full max-w-4xl pb-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-dialog-title"
      >
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl overflow-hidden shadow-2xl">
          <div className="p-6 border-b border-[var(--border-color)] flex items-center justify-between">
            <h2 id="profile-dialog-title" className="text-xl font-bold text-[var(--text-primary)]">
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
          <div className="p-6">
            <p className="text-[var(--text-secondary)]">Loading account…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className="w-full max-w-4xl pb-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-dialog-title"
      >
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl overflow-hidden shadow-2xl">
          <div className="p-6 border-b border-[var(--border-color)] flex items-center justify-between">
            <h2 id="profile-dialog-title" className="text-xl font-bold text-[var(--text-primary)]">
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
          <div className="p-8 text-center">
            <p className="text-[var(--text-secondary)] mb-6">Sign in to see your details and learning stats.</p>
            <button
              type="button"
              onClick={onLogin}
              className="bg-orange-500 text-white px-8 py-3 rounded-xl font-bold hover:bg-orange-600 transition-colors"
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
      className="w-full max-w-4xl pb-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-dialog-title"
    >
      <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-[var(--border-color)] flex items-center justify-between">
          <h2 id="profile-dialog-title" className="text-xl font-bold text-[var(--text-primary)]">
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
        <div className="p-8">
        <div className="flex flex-col md:flex-row items-center gap-8 mb-12">
          <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-orange-500/20 bg-[var(--hover-bg)] shrink-0">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt=""
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-4xl font-bold text-orange-500">
                {heroName.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
          <div className="text-center md:text-left min-w-0">
            <h1 className="text-3xl font-bold mb-2 text-[var(--text-primary)] break-words">{heroName}</h1>
            <p className="text-[var(--text-secondary)] mb-4 break-all">{user.email}</p>
            <div className="flex flex-wrap justify-center md:justify-start gap-4">
              <button
                onClick={() => setShowCompletedModal(true)}
                className="bg-[var(--hover-bg)] px-4 py-2 rounded-lg border border-[var(--border-color)] text-left hover:border-orange-500/50 transition-colors group"
              >
                <div className="text-xs text-[var(--text-secondary)] uppercase group-hover:text-orange-500 transition-colors">Courses Completed</div>
                <div className="text-xl font-bold text-[var(--text-primary)]">{stats.completedCourses}</div>
              </button>
              <div className="bg-[var(--hover-bg)] px-4 py-2 rounded-lg border border-[var(--border-color)]">
                <div className="text-xs text-[var(--text-secondary)] uppercase">Skill Points</div>
                <div className="text-xl font-bold text-[var(--text-primary)]">
                  {stats.skillPoints.toLocaleString()}
                </div>
              </div>
              <div className="bg-[var(--hover-bg)] px-4 py-2 rounded-lg border border-[var(--border-color)]">
                <div className="text-xs text-[var(--text-secondary)] uppercase">Certificates</div>
                <div className="text-xl font-bold text-[var(--text-primary)]">{stats.certificates}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <h2 className="text-xl font-bold mb-6 text-[var(--text-primary)]">Personal Information</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-[var(--text-secondary)] uppercase mb-1">Full Name</label>
                <input
                  type="text"
                  value={displayNameEdit}
                  onChange={(e) => setDisplayNameEdit(e.target.value)}
                  className="w-full bg-[var(--hover-bg)] border border-[var(--border-color)] rounded-lg px-4 py-2 focus:outline-none focus:border-orange-500/50 text-[var(--text-primary)]"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-secondary)] uppercase mb-1">Email Address</label>
                <input
                  type="email"
                  value={user.email || ''}
                  readOnly
                  className="w-full bg-[var(--hover-bg)] border border-[var(--border-color)] rounded-lg px-4 py-2 text-[var(--text-muted)] cursor-not-allowed"
                />
                <p className="text-xs text-[var(--text-muted)] mt-1">Managed by your sign-in provider.</p>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-secondary)] uppercase mb-1">Bio</label>
                <textarea
                  rows={4}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="A short bio visible on this device…"
                  className="w-full bg-[var(--hover-bg)] border border-[var(--border-color)] rounded-lg px-4 py-2 focus:outline-none focus:border-orange-500/50 resize-none text-[var(--text-primary)]"
                />
              </div>
              {saveError && <p className="text-sm text-red-500">{saveError}</p>}
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saveState === 'saving'}
                className="bg-orange-500 text-white px-6 py-2 rounded-lg font-bold hover:bg-orange-600 transition-colors disabled:opacity-60"
              >
                {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save Changes'}
              </button>
            </div>
          </div>
          <div>
            <h2 className="text-xl font-bold mb-6 text-[var(--text-primary)]">Recent Activity</h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Course completions, ratings, and progress are tracked per account. Keep learning — more activity
              insights will show here as you use SkillStream.
            </p>
          </div>
        </div>
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
    </div>
  );
};
