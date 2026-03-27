import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { useDialogKeyboard } from '../hooks/useDialogKeyboard';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import {
  Play,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Check,
  ChevronLeft,
  RotateCcw,
  ThumbsUp,
  AlertTriangle,
  Send,
  ExternalLink,
  Settings2,
  X,
  Info,
  Flag,
  Star,
  LogIn,
  Volume2,
  VolumeX,
  Cog,
} from 'lucide-react';
import { Course, Lesson } from '../data/courses';
import { motion, AnimatePresence } from 'motion/react';
import {
  applyYoutubeCaptionsModule,
  loadYoutubeIframeApi,
  readYoutubeCaptionLang,
  readYoutubeCaptionsPreference,
  writeYoutubeCaptionsPreference,
  YOUTUBE_EMBED_TOP_CROP_PX,
  youtubeEmbedSrcForVideoId,
  youtubeUrlToEmbedUrl,
  youtubeVideoIdFromUrl,
} from '../utils/youtube';
import { db, User, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, getDocs, addDoc, updateDoc, doc, serverTimestamp, onSnapshot, deleteDoc, limit } from 'firebase/firestore';
import {
  isLessonPlaybackComplete,
  isTrivialLessonProgress,
  getNextIncompleteLessonAfter,
  loadLessonProgressMap,
  progressPercent,
  progressStorageKey,
  isCourseReadyToFinalize,
  syncProgressToFirestore,
  loadProgressFromFirestore,
  type LessonProgress,
} from '../utils/courseProgress';
import { mergeCompletionTimestampFromRemote } from '../utils/courseCompletionLog';
import {
  saveCourseRating,
  hasRatedOrDismissed,
  remindLaterCourseRating,
  loadCourseRatingFromFirestore,
} from '../utils/courseRating';
import { useYoutubeResolvedSeconds } from '../hooks/useYoutubeResolvedSeconds';
import { formatAuthError } from '../utils/authErrors';

/**
 * Frost + resume blocker wait this long after a user pause so sub‑100ms glitches don’t flash the UI.
 * `mediaPaused` still updates immediately so chrome/cursor match the real player state.
 */
const PAUSE_UI_MIN_MS = 10;

/** Keep pause frost visible this long after playback resumes (video plays underneath; overlay is pointer-events none). */
const UNPAUSE_FROST_LINGER_MS = 100;

/** Auto-hide player chrome after idle mouse; same delay when playback starts (no cursor required). */
const PLAYER_CHROME_IDLE_MS = 1000;

function formatYtClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function formatYtSpeedLabel(rate: number): string {
  if (rate === 1) return 'Normal';
  return `${rate}×`;
}

interface CoursePlayerProps {
  course: Course;
  /** Called when every lesson has reached the true end of its video (same bar as the rating popup). */
  onCourseFinished: (course: Course) => void;
  user: User | null;
  onLogin: () => Promise<void>;
  initialLesson?: Lesson;
  /** Profile overlay on top of the player (App): pause while true, resume when cleared if playback was interrupted. */
  pauseForAppNavOverlay?: boolean;
  /** App hides nav + full-bleed video while true (playback without top nav). */
  immersiveLayout?: boolean;
  /** Fired when the shell should hide global nav (narrow viewport + landscape + playing). Portrait keeps the nav. */
  onImmersivePlaybackChange?: (immersive: boolean) => void;
}

