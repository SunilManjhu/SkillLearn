import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Navbar, type NavbarNotification } from './components/Navbar';
import { CourseCard } from './components/CourseCard';
import { CoursePlayer } from './components/CoursePlayer';
import { CourseOverview } from './components/CourseOverview';
import { ProfilePage } from './components/ProfilePage';
import { Certificate } from './components/Certificate';
import { ContactForm } from './components/ContactForm';
import { DemoLearningAgent } from './components/DemoLearningAgent';
import { COURSES, Course, Lesson } from './data/courses';
import { Play, TrendingUp, Award, Users, Globe, ChevronRight, ChevronDown, X, CheckCircle, Mail, LifeBuoy, Briefcase, Shield, Info, Clock, ArrowLeft, LogIn, AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';
import { auth, signInWithGoogle, getRedirectResult, signOut, onAuthStateChanged, User, db, handleFirestoreError, OperationType } from './firebase';
import { collection, query, where, getDocs, addDoc, setDoc, doc, serverTimestamp } from 'firebase/firestore';
import { scrollDocumentToTop } from './utils/scrollDocumentToTop';
import { recordCourseCompletion } from './utils/courseCompletionLog';
import { formatAuthError } from './utils/authErrors';
import { stashAuthReturnState, consumeAuthReturnState, type AuthReturnPayload } from './utils/authReturnContext';
import {
  APP_HISTORY_KEY,
  type AppHistoryPayload,
  buildHistoryUrl,
  historyBackOrFallback,
  historyPayloadsEqual,
  parseHashToPayload,
  readPayloadFromHistoryState,
  resolvePayloadForCourses,
} from './utils/appHistory';

type View = 'home' | 'catalog' | 'player' | 'overview' | 'about' | 'careers' | 'privacy' | 'help' | 'contact' | 'status' | 'enterprise' | 'signup' | 'profile' | 'settings' | 'certificate';

function findLessonById(course: Course, lessonId: string): Lesson | undefined {
  for (const mod of course.modules) {
    const found = mod.lessons.find((l) => l.id === lessonId);
    if (found) return found;
  }
  return undefined;
}

function getInitialRouteState(): {
  view: View;
  selectedCourse: Course | null;
  initialLesson: Lesson | undefined;
} {
  if (typeof window === 'undefined') {
    return { view: 'home', selectedCourse: null, initialLesson: undefined };
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get('cert_id')) {
    return { view: 'home', selectedCourse: null, initialLesson: undefined };
  }
  const parsed = parseHashToPayload(window.location.hash);
  if (!parsed) {
    return { view: 'home', selectedCourse: null, initialLesson: undefined };
  }
  const resolved = resolvePayloadForCourses(parsed, COURSES, findLessonById);

  if (resolved.view === 'overview' || resolved.view === 'player') {
    const c = resolved.courseId ? (COURSES.find((x) => x.id === resolved.courseId) ?? null) : null;
    const l = c && resolved.lessonId ? findLessonById(c, resolved.lessonId) : undefined;
    if (c) {
      return { view: resolved.view as View, selectedCourse: c, initialLesson: l };
    }
    return { view: 'catalog', selectedCourse: null, initialLesson: undefined };
  }

  if (resolved.view === 'certificate') {
    return { view: 'home', selectedCourse: null, initialLesson: undefined };
  }

  return {
    view: resolved.view as View,
    selectedCourse: null,
    initialLesson: undefined,
  };
}

interface CertificateData {
  courseId: string;
  userName: string;
  date: string;
  certificateId: string;
  isPublic: boolean;
}

function PlayerSignInGate({
  courseTitle,
  onBack,
  onLogin,
}: {
  courseTitle: string;
  onBack: () => void;
  onLogin: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] pt-20 px-6 flex flex-col items-center justify-center gap-8 max-w-lg mx-auto text-center">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="self-start flex items-center justify-center rounded-full border border-[var(--border-color)] p-2.5 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] transition-colors"
      >
        <ArrowLeft size={18} aria-hidden />
      </button>
      <div className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight">Sign in to continue</h1>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          Watch lessons and track progress for &ldquo;{courseTitle}&rdquo; with your Google account. After signing in you&apos;ll return to the course overview — start the course when you&apos;re ready.
        </p>
      </div>
      {error && (
        <div className="w-full flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500 text-left">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      <button
        type="button"
        disabled={submitting}
        onClick={async () => {
          setError(null);
          setSubmitting(true);
          try {
            await onLogin();
          } catch (e) {
            setError(formatAuthError(e));
          } finally {
            setSubmitting(false);
          }
        }}
        className="w-full max-w-sm flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white py-3.5 rounded-xl text-sm font-bold transition-colors"
      >
        <LogIn size={18} />
        {submitting ? 'Signing in…' : 'Continue with Google'}
      </button>
    </div>
  );
}

export default function App() {
  const [initialRoute] = useState(() => getInitialRouteState());
  const [currentView, setCurrentView] = useState<View>(initialRoute.view);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(initialRoute.selectedCourse);
  const [initialLesson, setInitialLesson] = useState<Lesson | undefined>(initialRoute.initialLesson);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [showMoreCategories, setShowMoreCategories] = useState(false);
  const [focusedCategoryIndex, setFocusedCategoryIndex] = useState(0);
  const [focusedCourseIndex, setFocusedCourseIndex] = useState(-1);
  const [focusedFooterIndex, setFocusedFooterIndex] = useState(-1);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [certificateData, setCertificateData] = useState<CertificateData | null>(null);
  /** Where to return when closing the certificate view (set synchronously before navigation). */
  const certificateReturnRef = useRef<{ view: View; courseId: string | null } | null>(null);
  const [notifications, setNotifications] = useState<NavbarNotification[]>(() => [
    {
      id: 'welcome',
      message: 'Welcome to SkillStream! Start your first course today.',
      read: false,
      time: 'Now',
      kind: 'generic',
    },
  ]);
  const [completedCoursesModalSignal, setCompletedCoursesModalSignal] = useState(0);
  const [authBanner, setAuthBanner] = useState<string | null>(null);

  const categoryRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const courseRefs = useRef<(HTMLDivElement | null)[]>([]);
  const footerRefs = useRef<(HTMLLIElement | null)[]>([]);
  /** Guest was on the player sign-in gate; after Google sign-in, send them to overview (no auto-play). */
  const returnToOverviewAfterPlayerGateSignInRef = useRef(false);

  /** Skip one History sync cycle (popstate / programmatic replace). */
  const historySkipSyncRef = useRef(false);
  /** Replace current history entry instead of pushing (auth return, completion, etc.). */
  const historyActionRef = useRef<'push' | 'replace'>('push');
  const didInitHistoryRef = useRef(false);

  const buildHistoryPayload = useCallback((): AppHistoryPayload => {
    const p: AppHistoryPayload = { v: 1, view: currentView as AppHistoryPayload['view'] };
    if (currentView === 'overview' || currentView === 'player') {
      p.courseId = selectedCourse?.id ?? null;
      if (currentView === 'player' && initialLesson?.id) {
        p.lessonId = initialLesson.id;
      }
    }
    if (currentView === 'certificate' && certificateData) {
      p.certificate = { ...certificateData };
    }
    return p;
  }, [currentView, selectedCourse?.id, initialLesson?.id, certificateData]);

  const applyHistoryPayload = useCallback((raw: AppHistoryPayload) => {
    const resolved = resolvePayloadForCourses(raw, COURSES, findLessonById);
    historySkipSyncRef.current = true;

    const view = resolved.view as View;

    if (view === 'certificate' && resolved.certificate) {
      setCertificateData({
        courseId: resolved.certificate.courseId,
        userName: resolved.certificate.userName,
        date: resolved.certificate.date,
        certificateId: resolved.certificate.certificateId,
        isPublic: resolved.certificate.isPublic,
      });
    } else {
      setCertificateData(null);
    }

    if (view === 'overview' || view === 'player') {
      const c = resolved.courseId ? (COURSES.find((x) => x.id === resolved.courseId) ?? null) : null;
      setSelectedCourse(c);
      setInitialLesson(c && resolved.lessonId ? findLessonById(c, resolved.lessonId) : undefined);
    } else {
      setSelectedCourse(null);
      setInitialLesson(undefined);
    }

    setCurrentView(view);
    scrollDocumentToTop();
  }, []);

  useLayoutEffect(() => {
    if (didInitHistoryRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('cert_id')) {
      didInitHistoryRef.current = true;
      return;
    }
    didInitHistoryRef.current = true;
    const payload = buildHistoryPayload();
    window.history.replaceState({ [APP_HISTORY_KEY]: payload }, '', buildHistoryUrl(payload));
  }, [buildHistoryPayload]);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const fromState = readPayloadFromHistoryState(e.state);
      const fromHash = parseHashToPayload(window.location.hash);
      const raw = fromState ?? fromHash;
      if (!raw) return;
      applyHistoryPayload(raw);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [applyHistoryPayload]);

  useEffect(() => {
    if (historySkipSyncRef.current) {
      historySkipSyncRef.current = false;
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('cert_id') && currentView === 'certificate' && certificateData?.isPublic) {
      return;
    }

    const payload = buildHistoryPayload();
    const prev = readPayloadFromHistoryState(window.history.state);
    if (historyPayloadsEqual(prev, payload)) {
      return;
    }

    const url = buildHistoryUrl(payload);
    const state = { [APP_HISTORY_KEY]: payload };

    if (historyActionRef.current === 'replace') {
      historyActionRef.current = 'push';
      window.history.replaceState(state, '', url);
      return;
    }

    window.history.pushState(state, '', url);
  }, [buildHistoryPayload, currentView, selectedCourse?.id, initialLesson?.id, certificateData]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (currentView === 'player' && isAuthReady && !user) {
      returnToOverviewAfterPlayerGateSignInRef.current = true;
    }
    if (currentView !== 'player') {
      returnToOverviewAfterPlayerGateSignInRef.current = false;
    }
  }, [currentView, isAuthReady, user]);

  useEffect(() => {
    if (!isAuthReady || !user || currentView !== 'player') return;
    if (!returnToOverviewAfterPlayerGateSignInRef.current) return;
    returnToOverviewAfterPlayerGateSignInRef.current = false;
    historyActionRef.current = 'replace';
    setCurrentView('overview');
    scrollDocumentToTop();
  }, [isAuthReady, user, currentView]);

  useEffect(() => {
    // Handle Public Certificate Links
    const params = new URLSearchParams(window.location.search);
    const certId = params.get('cert_id');
    const certCourse = params.get('cert_course');
    const certUser = params.get('cert_user');
    const certDate = params.get('cert_date');

    if (certId && certCourse && certUser && certDate) {
      certificateReturnRef.current = { view: 'catalog', courseId: null };
      historySkipSyncRef.current = true;
      setCertificateData({
        certificateId: certId,
        courseId: certCourse,
        userName: certUser,
        date: certDate,
        isPublic: true
      });
      setCurrentView('certificate');
      const payload: AppHistoryPayload = {
        v: 1,
        view: 'certificate',
        certificate: {
          courseId: certCourse,
          userName: certUser,
          date: certDate,
          certificateId: certId,
          isPublic: true,
        },
      };
      window.history.replaceState({ [APP_HISTORY_KEY]: payload }, '', buildHistoryUrl(payload));
    }
  }, []);

  const applyAuthReturnPayload = useCallback((payload: AuthReturnPayload | null) => {
    if (!payload) return;
    historyActionRef.current = 'replace';
    if (payload.view === 'pricing') {
      (payload as { view: string }).view = 'contact';
    }
    const course = payload.courseId ? COURSES.find((c) => c.id === payload.courseId) : undefined;

    if (payload.view === 'overview' && course) {
      setSelectedCourse(course);
      setInitialLesson(undefined);
      setCurrentView('overview');
      scrollDocumentToTop();
      return;
    }
    if (payload.view === 'player' && course) {
      setSelectedCourse(course);
      setInitialLesson(
        payload.initialLessonId ? findLessonById(course, payload.initialLessonId) : undefined
      );
      setCurrentView('player');
      scrollDocumentToTop();
      return;
    }

    const simpleViews: View[] = [
      'home',
      'catalog',
      'profile',
      'settings',
      'about',
      'careers',
      'privacy',
      'help',
      'contact',
      'status',
      'enterprise',
      'signup',
    ];
    if (simpleViews.includes(payload.view as View)) {
      setCurrentView(payload.view as View);
      scrollDocumentToTop();
      return;
    }

    if (payload.view === 'certificate') {
      setCurrentView(course ? 'overview' : 'catalog');
      if (course) setSelectedCourse(course);
      scrollDocumentToTop();
    }
  }, []);

  useEffect(() => {
    getRedirectResult(auth)
      .then((cred) => {
        if (cred?.user) {
          setAuthBanner(null);
          const params = new URLSearchParams(window.location.search);
          if (params.get('cert_id')) {
            consumeAuthReturnState();
            return;
          }
          const payload = consumeAuthReturnState();
          applyAuthReturnPayload(payload);
        }
      })
      .catch((err) => {
        console.error('Google redirect sign-in error:', err);
        setAuthBanner(formatAuthError(err));
        consumeAuthReturnState();
      });
  }, [applyAuthReturnPayload]);

  const handleLogin = async () => {
    try {
      setAuthBanner(null);
      await signInWithGoogle(() =>
        stashAuthReturnState({
          view: currentView === 'certificate' ? 'catalog' : currentView,
          courseId: selectedCourse?.id ?? null,
          initialLessonId: initialLesson?.id ?? null,
        })
      );
    } catch (e) {
      consumeAuthReturnState();
      console.error('Login error:', e);
      setAuthBanner(formatAuthError(e));
      throw e;
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      historyActionRef.current = 'replace';
      setCurrentView('home');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const categories = ['All', 'Software Development', 'Cloud Computing', 'Data Science', 'Cybersecurity', 'AI & ML'];
  const moreCategories = ['Business', 'Design', 'Marketing', 'Personal Development'];

  const filteredCourses = COURSES.filter(course => {
    const matchesSearch = course.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      course.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      course.author.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = selectedCategory === 'All' || course.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedCategory('All');
  };

  useEffect(() => {
    if (theme === 'light') {
      document.body.classList.add('light');
    } else {
      document.body.classList.remove('light');
    }
  }, [theme]);

  useEffect(() => {
    if (currentView !== 'profile') {
      setCompletedCoursesModalSignal(0);
    }
  }, [currentView]);

  /** Course overview / player replace the main column; reset document scroll. */
  useLayoutEffect(() => {
    if (currentView === 'overview' || currentView === 'player') {
      scrollDocumentToTop();
    }
  }, [currentView, selectedCourse?.id]);

  const handleNavigate = (view: View, shouldClear = true) => {
    if (shouldClear && (view === 'home' || view === 'catalog' || view === 'contact' || view === 'profile' || view === 'settings')) {
      clearFilters();
      setFocusedCourseIndex(-1);
      setFocusedCategoryIndex(0);
      setFocusedFooterIndex(-1);
    }
    setCurrentView(view);
    scrollDocumentToTop();
  };

  const handleCourseClick = (course: Course, index?: number) => {
    if (index !== undefined) {
      setFocusedCourseIndex(index);
    }
    setSelectedCourse(course);
    setInitialLesson(undefined);
    setCurrentView('overview');
  };

  const handleCertificateNotificationClick = useCallback(() => {
    setCompletedCoursesModalSignal((s) => s + 1);
    setCurrentView('profile');
    scrollDocumentToTop();
  }, []);

  const handleCoursePlayerFinished = useCallback(
    (course: Course) => {
      try {
        recordCourseCompletion(course.id, user?.uid ?? null);
        setNotifications((prev) => [
          {
            id: `certificate-${course.id}-${Date.now()}`,
            kind: 'certificate',
            courseId: course.id,
            message: `Your certificate for "${course.title}" is ready.`,
            read: false,
            time: 'Just now',
          },
          ...prev,
        ]);
      } catch (e) {
        console.error('Course completion side effects failed:', e);
      } finally {
        historyActionRef.current = 'replace';
        setCurrentView('overview');
        scrollDocumentToTop();
      }
    },
    [user?.uid]
  );

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    if (query && currentView !== 'catalog') {
      setCurrentView('catalog');
    }
  };

  const handleCategorySelect = (category: string) => {
    setSearchQuery('');
    setSelectedCategory(category);
    handleNavigate('catalog', false);
  };

  const handlePathSelect = (path: string) => {
    setSearchQuery(path);
    setSelectedCategory('All');
    handleNavigate('catalog', false);
  };

  const handleSkillSelect = (skill: string) => {
    setSearchQuery(skill);
    setSelectedCategory('All');
    handleNavigate('catalog', false);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger navigation if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
          clearFilters();
        }
        return;
      }

      if (e.key === 'Escape') {
        clearFilters();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentView]);

  useEffect(() => {
    if (currentView === 'catalog') {
      // Small timeout to ensure DOM is ready and refs are populated
      const timer = setTimeout(() => {
        if (focusedCourseIndex !== -1 && courseRefs.current[focusedCourseIndex]) {
          courseRefs.current[focusedCourseIndex]?.focus();
        } else if (categoryRefs.current[focusedCategoryIndex]) {
          categoryRefs.current[focusedCategoryIndex]?.focus();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [currentView]);

  const handleCategoryKeyDown = (e: React.KeyboardEvent, index: number) => {
    const allCategoriesCount = categories.length + 1 + (showMoreCategories ? moreCategories.length : 0);
    
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIndex = (index + 1) % allCategoriesCount;
      setFocusedCategoryIndex(nextIndex);
      categoryRefs.current[nextIndex]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIndex = (index - 1 + allCategoriesCount) % allCategoriesCount;
      setFocusedCategoryIndex(prevIndex);
      categoryRefs.current[prevIndex]?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (index === categories.length && !showMoreCategories) {
        setShowMoreCategories(true);
        setTimeout(() => {
          setFocusedCategoryIndex(categories.length + 1);
          categoryRefs.current[categories.length + 1]?.focus();
        }, 0);
      } else if (filteredCourses.length > 0) {
        setFocusedCourseIndex(0);
        courseRefs.current[0]?.focus();
      }
    } else if (e.key === 'Escape') {
      setShowMoreCategories(false);
      setFocusedCategoryIndex(categories.length);
      categoryRefs.current[categories.length]?.focus();
    }
  };

  const handleCourseKeyDown = (e: React.KeyboardEvent, index: number) => {
    const cols = window.innerWidth >= 1024 ? 4 : window.innerWidth >= 640 ? 2 : 1;
    
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIndex = Math.min(index + 1, filteredCourses.length - 1);
      setFocusedCourseIndex(nextIndex);
      courseRefs.current[nextIndex]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIndex = Math.max(index - 1, 0);
      setFocusedCourseIndex(prevIndex);
      courseRefs.current[prevIndex]?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = Math.min(index + cols, filteredCourses.length - 1);
      setFocusedCourseIndex(nextIndex);
      courseRefs.current[nextIndex]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (index < cols) {
        setFocusedCourseIndex(-1);
        categoryRefs.current[focusedCategoryIndex]?.focus();
      } else {
        const prevIndex = index - cols;
        setFocusedCourseIndex(prevIndex);
        courseRefs.current[prevIndex]?.focus();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleCourseClick(filteredCourses[index], index);
    }
  };

  const handleFooterKeyDown = (e: React.KeyboardEvent, index: number) => {
    const footerLinksCount = 6; // Focusable footer links (Solutions rows are static)
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = (index + 1) % footerLinksCount;
      setFocusedFooterIndex(nextIndex);
      footerRefs.current[nextIndex]?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = (index - 1 + footerLinksCount) % footerLinksCount;
      setFocusedFooterIndex(prevIndex);
      footerRefs.current[prevIndex]?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      footerRefs.current[index]?.click();
    }
  };

  const handleBackFromPlayer = useCallback(() => {
    historyBackOrFallback(() => {
      historyActionRef.current = 'replace';
      setCurrentView('overview');
      scrollDocumentToTop();
    });
  }, []);

  const handleCloseCertificate = useCallback(() => {
    const wasPublic = certificateData?.isPublic === true;
    const snap = certificateReturnRef.current;
    certificateReturnRef.current = null;

    if (!wasPublic) {
      historyBackOrFallback(() => {
        historySkipSyncRef.current = true;
        setCertificateData(null);
        if (!snap) {
          setSelectedCourse(null);
          setInitialLesson(undefined);
          setCurrentView('catalog');
          scrollDocumentToTop();
          return;
        }
        if (snap.view === 'overview') {
          if (snap.courseId) {
            const c = COURSES.find((x) => x.id === snap.courseId);
            if (c) {
              setSelectedCourse(c);
              setInitialLesson(undefined);
              setCurrentView('overview');
              scrollDocumentToTop();
              return;
            }
          }
          setSelectedCourse(null);
          setInitialLesson(undefined);
          setCurrentView('catalog');
          scrollDocumentToTop();
          return;
        }
        setSelectedCourse(null);
        setInitialLesson(undefined);
        setCurrentView(snap.view);
        scrollDocumentToTop();
      });
      return;
    }

    historySkipSyncRef.current = true;
    setCertificateData(null);
    if (wasPublic) {
      window.history.replaceState(
        { [APP_HISTORY_KEY]: { v: 1, view: 'catalog' } },
        '',
        `${window.location.pathname}#/catalog`
      );
    }
    if (!snap) {
      setSelectedCourse(null);
      setInitialLesson(undefined);
      setCurrentView('catalog');
      scrollDocumentToTop();
      return;
    }
    if (snap.view === 'overview') {
      if (snap.courseId) {
        const c = COURSES.find((x) => x.id === snap.courseId);
        if (c) {
          setSelectedCourse(c);
          setInitialLesson(undefined);
          setCurrentView('overview');
          scrollDocumentToTop();
          return;
        }
      }
      setSelectedCourse(null);
      setInitialLesson(undefined);
      setCurrentView('catalog');
      scrollDocumentToTop();
      return;
    }
    setSelectedCourse(null);
    setInitialLesson(undefined);
    setCurrentView(snap.view);
    scrollDocumentToTop();
  }, [certificateData?.isPublic]);

  const handleShowCertificate = async (courseId: string, userName: string, date: string, certId: string) => {
    certificateReturnRef.current = {
      view: currentView,
      courseId: selectedCourse?.id ?? null,
    };
    setCertificateData({
      courseId,
      userName,
      date,
      certificateId: certId,
      isPublic: false
    });
    setCurrentView('certificate');

    // Save to Firestore if user is logged in
    if (user) {
      try {
        await setDoc(doc(db, 'certificates', certId), {
          courseId,
          userId: user.uid,
          userName,
          date: serverTimestamp(), // Use server timestamp for official record
          certificateId: certId
        }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'certificates');
      }
    }
  };

  const renderCertificate = () => {
    if (!certificateData) return null;
    const course = COURSES.find(c => c.id === certificateData.courseId);
    if (!course) return null;

    return (
      <div className="pt-24 px-6 sm:px-12 max-w-7xl mx-auto pb-20">
        <Certificate 
          course={course}
          userName={certificateData.userName}
          date={certificateData.date}
          certificateId={certificateData.certificateId}
          isPublic={certificateData.isPublic}
          onClose={handleCloseCertificate}
        />
      </div>
    );
  };

  const renderSettings = () => (
    <div className="pt-24 px-6 sm:px-12 max-w-4xl mx-auto pb-20">
      <h1 className="text-3xl font-bold mb-8 text-[var(--text-primary)]">Account Settings</h1>
      <div className="space-y-6">
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-[var(--border-color)]">
            <h2 className="text-xl font-bold text-[var(--text-primary)]">Preferences</h2>
            <p className="text-sm text-[var(--text-secondary)]">Manage your learning and account preferences.</p>
          </div>
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold text-[var(--text-primary)]">Email Notifications</div>
                <div className="text-sm text-[var(--text-secondary)]">Receive updates about new courses and activity.</div>
              </div>
              <div className="w-12 h-6 bg-orange-500 rounded-full relative cursor-pointer">
                <div className="absolute top-1 right-1 w-4 h-4 bg-white rounded-full" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold text-[var(--text-primary)]">Autoplay Lessons</div>
                <div className="text-sm text-[var(--text-secondary)]">Automatically start the next lesson in a course.</div>
              </div>
              <div className="w-12 h-6 bg-gray-600 rounded-full relative cursor-pointer">
                <div className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold text-[var(--text-primary)]">Public Profile</div>
                <div className="text-sm text-[var(--text-secondary)]">Allow others to see your progress and certificates.</div>
              </div>
              <div className="w-12 h-6 bg-orange-500 rounded-full relative cursor-pointer">
                <div className="absolute top-1 right-1 w-4 h-4 bg-white rounded-full" />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-[var(--border-color)]">
            <h2 className="text-xl font-bold text-red-500">Danger Zone</h2>
            <p className="text-sm text-[var(--text-secondary)]">Irreversible actions for your account.</p>
          </div>
          <div className="p-6">
            <button className="text-red-500 border border-red-500/20 px-6 py-2 rounded-lg font-bold hover:bg-red-500 hover:text-white transition-all">Delete Account</button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderHome = () => (
    <div className="pt-16">
      {/* Hero Section */}
      <section className="relative h-[600px] flex items-center px-6 sm:px-12 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img 
            src="https://picsum.photos/seed/tech/1920/1080?blur=4" 
            className="w-full h-full object-cover opacity-30"
            alt="Hero Background"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-primary)] via-[var(--bg-primary)]/80 to-transparent" />
        </div>

        <div className="relative z-10 max-w-2xl">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/20 text-orange-500 text-xs font-bold uppercase tracking-widest mb-6"
          >
            <TrendingUp size={14} />
            Trending in Software Development
          </motion.div>
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-5xl sm:text-7xl font-bold text-[var(--text-primary)] leading-tight mb-6"
          >
            Build your <span className="text-orange-500">future</span> with SkillStream.
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-xl text-[var(--text-secondary)] mb-8"
          >
            The technology learning platform to build tomorrow's skills today. 
            Get access to 7,000+ courses from industry experts.
          </motion.p>
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex flex-wrap gap-4 items-stretch"
          >
            {isAuthReady && !user && (
            <button 
              type="button"
              onClick={() => void handleLogin().catch(() => {})}
              className="min-h-24 bg-orange-500 hover:bg-orange-600 text-white px-8 rounded-md transition-colors flex flex-col items-center justify-center gap-1"
            >
              <span className="font-bold flex items-center gap-2">
                Learn for free
                <ChevronRight size={20} />
              </span>
              <span className="text-sm font-medium text-white/90">Sign in with Google</span>
            </button>
            )}
            <button 
              type="button"
              onClick={() => handleNavigate('contact')}
              className="min-h-24 inline-flex items-center justify-center bg-[var(--hover-bg)] hover:bg-[var(--hover-bg)]/80 text-[var(--text-primary)] px-8 rounded-md font-bold transition-colors"
            >
              Contact Us
            </button>
          </motion.div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-12 bg-[var(--bg-secondary)] border-y border-[var(--border-color)]">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-[var(--hover-bg)] rounded-lg text-orange-500"><Users size={24} /></div>
            <div>
              <div className="text-xl font-bold text-[var(--text-primary)]">1.5M+</div>
              <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">Learners</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="p-3 bg-[var(--hover-bg)] rounded-lg text-orange-500"><Globe size={24} /></div>
            <div>
              <div className="text-xl font-bold text-[var(--text-primary)]">150+</div>
              <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">Countries</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="p-3 bg-[var(--hover-bg)] rounded-lg text-orange-500"><Award size={24} /></div>
            <div>
              <div className="text-xl font-bold text-[var(--text-primary)]">7,000+</div>
              <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">Courses</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="p-3 bg-[var(--hover-bg)] rounded-lg text-orange-500"><Play size={24} /></div>
            <div>
              <div className="text-xl font-bold text-[var(--text-primary)]">20k+</div>
              <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">Lessons</div>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Courses */}
      <section className="py-20 px-6 max-w-7xl mx-auto">
        <div className="flex items-end justify-between mb-12">
          <div>
            <h2 className="text-3xl font-bold text-[var(--text-primary)] mb-2">Popular Courses</h2>
            <p className="text-[var(--text-secondary)]">Expand your knowledge with our most sought-after content.</p>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => handleNavigate('catalog')}
              className="text-orange-500 font-bold hover:underline flex items-center gap-1"
            >
              View all courses <ChevronRight size={18} />
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {filteredCourses.slice(0, 4).map(course => (
            <CourseCard key={course.id} course={course} onClick={handleCourseClick} />
          ))}
        </div>
      </section>
    </div>
  );

  const renderCatalog = () => {
    const allCategories = [...categories, ...moreCategories];
    
    return (
      <div className="pt-24 px-6 max-w-7xl mx-auto pb-20">
        <div className="mb-12">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-4xl font-bold text-[var(--text-primary)]">
              {searchQuery ? `Search Results for "${searchQuery}"` : 'Course Library'}
            </h1>
            {(searchQuery || selectedCategory !== 'All') && (
              <button 
                onClick={clearFilters}
                className="text-orange-500 hover:text-orange-400 text-sm font-medium flex items-center gap-1 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 rounded-sm"
              >
                <X size={16} /> Clear all filters
              </button>
            )}
          </div>
          {!searchQuery && (
            <div className="flex flex-wrap items-center gap-4">
              {categories.map((cat, index) => (
                <button 
                  key={cat}
                  ref={el => categoryRefs.current[index] = el}
                  onClick={() => setSelectedCategory(cat)}
                  onKeyDown={(e) => handleCategoryKeyDown(e, index)}
                  tabIndex={focusedCategoryIndex === index ? 0 : -1}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 ${selectedCategory === cat ? 'bg-orange-500 text-white' : 'bg-[var(--hover-bg)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]/80'}`}
                >
                  {cat}
                </button>
              ))}
              <div className="relative">
                <button 
                  ref={el => categoryRefs.current[categories.length] = el}
                  onClick={() => setShowMoreCategories(!showMoreCategories)}
                  onKeyDown={(e) => handleCategoryKeyDown(e, categories.length)}
                  tabIndex={focusedCategoryIndex === categories.length ? 0 : -1}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-orange-500 ${moreCategories.includes(selectedCategory) ? 'bg-orange-500 text-white' : 'bg-[var(--hover-bg)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]/80'}`}
                >
                  More <ChevronDown size={14} className={showMoreCategories ? 'rotate-180 transition-transform' : 'transition-transform'} />
                </button>
                
                {showMoreCategories && (
                  <div className="absolute top-full left-0 mt-2 w-48 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl z-20 py-2 overflow-hidden">
                    {moreCategories.map((cat, index) => (
                      <button
                        key={cat}
                        ref={el => categoryRefs.current[categories.length + 1 + index] = el}
                        onClick={() => {
                          setSelectedCategory(cat);
                          setShowMoreCategories(false);
                        }}
                        onKeyDown={(e) => handleCategoryKeyDown(e, categories.length + 1 + index)}
                        tabIndex={focusedCategoryIndex === categories.length + 1 + index ? 0 : -1}
                        className={`w-full text-left px-4 py-2 text-sm hover:bg-[var(--hover-bg)] transition-colors focus:outline-none ${selectedCategory === cat ? 'text-orange-500' : 'text-[var(--text-secondary)]'} ${focusedCategoryIndex === categories.length + 1 + index ? 'bg-[var(--hover-bg)]' : ''}`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {filteredCourses.map((course, index) => (
            <CourseCard 
              key={course.id}
              ref={el => courseRefs.current[index] = el}
              course={course} 
              onClick={(c) => handleCourseClick(c, index)} 
              tabIndex={focusedCourseIndex === index || (focusedCourseIndex === -1 && index === 0) ? 0 : -1}
              onKeyDown={(e) => handleCourseKeyDown(e, index)}
              isFocused={focusedCourseIndex === index}
            />
          ))}
        </div>
        {filteredCourses.length === 0 && (
          <div className="text-center py-20">
            <p className="text-[var(--text-muted)] text-lg mb-4">No courses found matching your search.</p>
            <button 
              onClick={clearFilters}
              className="px-6 py-2 bg-orange-500 text-white rounded-md font-medium hover:bg-orange-600 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderAbout = () => (
    <div className="pt-32 pb-20 px-6 max-w-7xl mx-auto">
      <div className="max-w-3xl mx-auto text-center mb-16">
        <h1 className="text-5xl font-bold text-[var(--text-primary)] mb-6">Building the future of tech education.</h1>
        <p className="text-xl text-[var(--text-secondary)]">SkillStream is the leading technology learning platform, empowering teams and individuals to build the future through expert-led content.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-20">
        {[
          { icon: <Users />, title: 'Expert Instructors', desc: 'Learn from industry leaders with real-world experience.' },
          { icon: <Globe />, title: 'Global Community', desc: 'Join millions of learners from around the world.' },
          { icon: <Award />, title: 'Recognized Skills', desc: 'Earn certificates that are valued by top employers.' }
        ].map((item, i) => (
          <div key={i} className="bg-[var(--bg-secondary)] p-8 rounded-2xl border border-[var(--border-color)]">
            <div className="w-12 h-12 bg-orange-500/10 text-orange-500 rounded-lg flex items-center justify-center mb-6">
              {item.icon}
            </div>
            <h3 className="text-xl font-bold text-[var(--text-primary)] mb-4">{item.title}</h3>
            <p className="text-[var(--text-secondary)] leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );

  const renderCareers = () => (
    <div className="pt-32 pb-20 px-6 max-w-7xl mx-auto">
      <div className="text-center mb-16">
        <h1 className="text-5xl font-bold text-[var(--text-primary)] mb-6">Join our mission.</h1>
        <p className="text-xl text-[var(--text-secondary)] max-w-2xl mx-auto">We're looking for passionate people to help us build the future of technology education.</p>
      </div>
      <div className="space-y-6 max-w-4xl mx-auto">
        {[
          { title: 'Senior Frontend Engineer', team: 'Engineering', location: 'Remote' },
          { title: 'Product Designer', team: 'Design', location: 'San Francisco, CA' },
          { title: 'Content Specialist', team: 'Education', location: 'Remote' },
          { title: 'Technical Recruiter', team: 'People', location: 'Austin, TX' }
        ].map((job, i) => (
          <div key={i} className="bg-[var(--bg-secondary)] p-6 rounded-xl border border-[var(--border-color)] flex items-center justify-between hover:border-orange-500/50 transition-colors cursor-pointer group">
            <div>
              <h3 className="text-lg font-bold text-[var(--text-primary)] group-hover:text-orange-500 transition-colors">{job.title}</h3>
              <p className="text-[var(--text-secondary)] text-sm">{job.team} • {job.location}</p>
            </div>
            <ChevronRight className="text-[var(--text-secondary)] group-hover:text-orange-500 transition-colors" />
          </div>
        ))}
      </div>
    </div>
  );

  const renderHelp = () => (
    <div className="pt-32 pb-20 px-6 max-w-7xl mx-auto">
      <div className="text-center mb-16">
        <h1 className="text-5xl font-bold text-[var(--text-primary)] mb-6">How can we help?</h1>
        <div className="max-w-xl mx-auto relative">
          <input 
            type="text" 
            placeholder="Search for articles..." 
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-full py-4 px-6 text-[var(--text-primary)] focus:outline-none focus:border-orange-500 transition-colors"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {[
          { icon: <Play />, title: 'Getting Started', desc: 'Learn the basics of using SkillStream.' },
          { icon: <Users />, title: 'Account & Billing', desc: 'Manage your subscription and profile.' },
          { icon: <Award />, title: 'Certificates', desc: 'How to earn and share your achievements.' }
        ].map((item, i) => (
          <div key={i} className="bg-[var(--bg-secondary)] p-8 rounded-2xl border border-[var(--border-color)] hover:bg-[var(--hover-bg)] transition-colors cursor-pointer">
            <div className="w-10 h-10 bg-orange-500/10 text-orange-500 rounded-lg flex items-center justify-center mb-6">
              {item.icon}
            </div>
            <h3 className="text-lg font-bold text-[var(--text-primary)] mb-2">{item.title}</h3>
            <p className="text-[var(--text-secondary)] text-sm">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );

  const renderContact = () => (
    <div className="pt-32 pb-20 px-6 max-w-7xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-20">
        <div>
          <h1 className="text-5xl font-bold text-[var(--text-primary)] mb-6">Get in touch.</h1>
          <p className="text-xl text-[var(--text-secondary)] mb-12">Have questions? We're here to help you find the right solution for your needs.</p>
          <div className="space-y-8">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-orange-500/10 text-orange-500 rounded-full flex items-center justify-center">
                <Mail />
              </div>
              <div>
                <p className="text-[var(--text-primary)] font-bold">Email us</p>
                <p className="text-[var(--text-secondary)]">
                  Use the form — we&apos;ll reply to the address you provide.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-orange-500/10 text-orange-500 rounded-full flex items-center justify-center">
                <LifeBuoy />
              </div>
              <div>
                <p className="text-[var(--text-primary)] font-bold">Support</p>
                <p className="text-[var(--text-secondary)]">Available 24/7 for Premium members</p>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-[var(--bg-secondary)] p-8 rounded-2xl border border-[var(--border-color)]">
          <ContactForm />
        </div>
      </div>
    </div>
  );

  const renderStatus = () => (
    <div className="pt-32 pb-20 px-6 max-w-7xl mx-auto">
      <div className="bg-emerald-500/10 border border-emerald-500/20 p-8 rounded-2xl mb-12 flex items-center gap-6">
        <div className="w-16 h-16 bg-emerald-500 text-white rounded-full flex items-center justify-center">
          <CheckCircle size={32} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-1">All Systems Operational</h1>
          <p className="text-emerald-500/80">SkillStream is running smoothly. No issues reported in the last 24 hours.</p>
        </div>
      </div>
      <div className="space-y-4">
        {[
          { name: 'Website', status: 'Operational' },
          { icon: <Play />, name: 'Video Streaming', status: 'Operational' },
          { icon: <Users />, name: 'User Authentication', status: 'Operational' },
          { icon: <Award />, name: 'Certificate Generation', status: 'Operational' },
          { icon: <Globe />, name: 'API Services', status: 'Operational' }
        ].map((system, i) => (
          <div key={i} className="bg-[var(--bg-secondary)] p-6 rounded-xl border border-[var(--border-color)] flex items-center justify-between">
            <span className="text-[var(--text-primary)] font-medium">{system.name}</span>
            <div className="flex items-center gap-2 text-emerald-500 text-sm">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              {system.status}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderPrivacy = () => (
    <div className="pt-32 pb-20 px-6 max-w-3xl mx-auto">
      <h1 className="text-4xl font-bold text-[var(--text-primary)] mb-8">Privacy Policy</h1>
      <div className="prose prose-invert max-w-none text-[var(--text-secondary)] space-y-6">
        <p>Last updated: March 19, 2026</p>
        <p>At SkillStream, we take your privacy seriously. This policy describes how we collect, use, and handle your personal information when you use our website and services.</p>
        <h2 className="text-2xl font-bold text-[var(--text-primary)] mt-12 mb-4">1. Information We Collect</h2>
        <p>We collect information you provide directly to us, such as when you create an account, subscribe to a plan, or communicate with our support team.</p>
        <h2 className="text-2xl font-bold text-[var(--text-primary)] mt-12 mb-4">2. How We Use Information</h2>
        <p>We use the information we collect to provide, maintain, and improve our services, to process transactions, and to communicate with you about your account.</p>
        <h2 className="text-2xl font-bold text-[var(--text-primary)] mt-12 mb-4">3. Data Security</h2>
        <p>We implement a variety of security measures to maintain the safety of your personal information when you enter, submit, or access your personal information.</p>
      </div>
    </div>
  );

  const renderEnterprise = () => (
    <div className="pt-32 pb-20 px-6 max-w-7xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-20 items-center mb-32">
        <div>
          <h1 className="text-6xl font-bold text-[var(--text-primary)] mb-8 leading-tight">Scale your team's skills.</h1>
          <p className="text-xl text-[var(--text-secondary)] mb-12">The most comprehensive technology learning platform for organizations of all sizes.</p>
          <div className="flex gap-4">
            <button className="px-8 py-4 bg-orange-500 text-white rounded-md font-bold hover:bg-orange-600 transition-colors">
              Request a Demo
            </button>
            <button className="px-8 py-4 bg-[var(--hover-bg)] text-[var(--text-primary)] rounded-md font-bold hover:bg-[var(--hover-bg)]/80 transition-colors">
              View Case Studies
            </button>
          </div>
        </div>
        <div className="relative">
          <div className="absolute -inset-4 bg-orange-500/20 blur-3xl rounded-full"></div>
          <div className="relative bg-[var(--bg-secondary)] border border-[var(--border-color)] p-8 rounded-2xl shadow-2xl">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 bg-orange-500 rounded-lg flex items-center justify-center text-white">
                <TrendingUp />
              </div>
              <div>
                <p className="text-[var(--text-primary)] font-bold">Team Analytics</p>
                <p className="text-[var(--text-secondary)] text-sm">Real-time skill tracking</p>
              </div>
            </div>
            <div className="space-y-4">
              {[85, 92, 78].map((progress, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-between text-xs text-[var(--text-secondary)]">
                    <span>{['Cloud Computing', 'Cybersecurity', 'AI & ML'][i]}</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-2 bg-[var(--hover-bg)] rounded-full overflow-hidden">
                    <div className="h-full bg-orange-500 rounded-full" style={{ width: `${progress}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderSignup = () => (
    <div className="pt-32 pb-20 px-6 max-w-md mx-auto">
      <div className="bg-[var(--bg-secondary)] p-8 rounded-2xl border border-[var(--border-color)] shadow-2xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">Create your account</h1>
          <p className="text-[var(--text-muted)]">Start your 14-day free trial today.</p>
        </div>
        <form className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm text-[var(--text-secondary)]">Full Name</label>
            <input type="text" className="w-full bg-[var(--bg-primary)] border border-[var(--border-light)] rounded-lg p-3 text-[var(--text-primary)] focus:border-orange-500 outline-none" placeholder="John Doe" />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-[var(--text-secondary)]">Email Address</label>
            <input type="email" className="w-full bg-[var(--bg-primary)] border border-[var(--border-light)] rounded-lg p-3 text-[var(--text-primary)] focus:border-orange-500 outline-none" placeholder="john@example.com" />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-[var(--text-secondary)]">Password</label>
            <input type="password" className="w-full bg-[var(--bg-primary)] border border-[var(--border-light)] rounded-lg p-3 text-[var(--text-primary)] focus:border-orange-500 outline-none" placeholder="••••••••" />
          </div>
          <button className="w-full py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-bold transition-colors mt-4">
            Create Account
          </button>
        </form>
        <p className="text-center text-[var(--text-muted)] text-xs mt-6">
          By signing up, you agree to our <span onClick={() => handleNavigate('privacy')} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer underline">Privacy Policy</span> and Terms of Service.
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] selection:bg-orange-500/30 transition-colors duration-300">
      {currentView !== 'certificate' && (
        <Navbar 
          onNavigate={handleNavigate} 
          activeView={currentView === 'overview' || currentView === 'player' ? 'catalog' : currentView}
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          onCategorySelect={handleCategorySelect}
          onPathSelect={handlePathSelect}
          onSkillSelect={handleSkillSelect}
          onClearFilters={clearFilters}
          theme={theme}
          onThemeToggle={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
          user={user}
          onLogin={() => void handleLogin().catch(() => {})}
          onLogout={handleLogout}
          notifications={notifications}
          setNotifications={setNotifications}
          onCertificateNotificationClick={handleCertificateNotificationClick}
        />
      )}
      {authBanner && currentView !== 'certificate' && (
        <div
          role="alert"
          className="border-b border-orange-500/40 bg-orange-500/10 px-4 py-3 text-sm text-[var(--text-primary)]"
        >
          <div className="max-w-7xl mx-auto flex gap-3 items-start justify-between">
            <p className="min-w-0 flex-1 leading-relaxed">{authBanner}</p>
            <button
              type="button"
              onClick={() => setAuthBanner(null)}
              className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-orange-600 hover:bg-orange-500/20 dark:text-orange-400"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <main>
        {currentView === 'home' && renderHome()}
        {currentView === 'catalog' && renderCatalog()}
        {currentView === 'overview' && selectedCourse && (
          <CourseOverview
            key={selectedCourse.id}
            course={selectedCourse}
            onStartCourse={(lesson) => {
              setInitialLesson(lesson);
              setCurrentView('player');
            }}
            user={user}
            onLogin={handleLogin}
            onShowCertificate={handleShowCertificate}
          />
        )}
        {currentView === 'player' && selectedCourse && (
          !isAuthReady ? (
            <div className="min-h-screen pt-28 flex items-center justify-center text-[var(--text-secondary)] text-sm">
              Loading…
            </div>
          ) : user ? (
            <CoursePlayer
              key={selectedCourse.id}
              course={selectedCourse}
              initialLesson={initialLesson}
              onBack={handleBackFromPlayer}
              onCourseFinished={handleCoursePlayerFinished}
              user={user}
              onLogin={handleLogin}
            />
          ) : (
            <PlayerSignInGate
              courseTitle={selectedCourse.title}
              onBack={handleBackFromPlayer}
              onLogin={handleLogin}
            />
          )
        )}
        {currentView === 'profile' && (
          <ProfilePage
            user={user}
            isAuthReady={isAuthReady}
            onLogin={() => void handleLogin().catch(() => {})}
            onShowCertificate={handleShowCertificate}
            openCompletedCoursesSignal={completedCoursesModalSignal}
            onDismiss={() => handleNavigate('catalog')}
          />
        )}
        {currentView === 'certificate' && renderCertificate()}
        {currentView === 'settings' && renderSettings()}
        {currentView === 'about' && renderAbout()}
        {currentView === 'careers' && renderCareers()}
        {currentView === 'privacy' && renderPrivacy()}
        {currentView === 'help' && renderHelp()}
        {currentView === 'contact' && renderContact()}
        {currentView === 'status' && renderStatus()}
        {currentView === 'enterprise' && renderEnterprise()}
        {currentView === 'signup' && renderSignup()}
      </main>

      <DemoLearningAgent
        onOpenCourse={(course) => {
          setSelectedCourse(course);
          setInitialLesson(undefined);
          setCurrentView('overview');
          scrollDocumentToTop();
        }}
      />

      {currentView !== 'player' && currentView !== 'overview' && (
        <footer className="bg-[var(--bg-secondary)] border-t border-[var(--border-color)] py-12 px-6 transition-colors duration-300">
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12">
            <div className="col-span-1 md:col-span-1">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 bg-orange-500 rounded-sm flex items-center justify-center font-bold text-white">S</div>
                <span className="text-xl font-bold tracking-tighter text-[var(--text-primary)]">SKILLSTREAM</span>
              </div>
              <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
                Empowering technology teams and individuals to build the future through expert-led content and skill assessments.
              </p>
            </div>
            <div>
              <h4 className="text-[var(--text-primary)] font-bold mb-6">Solutions</h4>
              <ul className="space-y-4 text-sm text-[var(--text-secondary)]">
                <li className="text-[var(--text-secondary)]">For Individuals</li>
                <li className="text-[var(--text-secondary)]">For Teams</li>
                <li className="text-[var(--text-secondary)]">For Enterprise</li>
              </ul>
            </div>
            <div>
              <h4 className="text-[var(--text-primary)] font-bold mb-6">Support</h4>
              <ul className="space-y-4 text-sm text-[var(--text-secondary)]">
                <li 
                  ref={el => footerRefs.current[0] = el as any}
                  tabIndex={focusedFooterIndex === 0 || focusedFooterIndex === -1 ? 0 : -1}
                  onKeyDown={(e) => handleFooterKeyDown(e as any, 0)}
                  onClick={() => handleNavigate('help')} 
                  className="hover:text-orange-500 cursor-pointer focus:outline-none focus:text-orange-500"
                >
                  Help Center
                </li>
                <li 
                  ref={el => footerRefs.current[1] = el as any}
                  tabIndex={focusedFooterIndex === 1 ? 0 : -1}
                  onKeyDown={(e) => handleFooterKeyDown(e as any, 1)}
                  onClick={() => handleNavigate('contact')} 
                  className="hover:text-orange-500 cursor-pointer focus:outline-none focus:text-orange-500"
                >
                  Contact Us
                </li>
                <li 
                  ref={el => footerRefs.current[2] = el as any}
                  tabIndex={focusedFooterIndex === 2 ? 0 : -1}
                  onKeyDown={(e) => handleFooterKeyDown(e as any, 2)}
                  onClick={() => handleNavigate('status')} 
                  className="hover:text-orange-500 cursor-pointer focus:outline-none focus:text-orange-500"
                >
                  System Status
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-[var(--text-primary)] font-bold mb-6">Company</h4>
              <ul className="space-y-4 text-sm text-[var(--text-secondary)]">
                <li 
                  ref={el => footerRefs.current[3] = el as any}
                  tabIndex={focusedFooterIndex === 3 ? 0 : -1}
                  onKeyDown={(e) => handleFooterKeyDown(e as any, 3)}
                  onClick={() => handleNavigate('about')} 
                  className="hover:text-orange-500 cursor-pointer focus:outline-none focus:text-orange-500"
                >
                  About Us
                </li>
                <li 
                  ref={el => footerRefs.current[4] = el as any}
                  tabIndex={focusedFooterIndex === 4 ? 0 : -1}
                  onKeyDown={(e) => handleFooterKeyDown(e as any, 4)}
                  onClick={() => handleNavigate('careers')} 
                  className="hover:text-orange-500 cursor-pointer focus:outline-none focus:text-orange-500"
                >
                  Careers
                </li>
                <li 
                  ref={el => footerRefs.current[5] = el as any}
                  tabIndex={focusedFooterIndex === 5 ? 0 : -1}
                  onKeyDown={(e) => handleFooterKeyDown(e as any, 5)}
                  onClick={() => handleNavigate('privacy')} 
                  className="hover:text-orange-500 cursor-pointer focus:outline-none focus:text-orange-500"
                >
                  Privacy Policy
                </li>
              </ul>
            </div>
          </div>
          <div className="max-w-7xl mx-auto mt-12 pt-8 border-t border-[var(--border-color)] text-center text-[var(--text-secondary)] text-xs">
            © 2026 SkillStream Inc. All rights reserved.
          </div>
        </footer>
      )}
    </div>
  );
}

