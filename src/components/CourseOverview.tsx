import React, { useState, useLayoutEffect, useEffect, useCallback } from 'react';
import { useDialogKeyboard } from '../hooks/useDialogKeyboard';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { ChevronDown, ChevronRight, Play, Star, Clock, BarChart, Layout, User, RotateCcw, CheckCircle2, Award, LogIn, X, AlertTriangle } from 'lucide-react';
import { Course, Lesson } from '../data/courses';
import { motion, AnimatePresence } from 'motion/react';
import {
  isCourseComplete,
  hasResumableCourseProgress,
  getResumeOrStartLesson,
  loadLessonProgressMap,
  reconcileLessonProgressMap,
  isLessonPlaybackComplete,
  clearCourseProgress,
  syncProgressToFirestore,
  loadProgressFromFirestore,
  progressStorageKey,
} from '../utils/courseProgress';
import { courseLessonIdsKey } from '../utils/courseLessons';
import {
  hasRatedOrDismissed,
  saveCourseRating,
  remindLaterCourseRating,
  clearCourseRating,
  loadCourseRating,
  loadCourseRatingFromFirestore,
  type CourseRating,
} from '../utils/courseRating';
import { useYoutubeResolvedSeconds } from '../hooks/useYoutubeResolvedSeconds';
import { scrollDocumentToTop } from '../utils/scrollDocumentToTop';
import {
  loadCompletionTimestamps,
  mergeCompletionTimestampFromRemote,
  clearCourseCompletionTimestamp,
} from '../utils/courseCompletionLog';
import { buildCertificateId } from '../utils/certificateFirestore';
import type { User as FirebaseUser } from '../firebase';
import type { AuthProfileSnapshot } from '../utils/authProfileCache';
import { formatAuthError } from '../utils/authErrors';

type OverviewUser = FirebaseUser | AuthProfileSnapshot;

interface CourseOverviewProps {
  course: Course;
  onStartCourse: (lesson?: Lesson) => void;
  /** Firebase user or cached profile while session restores (matches navbar). */
  user: OverviewUser | null;
  onLogin: () => Promise<void>;
  onShowCertificate: (courseId: string, userName: string, date: string, certId: string) => void;
  /** Bumps when cloud data is merged into localStorage (so progress/completion UI refreshes). */
  remoteDataVersion?: number;
  /** One-shot scroll target (e.g. from a broadcast alert). */
  contentDeepLink?: { moduleId?: string; lessonId?: string } | null;
  onContentDeepLinkConsumed?: () => void;
}