export const CoursePlayer: React.FC<CoursePlayerProps> = ({
  course,
  onCourseFinished,
  user,
  onLogin,
  initialLesson,
  pauseForAppNavOverlay = false,
  immersiveLayout = false,
  onImmersivePlaybackChange,
}) => {
  const progressUserId = user?.uid ?? null;
  const { setYoutubeResolvedSeconds, lessonDurationLabel } = useYoutubeResolvedSeconds(course);
  const [currentLesson, setCurrentLesson] = useState<Lesson>(() => {
    if (initialLesson) return initialLesson;
    const m = loadLessonProgressMap(course.id, progressUserId);
    // Find first lesson that is not complete to resume
    for (const mod of course.modules) {
      for (const lesson of mod.lessons) {
        if (!isLessonPlaybackComplete(m[lesson.id])) {
          return lesson;
        }
      }
    }
    // If all complete, start from the beginning
    return course.modules[0].lessons[0];
  });
  const [expandedModules, setExpandedModules] = useState<string[]>(() => {
    // Expand the module containing the current lesson
    const mod = course.modules.find(m => m.lessons.some(l => l.id === currentLesson.id));
    return mod ? [mod.id] : [course.modules[0].id];
  });
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [youtubeCaptionsEnabled, setYoutubeCaptionsEnabled] = useState(() => readYoutubeCaptionsPreference());
  const youtubeCaptionsEnabledRef = useRef(youtubeCaptionsEnabled);
  youtubeCaptionsEnabledRef.current = youtubeCaptionsEnabled;
  const [youtubeCaptionLang, setYoutubeCaptionLang] = useState(() => readYoutubeCaptionLang());
  const youtubeCaptionLangRef = useRef(youtubeCaptionLang);
  youtubeCaptionLangRef.current = youtubeCaptionLang;
  /** YouTube-only HUD: current time / duration and volume (synced via IFrame API). */
  const [ytHudTime, setYtHudTime] = useState({ current: 0, duration: 0 });
  /** While dragging the seek bar, HUD ticks must not fight the slider. */
  const [ytSeekDragging, setYtSeekDragging] = useState(false);
  const [ytSeekDragSeconds, setYtSeekDragSeconds] = useState(0);
  const ytSeekDraggingRef = useRef(false);
  ytSeekDraggingRef.current = ytSeekDragging;
  /** True between pointer down/up on the seek bar so we only preview during drag; keyboard uses `onInput` commits. */
  const ytPointerSeekRef = useRef(false);
  const [ytVolume, setYtVolume] = useState(100);
  const [ytMuted, setYtMuted] = useState(false);
  const [ytSettingsOpen, setYtSettingsOpen] = useState(false);
  const [ytPlaybackRates, setYtPlaybackRates] = useState<number[]>([1]);
  const [ytPlaybackRate, setYtPlaybackRate] = useState(1);
  const ytSettingsPanelRef = useRef<HTMLDivElement>(null);
  const [mediaPaused, setMediaPaused] = useState(true);
  /** Once true for this lesson, show blurred "Paused" overlay when stopped (not before first play). */
  const [lessonPlaybackEverStarted, setLessonPlaybackEverStarted] = useState(false);
  /** YouTube: frost/blocker after PAUSE is confirmed (100ms) or right away on end / non-buffering stop. */
  const [ytPauseBlurActive, setYtPauseBlurActive] = useState(false);
  /** Native video: frost/blocker after pause is confirmed (100ms) or right away on ended. */
  const [nativePauseFrostReady, setNativePauseFrostReady] = useState(false);
  /** Brief frost after unpause while video is already playing (cleared from pause state immediately). */
  const [unpauseFrostLinger, setUnpauseFrostLinger] = useState(false);
  /** When playing: chrome hides after idle; any activity in the video rect shows it again (like native / streaming UIs). */
  const [chromeVisible, setChromeVisible] = useState(true);
  const [seekNudgeSeconds, setSeekNudgeSeconds] = useState<5 | -5>(5);
  const [seekNudgeVisible, setSeekNudgeVisible] = useState(false);
  const [progressByLesson, setProgressByLesson] = useState<Record<string, LessonProgress>>(() =>
    loadLessonProgressMap(course.id, progressUserId)
  );
  /**
   * While false, a lesson that’s already “done” shows the replay overlay. Set true as soon as the
   * user chooses Replay (before progress resets) so the overlay drops immediately. Reset on each
   * lesson id change and when the clip ends without auto-advancing.
   */
  const [replayUiSuppressed, setReplayUiSuppressed] = useState(false);

  /** Narrow + landscape: hide site nav / learning agent while playing; portrait keeps the nav bar. */
  const [immersiveShellViewport, setImmersiveShellViewport] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(max-width: 1023px)').matches &&
      window.matchMedia('(orientation: landscape)').matches
    );
  });

  // Voting & Suggestion State
  const [upvotes, setUpvotes] = useState(0);
  const [reports, setReports] = useState(0);
  const [userVote, setUserVote] = useState<'up' | 'down' | null>(null);
  const [suggestedUrl, setSuggestedUrl] = useState('');
  const [isSubmittingSuggestion, setIsSubmittingSuggestion] = useState(false);
  const [suggestionSuccess, setSuggestionSuccess] = useState(false);
  const [userSuggestion, setUserSuggestion] = useState<string | null>(null);
  const [customVideoUrl, setCustomVideoUrl] = useState<string | null>(null);
  const [isCustomizeModalOpen, setIsCustomizeModalOpen] = useState(false);
  const [customizeTab, setCustomizeTab] = useState<'replace' | 'suggest'>('replace');
  const [replaceUrl, setReplaceUrl] = useState('');
  const [isSubmittingCustomization, setIsSubmittingCustomization] = useState(false);

  const [isVoteLoginModalOpen, setIsVoteLoginModalOpen] = useState(false);
  const [voteLoginSubmitting, setVoteLoginSubmitting] = useState(false);
  const [voteLoginError, setVoteLoginError] = useState<string | null>(null);

  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportMode, setReportMode] = useState<'create' | 'recall'>('create');
  const [reportStep, setReportStep] = useState(1);
  const [selectedReportReason, setSelectedReportReason] = useState<string | null>(null);
  const [reportDetails, setReportDetails] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [hasActiveUserReport, setHasActiveUserReport] = useState(false);
  const [isRecallingReport, setIsRecallingReport] = useState(false);

  // Rating State
  const [showRatingPrompt, setShowRatingPrompt] = useState(false);
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

  const videoRef = useRef<HTMLVideoElement>(null);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<{ destroy: () => void } | null>(null);
  const ytPauseUiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativePauseUiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unpauseFrostLingerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoAreaRef = useRef<HTMLDivElement>(null);
  /** Pull focus out of cross-origin iframe so parent (e.g. Navbar Esc) receives key events. */
  const pauseResumeOverlayRef = useRef<HTMLDivElement>(null);
  const chromeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaPausedRef = useRef(mediaPaused);
  const lessonPlaybackEverStartedRef = useRef(lessonPlaybackEverStarted);
  lessonPlaybackEverStartedRef.current = lessonPlaybackEverStarted;

  const playNextAfterEndRef = useRef(false);
  const courseRef = useRef(course);
  const lessonRef = useRef(currentLesson);
  const autoAdvanceRef = useRef(autoAdvance);
  const nativeProgressThrottleRef = useRef(0);
  /** Latest (t,d) per lesson so flush can persist if the element/API isn’t readable mid-transition. */
  const lastKnownProgressByLessonRef = useRef<Record<string, { t: number; d: number }>>(
    (() => {
      const m = loadLessonProgressMap(course.id, progressUserId);
      const o: Record<string, { t: number; d: number }> = {};
      for (const id of Object.keys(m)) {
        o[id] = { t: m[id].currentTime, d: m[id].duration };
      }
      return o;
    })()
  );

  courseRef.current = course;
  lessonRef.current = currentLesson;
  autoAdvanceRef.current = autoAdvance;
  mediaPausedRef.current = mediaPaused;

  const ytPauseBlurActiveRef = useRef(ytPauseBlurActive);
  const nativePauseFrostReadyRef = useRef(nativePauseFrostReady);
  ytPauseBlurActiveRef.current = ytPauseBlurActive;
  nativePauseFrostReadyRef.current = nativePauseFrostReady;

  const progressByLessonRef = useRef(progressByLesson);
  progressByLessonRef.current = progressByLesson;

  const replayUiSuppressedRef = useRef(replayUiSuppressed);
  replayUiSuppressedRef.current = replayUiSuppressed;

  const isCustomizeModalOpenRef = useRef(isCustomizeModalOpen);
  isCustomizeModalOpenRef.current = isCustomizeModalOpen;
  const isReportModalOpenRef = useRef(isReportModalOpen);
  isReportModalOpenRef.current = isReportModalOpen;
  const pauseForAppNavOverlayRef = useRef(pauseForAppNavOverlay);
  pauseForAppNavOverlayRef.current = pauseForAppNavOverlay;
  const isVoteLoginModalOpenRef = useRef(isVoteLoginModalOpen);
  isVoteLoginModalOpenRef.current = isVoteLoginModalOpen;
  const showRatingPromptRef = useRef(showRatingPrompt);
  showRatingPromptRef.current = showRatingPrompt;

  /** User was playing before we auto-paused for customize/report/app overlay/tab visibility. */
  const resumeAfterInterruptionsRef = useRef(false);
  const customizePauseOwnedRef = useRef(false);
  const reportPauseOwnedRef = useRef(false);
  const appNavPauseOwnedRef = useRef(false);
  const visibilityPauseOwnedRef = useRef(false);

  /** Prefer React state so lesson-load handlers see completion before effects run. */
  const savedProgressForLesson = useCallback((lessonId: string): LessonProgress | undefined => {
    return (
      progressByLessonRef.current[lessonId] ??
      loadLessonProgressMap(courseRef.current.id, progressUserId)[lessonId]
    );
  }, [progressUserId]);

  /** In-memory + storage + last-known player times — for auto-advance right after mergeProgress. */
  const getMergedProgressSnapshot = useCallback((): Record<string, LessonProgress> => {
    const c = courseRef.current;
    const merged: Record<string, LessonProgress> = {
      ...loadLessonProgressMap(c.id, progressUserId),
    };
    Object.assign(merged, progressByLessonRef.current);
    for (const id of Object.keys(lastKnownProgressByLessonRef.current)) {
      const x = lastKnownProgressByLessonRef.current[id]!;
      merged[id] = { currentTime: x.t, duration: x.d };
    }
    return merged;
  }, [progressUserId]);

  const activeVideoUrl = customVideoUrl || userSuggestion || currentLesson.videoUrl;
  const youtubeEmbedUrl = youtubeUrlToEmbedUrl(activeVideoUrl);

  const mergeProgress = useCallback(
    (
      lessonId: string,
      currentTime: number,
      duration: number,
      opts?: { allowDowngradeFromComplete?: boolean }
    ): boolean => {
      if (!(duration > 0) || currentTime < 0) return false;
      const clampedRaw = Math.min(currentTime, duration);
      if (!opts?.allowDowngradeFromComplete) {
        const existing =
          progressByLessonRef.current[lessonId] ??
          loadLessonProgressMap(courseRef.current.id, progressUserId)[lessonId];
        if (
          existing &&
          isLessonPlaybackComplete(existing) &&
          !isLessonPlaybackComplete({ currentTime: clampedRaw, duration })
        ) {
          return false;
        }
      }
      let clamped = clampedRaw;
      if (isLessonPlaybackComplete({ currentTime: clamped, duration }) && clamped < duration) {
        clamped = duration;
      }
      lastKnownProgressByLessonRef.current[lessonId] = { t: clamped, d: duration };
      setProgressByLesson((prev) => {
        const next = { ...prev, [lessonId]: { currentTime: clamped, duration } };
        try {
          localStorage.setItem(progressStorageKey(course.id, progressUserId), JSON.stringify(next));
        } catch {
          /* ignore quota */
        }
        return next;
      });
      return true;
    },
    [course.id, progressUserId]
  );

  const flushCurrentLessonProgress = useCallback(() => {
    const lesson = lessonRef.current;
    const fallback = () => {
      const last = lastKnownProgressByLessonRef.current[lesson.id];
      if (last && last.d > 0) mergeProgress(lesson.id, last.t, last.d);
    };

    if (youtubeUrlToEmbedUrl(customVideoUrl || userSuggestion || lesson.videoUrl)) {
      let wrote = false;
      const p = ytPlayerRef.current;
      if (p?.getCurrentTime && p.getDuration) {
        try {
          const d = p.getDuration();
          if (d > 0) {
            wrote = mergeProgress(lesson.id, p.getCurrentTime(), d);
          }
        } catch {
          /* ignore */
        }
      }
      if (!wrote) fallback();
    } else {
      const v = videoRef.current;
      if (v && Number.isFinite(v.duration) && v.duration > 0) {
        const t = Number.isFinite(v.currentTime) ? Math.max(0, v.currentTime) : 0;
        const wrote = mergeProgress(lesson.id, t, v.duration);
        if (!wrote) fallback();
      } else {
        fallback();
      }
    }
  }, [mergeProgress, userSuggestion]);

  const clearUnpauseFrostLinger = useCallback(() => {
    if (unpauseFrostLingerTimerRef.current) {
      clearTimeout(unpauseFrostLingerTimerRef.current);
      unpauseFrostLingerTimerRef.current = null;
    }
    setUnpauseFrostLinger(false);
  }, []);

  const startUnpauseFrostLinger = useCallback(() => {
    clearUnpauseFrostLinger();
    setUnpauseFrostLinger(true);
    unpauseFrostLingerTimerRef.current = window.setTimeout(() => {
      unpauseFrostLingerTimerRef.current = null;
      setUnpauseFrostLinger(false);
    }, UNPAUSE_FROST_LINGER_MS);
  }, [clearUnpauseFrostLinger]);

  const stopPlayback = useCallback(() => {
    clearUnpauseFrostLinger();
    videoRef.current?.pause();
    try {
      ytPlayerRef.current?.pauseVideo();
    } catch {
      /* ignore */
    }
  }, [clearUnpauseFrostLinger]);

  const resumePlayback = useCallback(() => {
    if (youtubeEmbedUrl) {
      try {
        (ytPlayerRef.current as { playVideo?: () => void } | null)?.playVideo?.();
      } catch {
        /* ignore */
      }
    } else {
      const v = videoRef.current;
      if (v) void v.play().catch(() => {});
    }
  }, [youtubeEmbedUrl]);

  const ytOverlayClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearYoutubeOverlayClickTimer = useCallback(() => {
    if (ytOverlayClickTimerRef.current) {
      clearTimeout(ytOverlayClickTimerRef.current);
      ytOverlayClickTimerRef.current = null;
    }
  }, []);

  /** Fullscreen the video wrapper; iframe alone cannot be targeted from parent. */
  const toggleVideoAreaFullscreen = useCallback(async () => {
    const el = videoAreaRef.current;
    if (!el || typeof document === 'undefined') return;
    try {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
        webkitExitFullscreen?: () => Promise<void>;
      };
      const current = document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
      if (current === el) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else await doc.webkitExitFullscreen?.();
        return;
      }
      const host = el as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
      if (el.requestFullscreen) await el.requestFullscreen();
      else await host.webkitRequestFullscreen?.();
    } catch {
      /* ignore */
    }
  }, []);

  /**
   * Single-click toggles play/pause after a short delay. If a second click arrives (double-click),
   * we clear that timer and do not toggle — `onDoubleClick` handles fullscreen.
   */
  const handleYoutubeOverlayClick = useCallback(() => {
    if (ytOverlayClickTimerRef.current) {
      clearYoutubeOverlayClickTimer();
      return;
    }
    ytOverlayClickTimerRef.current = window.setTimeout(() => {
      ytOverlayClickTimerRef.current = null;
      const p = ytPlayerRef.current as {
        getPlayerState?: () => number;
        pauseVideo?: () => void;
        playVideo?: () => void;
      } | null;
      const YT = window.YT;
      if (!p?.getPlayerState || !YT?.PlayerState) return;
      try {
        const ps = p.getPlayerState();
        if (ps === YT.PlayerState.PLAYING) p.pauseVideo?.();
        else p.playVideo?.();
      } catch {
        /* ignore */
      }
    }, 280);
  }, [clearYoutubeOverlayClickTimer]);

  const handleYoutubeOverlayDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      clearYoutubeOverlayClickTimer();
      void toggleVideoAreaFullscreen();
    },
    [clearYoutubeOverlayClickTimer, toggleVideoAreaFullscreen]
  );

  const handleYtMuteToggle = useCallback(() => {
    const p = ytPlayerRef.current as {
      isMuted?: () => boolean;
      mute?: () => void;
      unMute?: () => void;
      getVolume?: () => number;
    } | null;
    if (!p?.isMuted) return;
    try {
      const wasMuted = p.isMuted();
      if (wasMuted) {
        p.unMute?.();
        setYtMuted(false);
      } else {
        p.mute?.();
        setYtMuted(true);
      }
      setYtVolume(p.getVolume?.() ?? 0);
    } catch {
      /* ignore */
    }
  }, []);

  const handleYtVolumeSlider = useCallback((value: number) => {
    const v = Math.max(0, Math.min(100, Math.round(value)));
    setYtVolume(v);
    const p = ytPlayerRef.current as { setVolume?: (n: number) => void; unMute?: () => void } | null;
    if (!p?.setVolume) return;
    try {
      p.setVolume(v);
      if (v > 0) {
        p.unMute?.();
        setYtMuted(false);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const commitYtSeek = useCallback((seconds: number) => {
    const p = ytPlayerRef.current as {
      seekTo?: (t: number, allowSeekAhead: boolean) => void;
      getDuration?: () => number;
    } | null;
    if (!p?.seekTo || !p.getDuration) {
      setYtSeekDragging(false);
      return;
    }
    try {
      const d = p.getDuration();
      if (!(Number.isFinite(d) && d > 0)) {
        setYtSeekDragging(false);
        return;
      }
      const clamped = Math.max(0, Math.min(seconds, d));
      p.seekTo(clamped, true);
      setYtHudTime({ current: clamped, duration: d });
      mergeProgress(lessonRef.current.id, clamped, d);
    } catch {
      /* ignore */
    }
    setYtSeekDragging(false);
  }, [mergeProgress]);

  const refreshYtPlayerSettings = useCallback(() => {
    const p = ytPlayerRef.current as {
      getAvailablePlaybackRates?: () => number[];
      getPlaybackRate?: () => number;
    } | null;
    if (!p?.getAvailablePlaybackRates || !p.getPlaybackRate) return;
    try {
      const rates = p.getAvailablePlaybackRates();
      if (Array.isArray(rates) && rates.length > 0) {
        setYtPlaybackRates(rates);
      }
      setYtPlaybackRate(p.getPlaybackRate());
    } catch {
      /* ignore */
    }
  }, []);

  const handleYtPlaybackRateSelect = useCallback((rate: number) => {
    const p = ytPlayerRef.current as { setPlaybackRate?: (r: number) => void } | null;
    if (!p?.setPlaybackRate) return;
    try {
      p.setPlaybackRate(rate);
      setYtPlaybackRate(rate);
    } catch {
      /* ignore */
    }
    setYtSettingsOpen(false);
  }, []);

  const tryResumePlayback = useCallback(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (
      isCustomizeModalOpenRef.current ||
      isReportModalOpenRef.current ||
      pauseForAppNavOverlayRef.current
    ) {
      return;
    }
    if (!resumeAfterInterruptionsRef.current) return;
    resumeAfterInterruptionsRef.current = false;
    resumePlayback();
  }, [resumePlayback]);

  const canResumeFromPlayerOverlay = useCallback(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
    return !(
      isCustomizeModalOpenRef.current ||
      isReportModalOpenRef.current ||
      pauseForAppNavOverlayRef.current ||
      isVoteLoginModalOpenRef.current ||
      showRatingPromptRef.current
    );
  }, []);

  /** User tapped the pause surface — resume immediately (frost may linger via `startUnpauseFrostLinger`). */
  const resumeFromPausedOverlay = useCallback(
    (e?: React.PointerEvent | React.KeyboardEvent) => {
      e?.preventDefault();
      if (!canResumeFromPlayerOverlay()) return;
      resumePlayback();
    },
    [canResumeFromPlayerOverlay, resumePlayback]
  );

  const seekActiveVideoBySeconds = useCallback(
    (deltaSeconds: number) => {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds === 0) return;
      if (
        isCustomizeModalOpenRef.current ||
        isReportModalOpenRef.current ||
        pauseForAppNavOverlayRef.current ||
        isVoteLoginModalOpenRef.current ||
        showRatingPromptRef.current
      ) {
        return;
      }
      if (youtubeEmbedUrl) {
        const p = ytPlayerRef.current as {
          getCurrentTime?: () => number;
          getDuration?: () => number;
          seekTo?: (t: number, allowSeekAhead: boolean) => void;
        } | null;
        if (!p?.getCurrentTime || !p.getDuration || !p.seekTo) return;
        try {
          const d = p.getDuration();
          if (!(Number.isFinite(d) && d > 0)) return;
          const t = p.getCurrentTime();
          const nextT = Math.max(0, Math.min(t + deltaSeconds, d));
          p.seekTo(nextT, true);
          setYtHudTime({ current: nextT, duration: d });
          mergeProgress(lessonRef.current.id, nextT, d);
        } catch {
          /* ignore */
        }
        return;
      }
      const v = videoRef.current;
      if (!v || !(Number.isFinite(v.duration) && v.duration > 0)) return;
      const nextT = Math.max(0, Math.min(v.currentTime + deltaSeconds, v.duration));
      v.currentTime = nextT;
      mergeProgress(lessonRef.current.id, nextT, v.duration);
    },
    [mergeProgress, youtubeEmbedUrl]
  );

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.closest('input, textarea, select, [contenteditable="true"], [role="slider"]')) return true;
      return false;
    };

    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSeekNudgeSeconds(5);
        setSeekNudgeVisible(true);
        seekActiveVideoBySeconds(5);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSeekNudgeSeconds(-5);
        setSeekNudgeVisible(true);
        seekActiveVideoBySeconds(-5);
      }
    };

    const onWindowKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        setSeekNudgeVisible(false);
      }
    };

    const onWindowBlur = () => setSeekNudgeVisible(false);

    window.addEventListener('keydown', onWindowKeyDown);
    window.addEventListener('keyup', onWindowKeyUp);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onWindowKeyDown);
      window.removeEventListener('keyup', onWindowKeyUp);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [seekActiveVideoBySeconds]);

  const currentModule = useMemo(
    () => course.modules.find((m) => m.lessons.some((l) => l.id === currentLesson.id)),
    [course.modules, currentLesson.id]
  );

  const aboutFallback = useMemo(() => {
    const section = currentModule?.title ?? 'this course';
    return `You're in the section “${section}”, on “${currentLesson.title}.” This segment connects to the rest of the course and emphasizes patterns you can reuse while practicing.`;
  }, [currentModule?.title, currentLesson.title]);

  /** Touch: brief idle before hiding chrome while playing (no reliable “cursor left” signal). */
  const TOUCH_CHROME_IDLE_MS = 3000;

  const clearChromeHideTimer = useCallback(() => {
    if (chromeHideTimerRef.current) {
      clearTimeout(chromeHideTimerRef.current);
      chromeHideTimerRef.current = null;
    }
  }, []);

  const scheduleTouchChromeHide = useCallback(() => {
    clearChromeHideTimer();
    chromeHideTimerRef.current = setTimeout(() => {
      if (!mediaPausedRef.current) setChromeVisible(false);
    }, TOUCH_CHROME_IDLE_MS);
  }, [clearChromeHideTimer]);

  const revealChromeAfterTouch = useCallback(() => {
    setChromeVisible(true);
    if (!mediaPausedRef.current) scheduleTouchChromeHide();
  }, [scheduleTouchChromeHide]);

  const showTopControls = mediaPaused || chromeVisible;

  /** Prefer in-memory map so the replay CTA matches immediately after navigation (storage is still the fallback). */
  const persistedProgressForCurrentLesson = useMemo(() => {
    return (
      progressByLesson[currentLesson.id] ?? loadLessonProgressMap(course.id, progressUserId)[currentLesson.id]
    );
  }, [course.id, currentLesson.id, progressByLesson, progressUserId]);

  const showReplayCta =
    isLessonPlaybackComplete(persistedProgressForCurrentLesson) && !replayUiSuppressed && mediaPaused;

  const showPauseFrostBackdrop =
    !showReplayCta &&
    lessonPlaybackEverStarted &&
    (unpauseFrostLinger ||
      (mediaPaused && (youtubeEmbedUrl ? ytPauseBlurActive : nativePauseFrostReady)));

  const showPauseFrostLabel = showPauseFrostBackdrop && mediaPaused;

  /** After first play, while paused: full-area resume layer; blocks iframe / native controls (timeline) until unpaused. */
  const blockPlayerPointerWhilePaused =
    mediaPaused &&
    lessonPlaybackEverStarted &&
    !showReplayCta &&
    (youtubeEmbedUrl ? ytPauseBlurActive : nativePauseFrostReady);

  /** Before paint: pause chrome + reset replay overlay for this lesson. */
  useLayoutEffect(() => {
    replayUiSuppressedRef.current = false;
    setReplayUiSuppressed(false);
    setMediaPaused(true);
    setLessonPlaybackEverStarted(false);
    setChromeVisible(true);
    clearChromeHideTimer();
    if (ytPauseUiTimerRef.current) {
      clearTimeout(ytPauseUiTimerRef.current);
      ytPauseUiTimerRef.current = null;
    }
    if (nativePauseUiTimerRef.current) {
      clearTimeout(nativePauseUiTimerRef.current);
      nativePauseUiTimerRef.current = null;
    }
    clearUnpauseFrostLinger();
    setYtPauseBlurActive(false);
    setNativePauseFrostReady(false);
    if (ytOverlayClickTimerRef.current) {
      clearTimeout(ytOverlayClickTimerRef.current);
      ytOverlayClickTimerRef.current = null;
    }
    setYtHudTime({ current: 0, duration: 0 });
    setYtSeekDragging(false);
    setYtSeekDragSeconds(0);
    setYtVolume(100);
    setYtMuted(false);
    setYtSettingsOpen(false);
    setYtPlaybackRates([1]);
    setYtPlaybackRate(1);
    resumeAfterInterruptionsRef.current = false;
    customizePauseOwnedRef.current = false;
    reportPauseOwnedRef.current = false;
    appNavPauseOwnedRef.current = false;
    visibilityPauseOwnedRef.current = false;
  }, [currentLesson.id, clearChromeHideTimer, clearUnpauseFrostLinger]);

  useLayoutEffect(() => {
    if (isCustomizeModalOpen) {
      if (!mediaPausedRef.current) {
        stopPlayback();
        setMediaPaused(true);
        customizePauseOwnedRef.current = true;
        resumeAfterInterruptionsRef.current = true;
      } else {
        customizePauseOwnedRef.current = false;
      }
      return;
    }
    if (customizePauseOwnedRef.current) {
      customizePauseOwnedRef.current = false;
    }
    tryResumePlayback();
  }, [isCustomizeModalOpen, stopPlayback, tryResumePlayback]);

  useLayoutEffect(() => {
    if (isReportModalOpen) {
      if (!mediaPausedRef.current) {
        stopPlayback();
        setMediaPaused(true);
        reportPauseOwnedRef.current = true;
        resumeAfterInterruptionsRef.current = true;
      } else {
        reportPauseOwnedRef.current = false;
      }
      return;
    }
    if (reportPauseOwnedRef.current) {
      reportPauseOwnedRef.current = false;
    }
    tryResumePlayback();
  }, [isReportModalOpen, stopPlayback, tryResumePlayback]);

  useLayoutEffect(() => {
    if (pauseForAppNavOverlay) {
      if (!mediaPausedRef.current) {
        stopPlayback();
        setMediaPaused(true);
        appNavPauseOwnedRef.current = true;
        resumeAfterInterruptionsRef.current = true;
      } else {
        appNavPauseOwnedRef.current = false;
      }
      return;
    }
    if (appNavPauseOwnedRef.current) {
      appNavPauseOwnedRef.current = false;
    }
    tryResumePlayback();
  }, [pauseForAppNavOverlay, stopPlayback, tryResumePlayback]);

  useEffect(() => {
    let visibleDebounce: number | null = null;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (visibleDebounce != null) {
          clearTimeout(visibleDebounce);
          visibleDebounce = null;
        }
        if (!mediaPausedRef.current) {
          stopPlayback();
          setMediaPaused(true);
          visibilityPauseOwnedRef.current = true;
          resumeAfterInterruptionsRef.current = true;
        }
        return;
      }
      if (visibleDebounce != null) clearTimeout(visibleDebounce);
      /** Debounce: rotation / mobile UI can briefly flip visibility and would otherwise resume incorrectly. */
      visibleDebounce = window.setTimeout(() => {
        visibleDebounce = null;
        if (document.visibilityState !== 'visible') return;
        if (visibilityPauseOwnedRef.current) {
          visibilityPauseOwnedRef.current = false;
        }
        tryResumePlayback();
      }, 220);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (visibleDebounce != null) clearTimeout(visibleDebounce);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [stopPlayback, tryResumePlayback]);

  useEffect(() => {
    if (mediaPaused) {
      clearChromeHideTimer();
      setChromeVisible(true);
      return;
    }
    /** Playing: auto-hide chrome after the same idle window as mouse (no cursor / not over video required). */
    clearChromeHideTimer();
    chromeHideTimerRef.current = window.setTimeout(() => {
      if (!mediaPausedRef.current) setChromeVisible(false);
    }, PLAYER_CHROME_IDLE_MS);
  }, [mediaPaused, clearChromeHideTimer]);

  useEffect(() => {
    return () => clearChromeHideTimer();
  }, [clearChromeHideTimer]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const narrow = window.matchMedia('(max-width: 1023px)');
    const landscape = window.matchMedia('(orientation: landscape)');
    const update = () => {
      setImmersiveShellViewport(narrow.matches && landscape.matches);
    };
    update();
    narrow.addEventListener('change', update);
    landscape.addEventListener('change', update);
    return () => {
      narrow.removeEventListener('change', update);
      landscape.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    onImmersivePlaybackChange?.(!mediaPaused && immersiveShellViewport);
    return () => onImmersivePlaybackChange?.(false);
  }, [mediaPaused, immersiveShellViewport, onImmersivePlaybackChange]);

  useEffect(() => {
    return () => {
      if (ytOverlayClickTimerRef.current) {
        clearTimeout(ytOverlayClickTimerRef.current);
        ytOverlayClickTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!ytSettingsOpen) return;
    const onDocPointerDown = (e: PointerEvent) => {
      const el = ytSettingsPanelRef.current;
      if (el && !el.contains(e.target as Node)) {
        setYtSettingsOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);
    return () => document.removeEventListener('pointerdown', onDocPointerDown, true);
  }, [ytSettingsOpen]);

  /** Mouse: while playing, show on movement and hide after short idle even if pointer stays inside. */
  useEffect(() => {
    const isInsideVideoArea = (clientX: number, clientY: number) => {
      const el = videoAreaRef.current;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    };

    const onMove = (e: MouseEvent) => {
      if (mediaPausedRef.current) return;
      const inside = isInsideVideoArea(e.clientX, e.clientY);
      if (!inside) {
        clearChromeHideTimer();
        setChromeVisible(false);
        return;
      }
      setChromeVisible(true);
      clearChromeHideTimer();
      chromeHideTimerRef.current = setTimeout(() => {
        if (!mediaPausedRef.current) setChromeVisible(false);
      }, PLAYER_CHROME_IDLE_MS);
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [clearChromeHideTimer]);

  useEffect(() => {
    const el = videoAreaRef.current;
    if (!el) return;

    const onTouch = () => {
      if (mediaPausedRef.current) {
        setChromeVisible(true);
        return;
      }
      revealChromeAfterTouch();
    };

    el.addEventListener('touchstart', onTouch, { passive: true });
    return () => el.removeEventListener('touchstart', onTouch);
  }, [currentLesson.id, currentLesson.videoUrl, revealChromeAfterTouch]);

  useEffect(() => {
    if (!blockPlayerPointerWhilePaused) return;
    const id = requestAnimationFrame(() => {
      pauseResumeOverlayRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [blockPlayerPointerWhilePaused]);

  /** Persist YouTube position periodically while playing. */
  useEffect(() => {
    if (!youtubeEmbedUrl) return;
    const id = window.setInterval(() => {
      if (mediaPausedRef.current) return;
      const p = ytPlayerRef.current;
      if (!p?.getCurrentTime || !p.getDuration) return;
      try {
        const d = p.getDuration();
        if (d > 0) mergeProgress(lessonRef.current.id, p.getCurrentTime(), d);
      } catch {
        /* ignore */
      }
    }, 2500);
    return () => clearInterval(id);
  }, [youtubeEmbedUrl, mergeProgress]);

  /** YouTube HUD: current time / duration (like the default player). */
  useEffect(() => {
    if (!youtubeEmbedUrl) return;
    const tick = () => {
      const p = ytPlayerRef.current as {
        getCurrentTime?: () => number;
        getDuration?: () => number;
      } | null;
      if (!p?.getCurrentTime || !p.getDuration) return;
      try {
        if (ytSeekDraggingRef.current) return;
        const d = p.getDuration();
        const t = p.getCurrentTime();
        if (Number.isFinite(d) && d > 0) {
          setYtHudTime({ current: t, duration: d });
        }
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => clearInterval(id);
  }, [youtubeEmbedUrl, currentLesson.id]);

  /**
   * If the course already met finalize criteria when opening the player, skip layout-driven finalize
   * (retake / replay stays in the player until the last lesson ends again).
   */
  const wasActuallyFinishedOnOpenRef = useRef(
    isCourseReadyToFinalize(course, loadLessonProgressMap(course.id, progressUserId))
  );
  const hasTriggeredFinishNavigationRef = useRef(false);

  /* Mid-course (or after local retake) we’re not ready to finalize — allow the end-of-course flow to run again. */
  useEffect(() => {
    if (!isCourseReadyToFinalize(course, progressByLesson)) {
      hasTriggeredFinishNavigationRef.current = false;
    }
  }, [course, progressByLesson]);

  /**
   * Strict course end: show rating if needed, otherwise go to overview.
   * Used after the last lesson ends (including retake) and for first-time complete + paused (layout backup).
   */
  const finalizeStrictCourseCompletion = useCallback(
    (c: Course, progressMap: Record<string, LessonProgress>) => {
      if (hasTriggeredFinishNavigationRef.current) return;
      if (!isCourseReadyToFinalize(c, progressMap)) return;

      hasTriggeredFinishNavigationRef.current = true;
      if (!hasRatedOrDismissed(c.id, progressUserId)) {
        setShowRatingPrompt(true);
        return;
      }
      try {
        onCourseFinished(c);
      } catch (e) {
        hasTriggeredFinishNavigationRef.current = false;
        console.error(e);
      }
    },
    [progressUserId, onCourseFinished]
  );

  const scheduleFinalizeFromStorage = useCallback(() => {
    queueMicrotask(() => {
      const c = courseRef.current;
      const base = loadLessonProgressMap(c.id, progressUserId);
      const ref = lastKnownProgressByLessonRef.current;
      const merged: Record<string, LessonProgress> = { ...base };
      for (const id of Object.keys(ref)) {
        merged[id] = { currentTime: ref[id].t, duration: ref[id].d };
      }
      finalizeStrictCourseCompletion(c, merged);
    });
  }, [progressUserId, finalizeStrictCourseCompletion]);

  const goToNextLesson = useCallback(() => {
    flushCurrentLessonProgress();
    stopPlayback();
    const merged = getMergedProgressSnapshot();
    const next = getNextIncompleteLessonAfter(courseRef.current, lessonRef.current, merged);
    if (!next) {
      scheduleFinalizeFromStorage();
      return;
    }
    playNextAfterEndRef.current = true;
    setCurrentLesson(next);
  }, [flushCurrentLessonProgress, stopPlayback, scheduleFinalizeFromStorage, getMergedProgressSnapshot]);

  /** Refs so YouTube iframe setup is not torn down when callback identities change (resize / parent re-render). */
  const mergeProgressRef = useRef(mergeProgress);
  mergeProgressRef.current = mergeProgress;
  const savedProgressForLessonRef = useRef(savedProgressForLesson);
  savedProgressForLessonRef.current = savedProgressForLesson;
  const getMergedProgressSnapshotRef = useRef(getMergedProgressSnapshot);
  getMergedProgressSnapshotRef.current = getMergedProgressSnapshot;
  const scheduleFinalizeFromStorageRef = useRef(scheduleFinalizeFromStorage);
  scheduleFinalizeFromStorageRef.current = scheduleFinalizeFromStorage;
  const goToNextLessonRef = useRef(goToNextLesson);
  goToNextLessonRef.current = goToNextLesson;
  const startUnpauseFrostLingerRef = useRef(startUnpauseFrostLinger);
  startUnpauseFrostLingerRef.current = startUnpauseFrostLinger;

  /**
   * When App changes `initialLesson` (navigation / auth return), follow it.
   * Do not re-sync when only `currentLesson` diverges — the user may have picked another chapter in the sidebar
   * while `initialLesson` stays the overview “started” lesson.
   */
  const initialLessonIdFromParentRef = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const fromParent = initialLesson?.id;
    const prevParent = initialLessonIdFromParentRef.current;
    if (fromParent === prevParent) return;
    initialLessonIdFromParentRef.current = fromParent;
    if (fromParent === undefined) return;
    const match = courseRef.current.modules.flatMap((m) => m.lessons).find((l) => l.id === fromParent);
    if (!match || match.id === currentLesson.id) return;
    flushCurrentLessonProgress();
    stopPlayback();
    playNextAfterEndRef.current = false;
    setCurrentLesson(match);
  }, [initialLesson?.id, course.id, currentLesson.id, flushCurrentLessonProgress, stopPlayback]);

  useLayoutEffect(() => {
    if (wasActuallyFinishedOnOpenRef.current) return;
    if (!mediaPaused) return;
    if (!isCourseReadyToFinalize(course, progressByLesson)) return;
    /* After rating / remind-later, only last-lesson end paths should call finalize — not every pause. */
    if (hasRatedOrDismissed(course.id, progressUserId)) return;
    finalizeStrictCourseCompletion(course, progressByLesson);
  }, [course, progressByLesson, mediaPaused, progressUserId, finalizeStrictCourseCompletion]);

  useEffect(() => {
    const m = loadLessonProgressMap(course.id, progressUserId);
    setProgressByLesson(m);
    const o: Record<string, { t: number; d: number }> = {};
    for (const id of Object.keys(m)) {
      o[id] = { t: m[id].currentTime, d: m[id].duration };
    }
    lastKnownProgressByLessonRef.current = o;

    // Load from Firestore if logged in
    if (progressUserId) {
      loadProgressFromFirestore(course.id, progressUserId).then((remote) => {
        if (!remote) return;
        if (remote.completedAtMs != null) {
          mergeCompletionTimestampFromRemote(course.id, progressUserId, remote.completedAtMs);
        }
        if (Object.keys(remote.lessonProgress).length === 0) return;
        setProgressByLesson((prev) => {
          const next = { ...prev, ...remote.lessonProgress };
          try {
            localStorage.setItem(progressStorageKey(course.id, progressUserId), JSON.stringify(next));
          } catch {
            /* ignore */
          }
          return next;
        });
      });
    }
  }, [course.id, progressUserId]);

  useEffect(() => {
    if (!progressUserId) return;
    let cancelled = false;
    loadCourseRatingFromFirestore(course.id, progressUserId).then((remote) => {
      if (cancelled || !remote) return;
      saveCourseRating(course.id, remote, progressUserId, { skipFirestoreSync: true });
    });
    return () => {
      cancelled = true;
    };
  }, [course.id, progressUserId]);

  /**
   * Persist lesson progress to Firestore for logged-in users.
   * Flush whenever progress commits (cleanup runs before the next update) and on unmount.
   * A debounced timer alone was wrong: leaving the player cleared the timer without syncing,
   * so progress never reached Firestore if the user exited within 5s of the last update.
   */
  useEffect(() => {
    if (!progressUserId) return;
    return () => {
      void syncProgressToFirestore(course.id, progressUserId, progressByLessonRef.current);
    };
  }, [course.id, progressUserId, progressByLesson]);

  const handleRatingSubmit = () => {
    if (ratingStars === 0) return;
    saveCourseRating(course.id, { stars: ratingStars, comment: ratingComment }, progressUserId);
    setShowRatingPrompt(false);
    try {
      onCourseFinished(course);
    } catch (e) {
      hasTriggeredFinishNavigationRef.current = false;
      console.error(e);
    }
  };

  const handleNativeEnded = () => {
    if (!autoAdvanceRef.current) return;
    goToNextLesson();
  };

  const saveNativeProgressNow = useCallback(() => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
    mergeProgress(currentLesson.id, v.currentTime, v.duration);
  }, [currentLesson.id, mergeProgress]);

  const applyNativeResume = useCallback(() => {
    if (youtubeEmbedUrl) return;
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
    const saved = savedProgressForLesson(currentLesson.id);
    if (!saved || !(saved.duration > 0)) return;
    /* At true end (playback-complete): start at 0 for replay. Otherwise resume saved time. */
    if (isLessonPlaybackComplete(saved)) {
      v.currentTime = 0;
      void v.pause();
      return;
    }
    if (!isTrivialLessonProgress(saved) && saved.currentTime > 0.5) {
      const cap = Math.max(0, v.duration - 0.05);
      v.currentTime = Math.min(saved.currentTime, cap);
    }
  }, [currentLesson.id, savedProgressForLesson, youtubeEmbedUrl]);

  const handleReplayFromStart = useCallback(() => {
    replayUiSuppressedRef.current = true;
    setReplayUiSuppressed(true);
    const lid = currentLesson.id;
    if (youtubeEmbedUrl) {
      const p = ytPlayerRef.current;
      if (!p?.seekTo || !p.getDuration) return;
      try {
        const d = p.getDuration();
        if (!(d > 0)) return;
        mergeProgress(lid, 0, d, { allowDowngradeFromComplete: true });
        p.seekTo(0, true);
        p.playVideo();
      } catch {
        /* ignore */
      }
      return;
    }
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
    mergeProgress(lid, 0, v.duration, { allowDowngradeFromComplete: true });
    v.currentTime = 0;
    void v.play().catch(() => {});
  }, [currentLesson.id, mergeProgress, youtubeEmbedUrl]);

  const handleNativeLoadedMetadata = useCallback(() => {
    if (youtubeEmbedUrl) return;
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
    const saved = savedProgressForLesson(currentLesson.id);
    const alreadyComplete = isLessonPlaybackComplete(saved);
    if (playNextAfterEndRef.current) {
      playNextAfterEndRef.current = false;
      applyNativeResume();
      if (!alreadyComplete) {
        void v.play().catch(() => {});
      }
      return;
    }
    applyNativeResume();
    if (autoAdvanceRef.current && !alreadyComplete) {
      void v.play().catch(() => {});
    }
  }, [applyNativeResume, currentLesson.id, savedProgressForLesson, youtubeEmbedUrl]);

  useEffect(() => {
    const mod = course.modules.find((m) => m.lessons.some((l) => l.id === currentLesson.id));
    if (mod) {
      setExpandedModules((prev) => (prev.includes(mod.id) ? prev : [...prev, mod.id]));
    }
  }, [currentLesson.id, course.id]);

  /**
   * YouTube mutates the host node. Unmounting that div (switching to <video>) while the API still
   * owns children causes React removeChild errors. We keep a stable host + destroy in layout phase.
   */
  useLayoutEffect(() => {
    const videoId = youtubeVideoIdFromUrl(activeVideoUrl);
    const el = ytContainerRef.current;

    if (!videoId || !el) {
      ytPlayerRef.current?.destroy();
      ytPlayerRef.current = null;
      return;
    }

    let cancelled = false;

    loadYoutubeIframeApi().then(() => {
      if (cancelled || !window.YT?.Player) return;
      ytPlayerRef.current?.destroy();
      ytPlayerRef.current = null;

      const chainAutoplay = playNextAfterEndRef.current;
      playNextAfterEndRef.current = false;
      const savedYt = savedProgressForLessonRef.current(lessonRef.current.id);
      const alreadyCompleteYt = isLessonPlaybackComplete(savedYt);
      const shouldAutoplay =
        (chainAutoplay || autoAdvanceRef.current) && !alreadyCompleteYt;

      ytPlayerRef.current = new window.YT.Player(el, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: shouldAutoplay ? 1 : 0,
          cc_lang_pref: youtubeCaptionLangRef.current,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: (ev) => {
            const player = ev.target;
            applyYoutubeCaptionsModule(player, youtubeCaptionsEnabledRef.current, youtubeCaptionLangRef.current);
            try {
              setYtVolume(player.getVolume());
              setYtMuted(player.isMuted());
              const d0 = player.getDuration();
              if (Number.isFinite(d0) && d0 > 0) {
                setYtHudTime({ current: player.getCurrentTime(), duration: d0 });
              }
              const rates = player.getAvailablePlaybackRates();
              if (Array.isArray(rates) && rates.length > 0) {
                setYtPlaybackRates(rates);
              }
              setYtPlaybackRate(player.getPlaybackRate());
            } catch {
              /* ignore */
            }
            const lid = lessonRef.current.id;
            try {
              const d = player.getDuration();
              if (d > 0) {
                setYoutubeResolvedSeconds((prev) => (prev[lid] === d ? prev : { ...prev, [lid]: d }));
              }
            } catch {
              /* ignore */
            }
            const saved = savedProgressForLessonRef.current(lid);
            if (!saved || !(saved.duration > 0)) return;
            try {
              const d = player.getDuration();
              if (!(d > 0)) return;
              if (isLessonPlaybackComplete(saved)) {
                player.seekTo(0, true);
                try {
                  player.pauseVideo();
                } catch {
                  /* ignore */
                }
                return;
              }
              if (!isTrivialLessonProgress(saved) && saved.currentTime > 0.5) {
                const cap = Math.max(0, d - 0.05);
                player.seekTo(Math.min(saved.currentTime, cap), true);
              }
            } catch {
              /* ignore */
            }
          },
          onApiChange: (ev) => {
            applyYoutubeCaptionsModule(ev.target, youtubeCaptionsEnabledRef.current, youtubeCaptionLangRef.current);
          },
          onPlaybackRateChange: (ev) => {
            setYtPlaybackRate(ev.data);
          },
          onStateChange: (e) => {
            const ps = window.YT!.PlayerState;
            const clearYtPauseUiTimer = () => {
              if (ytPauseUiTimerRef.current) {
                clearTimeout(ytPauseUiTimerRef.current);
                ytPauseUiTimerRef.current = null;
              }
            };

            /* Only PLAYING clears pause. BUFFERING during load was hiding the replay CTA on completed lessons. */
            if (e.data === ps.PLAYING) {
              clearYtPauseUiTimer();
              const hadPauseFrost = lessonPlaybackEverStartedRef.current && ytPauseBlurActiveRef.current;
              setLessonPlaybackEverStarted(true);
              setMediaPaused(false);
              setYtPauseBlurActive(false);
              if (hadPauseFrost) {
                startUnpauseFrostLingerRef.current();
              }
            } else if (e.data === ps.PAUSED) {
              clearYtPauseUiTimer();
              clearUnpauseFrostLinger();
              setMediaPaused(true);
              setYtPauseBlurActive(false);
              const player = e.target as unknown as {
                getPlayerState?: () => number;
                getDuration?: () => number;
                getCurrentTime?: () => number;
              };
              ytPauseUiTimerRef.current = window.setTimeout(() => {
                ytPauseUiTimerRef.current = null;
                try {
                  if (player.getPlayerState?.() === ps.PAUSED) {
                    setYtPauseBlurActive(true);
                    try {
                      const d = player.getDuration?.() ?? 0;
                      const curT = player.getCurrentTime?.() ?? 0;
                      if (d > 0) {
                        mergeProgressRef.current(lessonRef.current.id, curT, d);
                      }
                    } catch {
                      /* ignore */
                    }
                  }
                } catch {
                  setYtPauseBlurActive(true);
                }
              }, PAUSE_UI_MIN_MS);
            } else if (e.data === ps.ENDED) {
              clearYtPauseUiTimer();
              clearUnpauseFrostLinger();
              setMediaPaused(true);
              setYtPauseBlurActive(true);
            } else if (e.data !== ps.BUFFERING) {
              clearYtPauseUiTimer();
              clearUnpauseFrostLinger();
              setMediaPaused(true);
              setYtPauseBlurActive(true);
            }

            if (e.data === ps.ENDED) {
              try {
                const player = e.target;
                const d = player.getDuration();
                /* Match native onEnded: full duration so Replay CTA shows when Auto-next is off. */
                if (d > 0) mergeProgressRef.current(lessonRef.current.id, d, d);
              } catch {
                /* ignore */
              }
              const merged = getMergedProgressSnapshotRef.current();
              const hasNext = !!getNextIncompleteLessonAfter(
                courseRef.current,
                lessonRef.current,
                merged
              );
              if (!hasNext && !autoAdvanceRef.current) {
                scheduleFinalizeFromStorageRef.current();
              }
              const willAdvance = autoAdvanceRef.current && hasNext;
              if (!willAdvance) {
                replayUiSuppressedRef.current = false;
                setReplayUiSuppressed(false);
              }
              if (!autoAdvanceRef.current) return;
              goToNextLessonRef.current();
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      if (ytPauseUiTimerRef.current) {
        clearTimeout(ytPauseUiTimerRef.current);
        ytPauseUiTimerRef.current = null;
      }
      clearUnpauseFrostLinger();
      ytPlayerRef.current?.destroy();
      ytPlayerRef.current = null;
    };
  }, [currentLesson.id, activeVideoUrl, clearUnpauseFrostLinger]);

  /** Help YouTube iframe reflow after orientation change without recreating the player. */
  useEffect(() => {
    let rafId: number | null = null;
    const bump = () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        window.dispatchEvent(new Event('resize'));
      });
    };
    window.addEventListener('orientationchange', bump);
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      window.removeEventListener('orientationchange', bump);
    };
  }, []);

  useEffect(() => {
    if (!youtubeEmbedUrl) return;
    applyYoutubeCaptionsModule(ytPlayerRef.current, youtubeCaptionsEnabled, youtubeCaptionLang);
  }, [youtubeCaptionsEnabled, youtubeCaptionLang, youtubeEmbedUrl]);

  useEffect(() => {
    if (!currentLesson.id) return;

    // Reset suggestion state
    setSuggestedUrl('');
    setSuggestionSuccess(false);

    // Only subscribe to votes if user is authenticated (due to security rules)
    if (!user) {
      setUpvotes(0);
      setReports(0);
      setUserVote(null);
      return;
    }

    // Listen for votes
    const votesQuery = query(collection(db, 'votes'), where('lessonId', '==', currentLesson.id));
    const unsubscribe = onSnapshot(votesQuery, (snapshot) => {
      let ups = 0;
      let downs = 0;
      let myVote: 'up' | 'down' | null = null;

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (data.type === 'up') ups++;
        if (data.type === 'down') downs++;
        if (user && data.userId === user.uid) {
          myVote = data.type;
        }
      });

      setUpvotes(ups);
      setReports(downs);
      setUserVote(myVote);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'votes');
    });

    return () => unsubscribe();
  }, [currentLesson.id, user]);

  // Track whether the current signed-in user has an active report for this lesson.
  useEffect(() => {
    if (!currentLesson.id || !user) {
      setHasActiveUserReport(false);
      return;
    }
    const reportQ = query(
      collection(db, 'reports'),
      where('lessonId', '==', currentLesson.id),
      where('userId', '==', user.uid),
      limit(20)
    );
    const unsubscribe = onSnapshot(
      reportQ,
      (snapshot) => {
        setHasActiveUserReport(!snapshot.empty);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'reports');
      }
    );
    return () => unsubscribe();
  }, [currentLesson.id, user]);

  // Listen for user's own suggestion to replace the video URL
  useEffect(() => {
    if (!currentLesson.id || !user) {
      setUserSuggestion(null);
      return;
    }

    const suggestionsQuery = query(
      collection(db, 'suggestions'),
      where('lessonId', '==', currentLesson.id),
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(suggestionsQuery, (snapshot) => {
      if (!snapshot.empty) {
        // Use the most recent suggestion
        const sorted = snapshot.docs.sort((a, b) => {
          const tA = a.data().timestamp?.toMillis() || 0;
          const tB = b.data().timestamp?.toMillis() || 0;
          return tB - tA;
        });
        setUserSuggestion(sorted[0].data().suggestedUrl);
      } else {
        setUserSuggestion(null);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'suggestions');
    });

    return () => unsubscribe();
  }, [currentLesson.id, user]);

  // Listen for user's own customization to replace the video URL
  useEffect(() => {
    if (!currentLesson.id || !user) {
      setCustomVideoUrl(null);
      return;
    }

    const q = query(
      collection(db, 'customizations'),
      where('lessonId', '==', currentLesson.id),
      where('userId', '==', user.uid),
      limit(1)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        setCustomVideoUrl(snapshot.docs[0].data().customUrl);
      } else {
        setCustomVideoUrl(null);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'customizations');
    });

    return () => unsubscribe();
  }, [currentLesson.id, user]);

  useEffect(() => {
    if (user && isVoteLoginModalOpen) {
      setIsVoteLoginModalOpen(false);
      setVoteLoginError(null);
    }
  }, [user, isVoteLoginModalOpen]);

  const handleVote = async (type: 'up' | 'down') => {
    if (!user) {
      setVoteLoginError(null);
      setIsVoteLoginModalOpen(true);
      return;
    }

    try {
      const votesRef = collection(db, 'votes');
      const q = query(votesRef, where('lessonId', '==', currentLesson.id), where('userId', '==', user.uid));
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        const voteDoc = snapshot.docs[0];
        if (voteDoc.data().type === type) {
          // Remove vote if clicking same button
          await deleteDoc(doc(db, 'votes', voteDoc.id));
        } else {
          // Update vote type
          await updateDoc(doc(db, 'votes', voteDoc.id), {
            type,
            timestamp: serverTimestamp()
          });
        }
      } else {
        // Add new vote
        await addDoc(votesRef, {
          lessonId: currentLesson.id,
          userId: user.uid,
          type,
          timestamp: serverTimestamp()
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'votes');
    }
  };

  const handleSubmitSuggestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !suggestedUrl.trim()) return;

    setIsSubmittingSuggestion(true);
    try {
      await addDoc(collection(db, 'suggestions'), {
        lessonId: currentLesson.id,
        userId: user.uid,
        suggestedUrl: suggestedUrl.trim(),
        timestamp: serverTimestamp()
      });

      // Remove downvote if it exists
      const votesRef = collection(db, 'votes');
      const q = query(votesRef, where('lessonId', '==', currentLesson.id), where('userId', '==', user.uid), where('type', '==', 'down'));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        await deleteDoc(doc(db, 'votes', snapshot.docs[0].id));
      }

      setSuggestionSuccess(true);
      setSuggestedUrl('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'suggestions');
    } finally {
      setIsSubmittingSuggestion(false);
    }
  };

  const handleReplaceVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !replaceUrl.trim()) return;

    setIsSubmittingCustomization(true);
    try {
      const customizationsRef = collection(db, 'customizations');
      const q = query(
        customizationsRef,
        where('lessonId', '==', currentLesson.id),
        where('userId', '==', user.uid)
      );
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        await updateDoc(doc(db, 'customizations', snapshot.docs[0].id), {
          customUrl: replaceUrl.trim(),
          timestamp: serverTimestamp()
        });
      } else {
        await addDoc(customizationsRef, {
          lessonId: currentLesson.id,
          userId: user.uid,
          customUrl: replaceUrl.trim(),
          timestamp: serverTimestamp()
        });
      }
      setReplaceUrl('');
      setIsCustomizeModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'customizations');
    } finally {
      setIsSubmittingCustomization(false);
    }
  };

  const handleResetVideo = async () => {
    if (!user) return;
    try {
      // Delete customizations
      const customizationsRef = collection(db, 'customizations');
      const qCust = query(
        customizationsRef,
        where('lessonId', '==', currentLesson.id),
        where('userId', '==', user.uid)
      );
      const snapCust = await getDocs(qCust);
      const deleteCustPromises = snapCust.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deleteCustPromises);
      setCustomVideoUrl(null);

      // Also delete suggestions if they exist (optional, but user said "Revert back to default")
      const suggestionsRef = collection(db, 'suggestions');
      const qSug = query(
        suggestionsRef,
        where('lessonId', '==', currentLesson.id),
        where('userId', '==', user.uid)
      );
      const snapSug = await getDocs(qSug);
      const deleteSugPromises = snapSug.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deleteSugPromises);
      setUserSuggestion(null);
      
      setIsCustomizeModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'customizations');
    }
  };

  const handleReportSubmit = async () => {
    if (!user || !selectedReportReason) return;

    setIsSubmittingReport(true);
    try {
      await addDoc(collection(db, 'reports'), {
        lessonId: currentLesson.id,
        courseId: course.id,
        courseTitle: course.title,
        lessonTitle: currentLesson.title,
        userId: user.uid,
        reason: selectedReportReason,
        details: reportDetails,
        timestamp: serverTimestamp()
      });
      
      // Also mark as downvoted in the votes collection if not already
      if (userVote !== 'down') {
        await handleVote('down');
      }

      setIsReportModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'reports');
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const handleRecallReport = useCallback(async () => {
    if (!user) return;
    setIsRecallingReport(true);
    try {
      const reportsRef = collection(db, 'reports');
      const reportQ = query(
        reportsRef,
        where('lessonId', '==', currentLesson.id),
        where('userId', '==', user.uid)
      );
      const reportSnap = await getDocs(reportQ);
      const deleteReportPromises = reportSnap.docs.map((d) => deleteDoc(d.ref));
      await Promise.all(deleteReportPromises);

      // Reporting currently auto-adds a downvote; recall removes it to fully clear the report signal.
      const votesRef = collection(db, 'votes');
      const voteQ = query(
        votesRef,
        where('lessonId', '==', currentLesson.id),
        where('userId', '==', user.uid),
        where('type', '==', 'down')
      );
      const voteSnap = await getDocs(voteQ);
      const deleteVotePromises = voteSnap.docs.map((d) => deleteDoc(d.ref));
      await Promise.all(deleteVotePromises);
      setIsReportModalOpen(false);
      setReportMode('create');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'reports');
    } finally {
      setIsRecallingReport(false);
    }
  }, [currentLesson.id, user]);

  const closeCustomizeModal = useCallback(() => {
    setIsCustomizeModalOpen(false);
  }, []);

  const closeVoteLoginModal = useCallback(() => {
    setIsVoteLoginModalOpen(false);
    setVoteLoginError(null);
  }, []);

  const closeReportModal = useCallback(() => {
    setIsReportModalOpen(false);
    setReportMode('create');
  }, []);

  const dismissRatingPrompt = useCallback(() => {
    remindLaterCourseRating(course.id, progressUserId);
    setShowRatingPrompt(false);
    try {
      onCourseFinished(course);
    } catch (e) {
      hasTriggeredFinishNavigationRef.current = false;
      console.error(e);
    }
  }, [course, progressUserId, onCourseFinished]);

  const customizePrimaryAction = useCallback(() => {
    const fake = { preventDefault: () => {} } as React.FormEvent<Element>;
    if (customizeTab === 'replace') {
      void handleReplaceVideo(fake);
    } else {
      void handleSubmitSuggestion(fake);
    }
  }, [customizeTab, handleReplaceVideo, handleSubmitSuggestion]);

  const reportPrimaryAction = useCallback(() => {
    if (reportStep === 1) {
      if (selectedReportReason) setReportStep(2);
      return;
    }
    void handleReportSubmit();
  }, [reportStep, selectedReportReason, handleReportSubmit]);

  const voteLoginPrimary = useCallback(async () => {
    if (voteLoginSubmitting) return;
    setVoteLoginError(null);
    setVoteLoginSubmitting(true);
    try {
      await onLogin();
    } catch (e) {
      setVoteLoginError(formatAuthError(e));
    } finally {
      setVoteLoginSubmitting(false);
    }
  }, [voteLoginSubmitting, onLogin]);

  const ratingPrimaryAction = useCallback(() => {
    if (ratingStars > 0) handleRatingSubmit();
    else dismissRatingPrompt();
  }, [ratingStars, handleRatingSubmit, dismissRatingPrompt]);

  const dismissReplayOverlay = useCallback(() => {
    replayUiSuppressedRef.current = true;
    setReplayUiSuppressed(true);
  }, []);

  useDialogKeyboard({
    open: isCustomizeModalOpen,
    onClose: closeCustomizeModal,
    onPrimaryAction: customizePrimaryAction,
  });

  useDialogKeyboard({
    open: isVoteLoginModalOpen,
    onClose: closeVoteLoginModal,
    onPrimaryAction: voteLoginPrimary,
  });

  useDialogKeyboard({
    open: showRatingPrompt,
    onClose: dismissRatingPrompt,
    onPrimaryAction: ratingPrimaryAction,
  });

  useDialogKeyboard({
    open: isReportModalOpen,
    onClose: closeReportModal,
    onPrimaryAction: reportPrimaryAction,
  });

  useDialogKeyboard({
    open: showReplayCta,
    onClose: dismissReplayOverlay,
    onPrimaryAction: handleReplayFromStart,
    closeOnEscape: false,
  });

  useBodyScrollLock(
    isCustomizeModalOpen ||
      isVoteLoginModalOpen ||
      showRatingPrompt ||
      isReportModalOpen ||
      showReplayCta
  );

  const selectLesson = (lesson: Lesson) => {
    if (lesson.id === currentLesson.id) return;
    flushCurrentLessonProgress();
    stopPlayback();
    playNextAfterEndRef.current = false;
    setCurrentLesson(lesson);
  };

  const toggleModule = (id: string) => {
    setExpandedModules((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  };

  const landscapeVideoH = immersiveLayout
    ? 'max-lg:landscape:h-[100dvh] max-lg:landscape:min-h-[100dvh]'
    : 'max-lg:landscape:h-[calc(100dvh-4rem)] max-lg:landscape:min-h-[calc(100dvh-4rem)]';

  return (
    <div
      className={`min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] flex flex-col lg:flex-row transition-[padding-top,colors] duration-300 ease-out ${immersiveLayout ? 'pt-0' : 'pt-16'}`}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={videoAreaRef}
          data-skillstream-video-area
          className={`aspect-video bg-black relative group max-lg:landscape:aspect-auto ${landscapeVideoH} max-lg:landscape:w-full max-lg:landscape:shrink-0 max-lg:landscape:transition-[height,min-height] max-lg:landscape:duration-300 max-lg:landscape:ease-out ${!showTopControls && !mediaPaused ? 'cursor-none' : ''}`}
        >
          <div
            className={`absolute inset-0 overflow-hidden ${youtubeEmbedUrl ? 'z-[1]' : 'hidden'} ${blockPlayerPointerWhilePaused && youtubeEmbedUrl ? 'pointer-events-none' : ''}`}
            aria-hidden={!youtubeEmbedUrl}
          >
            {/*
              Optional top offset via YOUTUBE_EMBED_TOP_CROP_PX (0 = full frame, no picture crop).
            */}
            <div
              ref={ytContainerRef}
              className="absolute left-0 right-0 w-full"
              style={{
                top: -YOUTUBE_EMBED_TOP_CROP_PX,
                height: `calc(100% + ${YOUTUBE_EMBED_TOP_CROP_PX}px)`,
              }}
            />
          </div>
          {youtubeEmbedUrl && (
            <div
              className="absolute inset-0 z-[2] cursor-pointer touch-manipulation"
              aria-hidden
              onClick={handleYoutubeOverlayClick}
              onDoubleClick={handleYoutubeOverlayDoubleClick}
            />
          )}
          <video
            key={currentLesson.id}
            ref={videoRef}
            src={youtubeEmbedUrl ? undefined : activeVideoUrl}
            className={`absolute inset-0 h-full w-full object-contain ${youtubeEmbedUrl ? 'hidden' : 'z-0'}`}
            controls={!youtubeEmbedUrl}
            onLoadedMetadata={handleNativeLoadedMetadata}
            onTimeUpdate={() => {
              const v = videoRef.current;
              if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
              const now = Date.now();
              if (now - nativeProgressThrottleRef.current < 2200) return;
              nativeProgressThrottleRef.current = now;
              mergeProgress(currentLesson.id, v.currentTime, v.duration);
            }}
            onSeeked={saveNativeProgressNow}
            onPlay={() => {
              if (nativePauseUiTimerRef.current) {
                clearTimeout(nativePauseUiTimerRef.current);
                nativePauseUiTimerRef.current = null;
              }
              const hadPauseFrost = lessonPlaybackEverStartedRef.current && nativePauseFrostReadyRef.current;
              setNativePauseFrostReady(false);
              const saved = savedProgressForLesson(currentLesson.id);
              if (isLessonPlaybackComplete(saved) && !replayUiSuppressedRef.current) {
                void videoRef.current?.pause();
                return;
              }
              setLessonPlaybackEverStarted(true);
              setMediaPaused(false);
              if (hadPauseFrost) {
                startUnpauseFrostLinger();
              }
            }}
            onPause={() => {
              if (nativePauseUiTimerRef.current) {
                clearTimeout(nativePauseUiTimerRef.current);
                nativePauseUiTimerRef.current = null;
              }
              clearUnpauseFrostLinger();
              setMediaPaused(true);
              setNativePauseFrostReady(false);
              saveNativeProgressNow();
              nativePauseUiTimerRef.current = window.setTimeout(() => {
                nativePauseUiTimerRef.current = null;
                const v = videoRef.current;
                if (!v || v.paused !== true) return;
                setNativePauseFrostReady(true);
              }, PAUSE_UI_MIN_MS);
            }}
            onEnded={() => {
              if (nativePauseUiTimerRef.current) {
                clearTimeout(nativePauseUiTimerRef.current);
                nativePauseUiTimerRef.current = null;
              }
              clearUnpauseFrostLinger();
              const v = videoRef.current;
              if (v && Number.isFinite(v.duration) && v.duration > 0) {
                mergeProgress(currentLesson.id, v.duration, v.duration);
              }
              setMediaPaused(true);
              setNativePauseFrostReady(true);
              const mergedNative = getMergedProgressSnapshot();
              const hasNextNative = !!getNextIncompleteLessonAfter(
                courseRef.current,
                lessonRef.current,
                mergedNative
              );
              if (!hasNextNative && !autoAdvanceRef.current) {
                scheduleFinalizeFromStorage();
              }
              const willAdvance = autoAdvanceRef.current && hasNextNative;
              if (!willAdvance) {
                replayUiSuppressedRef.current = false;
                setReplayUiSuppressed(false);
              }
              handleNativeEnded();
            }}
          />

          {blockPlayerPointerWhilePaused && (
            <div
              ref={pauseResumeOverlayRef}
              className="absolute inset-0 z-10 cursor-pointer select-none touch-manipulation focus:outline-none"
              role="button"
              tabIndex={0}
              aria-label="Resume playback"
              onPointerDown={(e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                resumeFromPausedOverlay(e);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                resumeFromPausedOverlay(e);
              }}
            />
          )}

          {showPauseFrostBackdrop && (
            <div
              className={`pointer-events-none absolute inset-0 z-20 bg-black/80 backdrop-blur-[28px] supports-[backdrop-filter]:bg-black/70 ${
                youtubeEmbedUrl ? 'flex flex-col' : 'flex items-center justify-center'
              }`}
              aria-hidden="true"
            >
              {youtubeEmbedUrl ? (
                <>
                  {/* Reserve bottom HUD height so “Paused” centers like landscape on all small viewports */}
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
                    {showPauseFrostLabel && (
                      <div
                        className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-white/70 bg-black/30 shadow-lg transition-[width,height,border-width] duration-300 ease-out max-lg:portrait:h-[4.75rem] max-lg:portrait:w-[4.75rem] max-lg:portrait:border-[1.75px] max-lg:landscape:h-14 max-lg:landscape:w-14 max-lg:landscape:border-[1.5px]"
                        role="status"
                      >
                        <p className="text-center text-lg font-semibold tracking-wide text-white drop-shadow-md transition-[font-size] duration-300 ease-out max-lg:portrait:text-sm max-lg:portrait:leading-snug max-lg:landscape:text-xs max-lg:landscape:leading-tight max-lg:landscape:px-1">
                          Paused
                        </p>
                      </div>
                    )}
                  </div>
                  <div
                    className="pointer-events-none shrink-0 max-lg:h-[4.25rem] lg:h-[6.5rem]"
                    aria-hidden
                  />
                </>
              ) : (
                showPauseFrostLabel && (
                  <div
                    className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-white/70 bg-black/30 shadow-lg transition-[width,height,border-width] duration-300 ease-out max-lg:portrait:h-[4.75rem] max-lg:portrait:w-[4.75rem] max-lg:portrait:border-[1.75px] max-lg:landscape:h-14 max-lg:landscape:w-14 max-lg:landscape:border-[1.5px]"
                    role="status"
                  >
                    <p className="text-center text-lg font-semibold tracking-wide text-white drop-shadow-md transition-[font-size] duration-300 ease-out max-lg:portrait:text-sm max-lg:portrait:leading-snug max-lg:landscape:text-xs max-lg:landscape:leading-tight max-lg:landscape:px-1">
                      Paused
                    </p>
                  </div>
                )
              )}
            </div>
          )}

          <div
            className={`pointer-events-none absolute top-1/2 z-[22] -translate-y-1/2 transition-opacity duration-200 ${
              seekNudgeSeconds > 0 ? 'right-5' : 'left-5'
            } ${seekNudgeVisible ? 'opacity-100' : 'opacity-0'}`}
            aria-hidden="true"
          >
            <div
              className={`rounded-full border border-white/40 bg-black/55 px-6 py-3 text-2xl font-semibold text-white shadow-lg transition-transform duration-200 max-lg:portrait:px-4 max-lg:portrait:py-2 max-lg:portrait:text-lg max-lg:landscape:px-4 max-lg:landscape:py-2 max-lg:landscape:text-base ${
                seekNudgeVisible ? 'scale-100' : 'scale-95'
              }`}
            >
              {seekNudgeSeconds > 0 ? `+${seekNudgeSeconds}` : `${seekNudgeSeconds}`}
            </div>
          </div>

          {showReplayCta && (
            <div
              className="absolute inset-0 z-30 flex cursor-default items-center justify-center bg-black/80 backdrop-blur-[28px] supports-[backdrop-filter]:bg-black/70"
              role="dialog"
              aria-modal="true"
              aria-label="Lesson completed"
            >
              <div className="flex max-w-sm flex-col items-center gap-4 px-6 text-center">
                <p className="text-sm font-medium text-white/90">Finished this lesson — replay from the start?</p>
                <button
                  type="button"
                  onClick={handleReplayFromStart}
                  className="flex items-center gap-2 rounded-full bg-orange-500 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-black/30 transition-colors hover:bg-orange-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                >
                  <RotateCcw size={18} aria-hidden />
                  Replay from start
                </button>
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-between gap-4 px-4 pt-4 transition-[padding] duration-300 ease-out max-lg:px-2 max-lg:pt-2 lg:px-4 lg:pt-4">
            <div
              className={`flex w-full items-start justify-end gap-4 transition-opacity duration-200 ease-out ${
                showTopControls ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
              }`}
            >
              <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5 text-white backdrop-blur-sm transition-[padding,gap] duration-300 ease-out max-lg:gap-1 max-lg:px-2 max-lg:py-1 max-lg:shadow-none lg:gap-2 lg:px-3 lg:py-1.5">
                <span className="text-xs max-lg:text-[10px] max-lg:leading-none lg:leading-normal">Auto-next</span>
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={autoAdvance}
                  onChange={(e) => setAutoAdvance(e.target.checked)}
                />
                <span
                  className="relative inline-flex h-6 w-11 shrink-0 rounded-full bg-white/20 transition-[width,height,transform] duration-300 ease-out peer-checked:bg-orange-500 peer-focus-visible:ring-2 peer-focus-visible:ring-orange-400 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-black peer-checked:[&>span]:translate-x-5 max-lg:h-5 max-lg:w-9 max-lg:peer-checked:[&>span]:translate-x-4 max-lg:peer-focus-visible:ring-offset-0"
                  aria-hidden
                >
                  <span className="pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-300 ease-out max-lg:top-px max-lg:left-px max-lg:h-4 max-lg:w-4" />
                </span>
              </label>
            </div>
          </div>

          {youtubeEmbedUrl && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-8 transition-[padding] duration-300 ease-out max-lg:portrait:px-3 max-lg:portrait:pb-2.5 max-lg:portrait:pt-6 max-lg:landscape:px-2 max-lg:landscape:pb-2 max-lg:landscape:pt-4">
              <div
                className={`mb-2 flex w-full flex-col gap-0 transition-opacity duration-200 ease-out max-lg:portrait:mb-1.5 max-lg:landscape:mb-1 ${
                  showTopControls ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
                }`}
              >
                <p className="sr-only" id="yt-seek-label">
                  Seek video position
                </p>
                <div className="flex w-full items-center py-1.5 max-lg:portrait:py-1 max-lg:landscape:py-0.5">
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, ytHudTime.duration)}
                    step={0.25}
                    value={
                      ytSeekDragging
                        ? Math.min(ytSeekDragSeconds, Math.max(0, ytHudTime.duration))
                        : Math.min(ytHudTime.current, Math.max(0, ytHudTime.duration))
                    }
                    disabled={!(ytHudTime.duration > 0)}
                    aria-labelledby="yt-seek-label"
                    aria-valuemin={0}
                    aria-valuemax={Math.floor(ytHudTime.duration)}
                    aria-valuenow={Math.floor(
                      ytSeekDragging ? ytSeekDragSeconds : ytHudTime.current
                    )}
                    onPointerDown={(e) => {
                      clearChromeHideTimer();
                      setChromeVisible(true);
                      ytPointerSeekRef.current = true;
                      setYtSeekDragging(true);
                      try {
                        e.currentTarget.setPointerCapture(e.pointerId);
                      } catch {
                        /* ignore */
                      }
                      const p = ytPlayerRef.current as { getCurrentTime?: () => number } | null;
                      try {
                        setYtSeekDragSeconds(p?.getCurrentTime?.() ?? ytHudTime.current);
                      } catch {
                        setYtSeekDragSeconds(ytHudTime.current);
                      }
                    }}
                    onInput={(e) => {
                      const v = Number((e.target as HTMLInputElement).value);
                      setYtSeekDragSeconds(v);
                      if (!ytPointerSeekRef.current) {
                        commitYtSeek(v);
                      }
                    }}
                    onPointerUp={(e) => {
                      try {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      } catch {
                        /* ignore */
                      }
                      if (ytPointerSeekRef.current) {
                        ytPointerSeekRef.current = false;
                        commitYtSeek(Number((e.target as HTMLInputElement).value));
                      }
                    }}
                    onPointerCancel={(e) => {
                      try {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      } catch {
                        /* ignore */
                      }
                      ytPointerSeekRef.current = false;
                      setYtSeekDragging(false);
                    }}
                    className="h-1.5 w-full cursor-pointer accent-orange-500 disabled:cursor-not-allowed disabled:opacity-40 max-lg:landscape:h-1"
                  />
                </div>
              </div>
              <div
                className={`flex w-full items-center justify-between gap-2 transition-opacity duration-200 ease-out max-lg:portrait:gap-2 max-lg:landscape:gap-1.5 sm:gap-3 ${
                  showTopControls ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
                }`}
              >
                <p
                  className="shrink-0 font-mono tabular-nums text-white drop-shadow-md text-xs max-lg:portrait:text-[11px] max-lg:portrait:leading-tight max-lg:landscape:text-[10px] max-lg:landscape:leading-none"
                  aria-live="polite"
                >
                  <span className="text-white/95">
                    {formatYtClock(ytSeekDragging ? ytSeekDragSeconds : ytHudTime.current)}
                  </span>
                  <span className="text-white/60"> / </span>
                  <span className="text-white/80">{formatYtClock(ytHudTime.duration)}</span>
                </p>
                <div className="flex min-w-0 max-w-[72%] items-center gap-2 sm:max-w-md max-lg:portrait:max-w-[76%] max-lg:portrait:gap-1.5 max-lg:landscape:max-w-[78%] max-lg:landscape:gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setYoutubeCaptionsEnabled((prev) => {
                        const next = !prev;
                        writeYoutubeCaptionsPreference(next);
                        return next;
                      });
                    }}
                    className={`rounded-md p-1.5 text-white transition-[padding] duration-300 ease-out hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 max-lg:portrait:p-1 max-lg:landscape:p-1 ${
                      youtubeCaptionsEnabled ? 'bg-white/15' : ''
                    }`}
                    aria-pressed={youtubeCaptionsEnabled}
                    aria-label={youtubeCaptionsEnabled ? 'Turn off captions' : 'Turn on captions'}
                  >
                    <span className="flex h-5 w-5 select-none items-center justify-center text-[10px] font-bold leading-none tracking-tight max-lg:portrait:h-[18px] max-lg:portrait:w-[18px] max-lg:portrait:text-[9px] max-lg:landscape:h-4 max-lg:landscape:w-4 max-lg:landscape:text-[9px]">
                      CC
                    </span>
                  </button>
                  <div className="relative shrink-0" ref={ytSettingsPanelRef}>
                    <button
                      type="button"
                      onClick={() => {
                        setYtSettingsOpen((o) => {
                          const next = !o;
                          if (next) {
                            refreshYtPlayerSettings();
                          }
                          return next;
                        });
                      }}
                      className={`rounded-md p-1.5 text-white transition-[padding] duration-300 ease-out hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 max-lg:portrait:p-1 max-lg:landscape:p-1 ${
                        ytSettingsOpen ? 'bg-white/15' : ''
                      }`}
                      aria-expanded={ytSettingsOpen}
                      aria-haspopup="true"
                      aria-label="Player settings"
                    >
                      <Cog
                        size={20}
                        className="max-lg:portrait:h-[18px] max-lg:portrait:w-[18px] max-lg:landscape:h-4 max-lg:landscape:w-4"
                        aria-hidden
                      />
                    </button>
                    <AnimatePresence>
                      {ytSettingsOpen && (
                        <motion.div
                          role="dialog"
                          aria-label="Playback speed"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 6 }}
                          transition={{ duration: 0.15 }}
                          className="absolute bottom-full right-0 z-50 mb-2 w-[min(calc(100vw-2rem),200px)] overflow-hidden rounded-2xl border border-white/[0.09] bg-[#141414]/[0.97] py-2 text-white shadow-[0_12px_40px_rgba(0,0,0,0.55)] ring-1 ring-black/20 backdrop-blur-xl"
                        >
                          <div className="flex items-center gap-1 px-2 pb-2 pt-0.5">
                            <button
                              type="button"
                              aria-label="Close settings"
                              onClick={() => setYtSettingsOpen(false)}
                              className="-ml-0.5 shrink-0 rounded-lg p-1.5 text-white/75 transition-colors hover:bg-white/[0.08] hover:text-white"
                            >
                              <ChevronLeft size={18} strokeWidth={2} aria-hidden />
                            </button>
                            <span className="min-w-0 truncate text-[12px] font-semibold tracking-wide text-white/[0.92]">
                              Playback speed
                            </span>
                          </div>
                          <div
                            className="mx-1 max-h-[min(92vh,26rem)] space-y-0.5 overflow-y-auto overscroll-contain px-1 pb-1 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.12)_transparent]"
                            role="listbox"
                            aria-label="Speed options"
                          >
                            {ytPlaybackRates.map((r) => {
                              const selected = ytPlaybackRate === r;
                              return (
                                <button
                                  key={r}
                                  type="button"
                                  role="option"
                                  aria-selected={selected}
                                  onClick={() => handleYtPlaybackRateSelect(r)}
                                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] tabular-nums transition-colors ${
                                    selected
                                      ? 'bg-orange-500/[0.14] text-white ring-1 ring-orange-400/25'
                                      : 'text-white/[0.88] hover:bg-white/[0.06] hover:text-white'
                                  }`}
                                >
                                  <span className="min-w-0">{formatYtSpeedLabel(r)}</span>
                                  {selected && (
                                    <Check
                                      className="shrink-0 text-orange-400"
                                      size={15}
                                      strokeWidth={2.5}
                                      aria-hidden
                                    />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <button
                    type="button"
                    onClick={handleYtMuteToggle}
                    className="shrink-0 rounded-md p-1.5 text-white transition-[padding] duration-300 ease-out hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 max-lg:portrait:p-1 max-lg:landscape:p-1"
                    aria-label={ytMuted ? 'Unmute' : 'Mute'}
                  >
                    {ytMuted ? (
                      <VolumeX
                        size={20}
                        className="max-lg:portrait:h-[18px] max-lg:portrait:w-[18px] max-lg:landscape:h-4 max-lg:landscape:w-4"
                        aria-hidden
                      />
                    ) : (
                      <Volume2
                        size={20}
                        className="max-lg:portrait:h-[18px] max-lg:portrait:w-[18px] max-lg:landscape:h-4 max-lg:landscape:w-4"
                        aria-hidden
                      />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={ytMuted ? 0 : ytVolume}
                    onChange={(e) => handleYtVolumeSlider(Number(e.target.value))}
                    className="h-1.5 w-full min-w-[72px] cursor-pointer accent-orange-500 transition-[height] duration-300 ease-out sm:min-w-[100px] max-lg:portrait:min-w-[64px] max-lg:landscape:h-1 max-lg:landscape:min-w-[56px]"
                    aria-label="Volume"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

          <div className="p-8 max-w-4xl">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="text-3xl font-bold text-[var(--text-primary)]">{currentLesson.title}</h1>
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    customVideoUrl 
                      ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' 
                      : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-color)]'
                  }`}>
                    {customVideoUrl ? 'Your version' : 'Default'}
                  </span>
                </div>
                <p className="text-[var(--text-secondary)] text-sm">
                  {currentModule?.title} • {lessonDurationLabel(currentLesson)}
                </p>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsCustomizeModalOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-full border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--hover-bg)] transition-all text-sm font-bold"
                >
                  <Settings2 size={18} />
                  Customize
                </button>

                <div className="h-8 w-[1px] bg-[var(--border-color)] mx-1" />

                <button
                  onClick={() => handleVote('up')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all ${
                    userVote === 'up' 
                      ? 'bg-orange-500 border-orange-500 text-white' 
                      : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-orange-500/50'
                  }`}
                >
                  <ThumbsUp size={18} />
                  <span className="text-sm font-bold">{upvotes}</span>
                </button>
                <button
                  onClick={() => {
                    if (hasActiveUserReport) {
                      setReportMode('recall');
                      setIsReportModalOpen(true);
                      return;
                    }
                    setReportMode('create');
                    setIsReportModalOpen(true);
                    setReportStep(1);
                    setSelectedReportReason(null);
                    setReportDetails('');
                  }}
                  disabled={isRecallingReport}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all ${
                    hasActiveUserReport
                      ? 'bg-red-500 border-red-500 text-white' 
                      : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-red-500/50'
                  } ${isRecallingReport ? 'opacity-60 cursor-not-allowed' : ''}`}
                  title={hasActiveUserReport ? 'Click to recall your report' : 'Report an issue'}
                >
                  <Flag size={18} />
                  <span className="text-sm font-bold">
                    {isRecallingReport ? 'Recalling...' : hasActiveUserReport ? 'Reported' : 'Report'}
                  </span>
                </button>
              </div>
            </div>

            <AnimatePresence>
              {isCustomizeModalOpen && (
                <div
                  className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="player-customize-title"
                >
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl"
                  >
                    <div className="p-6 border-b border-[var(--border-color)] flex items-center justify-between">
                      <h2 id="player-customize-title" className="text-xl font-bold text-[var(--text-primary)]">
                        Customize Lesson
                      </h2>
                      <button
                        type="button"
                        onClick={closeCustomizeModal}
                        className="p-2 hover:bg-[var(--hover-bg)] rounded-full transition-colors"
                      >
                        <X size={20} />
                      </button>
                    </div>

                    <div className="flex border-b border-[var(--border-color)]">
                      <button
                        onClick={() => setCustomizeTab('replace')}
                        className={`flex-1 py-4 text-sm font-bold transition-colors relative ${
                          customizeTab === 'replace' ? 'text-orange-500' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        Replace Video
                        {customizeTab === 'replace' && (
                          <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />
                        )}
                      </button>
                      <button
                        onClick={() => setCustomizeTab('suggest')}
                        className={`flex-1 py-4 text-sm font-bold transition-colors relative ${
                          customizeTab === 'suggest' ? 'text-orange-500' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        Suggest Video
                        {customizeTab === 'suggest' && (
                          <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />
                        )}
                      </button>
                    </div>

                    <div className="p-6">
                      {customizeTab === 'replace' ? (
                        <div className="space-y-6">
                          <div>
                            <label className="block text-sm font-bold text-[var(--text-primary)] mb-2">Personal YouTube URL</label>
                            <form onSubmit={handleReplaceVideo} className="space-y-4">
                              <input
                                type="url"
                                required
                                placeholder="https://www.youtube.com/watch?v=..."
                                value={replaceUrl}
                                onChange={(e) => setReplaceUrl(e.target.value)}
                                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500/50"
                              />
                              
                              {(() => {
                                const replaceVid = youtubeVideoIdFromUrl(replaceUrl);
                                return replaceUrl && replaceVid ? (
                                  <div className="aspect-video rounded-xl overflow-hidden border border-[var(--border-color)] bg-black relative">
                                    <iframe
                                      src={youtubeEmbedSrcForVideoId(replaceVid)}
                                      title="YouTube preview"
                                      className="absolute left-0 right-0 w-full border-0"
                                      style={{
                                        top: -YOUTUBE_EMBED_TOP_CROP_PX,
                                        height: `calc(100% + ${YOUTUBE_EMBED_TOP_CROP_PX}px)`,
                                      }}
                                      allowFullScreen
                                    />
                                  </div>
                                ) : null;
                              })()}

                              <div className="flex gap-3">
                                <button
                                  type="submit"
                                  disabled={isSubmittingCustomization}
                                  className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white py-3 rounded-xl text-sm font-bold transition-colors"
                                >
                                  {isSubmittingCustomization ? 'Saving...' : 'Use this video'}
                                </button>
                                {customVideoUrl && (
                                  <button
                                    type="button"
                                    onClick={handleResetVideo}
                                    className="px-6 border border-red-500/30 text-red-500 hover:bg-red-500/10 rounded-xl text-sm font-bold transition-colors"
                                  >
                                    Reset
                                  </button>
                                )}
                              </div>
                            </form>
                          </div>
                          <div className="flex items-start gap-3 p-4 bg-orange-500/5 border border-orange-500/10 rounded-xl">
                            <Info size={18} className="text-orange-500 shrink-0 mt-0.5" />
                            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                              Replacing the video will only change it for your account. Other students will still see the default version.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-6">
                          <div>
                            <label className="block text-sm font-bold text-[var(--text-primary)] mb-2">Suggest for others</label>
                            <form onSubmit={handleSubmitSuggestion} className="space-y-4">
                              <input
                                type="url"
                                required
                                placeholder="https://www.youtube.com/watch?v=..."
                                value={suggestedUrl}
                                onChange={(e) => setSuggestedUrl(e.target.value)}
                                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500/50"
                              />
                              
                              {(() => {
                                const suggestedVid = youtubeVideoIdFromUrl(suggestedUrl);
                                return suggestedUrl && suggestedVid ? (
                                  <div className="aspect-video rounded-xl overflow-hidden border border-[var(--border-color)] bg-black relative">
                                    <iframe
                                      src={youtubeEmbedSrcForVideoId(suggestedVid)}
                                      title="YouTube preview"
                                      className="absolute left-0 right-0 w-full border-0"
                                      style={{
                                        top: -YOUTUBE_EMBED_TOP_CROP_PX,
                                        height: `calc(100% + ${YOUTUBE_EMBED_TOP_CROP_PX}px)`,
                                      }}
                                      allowFullScreen
                                    />
                                  </div>
                                ) : null;
                              })()}

                              <button
                                type="submit"
                                disabled={isSubmittingSuggestion}
                                className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white py-3 rounded-xl text-sm font-bold transition-colors"
                              >
                                {isSubmittingSuggestion ? 'Submitting...' : 'Submit Suggestion'}
                              </button>
                            </form>
                          </div>
                          {suggestionSuccess && (
                            <motion.div
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="flex items-center gap-2 text-green-500 font-medium justify-center"
                            >
                              <CheckCircle2 size={20} />
                              Suggestion received!
                            </motion.div>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {isVoteLoginModalOpen && (
                <div
                  className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="player-vote-login-title"
                >
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl"
                  >
                    <div className="p-6 border-b border-[var(--border-color)] flex items-center justify-between">
                      <h2 id="player-vote-login-title" className="text-xl font-bold text-[var(--text-primary)]">
                        Sign in to vote
                      </h2>
                      <button
                        type="button"
                        onClick={closeVoteLoginModal}
                        className="p-2 hover:bg-[var(--hover-bg)] rounded-full transition-colors"
                      >
                        <X size={20} />
                      </button>
                    </div>
                    <div className="p-6 space-y-4">
                      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                        Voting on lessons requires a Google account. Continue to sign in; if a popup is blocked, you will be redirected to Google instead.
                      </p>
                      {voteLoginError && (
                        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                          <span>{voteLoginError}</span>
                        </div>
                      )}
                      <button
                        type="button"
                        disabled={voteLoginSubmitting}
                        onClick={() => void voteLoginPrimary()}
                        className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white py-3 rounded-xl text-sm font-bold transition-colors"
                      >
                        <LogIn size={18} />
                        {voteLoginSubmitting ? 'Signing in…' : 'Continue with Google'}
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {showRatingPrompt && (
                <div
                  className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="player-rating-title"
                >
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-3xl w-full max-w-md overflow-hidden shadow-2xl p-8"
                  >
                    <div className="text-center mb-8">
                      <div className="w-16 h-16 bg-orange-500/10 rounded-2xl flex items-center justify-center text-orange-500 mx-auto mb-4">
                        <Star size={32} fill="currentColor" />
                      </div>
                      <h2 id="player-rating-title" className="text-2xl font-bold text-[var(--text-primary)] mb-2">
                        Course Completed!
                      </h2>
                      <p className="text-[var(--text-secondary)]">How would you rate this course?</p>
                    </div>

                    <div className="flex flex-col items-center gap-2 mb-8">
                      <div className="flex justify-center gap-2">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            onClick={() => setRatingStars(star)}
                            onMouseEnter={() => setHoverStars(star)}
                            onMouseLeave={() => setHoverStars(0)}
                            className="p-1 transition-transform hover:scale-110"
                          >
                            <Star
                              size={36}
                              className={star <= (hoverStars || ratingStars) ? 'text-orange-500' : 'text-[var(--border-color)]'}
                              fill={star <= (hoverStars || ratingStars) ? 'currentColor' : 'none'}
                            />
                          </button>
                        ))}
                      </div>
                      <div className="h-7 flex items-center justify-center">
                        <AnimatePresence mode="wait">
                          {(hoverStars || ratingStars) > 0 && (
                            <motion.p
                              key={hoverStars || ratingStars}
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -5 }}
                              className="text-xl font-bold text-orange-500"
                            >
                              {RATING_LABELS[hoverStars || ratingStars]}
                            </motion.p>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>

                    <textarea
                      value={ratingComment}
                      onChange={(e) => setRatingComment(e.target.value)}
                      placeholder="Optional: Share your thoughts..."
                      className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500/50 min-h-[100px] resize-none mb-6"
                    />

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={dismissRatingPrompt}
                        className="flex-1 border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--hover-bg)] py-3 rounded-xl text-sm font-bold transition-colors"
                      >
                        Maybe later
                      </button>
                      <button
                        type="button"
                        onClick={handleRatingSubmit}
                        disabled={ratingStars === 0}
                        className="flex-[2] bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white py-3 rounded-xl text-sm font-bold transition-colors"
                      >
                        Submit Rating
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {isReportModalOpen && (
                <div
                  className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="player-report-title"
                >
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl"
                  >
                    <div className="p-6 border-b border-[var(--border-color)] flex items-center justify-between">
                      <h2 id="player-report-title" className="text-xl font-bold text-[var(--text-primary)]">
                        Report
                      </h2>
                      <button
                        type="button"
                        onClick={closeReportModal}
                        className="p-2 hover:bg-[var(--hover-bg)] rounded-full transition-colors"
                      >
                        <X size={20} />
                      </button>
                    </div>

                    <div className="p-8">
                      {reportMode === 'recall' ? (
                        <div className="space-y-6">
                          <div>
                            <h3 className="text-lg font-bold text-[var(--text-primary)] mb-2">Recall your report?</h3>
                            <p className="text-sm text-[var(--text-secondary)] mb-6">
                              We&apos;ll remove your report for this lesson. You can report it again anytime.
                            </p>
                          </div>
                          <div className="flex gap-3">
                            <button
                              onClick={closeReportModal}
                              disabled={isRecallingReport}
                              className="flex-1 border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--hover-bg)] disabled:opacity-60 py-3 rounded-xl text-sm font-bold transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => void handleRecallReport()}
                              disabled={isRecallingReport}
                              className="flex-[2] bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white py-3 rounded-xl text-sm font-bold transition-colors"
                            >
                              {isRecallingReport ? 'Recalling...' : 'Recall report'}
                            </button>
                          </div>
                        </div>
                      ) : reportStep === 1 ? (
                        <div className="space-y-6">
                          <div>
                            <h3 className="text-lg font-bold text-[var(--text-primary)] mb-2">What's going on?</h3>
                            <p className="text-sm text-[var(--text-secondary)] mb-6">
                              We'll check for all Community Guidelines, so don't worry about making the perfect choice.
                            </p>
                            
                            <div className="space-y-2">
                              {['Technical issue', 'Misinformation', 'Spam or misleading', 'Legal issue', 'Confusing'].map((reason) => (
                                <button
                                  key={reason}
                                  onClick={() => setSelectedReportReason(reason)}
                                  className={`w-full text-left px-4 py-3 rounded-xl border transition-all text-sm font-medium ${
                                    selectedReportReason === reason
                                      ? 'bg-orange-500/10 border-orange-500 text-orange-500'
                                      : 'border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--hover-bg)]'
                                  }`}
                                >
                                  {reason}
                                </button>
                              ))}
                            </div>
                          </div>

                          <button
                            onClick={() => setReportStep(2)}
                            disabled={!selectedReportReason}
                            className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white py-3 rounded-xl text-sm font-bold transition-colors"
                          >
                            Next
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-6">
                          <div>
                            <h3 className="text-lg font-bold text-[var(--text-primary)] mb-2">Want to tell us more? It's optional</h3>
                            <p className="text-sm text-[var(--text-secondary)] mb-6">
                              Sharing a few details can help us understand the issue. Please don't include personal info or questions.
                            </p>
                            
                            <textarea
                              value={reportDetails}
                              onChange={(e) => setReportDetails(e.target.value)}
                              placeholder="Add details..."
                              className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500/50 min-h-[120px] resize-none"
                            />
                          </div>

                          <div className="flex gap-3">
                            <button
                              onClick={() => setReportStep(1)}
                              className="flex-1 border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--hover-bg)] py-3 rounded-xl text-sm font-bold transition-colors"
                            >
                              Back
                            </button>
                            <button
                              onClick={handleReportSubmit}
                              disabled={isSubmittingReport}
                              className="flex-[2] bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white py-3 rounded-xl text-sm font-bold transition-colors"
                            >
                              {isSubmittingReport ? 'Reporting...' : 'Report'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            <div className="flex flex-wrap items-center gap-4 text-[var(--text-secondary)] text-sm mb-8">
            <span className="bg-[var(--hover-bg)] px-2 py-1 rounded">Lesson {currentLesson.id}</span>
            <span>{lessonDurationLabel(currentLesson)}</span>
            <span className="text-orange-500 font-semibold">{course.title}</span>
          </div>

          <div className="prose prose-invert max-w-none">
            <h2 className="text-xl font-semibold mb-1 text-[var(--text-primary)]">About this lesson</h2>
            {currentModule && (
              <p className="text-sm font-medium text-[var(--text-primary)] mb-2 not-prose">
                Section: <span className="text-orange-500">{currentModule.title}</span>
              </p>
            )}
            <p
              key={currentLesson.id}
              className="text-[var(--text-secondary)] leading-relaxed not-prose mb-0"
            >
              {currentLesson.about ?? aboutFallback}
            </p>
          </div>
        </div>
      </div>

      <div
        className={`w-full lg:w-[400px] border-l border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-y-auto transition-colors duration-300 ${immersiveLayout ? 'max-h-[100dvh]' : 'max-h-[calc(100dvh-4rem)]'}`}
      >
        <div className="p-6 border-b border-[var(--border-color)]">
          <h2 className="font-bold text-lg text-[var(--text-primary)]">Course Content</h2>
          <div className="text-sm text-[var(--text-secondary)] mt-1">
            {course.modules.length} modules • {course.modules.reduce((acc, m) => acc + m.lessons.length, 0)} lessons
          </div>
        </div>

        <div className="divide-y divide-[var(--border-color)]">
          {course.modules.map((module, idx) => (
            <div key={module.id} className="flex flex-col">
              <button
                onClick={() => toggleModule(module.id)}
                className="flex items-center justify-between p-4 hover:bg-[var(--hover-bg)] transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[var(--text-secondary)] font-mono text-sm">{String(idx + 1).padStart(2, '0')}</span>
                  <span className="font-semibold text-sm text-[var(--text-primary)]">{module.title}</span>
                </div>
                {expandedModules.includes(module.id) ? (
                  <ChevronDown size={18} className="text-[var(--text-secondary)]" />
                ) : (
                  <ChevronRight size={18} className="text-[var(--text-secondary)]" />
                )}
              </button>

              <AnimatePresence>
                {expandedModules.includes(module.id) && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden bg-black/5"
                  >
                    {module.lessons.map((lesson) => {
                      const pct = progressPercent(progressByLesson[lesson.id]);
                      const done = isLessonPlaybackComplete(progressByLesson[lesson.id]);
                      return (
                        <button
                          key={lesson.id}
                          onClick={() => selectLesson(lesson)}
                          className={`flex w-full flex-col gap-1.5 p-4 pl-12 text-left text-sm transition-colors hover:bg-[var(--hover-bg)] ${currentLesson.id === lesson.id ? 'bg-orange-500/10 text-orange-500' : 'text-[var(--text-secondary)]'}`}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            {currentLesson.id === lesson.id ? (
                              <Play size={14} fill="currentColor" className="shrink-0" />
                            ) : done ? (
                              <CheckCircle2 size={14} className="shrink-0 text-orange-500/80" />
                            ) : (
                              <CheckCircle2 size={14} className="shrink-0 text-gray-600" />
                            )}
                            <span className="min-w-0 flex-1 truncate font-medium">{lesson.title}</span>
                            <span className="shrink-0 text-xs opacity-60">{lessonDurationLabel(lesson)}</span>
                          </div>
                          <div className="flex w-full items-center gap-2 pl-7">
                            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--hover-bg)]">
                              <div
                                className="h-full rounded-full bg-orange-500 transition-[width] duration-300"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-[var(--text-muted)]">
                              {pct}%
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
