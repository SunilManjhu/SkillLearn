import React, { useState, useLayoutEffect, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, Play, Star, Clock, BarChart, Layout, User, RotateCcw, CheckCircle2, Award } from 'lucide-react';
import { Course, Lesson } from '../data/courses';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  isCourseComplete,
  hasResumableCourseProgress,
  getResumeOrStartLesson,
  loadLessonProgressMap,
  reconcileLessonProgressMap,
  isLessonPlaybackComplete,
  getCourseLessonProgressSummaryFromMap,
  progressPercent,
  clearCourseProgress,
  clearLocalLearnerStateForCourseId,
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
import { useCourseStockThumbnail } from '../hooks/useCourseStockThumbnail';
import { scrollDocumentToTop } from '../utils/scrollDocumentToTop';
import { CatalogRichText } from './CatalogRichText';
import { catalogMiniRichPlainText } from '../utils/catalogMiniRichHtml';
import {
  loadCompletionTimestamps,
  mergeCompletionTimestampFromRemote,
  clearCourseCompletionTimestamp,
} from '../utils/courseCompletionLog';
import { buildCertificateId } from '../utils/certificateFirestore';
import type { User as FirebaseUser } from '../firebase';
import type { AuthProfileSnapshot } from '../utils/authProfileCache';
import { isPlayableCatalogLesson } from '../utils/lessonContent';
import { useSignInModal } from './SignInModalProvider';

type OverviewUser = FirebaseUser | AuthProfileSnapshot;

/** In-progress lesson: orange ring + green arc (matches bar + completion cues). */
function OverviewLessonInProgressRing({ pct }: { pct: number }) {
  const size = 14;
  const stroke = 2;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct));
  const dash = (clamped / 100) * c;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      aria-hidden
    >
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        strokeWidth={stroke}
        className="stroke-brand-500/55"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        className="stroke-emerald-600 app-dark:stroke-emerald-400"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
    </svg>
  );
}

function OverviewLessonStatusGlyph({ lessonComplete, pct }: { lessonComplete: boolean; pct: number }) {
  if (lessonComplete) {
    return (
      <CheckCircle2
        size={14}
        className="shrink-0 text-emerald-600 transition-colors group-hover:text-emerald-500 app-dark:text-emerald-400 app-dark:group-hover:text-emerald-300"
        aria-hidden
      />
    );
  }
  if (pct > 0) {
    return <OverviewLessonInProgressRing pct={pct} />;
  }
  return (
    <Play
      size={14}
      className="shrink-0 text-[var(--text-secondary)] transition-colors group-hover:text-brand-500"
      aria-hidden
    />
  );
}