export const CourseOverview: React.FC<CourseOverviewProps> = ({
  course,
  onStartCourse,
  user,
  onLogin,
  onShowCertificate,
  remoteDataVersion = 0,
  contentDeepLink = null,
  onContentDeepLinkConsumed,
}) => {
  const progressUserId = user?.uid ?? null;
  const curriculumKey = courseLessonIdsKey(course);
  const { lessonDurationLabel } = useYoutubeResolvedSeconds(course);
  const [expandedModules, setExpandedModules] = useState<string[]>([course.modules[0].id]);
  const [showRatingPrompt, setShowRatingPrompt] = useState(false);
  const [existingRating, setExistingRating] = useState<CourseRating | null>(null);
  const [ratingStars, setRatingStars] = useState(0);
  const [hoverStars, setHoverStars] = useState(0);
  const [ratingComment, setRatingComment] = useState('');

  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const closeLoginModal = useCallback(() => {
    setLoginModalOpen(false);
    setLoginError(null);
  }, []);

  const loginPrimaryAction = useCallback(async () => {
    if (loginSubmitting) return;
    setLoginError(null);
    setLoginSubmitting(true);
    try {
      await onLogin();
      closeLoginModal();
    } catch (e) {
      setLoginError(formatAuthError(e));
    } finally {
      setLoginSubmitting(false);
    }
  }, [loginSubmitting, onLogin, closeLoginModal]);

  useDialogKeyboard({
    open: loginModalOpen,
    onClose: closeLoginModal,
    onPrimaryAction: loginPrimaryAction,
  });

  useBodyScrollLock(loginModalOpen);

  const openPlayLoginModal = () => {
    setLoginError(null);
    setLoginModalOpen(true);
  };

  /* If they sign in from elsewhere (e.g. navbar) while the modal is open, close it — stay on overview. */
  useEffect(() => {
    if (user && loginModalOpen) {
      setLoginModalOpen(false);
      setLoginError(null);
      setLoginSubmitting(false);
    }
  }, [user, loginModalOpen]);

  const RATING_LABELS: Record<number, string> = {
    1: 'Poor',
    2: 'Fair',
    3: 'Good',
    4: 'Very Good',
    5: 'Excellent'
  };

  const toggleModule = (moduleId: string) => {
    setExpandedModules(prev =>
      prev.includes(moduleId)
        ? prev.filter(id => id !== moduleId)
        : [...prev, moduleId]
    );
  };

  useEffect(() => {
    if (!contentDeepLink) return;
    const { moduleId, lessonId } = contentDeepLink;
    const expand: string[] = [];
    if (moduleId) expand.push(moduleId);
    if (lessonId) {
      const mod = course.modules.find((m) => m.lessons.some((l) => l.id === lessonId));
      if (mod && !expand.includes(mod.id)) expand.push(mod.id);
    }
    if (expand.length > 0) {
      setExpandedModules((prev) => Array.from(new Set([...prev, ...expand])));
    }
    const scrollId = lessonId ? `course-lesson-${lessonId}` : moduleId ? `course-module-${moduleId}` : null;
    const t = window.setTimeout(() => {
      if (scrollId) {
        document.getElementById(scrollId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        document.getElementById('course-curriculum')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      onContentDeepLinkConsumed?.();
    }, 120);
    return () => window.clearTimeout(t);
  }, [contentDeepLink, course, onContentDeepLinkConsumed]);

  const totalLessons = course.modules.reduce((acc, m) => acc + m.lessons.length, 0);

  const [progressMap, setProgressMap] = useState(() => {
    const uid = user?.uid ?? null;
    if (!uid) return {};
    const raw = loadLessonProgressMap(course.id, uid);
    return reconcileLessonProgressMap(course, raw).map;
  });

  const isComplete = isCourseComplete(course, progressMap);
  const canResume = hasResumableCourseProgress(course, progressMap);
  const completionRecorded =
    !!progressUserId && loadCompletionTimestamps(progressUserId)[course.id] != null;
  const showCertificateCta = isComplete || completionRecorded;
  const completedLessonCount = course.modules.reduce(
    (acc, m) => acc + m.lessons.filter((l) => isLessonPlaybackComplete(progressMap[l.id])).length,
    0
  );
  const overallProgressPercent = totalLessons ? Math.min(100, Math.round((completedLessonCount / totalLessons) * 100)) : 0;

  const handleRetakeCourse = useCallback(async () => {
    if (!progressUserId) return;
    clearCourseProgress(course.id, progressUserId);
    clearCourseRating(course.id, progressUserId);
    clearCourseCompletionTimestamp(course.id, progressUserId);
    /* Clear cloud progress before opening the player so we don’t reload a completed map and burn the one-shot finish flow. */
    await syncProgressToFirestore(course.id, progressUserId, {}, { completedAt: 'delete' });
    setProgressMap({}); // Force re-render and clear local state
    setExistingRating(null);
    setShowRatingPrompt(false);
    const start = getResumeOrStartLesson(course, {});
    if (start) onStartCourse(start);
    else onStartCourse();
  }, [course.id, progressUserId, onStartCourse, course]);

  const requestPrimaryAction = () => {
    if (user) {
      if (isComplete) void handleRetakeCourse();
      else {
        const next = getResumeOrStartLesson(course, progressMap);
        if (next) onStartCourse(next);
        else onStartCourse();
      }
      return;
    }
    openPlayLoginModal();
  };

  const requestLessonPlay = (lesson: Lesson) => {
    if (user) {
      onStartCourse(lesson);
      return;
    }
    openPlayLoginModal();
  };

  const handleRatingSubmit = () => {
    if (ratingStars === 0) return;
    const rating = { stars: ratingStars, comment: ratingComment };
    saveCourseRating(course.id, rating, progressUserId);
    setExistingRating(rating);
    setShowRatingPrompt(false);
  };

  const handleResetRating = () => {
    clearCourseRating(course.id, progressUserId);
    setExistingRating(null);
    setRatingStars(0);
    setRatingComment('');
    // Re-check if we should show prompt
    const progress = loadLessonProgressMap(course.id, progressUserId);
    if (user && isCourseComplete(course, progress)) {
      setShowRatingPrompt(true);
    }
  };

  const handleViewCertificate = () => {
    if (!user) return;
    const userName = user.displayName || user.email?.split('@')[0] || 'Learner';
    const completedAt = loadCompletionTimestamps(user.uid)[course.id];
    const date = completedAt
      ? new Date(completedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const certId = buildCertificateId(course.id, user.uid);
    onShowCertificate(course.id, userName, date, certId);
  };

  /* Re-load progress from local storage when course or account changes; remap legacy lesson ids to current catalog. */
  useEffect(() => {
    if (!progressUserId) {
      setProgressMap({});
      return;
    }
    const raw = loadLessonProgressMap(course.id, progressUserId);
    const { map, migrated } = reconcileLessonProgressMap(course, raw);
    setProgressMap(map);
    if (migrated) {
      try {
        localStorage.setItem(progressStorageKey(course.id, progressUserId), JSON.stringify(map));
      } catch {
        /* ignore */
      }
      void syncProgressToFirestore(course.id, progressUserId, map);
    }
  }, [course.id, curriculumKey, progressUserId, remoteDataVersion]);

  /* Ratings + completion prompt track the live progress map (including after Firestore merge). */
  useEffect(() => {
    const rating = loadCourseRating(course.id, progressUserId);
    setExistingRating(rating);
    const hasRated = rating && rating.stars > 0;
    setShowRatingPrompt(
      !!user &&
        isCourseComplete(course, progressMap) &&
        !hasRated &&
        !rating?.dismissedAt
    );
  }, [course, progressUserId, user, progressMap]);

  useEffect(() => {
    if (!progressUserId) return undefined;
    let cancelled = false;
    loadProgressFromFirestore(course.id, progressUserId).then((remote) => {
      if (cancelled || !remote) return;
      if (remote.completedAtMs != null) {
        mergeCompletionTimestampFromRemote(course.id, progressUserId, remote.completedAtMs);
      }
      if (Object.keys(remote.lessonProgress).length === 0) return;
      setProgressMap((prev) => {
        const merged = { ...prev, ...remote.lessonProgress };
        const { map, migrated } = reconcileLessonProgressMap(course, merged);
        try {
          localStorage.setItem(progressStorageKey(course.id, progressUserId), JSON.stringify(map));
        } catch {
          /* ignore */
        }
        if (migrated) void syncProgressToFirestore(course.id, progressUserId, map);
        return map;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [course.id, curriculumKey, progressUserId]);

  useEffect(() => {
    if (!progressUserId) return undefined;
    let cancelled = false;
    loadCourseRatingFromFirestore(course.id, progressUserId).then((remote) => {
      if (cancelled || !remote) return;
      saveCourseRating(course.id, remote, progressUserId, { skipFirestoreSync: true });
      setExistingRating(remote);
    });
    return () => {
      cancelled = true;
    };
  }, [course.id, progressUserId]);

  useLayoutEffect(() => {
    scrollDocumentToTop();
  }, [course.id]);

  /* Motion/layout can run after useLayoutEffect; rAF passes catch the settled layout. */
  useEffect(() => {
    scrollDocumentToTop();
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => scrollDocumentToTop());
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [course.id]);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] pb-10 pt-16">
      {/* Hero Section */}
      <div className="relative w-full overflow-hidden flex flex-col">
        <img
          src={course.thumbnail}
          alt={course.title}
          className="absolute inset-0 w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-primary)] via-[var(--bg-primary)]/60 to-transparent" />
        
        <div className="relative max-w-7xl mx-auto px-4 py-4 w-full">
          <div className="max-w-3xl">
              <div className="flex items-center gap-2 mb-1">
                <span className="px-3 py-1 rounded-full bg-orange-500/10 text-orange-500 text-xs font-bold uppercase tracking-wider">
                  {course.category}
                </span>
                <div className="flex items-center gap-1 text-yellow-500">
                  <Star size={14} fill="currentColor" />
                  <span className="text-sm font-bold">{course.rating}</span>
                </div>
              </div>
              
              <h1 className="text-3xl md:text-5xl font-bold mb-1 tracking-tight leading-tight">
                {course.title}
              </h1>
              
              <p className="text-base md:text-lg text-[var(--text-secondary)] mb-4 leading-relaxed max-w-2xl">
                {course.description}
              </p>

              {user && (
                <div className="mb-4 max-w-2xl">
                  <div className="flex items-center justify-between gap-3 text-sm text-[var(--text-secondary)] mb-1.5">
                    <span>Your progress</span>
                    <span className="font-mono text-xs text-[var(--text-muted)]">
                      {completedLessonCount}/{totalLessons} lessons
                    </span>
                  </div>
                  <div
                    className="h-2 w-full rounded-full bg-[var(--border-color)] overflow-hidden"
                    role="progressbar"
                    aria-valuenow={overallProgressPercent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Course completion"
                  >
                    <div
                      className="h-full rounded-full bg-orange-500 transition-[width] duration-300 ease-out"
                      style={{ width: `${overallProgressPercent}%` }}
                    />
                  </div>
                </div>
              )}
              
              <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <button
                    type="button"
                    onClick={requestPrimaryAction}
                    className="flex items-center justify-center gap-2 px-8 py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-2xl font-bold transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-orange-500/20"
                  >
                    {isComplete ? <RotateCcw size={20} /> : <Play size={20} fill="currentColor" />}
                    {isComplete ? 'Retake Course' : canResume ? 'Resume lesson' : 'Start Course'}
                  </button>
                  {user && showCertificateCta && (
                    <button
                      type="button"
                      onClick={handleViewCertificate}
                      className="flex items-center justify-center gap-2 px-8 py-4 rounded-2xl font-bold transition-all border-2 border-orange-500/60 text-orange-500 hover:bg-orange-500/10"
                    >
                      <Award size={20} />
                      View Certificate
                    </button>
                  )}
                </div>

                <div className="text-sm">
                  <span className="text-[var(--text-secondary)]">by </span>
                  <span className="font-bold text-orange-500">{course.author}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-6 mt-0">
        <AnimatePresence>
          {showRatingPrompt && user && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mb-12 overflow-hidden"
            >
              <div className="bg-orange-500/5 border border-orange-500/20 rounded-3xl p-8 flex flex-col md:flex-row items-center gap-8">
                <div className="w-16 h-16 bg-orange-500/10 rounded-2xl flex items-center justify-center text-orange-500 shrink-0">
                  <Star size={32} fill="currentColor" />
                </div>
                
                <div className="flex-1 text-center md:text-left">
                  <h3 className="text-xl font-bold text-[var(--text-primary)] mb-1">You finished this course!</h3>
                  <p className="text-[var(--text-secondary)] text-sm mb-4">Would you like to share your rating with us?</p>
                  
                  <div className="flex flex-col items-center md:items-start gap-2 mb-4">
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          onClick={() => setRatingStars(star)}
                          onMouseEnter={() => setHoverStars(star)}
                          onMouseLeave={() => setHoverStars(0)}
                          className="p-1 transition-transform hover:scale-110"
                        >
                          <Star
                            size={24}
                            className={star <= (hoverStars || ratingStars) ? 'text-orange-500' : 'text-[var(--border-color)]'}
                            fill={star <= (hoverStars || ratingStars) ? 'currentColor' : 'none'}
                          />
                        </button>
                      ))}
                    </div>
                    <div className="h-6 flex items-center">
                      <AnimatePresence mode="wait">
                        {(hoverStars || ratingStars) > 0 && (
                          <motion.p
                            key={hoverStars || ratingStars}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 10 }}
                            className="text-base font-bold text-orange-500"
                          >
                            {RATING_LABELS[hoverStars || ratingStars]}
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {ratingStars > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-4"
                    >
                      <textarea
                        value={ratingComment}
                        onChange={(e) => setRatingComment(e.target.value)}
                        placeholder="Optional: Share your thoughts..."
                        className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500/50 min-h-[80px] resize-none"
                      />
                      <div className="flex gap-3">
                        <button
                          onClick={handleRatingSubmit}
                          className="px-6 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-bold transition-colors"
                        >
                          Submit Rating
                        </button>
                        <button
                          onClick={() => {
                            remindLaterCourseRating(course.id, progressUserId);
                            setShowRatingPrompt(false);
                          }}
                          className="px-6 py-2 border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--hover-bg)] rounded-xl text-sm font-bold transition-colors"
                        >
                          Maybe later
                        </button>
                      </div>
                    </motion.div>
                  )}
                </div>

                {!ratingStars && (
                  <button
                    onClick={() => {
                      remindLaterCourseRating(course.id, progressUserId);
                      setShowRatingPrompt(false);
                    }}
                    className="text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    Maybe later
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {user && existingRating && existingRating.stars > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-12 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-3xl p-8"
            >
              <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
                <div className="w-12 h-12 bg-orange-500/10 rounded-xl flex items-center justify-center text-orange-500 shrink-0">
                  <Star size={24} fill="currentColor" />
                </div>
                
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-lg font-bold text-[var(--text-primary)]">Your Rating</h3>
                    <div className="flex items-center gap-0.5 text-orange-500">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          size={16}
                          fill={star <= existingRating.stars ? 'currentColor' : 'none'}
                          className={star <= existingRating.stars ? 'text-orange-500' : 'text-[var(--border-color)]'}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="text-sm text-[var(--text-secondary)]">
                    {existingRating.comment || "You rated this course " + RATING_LABELS[existingRating.stars]}
                  </p>
                </div>

                <button
                  onClick={handleResetRating}
                  className="px-4 py-2 text-sm font-bold text-orange-500 hover:bg-orange-500/10 rounded-xl transition-colors shrink-0"
                >
                  Reset Rating
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Main Content: Table of Contents */}
          <div className="lg:col-span-2">
            <h2 id="course-curriculum" className="text-2xl font-bold mb-8 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 whitespace-nowrap">
              Course Content
              <span className="text-sm font-normal text-[var(--text-secondary)] whitespace-nowrap">
                {course.modules.length} modules • {totalLessons} lessons
              </span>
            </h2>

            <div className="space-y-4">
              {course.modules.map((module, idx) => (
                <div
                  key={module.id}
                  id={`course-module-${module.id}`}
                  className="border border-[var(--border-color)] rounded-2xl overflow-hidden bg-[var(--bg-secondary)] transition-all"
                >
                  <button
                    onClick={() => toggleModule(module.id)}
                    className="w-full flex items-center justify-between p-6 hover:bg-[var(--hover-bg)] transition-colors text-left"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center text-orange-500 font-bold text-sm">
                        {idx + 1}
                      </div>
                      <div>
                        <h3 className="font-bold text-[var(--text-primary)]">{module.title}</h3>
                        <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                          {module.lessons.length} lessons
                        </p>
                      </div>
                    </div>
                    {expandedModules.includes(module.id) ? (
                      <ChevronDown size={20} className="text-[var(--text-secondary)]" />
                    ) : (
                      <ChevronRight size={20} className="text-[var(--text-secondary)]" />
                    )}
                  </button>

                  <AnimatePresence>
                    {expandedModules.includes(module.id) && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-[var(--border-color)]"
                      >
                        <div className="bg-[var(--bg-primary)]/50">
                          {module.lessons.map((lesson) => {
                            const lessonComplete = isLessonPlaybackComplete(progressMap[lesson.id]);
                            return (
                              <button
                                type="button"
                                key={lesson.id}
                                id={`course-lesson-${lesson.id}`}
                                onClick={() => requestLessonPlay(lesson)}
                                className="w-full flex items-center justify-between p-4 pl-16 hover:bg-[var(--hover-bg)] transition-colors group text-left"
                              >
                                <div className="flex items-center gap-3">
                                  {lessonComplete ? (
                                    <CheckCircle2 size={14} className="text-emerald-500" />
                                  ) : (
                                    <Play size={14} className="text-[var(--text-secondary)] group-hover:text-orange-500 transition-colors" />
                                  )}
                                  <span className={`text-sm font-medium transition-colors ${
                                    lessonComplete 
                                      ? 'text-emerald-500/80 group-hover:text-emerald-500' 
                                      : 'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'
                                  }`}>
                                    {lesson.title}
                                  </span>
                                </div>
                                <span className="text-xs text-[var(--text-muted)] font-mono">
                                  {lessonDurationLabel(lesson)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-8">
            {/* Author Info */}
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-3xl p-8">
              <h3 className="text-sm font-bold text-orange-500 uppercase tracking-widest mb-6">Course Author</h3>
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-2xl bg-orange-500/10 flex items-center justify-center text-orange-500">
                  <User size={32} />
                </div>
                <div>
                  <h4 className="font-bold text-lg text-[var(--text-primary)]">{course.author}</h4>
                  <p className="text-xs text-[var(--text-secondary)]">Instructor</p>
                </div>
              </div>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed italic">
                {course.authorBio || "A dedicated instructor committed to sharing knowledge and helping students master new skills through high-quality video resources."}
              </p>
            </div>

            {/* Metadata */}
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-3xl p-8 space-y-6">
              <h3 className="text-sm font-bold text-orange-500 uppercase tracking-widest mb-2">Course Details</h3>
              
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--hover-bg)] flex items-center justify-center text-orange-500">
                  <Clock size={20} />
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">Duration</p>
                  <p className="font-bold text-sm">{course.duration}</p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--hover-bg)] flex items-center justify-center text-orange-500">
                  <BarChart size={20} />
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">Level</p>
                  <p className="font-bold text-sm">{course.level}</p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--hover-bg)] flex items-center justify-center text-orange-500">
                  <Layout size={20} />
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">Category</p>
                  <p className="font-bold text-sm">{course.category}</p>
                </div>
              </div>

              <div className="pt-6 border-t border-[var(--border-color)] space-y-3">
                <button
                  type="button"
                  onClick={requestPrimaryAction}
                  className="w-full py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-2xl font-bold transition-all shadow-lg shadow-orange-500/20 flex items-center justify-center gap-2"
                >
                  {isComplete ? <RotateCcw size={20} /> : null}
                  {isComplete ? 'Retake Course' : 'Enroll Now'}
                </button>
                {user && showCertificateCta && (
                  <button
                    type="button"
                    onClick={handleViewCertificate}
                    className="w-full py-4 rounded-2xl font-bold transition-all border-2 border-orange-500/60 text-orange-500 hover:bg-orange-500/10 flex items-center justify-center gap-2"
                  >
                    <Award size={20} />
                    View Certificate
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {loginModalOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="course-overview-login-title"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-[var(--border-color)] flex items-center justify-between gap-4">
                <h2 id="course-overview-login-title" className="text-xl font-bold text-[var(--text-primary)]">
                  Sign in to learn
                </h2>
                <button
                  type="button"
                  onClick={closeLoginModal}
                  className="p-2 hover:bg-[var(--hover-bg)] rounded-full transition-colors shrink-0"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>
              <form
                className="p-6 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!loginSubmitting) void loginPrimaryAction();
                }}
              >
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                  Watching lessons and saving your progress requires a Google account. If a pop-up is blocked, you will be redirected to Google to sign in. After signing in you&apos;ll stay on this page — use{' '}
                  {canResume ? 'Resume lesson' : 'Start Course'} when you&apos;re ready.
                </p>
                {loginError && (
                  <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                    <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                    <span>{loginError}</span>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loginSubmitting}
                  autoFocus
                  className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white py-3 rounded-xl text-sm font-bold transition-colors"
                >
                  <LogIn size={18} />
                  {loginSubmitting ? 'Signing in…' : 'Continue with Google'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