interface CourseOverviewProps {
  course: Course;
  onStartCourse: (lesson?: Lesson) => void;
  /** Firebase user or cached profile while session restores (matches navbar). */
  user: OverviewUser | null;
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
  onShowCertificate,
  remoteDataVersion = 0,
  contentDeepLink = null,
  onContentDeepLinkConsumed,
}) => {
  const { openSignInModal } = useSignInModal();
  const progressUserId = user?.uid ?? null;
  const curriculumKey = courseLessonIdsKey(course);
  const { lessonDurationLabel } = useYoutubeResolvedSeconds(course);
  const { imageUrl: heroImageUrl, imageCreditTitle: heroImageCreditTitle } = useCourseStockThumbnail(course);
  const reduceMotion = useReducedMotion();
  const collapseTransition = { duration: reduceMotion ? 0 : 0.28 };
  const modalTransition = { duration: reduceMotion ? 0 : 0.2 };
  const [expandedModules, setExpandedModules] = useState<string[]>(() =>
    course.modules[0]?.id ? [course.modules[0].id] : []
  );
  const [showRatingPrompt, setShowRatingPrompt] = useState(false);
  const [existingRating, setExistingRating] = useState<CourseRating | null>(null);
  const [ratingStars, setRatingStars] = useState(0);
  const [hoverStars, setHoverStars] = useState(0);
  const [ratingComment, setRatingComment] = useState('');

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

  useLayoutEffect(() => {
    setExpandedModules((prev) => {
      const kept = prev.filter((id) => course.modules.some((m) => m.id === id));
      if (kept.length > 0) return kept;
      return course.modules[0]?.id ? [course.modules[0].id] : [];
    });
  }, [course.id, curriculumKey]);

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
  const { totalLessons, completedLessons: completedLessonCount, percent: overallProgressPercent } =
    getCourseLessonProgressSummaryFromMap(course, progressMap);

  const primaryCtaLabel = isComplete ? 'Retake Course' : canResume ? 'Resume lesson' : 'Start Course';

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
    openSignInModal();
  };

  const requestLessonPlay = (lesson: Lesson) => {
    if (!isPlayableCatalogLesson(lesson)) return;
    if (user) {
      onStartCourse(lesson);
      return;
    }
    openSignInModal();
  };

  const handleRatingSubmit = () => {
    if (ratingStars === 0) return;
    const rating = { stars: ratingStars, comment: ratingComment };
    saveCourseRating(course.id, rating, progressUserId);
    setExistingRating(rating);
    setShowRatingPrompt(false);
    setRatingStars(0);
    setRatingComment('');
    setHoverStars(0);
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
    loadProgressFromFirestore(course.id, progressUserId).then((res) => {
      if (cancelled || !res.ok) return;
      if (res.absent) {
        console.debug('[debug:courseReuse]', 'clearing local progress+completion+rating (no Firestore progress doc)', {
          courseId: course.id,
        });
        clearLocalLearnerStateForCourseId(course.id, progressUserId);
        setProgressMap({});
        setExistingRating(null);
        setShowRatingPrompt(false);
        return;
      }
      if (res.completedAtMs != null) {
        mergeCompletionTimestampFromRemote(course.id, progressUserId, res.completedAtMs);
      }
      if (Object.keys(res.lessonProgress).length === 0) return;
      setProgressMap((prev) => {
        const merged = { ...prev, ...res.lessonProgress };
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
    loadCourseRatingFromFirestore(course.id, progressUserId).then((res) => {
      if (cancelled || !res.ok) return;
      if (res.absent) {
        console.debug('[debug:courseReuse]', 'clearing local rating (no Firestore courseRatings doc)', {
          courseId: course.id,
        });
        clearCourseRating(course.id, progressUserId);
        setExistingRating(null);
        return;
      }
      if (res.rating) {
        saveCourseRating(course.id, res.rating, progressUserId, { skipFirestoreSync: true });
        setExistingRating(res.rating);
      }
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
      {/* Hero Section — min-height matches CourseCatalogLoadingSkeleton hero band */}
      <div className="relative flex min-h-56 w-full flex-col overflow-hidden md:min-h-72">
        <img
          src={heroImageUrl}
          alt={course.title}
          title={heroImageCreditTitle}
          className="absolute inset-0 h-full w-full object-cover"
          fetchPriority="high"
          loading="eager"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-primary)] via-[var(--bg-primary)]/60 to-transparent" />
        
        <div className="relative mx-auto w-full max-w-7xl px-4 py-4 sm:px-6">
          <div className="max-w-3xl">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                {course.categories.map((cat) => (
                  <span
                    key={cat}
                    className="rounded-full border border-[#cfcfcf] bg-[#e7e7e7] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#272828]"
                  >
                    {cat}
                  </span>
                ))}
                {course.skills.slice(0, 6).map((sk) => (
                  <span
                    key={sk}
                    className="rounded-md bg-[var(--bg-primary)]/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--skill-chip-fg)] backdrop-blur-sm"
                  >
                    {sk}
                  </span>
                ))}
                {course.skills.length > 6 && (
                  <span className="text-[10px] font-medium text-[var(--text-muted)]">
                    +{course.skills.length - 6} skills
                  </span>
                )}
                <div className="flex items-center gap-1 text-yellow-500">
                  <Star size={14} fill="currentColor" />
                  <span className="text-sm font-bold">{course.rating}</span>
                </div>
              </div>
              
              <h1 className="text-3xl md:text-5xl font-bold mb-1 tracking-tight leading-tight">
                {course.title}
              </h1>
              
              <div className="text-base md:text-lg text-[var(--text-secondary)] mb-4 leading-relaxed max-w-2xl [&_p]:mb-2 [&_p:last-child]:mb-0">
                <CatalogRichText as="div" value={course.description} />
              </div>

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
                      className="h-full rounded-full bg-brand-500 transition-[width] duration-300 ease-out"
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
                    className="flex items-center justify-center gap-2 px-8 py-4 bg-brand-500 hover:bg-brand-600 text-white rounded-2xl font-bold transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-brand-500/20"
                  >
                    {isComplete ? <RotateCcw size={20} /> : <Play size={20} fill="currentColor" />}
                    {primaryCtaLabel}
                  </button>
                  {user && showCertificateCta && (
                    <button
                      type="button"
                      onClick={handleViewCertificate}
                      className="flex items-center justify-center gap-2 px-8 py-4 rounded-2xl font-bold transition-all border-2 border-brand-500/60 text-brand-500 hover:bg-brand-500/10"
                    >
                      <Award size={20} />
                      View Certificate
                    </button>
                  )}
                </div>

                <div className="text-sm">
                  <span className="text-[var(--text-secondary)]">by </span>
                  <span className="font-bold text-brand-500">{course.author}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-0 w-full max-w-7xl px-4 sm:px-6">
        <AnimatePresence>
          {showRatingPrompt && user && (
            <motion.div
              key="course-overview-rating-prompt"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={collapseTransition}
              className="mb-12 overflow-hidden"
            >
              <div className="bg-brand-500/5 border border-brand-500/20 rounded-3xl p-8 flex flex-col md:flex-row items-center gap-8">
                <div className="w-16 h-16 bg-brand-500/10 rounded-2xl flex items-center justify-center text-brand-500 shrink-0">
                  <Star size={32} fill="currentColor" />
                </div>
                
                <div className="flex-1 text-center md:text-left">
                  <h3 className="text-xl font-bold text-[var(--text-primary)] mb-1">You finished this course!</h3>
                  <p className="text-[var(--text-secondary)] text-sm mb-4">Would you like to share your rating with us?</p>
                  
                  <div className="mb-4 flex flex-col items-center gap-2 md:items-start">
                    <div className="flex flex-wrap items-center justify-center gap-0.5 sm:justify-start">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          aria-label={`Rate ${star} out of 5`}
                          onClick={() => setRatingStars(star)}
                          onMouseEnter={() => setHoverStars(star)}
                          onMouseLeave={() => setHoverStars(0)}
                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg transition-transform hover:scale-110 motion-reduce:transform-none"
                        >
                          <Star
                            size={24}
                            className={star <= (hoverStars || ratingStars) ? 'text-brand-500' : 'text-[var(--border-color)]'}
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
                            initial={{ opacity: 0, x: reduceMotion ? 0 : -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: reduceMotion ? 0 : 10 }}
                            transition={modalTransition}
                            className="text-base font-bold text-brand-500"
                          >
                            {RATING_LABELS[hoverStars || ratingStars]}
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {ratingStars > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={modalTransition}
                      className="space-y-4"
                    >
                      <textarea
                        value={ratingComment}
                        onChange={(e) => setRatingComment(e.target.value)}
                        placeholder="Optional: Share your thoughts..."
                        className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-brand-500/50 min-h-[80px] resize-none"
                      />
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={handleRatingSubmit}
                          className="rounded-xl bg-brand-500 px-6 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-600"
                        >
                          Submit Rating
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            remindLaterCourseRating(course.id, progressUserId);
                            setShowRatingPrompt(false);
                          }}
                          className="rounded-xl border border-[var(--border-color)] px-6 py-2 text-sm font-bold text-[var(--text-primary)] transition-colors hover:bg-[var(--hover-bg)]"
                        >
                          Maybe later
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {ratingStars === 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        remindLaterCourseRating(course.id, progressUserId);
                        setShowRatingPrompt(false);
                      }}
                      className="mt-2 w-full rounded-xl py-3 text-sm font-bold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] md:mt-0 md:w-auto md:self-center"
                    >
                      Maybe later
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {user && existingRating && existingRating.stars > 0 && (
            <motion.div
              key="course-overview-rating-submitted"
              role="status"
              aria-live="polite"
              initial={{ opacity: 0, y: reduceMotion ? 0 : 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={modalTransition}
              className="mb-12 rounded-3xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 sm:p-8"
            >
              <div className="flex flex-col items-stretch gap-4 md:flex-row md:items-center md:gap-6">
                {/* Decorative icon only on md+; on mobile it was a sparse full-width row above the copy */}
                <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-500 md:flex">
                  <Star size={24} fill="currentColor" aria-hidden />
                </div>

                <div className="min-w-0 flex-1 text-center md:text-left">
                  <p className="mb-2 text-sm font-medium text-emerald-600 app-dark:text-emerald-400">
                    Thanks — your rating was saved.
                  </p>
                  <div className="mb-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 md:justify-start">
                    <h3 className="text-lg font-bold text-[var(--text-primary)]">Your Rating</h3>
                    <div
                      className="flex items-center gap-0.5 text-brand-500"
                      aria-label={`${existingRating.stars} out of 5 stars`}
                    >
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          size={18}
                          className={star <= existingRating.stars ? 'text-brand-500' : 'text-[var(--border-color)]'}
                          fill={star <= existingRating.stars ? 'currentColor' : 'none'}
                          aria-hidden
                        />
                      ))}
                    </div>
                  </div>
                  <p className="break-words text-sm leading-relaxed text-[var(--text-secondary)]">
                    {existingRating.comment?.trim()
                      ? existingRating.comment.trim()
                      : 'You rated this course ' + RATING_LABELS[existingRating.stars] + '.'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleResetRating}
                  className="min-h-11 w-full shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold text-brand-500 transition-colors hover:bg-brand-500/10 md:min-h-0 md:w-auto md:self-center"
                >
                  Reset Rating
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
          {/* Main Content: Table of Contents */}
          <div className="min-w-0 lg:col-span-2">
            <h2
              id="course-curriculum"
              className="mb-8 flex min-w-0 flex-col gap-1 text-2xl font-bold sm:flex-row sm:items-baseline sm:gap-3"
            >
              <span className="shrink-0">Course Content</span>
              <span className="text-sm font-normal text-[var(--text-secondary)] break-words sm:whitespace-nowrap">
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
                    type="button"
                    id={`course-module-heading-${module.id}`}
                    aria-expanded={expandedModules.includes(module.id)}
                    aria-controls={`module-panel-${module.id}`}
                    onClick={() => toggleModule(module.id)}
                    className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-[var(--hover-bg)] sm:p-6"
                  >
                    <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-sm font-bold text-brand-500">
                        {idx + 1}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-[var(--text-primary)] [&_p]:m-0 [&_p]:inline">
                          <CatalogRichText value={module.title} />
                        </h3>
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
                        id={`module-panel-${module.id}`}
                        role="region"
                        aria-labelledby={`course-module-heading-${module.id}`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={collapseTransition}
                        className="border-t border-[var(--border-color)]"
                      >
                        <div className="bg-[var(--bg-primary)]/50">
                          {module.lessons.map((lesson) => {
                            if (lesson.contentKind === 'divider') {
                              return (
                                <div
                                  key={lesson.id}
                                  id={`course-lesson-${lesson.id}`}
                                  className="border-t border-[var(--border-color)]/60 px-4 py-3 pl-6 text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] sm:pl-12 md:pl-16"
                                >
                                  {catalogMiniRichPlainText(lesson.title) ? (
                                    <CatalogRichText value={lesson.title} />
                                  ) : (
                                    'Section'
                                  )}
                                </div>
                              );
                            }
                            const lessonComplete = isLessonPlaybackComplete(progressMap[lesson.id]);
                            const pct = progressPercent(progressMap[lesson.id]);
                            return (
                              <button
                                type="button"
                                key={lesson.id}
                                id={`course-lesson-${lesson.id}`}
                                onClick={() => requestLessonPlay(lesson)}
                                className="group flex w-full flex-col gap-1.5 p-4 pl-6 text-left transition-colors hover:bg-[var(--hover-bg)] sm:pl-12 md:pl-16"
                              >
                                <div className="flex min-w-0 w-full items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                                    <div className="flex min-w-0 items-center gap-3">
                                      <OverviewLessonStatusGlyph lessonComplete={lessonComplete} pct={pct} />
                                      <span className="min-w-0 break-words text-sm font-medium text-[var(--text-secondary)] transition-colors line-clamp-2 group-hover:text-[var(--text-primary)] [&_p]:m-0 [&_p]:inline">
                                        <CatalogRichText value={lesson.title} />
                                      </span>
                                    </div>
                                    <div className="flex w-full items-center gap-2">
                                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--hover-bg)]">
                                        <div
                                          className="h-full rounded-full bg-brand-500 transition-[width] duration-300"
                                          style={{ width: `${pct}%` }}
                                        />
                                      </div>
                                      <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-[var(--text-muted)]">
                                        {pct}%
                                      </span>
                                    </div>
                                  </div>
                                  <span className="shrink-0 text-xs text-[var(--text-muted)] font-mono pt-0.5">
                                    {lessonDurationLabel(lesson)}
                                  </span>
                                </div>
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
          <div className="space-y-8 lg:sticky lg:top-20 lg:self-start">
            {/* Author Info */}
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-3xl p-8">
              <h3 className="text-sm font-bold text-brand-500 uppercase tracking-widest mb-6">Course Author</h3>
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-2xl bg-brand-500/10 flex items-center justify-center text-brand-500">
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
              <h3 className="text-sm font-bold text-brand-500 uppercase tracking-widest mb-2">Course Details</h3>
              
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--hover-bg)] flex items-center justify-center text-brand-500">
                  <Clock size={20} />
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">Duration</p>
                  <p className="font-bold text-sm">{course.duration}</p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--hover-bg)] flex items-center justify-center text-brand-500">
                  <BarChart size={20} />
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">Level</p>
                  <p className="font-bold text-sm">{course.level}</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--hover-bg)] text-brand-500">
                  <Layout size={20} />
                </div>
                <div className="min-w-0 space-y-3">
                  <div>
                    <p className="text-xs text-[var(--text-secondary)]">Categories</p>
                    {course.categories.length ? (
                      <p className="mt-1 flex flex-wrap gap-1.5 leading-snug">
                        {course.categories.map((c) => (
                          <span
                            key={c}
                            className="rounded-md border border-[#cfcfcf] bg-[#e7e7e7] px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-[#272828]"
                          >
                            {c}
                          </span>
                        ))}
                      </p>
                    ) : (
                      <p className="text-sm font-bold leading-snug text-[var(--text-primary)]">—</p>
                    )}
                  </div>
                  {course.skills.length > 0 && (
                    <div>
                      <p className="text-xs text-[var(--text-secondary)]">Skills</p>
                      <p className="flex flex-wrap gap-1 text-sm font-bold leading-snug">
                        {course.skills.map((sk) => (
                          <span
                            key={sk}
                            className="rounded-md bg-[var(--hover-bg)] px-2 py-0.5 text-xs font-semibold text-[color:var(--skill-chip-fg)]"
                          >
                            {sk}
                          </span>
                        ))}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
