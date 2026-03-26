import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { Navbar, type NavbarNotification } from './components/Navbar';
import { CourseCard } from './components/CourseCard';
import { CoursePlayer } from './components/CoursePlayer';
import { CourseOverview } from './components/CourseOverview';
import { CourseCatalogLoadingSkeleton } from './components/CourseCatalogLoadingSkeleton';
import { ProfilePage } from './components/ProfilePage';
import { Certificate } from './components/Certificate';
import { useBodyScrollLock } from './hooks/useBodyScrollLock';
import { ContactForm } from './components/ContactForm';
import { DemoLearningAgent } from './components/DemoLearningAgent';
import { STATIC_CATALOG_FALLBACK, Course, Lesson } from './data/courses';
import { AdminPage } from './components/AdminPage';
import {
  ensureUserProfile,
  fetchUserRole,
  countFirestoreAdminUsers,
} from './utils/userProfileFirestore';
import { peekResolvedCatalogCourses, resolveCatalogCourses } from './utils/publishedCoursesFirestore';
import { enrollUserInCourse, fetchEnrolledCourseIds } from './utils/enrollmentsFirestore';
import {
  fetchActiveAlertsForCourses,
  loadUserAlertState,
  markAlertDismissed,
  markAlertRead,
  reportNoticesFromQuerySnapshot,
} from './utils/alertsFirestore';
import { Play, TrendingUp, Award, Users, Globe, ChevronRight, ChevronDown, X, CheckCircle, Mail, LifeBuoy, Briefcase, Shield, Info, Clock, LogIn, AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';
import {
  auth,
  db,
  signInWithGoogle,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  isFirestorePermissionDenied,
  User,
  deleteCurrentUserAccount,
} from './firebase';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { scrollDocumentToTop } from './utils/scrollDocumentToTop';
import { recordCourseCompletion } from './utils/courseCompletionLog';
import {
  buildCertificateId,
  hydrateCompletionTimestampsFromCertificates,
  persistCertificateToFirestore,
} from './utils/certificateFirestore';
import {
  ensureSyntheticProgressForRecordedCompletions,
  getResumeOrStartLesson,
  hydrateAllUserProgressFromFirestore,
  loadLessonProgressMap,
  markCourseCompletedTimestampInFirestore,
} from './utils/courseProgress';
import { hydrateAllCourseRatingsFromFirestore } from './utils/courseRating';
import { formatAuthError } from './utils/authErrors';
import {
  readCachedAuthProfile,
  writeCachedAuthProfile,
  clearCachedAuthProfile,
  type AuthProfileSnapshot,
} from './utils/authProfileCache';
import { stashAuthReturnState, consumeAuthReturnState, type AuthReturnPayload } from './utils/authReturnContext';
import {
  APP_HISTORY_KEY,
  type AdminHistoryTab,
  type AppHistoryPayload,
  buildHistoryUrl,
  historyPayloadsEqual,
  parseHashToPayload,
  readPayloadFromHistoryState,
  resolvePayloadForCourses,
} from './utils/appHistory';
import {
  CATALOG_CATEGORY_EXTRAS_CHANGED,
  readCatalogCategoryExtras,
} from './utils/catalogCategoryExtras';
import {
  CATALOG_CATEGORIES_ROW,
  CATALOG_STATIC_MORE,
} from './utils/catalogCategoryPresets';

type View = 'home' | 'catalog' | 'player' | 'overview' | 'about' | 'careers' | 'privacy' | 'help' | 'contact' | 'status' | 'enterprise' | 'signup' | 'profile' | 'certificate' | 'admin';

const alertsMutedStorageKey = (uid: string) => `skilllearn-alerts-muted:${uid}`;

function readAlertsMutedFromStorage(uid: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(alertsMutedStorageKey(uid)) === '1';
  } catch {
    return false;
  }
}

const ADMIN_DELETE_BLOCKED_MULTI_MSG =
  "Admin accounts can't be deleted. In Admin → Users, set your role to user (or ask another admin), then return here to delete your account.";

const ADMIN_DELETE_BLOCKED_SOLE_MSG =
  "You're the only admin. Promote another account to admin in Admin → Users first, then set your role to user — after that you can delete your account.";

function findLessonById(course: Course, lessonId: string): Lesson | undefined {
  for (const mod of course.modules) {
    const found = mod.lessons.find((l) => l.id === lessonId);
    if (found) return found;
  }
  return undefined;
}

/** React key fragment: changes when any lesson id changes (e.g. live catalog replaces static fallback). */
function courseCurriculumSignature(course: Course): string {
  return course.modules.map((m) => m.lessons.map((l) => l.id).join('.')).join('/');
}

function formatAlertListTime(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return 'Just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

/** Hash asked for overview/player before this course existed in the catalog slice used on first paint (e.g. cold load vs Firestore). */
type DeferredCourseRoute = { view: 'overview' | 'player'; courseId: string; lessonId?: string };

function getInitialRouteState(catalog: Course[] = STATIC_CATALOG_FALLBACK): {
  view: View;
  selectedCourse: Course | null;
  initialLesson: Lesson | undefined;
  adminTab: AdminHistoryTab;
  deferredCourseRoute: DeferredCourseRoute | null;
} {
  if (typeof window === 'undefined') {
    return {
      view: 'home',
      selectedCourse: null,
      initialLesson: undefined,
      adminTab: 'alerts',
      deferredCourseRoute: null,
    };
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get('cert_id')) {
    return {
      view: 'home',
      selectedCourse: null,
      initialLesson: undefined,
      adminTab: 'alerts',
      deferredCourseRoute: null,
    };
  }
  const parsed = parseHashToPayload(window.location.hash);
  if (!parsed) {
    return {
      view: 'home',
      selectedCourse: null,
      initialLesson: undefined,
      adminTab: 'alerts',
      deferredCourseRoute: null,
    };
  }

  if (
    (parsed.view === 'overview' || parsed.view === 'player') &&
    parsed.courseId &&
    !catalog.some((x) => x.id === parsed.courseId)
  ) {
    return {
      view: parsed.view as View,
      selectedCourse: null,
      initialLesson: undefined,
      adminTab: 'alerts',
      deferredCourseRoute: {
        view: parsed.view,
        courseId: parsed.courseId,
        lessonId: parsed.lessonId ?? undefined,
      },
    };
  }

  let routeParsed: AppHistoryPayload = parsed;
  if (
    parsed.view === 'player' &&
    parsed.courseId &&
    !parsed.lessonId &&
    catalog.some((x) => x.id === parsed.courseId)
  ) {
    const c = catalog.find((x) => x.id === parsed.courseId);
    if (c) {
      const uid = readCachedAuthProfile()?.uid ?? null;
      const resume = getResumeOrStartLesson(c, loadLessonProgressMap(c.id, uid));
      if (resume) {
        routeParsed = { ...parsed, lessonId: resume.id };
      }
    }
  }

  const resolved = resolvePayloadForCourses(routeParsed, catalog, findLessonById);

  if (resolved.view === 'overview' || resolved.view === 'player') {
    const c = resolved.courseId ? (catalog.find((x) => x.id === resolved.courseId) ?? null) : null;
    const l = c && resolved.lessonId ? findLessonById(c, resolved.lessonId) : undefined;
    if (c) {
      return {
        view: resolved.view as View,
        selectedCourse: c,
        initialLesson: l,
        adminTab: 'alerts',
        deferredCourseRoute: null,
      };
    }
    return {
      view: 'catalog',
      selectedCourse: null,
      initialLesson: undefined,
      adminTab: 'alerts',
      deferredCourseRoute: null,
    };
  }

  if (resolved.view === 'certificate') {
    return {
      view: 'home',
      selectedCourse: null,
      initialLesson: undefined,
      adminTab: 'alerts',
      deferredCourseRoute: null,
    };
  }

  const adminTab: AdminHistoryTab =
    resolved.view === 'admin' ? (resolved.adminTab ?? 'alerts') : 'alerts';

  return {
    view: resolved.view as View,
    selectedCourse: null,
    initialLesson: undefined,
    adminTab,
    deferredCourseRoute: null,
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
  onLogin,
}: {
  courseTitle: string;
  onLogin: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] pt-20 px-6 flex flex-col items-center justify-center gap-8 max-w-lg mx-auto text-center">
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

const SKILLSTREAM_GUEST_WELCOME_READ_KEY = 'skillstream_guest_welcome_read';
const SKILLSTREAM_GUEST_WELCOME_DISMISSED_KEY = 'skillstream_guest_welcome_dismissed';

function readGuestWelcomePersistedState(): { read: boolean; dismissed: boolean } {
  if (typeof localStorage === 'undefined') return { read: false, dismissed: false };
  try {
    return {
      read: localStorage.getItem(SKILLSTREAM_GUEST_WELCOME_READ_KEY) === '1',
      dismissed: localStorage.getItem(SKILLSTREAM_GUEST_WELCOME_DISMISSED_KEY) === '1',
    };
  } catch {
    return { read: false, dismissed: false };
  }
}

export default function App() {
  const [initialRoute] = useState(() =>
    getInitialRouteState(peekResolvedCatalogCourses() ?? STATIC_CATALOG_FALLBACK)
  );
  const [currentView, setCurrentView] = useState<View>(initialRoute.view);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  /** In-app bell: hide course/admin alerts; certificates still show. Persisted per uid. */
  const [alertsMuted, setAlertsMuted] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(initialRoute.selectedCourse);
  const [initialLesson, setInitialLesson] = useState<Lesson | undefined>(initialRoute.initialLesson);
  const [adminTab, setAdminTab] = useState<AdminHistoryTab>(() => initialRoute.adminTab);
  const [deferredCourseRoute, setDeferredCourseRoute] = useState<DeferredCourseRoute | null>(
    () => initialRoute.deferredCourseRoute
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [showMoreCategories, setShowMoreCategories] = useState(false);
  const [focusedCategoryIndex, setFocusedCategoryIndex] = useState(0);
  const [focusedCourseIndex, setFocusedCourseIndex] = useState(-1);
  const [focusedFooterIndex, setFocusedFooterIndex] = useState(-1);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  /** Last signed-in profile from localStorage — shown until Firebase finishes async restore (no avatar flash on refresh). */
  const [authSnapshot, setAuthSnapshot] = useState<AuthProfileSnapshot | null>(() => readCachedAuthProfile());
  const [certificateData, setCertificateData] = useState<CertificateData | null>(null);
  /** Where to return when closing the certificate view (set synchronously before navigation). */
  const certificateReturnRef = useRef<{ view: View; courseId: string | null } | null>(null);
  const [notifications, setNotifications] = useState<NavbarNotification[]>([]);
  const [catalogCourses, setCatalogCourses] = useState<Course[]>(
    () => peekResolvedCatalogCourses() ?? STATIC_CATALOG_FALLBACK
  );
  /**
   * False only on cold load when session had no resolved catalog: bundled fallback is incomplete
   * vs Firestore. Block overview/player until resolveCatalogCourses() finishes so all lessons
   * appear together (no multi-second stub then "pop-in" of lessons 3+).
   */
  const [liveCatalogHydrated, setLiveCatalogHydrated] = useState(
    () => peekResolvedCatalogCourses() != null
  );
  const catalogCoursesRef = useRef<Course[]>(catalogCourses);
  catalogCoursesRef.current = catalogCourses;

  /** Prefer the live catalog row for this id so overview/player never render one frame of stale bundled lessons. */
  const selectedCourseResolved = useMemo((): Course | null => {
    if (!selectedCourse) return null;
    return catalogCourses.find((c) => c.id === selectedCourse.id) ?? selectedCourse;
  }, [selectedCourse, catalogCourses]);

  const [isAdminUser, setIsAdminUser] = useState(false);
  /**
   * False until Firebase auth is ready and (if signed in) Firestore role fetch finishes.
   * Prevents treating a brief `isAdminUser === false` as “kick off #/admin”.
   */
  const [adminAccessResolved, setAdminAccessResolved] = useState(false);
  /** `users` docs with role admin; loaded when signed-in user is admin (for delete-account copy). */
  const [firestoreAdminCount, setFirestoreAdminCount] = useState<number | null>(null);
  /** After opening a broadcast alert: scroll overview curriculum to module/lesson. */
  const [overviewContentDeepLink, setOverviewContentDeepLink] = useState<{
    moduleId?: string;
    lessonId?: string;
  } | null>(null);
  const [completedCoursesModalSignal, setCompletedCoursesModalSignal] = useState(0);
  /** Bumps after cloud progress/ratings hydrate into localStorage so profile stats refresh. */
  const [remoteProfileDataVersion, setRemoteProfileDataVersion] = useState(0);
  const [authBanner, setAuthBanner] = useState<string | null>(null);
  const [profileSettingsUnderlayView, setProfileSettingsUnderlayView] = useState<View | null>(null);
  const viewBeforeProfileOrSettingsRef = useRef<View>('catalog');
  /** Course id to restore when leaving profile overlay back to overview (survives certificate overlay). */
  const profileReturnCourseIdRef = useRef<string | null>(null);
  const currentViewRef = useRef<View>(currentView);
  currentViewRef.current = currentView;

  const categoryRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** Bumps when admin adds a custom category (localStorage + event). */
  const [categoryFilterRevision, setCategoryFilterRevision] = useState(0);
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
    /* Player hash is always `#/course/<id>/player` (no lesson segment); lesson lives in state + CoursePlayer. */
    if (currentView === 'overview' || currentView === 'player') {
      p.courseId = selectedCourse?.id ?? deferredCourseRoute?.courseId ?? null;
    }
    if (currentView === 'certificate' && certificateData) {
      p.certificate = { ...certificateData };
    }
    if (currentView === 'admin') {
      p.adminTab = adminTab;
    }
    return p;
  }, [currentView, selectedCourse?.id, deferredCourseRoute, certificateData, adminTab]);

  const applyHistoryPayload = useCallback((raw: AppHistoryPayload) => {
    const resolved = resolvePayloadForCourses(raw, catalogCoursesRef.current, findLessonById);
    historySkipSyncRef.current = true;

    const view = resolved.view as View;

    if (
      view === 'certificate' &&
      !resolved.certificate
    ) {
      setCertificateData(null);
      setSelectedCourse(null);
      setInitialLesson(undefined);
      setCurrentView('catalog');
      window.history.replaceState(
        { [APP_HISTORY_KEY]: { v: 1, view: 'catalog' } },
        '',
        buildHistoryUrl({ v: 1, view: 'catalog' })
      );
      scrollDocumentToTop();
      return;
    }

    if (view === 'profile' && currentViewRef.current !== 'profile') {
      viewBeforeProfileOrSettingsRef.current = currentViewRef.current;
      setProfileSettingsUnderlayView(currentViewRef.current);
    }

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
      const c = resolved.courseId ? (catalogCoursesRef.current.find((x) => x.id === resolved.courseId) ?? null) : null;
      setSelectedCourse(c);
      if (view === 'overview') {
        setInitialLesson(undefined);
      } else if (view === 'player' && c) {
        if (resolved.lessonId) {
          setInitialLesson(findLessonById(c, resolved.lessonId) ?? undefined);
        } else {
          const uid = readCachedAuthProfile()?.uid ?? null;
          const resume = getResumeOrStartLesson(c, loadLessonProgressMap(c.id, uid));
          setInitialLesson(resume ?? undefined);
        }
      } else {
        setInitialLesson(undefined);
      }
    } else {
      setSelectedCourse(null);
      setInitialLesson(undefined);
    }

    if (view === 'admin') {
      setAdminTab(resolved.adminTab ?? 'alerts');
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
    const onPop = (_e: PopStateEvent) => {
      /** Hash is the visible deep link; prefer it over history.state when they diverge (lesson segment / back-forward). */
      const fromHash = parseHashToPayload(window.location.hash);
      const fromState = readPayloadFromHistoryState(window.history.state);
      const raw = fromHash ?? fromState;
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
  }, [buildHistoryPayload, currentView, selectedCourse?.id, deferredCourseRoute, certificateData, adminTab]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      if (!nextUser) {
        setUser(null);
        setIsAuthReady(true);
        clearCachedAuthProfile();
        setAuthSnapshot(null);
        return;
      }
      /** Set user immediately so Firestore-backed flows are not blocked on getIdToken. */
      setUser(nextUser);
      setIsAuthReady(true);
      writeCachedAuthProfile(nextUser);
      setAuthSnapshot(null);
      void nextUser.getIdToken();
    });
    return () => unsubscribe();
  }, []);

  /** Same identity the navbar uses: Firebase user or cached profile until auth restores (overview progress row needs this). */
  const navUser = user ?? (!isAuthReady && authSnapshot ? authSnapshot : null);

  useEffect(() => {
    const uid = navUser?.uid;
    if (!uid) return;
    let cancelled = false;
    void (async () => {
      await hydrateAllUserProgressFromFirestore(uid);
      await hydrateCompletionTimestampsFromCertificates(uid);
      ensureSyntheticProgressForRecordedCompletions(uid, catalogCourses);
      await hydrateAllCourseRatingsFromFirestore(uid);
      if (!cancelled) setRemoteProfileDataVersion((v) => v + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [navUser?.uid, catalogCourses]);

  useEffect(() => {
    let cancelled = false;
    void resolveCatalogCourses().then((courses) => {
      if (!cancelled) {
        setCatalogCourses(courses);
        setLiveCatalogHydrated(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshCatalogCourses = useCallback(async () => {
    const next = await resolveCatalogCourses();
    setCatalogCourses(next);
    setLiveCatalogHydrated(true);
  }, []);

  /**
   * Re-bind overview/player to the live catalog when it loads (or refreshes).
   * useLayoutEffect: apply before paint so we don’t flash bundled lesson counts, then swap.
   * Prefer URL hash over history.state so the visible deep link wins if they diverge.
   */
  useLayoutEffect(() => {
    if (currentView !== 'overview' && currentView !== 'player') return;
    const fromHash = parseHashToPayload(window.location.hash);
    const fromState = readPayloadFromHistoryState(window.history.state);
    const raw = fromHash ?? fromState;
    if (!raw || (raw.view !== 'overview' && raw.view !== 'player')) return;
    const resolved = resolvePayloadForCourses(raw, catalogCourses, findLessonById);
    if ((resolved.view !== 'overview' && resolved.view !== 'player') || !resolved.courseId) return;
    const fresh = catalogCourses.find((c) => c.id === resolved.courseId);
    if (!fresh) return;
    setSelectedCourse(fresh);
    if (resolved.view === 'player') {
      if (resolved.lessonId) {
        setInitialLesson(findLessonById(fresh, resolved.lessonId) ?? undefined);
      } else {
        const uid = user?.uid ?? readCachedAuthProfile()?.uid ?? null;
        const resume = getResumeOrStartLesson(fresh, loadLessonProgressMap(fresh.id, uid));
        setInitialLesson(resume ?? undefined);
      }
    } else if (resolved.view === 'overview') {
      setInitialLesson(undefined);
    }
  }, [catalogCourses, currentView, user?.uid]);

  /** Apply deep link once the live catalog contains a course that was missing on first paint (cold refresh). */
  useLayoutEffect(() => {
    if (!deferredCourseRoute) return;
    const fresh = catalogCourses.find((c) => c.id === deferredCourseRoute.courseId);
    if (fresh) {
      setSelectedCourse(fresh);
      if (deferredCourseRoute.view === 'player') {
        if (deferredCourseRoute.lessonId) {
          setInitialLesson(findLessonById(fresh, deferredCourseRoute.lessonId) ?? undefined);
        } else {
          const uid = user?.uid ?? readCachedAuthProfile()?.uid ?? null;
          const resume = getResumeOrStartLesson(fresh, loadLessonProgressMap(fresh.id, uid));
          setInitialLesson(resume ?? undefined);
        }
      } else {
        setInitialLesson(undefined);
      }
      setDeferredCourseRoute(null);
      return;
    }
    if (!liveCatalogHydrated) return;
    setDeferredCourseRoute(null);
    historyActionRef.current = 'replace';
    setCurrentView('catalog');
    setSelectedCourse(null);
    setInitialLesson(undefined);
  }, [catalogCourses, deferredCourseRoute, liveCatalogHydrated, user?.uid]);

  useEffect(() => {
    if (!isAuthReady) {
      setAdminAccessResolved(false);
      return;
    }
    if (!user) {
      setIsAdminUser(false);
      setAdminAccessResolved(true);
      return;
    }
    setAdminAccessResolved(false);
    let cancelled = false;
    void (async () => {
      await ensureUserProfile(user);
      const role = await fetchUserRole(user.uid);
      if (!cancelled) {
        setIsAdminUser(role === 'admin');
        setAdminAccessResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthReady, user]);

  useEffect(() => {
    if (!user?.uid || !isAdminUser || !adminAccessResolved) {
      setFirestoreAdminCount(null);
      return;
    }
    if (currentView !== 'profile') {
      return;
    }
    let cancelled = false;
    void (async () => {
      const n = await countFirestoreAdminUsers();
      if (!cancelled) setFirestoreAdminCount(n);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, isAdminUser, adminAccessResolved, currentView]);

  useEffect(() => {
    if (!user?.uid) {
      setAlertsMuted(false);
      return;
    }
    setAlertsMuted(readAlertsMutedFromStorage(user.uid));
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      const { read, dismissed } = readGuestWelcomePersistedState();
      if (dismissed) {
        setNotifications([]);
      } else {
        setNotifications([
          {
            id: 'welcome',
            message: 'Welcome to SkillStream! Start your first course today.',
            read,
            time: 'Now',
            kind: 'generic',
            actionView: 'catalog',
            actionLabel: 'Open catalog',
          },
        ]);
      }
      return;
    }
    let cancelled = false;
    const uid = user.uid;
    const accountCreatedAtMs = (() => {
      const raw = user.metadata.creationTime;
      if (!raw) return null;
      const parsed = Date.parse(raw);
      return Number.isFinite(parsed) ? parsed : null;
    })();

    const applyMergedAlerts = async (personalAlerts: ReturnType<typeof reportNoticesFromQuerySnapshot>) => {
      if (cancelled) return;
      try {
        const enrolled = await fetchEnrolledCourseIds(uid);
        if (cancelled) return;
        const courseAlerts = await fetchActiveAlertsForCourses(enrolled);
        if (cancelled) return;
        const byAlertId = new Map<string, (typeof courseAlerts)[number]>();
        for (const a of courseAlerts) byAlertId.set(a.id, a);
        for (const a of personalAlerts) byAlertId.set(a.id, a);
        const alerts = Array.from(byAlertId.values()).sort((a, b) => b.createdAtMs - a.createdAtMs);
        const st = await loadUserAlertState(uid);
        if (cancelled) return;
        const rows: NavbarNotification[] = alerts
          .filter(
            (a) =>
              a.type === 'report_resolved' ||
              accountCreatedAtMs == null ||
              a.createdAtMs >= accountCreatedAtMs
          )
          .filter((a) => !st.dismissedAlertIds[a.id])
          .map((a) => {
            const kind: NavbarNotification['kind'] =
              a.type === 'report_resolved' ? 'generic' : 'broadcast';
            return {
              id: `broadcast-${a.id}`,
              kind,
              alertId: a.id,
              courseId: a.courseId,
              lessonId: a.lessonId,
              moduleId: a.moduleId,
              message: `${a.title}: ${a.message}`,
              read: !!st.readAlertIds[a.id],
              time: formatAlertListTime(a.createdAtMs),
            };
          });
        setNotifications((prev) => {
          const adminInbox = prev.filter((n) => n.id.startsWith('admin-moderation-'));
          const certs = prev.filter((n) => n.kind === 'certificate');
          return [...adminInbox, ...rows, ...certs];
        });
      } catch (error) {
        console.error('Failed to refresh notifications:', error);
      }
    };

    const reportNoticesQ = query(collection(db, 'reportNotices'), where('forUserId', '==', uid), limit(50));
    void applyMergedAlerts([]);
    const unsub = onSnapshot(
      reportNoticesQ,
      (snap) => {
        void applyMergedAlerts(reportNoticesFromQuerySnapshot(snap));
      },
      (error) => {
        // Keep course alerts working even if reportNotices read is denied/misconfigured.
        console.error('reportNotices snapshot failed:', error);
        if (isFirestorePermissionDenied(error)) {
          setAuthBanner('Session permissions may be stale. Please sign out and sign back in.');
        }
        void applyMergedAlerts([]);
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [user?.uid, user?.metadata.creationTime]);

  useEffect(() => {
    if (!user?.uid || !isAdminUser) {
      setNotifications((prev) => prev.filter((n) => !n.id.startsWith('admin-moderation-')));
      return;
    }

    let reportCount = 0;
    let suggestionCount = 0;
    let cancelled = false;

    const syncAdminInboxNotifications = () => {
      if (cancelled) return;
      setNotifications((prev) => {
        const byId = new Map<string, NavbarNotification>(prev.map((n) => [n.id, n]));
        const nonAdminRows = prev.filter((n) => !n.id.startsWith('admin-moderation-'));
        const adminRows: NavbarNotification[] = [];
        if (reportCount > 0) {
          const id = 'admin-moderation-reports';
          adminRows.push({
            id,
            kind: 'generic',
            actionView: 'admin',
            adminTab: 'moderation',
            actionLabel: 'Open moderation',
            message: `Moderation inbox: Reports (${reportCount}) need review.`,
            time: 'Now',
            read: byId.get(id)?.read ?? false,
          });
        }
        if (suggestionCount > 0) {
          const id = 'admin-moderation-suggestions';
          adminRows.push({
            id,
            kind: 'generic',
            actionView: 'admin',
            adminTab: 'moderation',
            actionLabel: 'Open moderation',
            message: `Moderation inbox: URL suggestions (${suggestionCount}) need review.`,
            time: 'Now',
            read: byId.get(id)?.read ?? false,
          });
        }
        return [...adminRows, ...nonAdminRows];
      });
    };

    const unsubReports = onSnapshot(collection(db, 'reports'), (snap) => {
      reportCount = snap.size;
      syncAdminInboxNotifications();
    });
    const unsubSuggestions = onSnapshot(collection(db, 'suggestions'), (snap) => {
      suggestionCount = snap.size;
      syncAdminInboxNotifications();
    });

    return () => {
      cancelled = true;
      unsubReports();
      unsubSuggestions();
    };
  }, [user?.uid, isAdminUser]);

  useEffect(() => {
    if (user?.uid) return;
    const welcome = notifications.find((n) => n.id === 'welcome');
    if (!welcome?.read) return;
    try {
      localStorage.setItem(SKILLSTREAM_GUEST_WELCOME_READ_KEY, '1');
    } catch {
      /* ignore */
    }
  }, [user?.uid, notifications]);

  useEffect(() => {
    if (currentView !== 'admin') return;
    if (!isAuthReady || !adminAccessResolved) return;
    if (!user || !isAdminUser) {
      historyActionRef.current = 'replace';
      setCurrentView('catalog');
      scrollDocumentToTop();
    }
  }, [currentView, isAuthReady, user, isAdminUser, adminAccessResolved]);

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
    const course = payload.courseId ? catalogCoursesRef.current.find((c) => c.id === payload.courseId) : undefined;

    if (payload.view === 'overview' && course) {
      setSelectedCourse(course);
      setInitialLesson(undefined);
      setCurrentView('overview');
      scrollDocumentToTop();
      return;
    }
    if (payload.view === 'player' && course) {
      setSelectedCourse(course);
      const explicit = payload.initialLessonId ? findLessonById(course, payload.initialLessonId) : undefined;
      const uid = auth.currentUser?.uid ?? null;
      const resume = getResumeOrStartLesson(course, loadLessonProgressMap(course.id, uid));
      setInitialLesson(explicit ?? resume ?? undefined);
      setCurrentView('player');
      scrollDocumentToTop();
      return;
    }

    const simpleViews: View[] = [
      'home',
      'catalog',
      'profile',
      'about',
      'careers',
      'privacy',
      'help',
      'contact',
      'status',
      'enterprise',
      'signup',
      'admin',
    ];
    const simpleTarget = (payload.view === 'settings' ? 'profile' : payload.view) as View;
    if (simpleViews.includes(simpleTarget)) {
      setCurrentView(simpleTarget);
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

  const handleToggleAlertsMuted = useCallback(
    (muted: boolean) => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try {
        if (muted) localStorage.setItem(alertsMutedStorageKey(uid), '1');
        else localStorage.removeItem(alertsMutedStorageKey(uid));
      } catch {
        /* ignore */
      }
      setAlertsMuted(muted);
    },
    []
  );

  const handleDeleteAccount = useCallback(async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      return { ok: false, error: 'No signed-in user.' };
    }
    const role = await fetchUserRole(uid);
    if (role === 'admin') {
      const n = await countFirestoreAdminUsers();
      if (n === 1) {
        return { ok: false, error: ADMIN_DELETE_BLOCKED_SOLE_MSG };
      }
      return { ok: false, error: ADMIN_DELETE_BLOCKED_MULTI_MSG };
    }
    const result = await deleteCurrentUserAccount();
    if (!result.ok) {
      if (result.code === 'auth/requires-recent-login') {
        return {
          ok: false,
          error:
            'For security, sign out, sign in with Google again, then try deleting your account.',
        };
      }
      return { ok: false, error: result.message };
    }
    clearCachedAuthProfile();
    historyActionRef.current = 'replace';
    setCurrentView('catalog');
    setSelectedCourse(null);
    setInitialLesson(undefined);
    setNotifications([]);
    return { ok: true };
  }, []);

  const navbarNotifications = useMemo(() => {
    if (user?.uid && alertsMuted) {
      return notifications.filter((n) => n.kind === 'certificate');
    }
    return notifications;
  }, [user?.uid, alertsMuted, notifications]);

  const accountDeletionBlockLoading =
    isAdminUser && adminAccessResolved && firestoreAdminCount === null;
  const accountDeletionBlockedMessage = !isAdminUser
    ? null
    : accountDeletionBlockLoading
      ? null
      : firestoreAdminCount === 1
        ? ADMIN_DELETE_BLOCKED_SOLE_MSG
        : ADMIN_DELETE_BLOCKED_MULTI_MSG;

  const categories = CATALOG_CATEGORIES_ROW;

  const moreCategories = useMemo(() => {
    const mainSet = new Set<string>(CATALOG_CATEGORIES_ROW);
    const pool = new Set<string>([...CATALOG_STATIC_MORE]);
    for (const c of readCatalogCategoryExtras()) pool.add(c);
    for (const co of catalogCourses) {
      const cat = co.category?.trim();
      if (cat) pool.add(cat);
    }
    return [...pool]
      .filter((c) => !mainSet.has(c))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [catalogCourses, categoryFilterRevision]);

  const filteredCourses = catalogCourses.filter(course => {
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
    const onExtras = () => setCategoryFilterRevision((r) => r + 1);
    window.addEventListener(CATALOG_CATEGORY_EXTRAS_CHANGED, onExtras);
    return () => window.removeEventListener(CATALOG_CATEGORY_EXTRAS_CHANGED, onExtras);
  }, []);

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

  useEffect(() => {
    if (currentView !== 'profile' && currentView !== 'certificate') {
      setProfileSettingsUnderlayView(null);
    }
  }, [currentView]);

  useLayoutEffect(() => {
    if (currentView === 'profile' && profileSettingsUnderlayView === null) {
      viewBeforeProfileOrSettingsRef.current = 'catalog';
      setProfileSettingsUnderlayView('catalog');
    }
  }, [currentView, profileSettingsUnderlayView]);

  useBodyScrollLock(currentView === 'profile');

  /** Course overview / player replace the main column; reset document scroll. */
  useLayoutEffect(() => {
    if (currentView === 'overview' || currentView === 'player') {
      scrollDocumentToTop();
    }
  }, [currentView, selectedCourse?.id]);

  const handleNavigate = (view: View, shouldClear = true) => {
    const prev = currentViewRef.current;

    /** Profile overlay and course views share one history slot so Back skips dismissed layers (e.g. overview → Back → home). */
    const openingProfileOverlay =
      view === 'profile' && (prev === 'overview' || prev === 'player' || prev === 'profile');
    const leavingProfileOverlay = prev === 'profile' && view !== 'profile';
    if (openingProfileOverlay || leavingProfileOverlay) {
      historyActionRef.current = 'replace';
    }

    if (view === 'profile' && prev !== 'profile') {
      viewBeforeProfileOrSettingsRef.current = prev;
      setProfileSettingsUnderlayView(prev);
      profileReturnCourseIdRef.current = selectedCourse?.id ?? null;
    }
    if (shouldClear && (view === 'home' || view === 'catalog' || view === 'contact' || view === 'profile')) {
      clearFilters();
      setFocusedCourseIndex(-1);
      setFocusedCategoryIndex(0);
      setFocusedFooterIndex(-1);
    }
    if (view === 'admin') {
      setAdminTab('alerts');
    }
    setCurrentView(view);
    scrollDocumentToTop();
  };

  /** Restore course context when leaving profile overlay to overview or player (e.g. cert overlay touched selection). */
  const handleProfileDismiss = () => {
    const v = viewBeforeProfileOrSettingsRef.current;
    if ((v === 'overview' || v === 'player') && profileReturnCourseIdRef.current) {
      const c = catalogCourses.find((x) => x.id === profileReturnCourseIdRef.current);
      if (c) {
        setSelectedCourse(c);
        if (v === 'overview') {
          setInitialLesson(undefined);
        }
      }
    }
    handleNavigate(v, false);
  };

  const handleCourseClick = (course: Course, index?: number) => {
    if (index !== undefined) {
      setFocusedCourseIndex(index);
    }
    if (user?.uid) {
      void enrollUserInCourse(user.uid, course.id);
    }
    setSelectedCourse(course);
    setInitialLesson(undefined);
    setCurrentView('overview');
  };

  const handleCertificateNotificationClick = useCallback(() => {
    setCompletedCoursesModalSignal((s) => s + 1);
    const prev = currentViewRef.current;
    if (prev !== 'profile') {
      viewBeforeProfileOrSettingsRef.current = prev;
      setProfileSettingsUnderlayView(prev);
      profileReturnCourseIdRef.current = selectedCourse?.id ?? null;
    }
    if (prev === 'overview' || prev === 'player' || prev === 'profile') {
      historyActionRef.current = 'replace';
    }
    setCurrentView('profile');
    scrollDocumentToTop();
  }, [selectedCourse?.id]);

  const handleNotificationAction = useCallback(
    (n: NavbarNotification) => {
      if (n.kind === 'certificate') {
        handleCertificateNotificationClick();
        return;
      }
      if (n.kind === 'generic' && n.actionView) {
        if (n.actionView === 'admin' && n.adminTab) {
          setAdminTab(n.adminTab);
          setCurrentView('admin');
          scrollDocumentToTop();
          return;
        }
        handleNavigate(n.actionView);
        return;
      }
      if (n.kind === 'broadcast' && n.courseId && user?.uid) {
        if (n.alertId) void markAlertRead(user.uid, n.alertId);
        const course = catalogCourses.find((c) => c.id === n.courseId);
        if (!course) return;
        setSelectedCourse(course);
        const lesson = n.lessonId ? findLessonById(course, n.lessonId) : undefined;
        if (lesson) {
          setInitialLesson(lesson);
          setOverviewContentDeepLink(null);
          setCurrentView('player');
        } else {
          setInitialLesson(undefined);
          setOverviewContentDeepLink({ moduleId: n.moduleId, lessonId: n.lessonId });
          setCurrentView('overview');
        }
        historyActionRef.current = 'replace';
        scrollDocumentToTop();
      }
    },
    [handleCertificateNotificationClick, handleNavigate, user?.uid, catalogCourses]
  );

  const handleDismissNotification = useCallback(
    (n: NavbarNotification) => {
      if (!user?.uid && n.id === 'welcome') {
        try {
          localStorage.setItem(SKILLSTREAM_GUEST_WELCOME_DISMISSED_KEY, '1');
        } catch {
          /* ignore */
        }
      }
      if (n.alertId && user?.uid) {
        void markAlertDismissed(user.uid, n.alertId);
      }
    },
    [user?.uid]
  );

  const handleGuestClearNotifications = useCallback(() => {
    if (user?.uid) return;
    try {
      localStorage.setItem(SKILLSTREAM_GUEST_WELCOME_DISMISSED_KEY, '1');
    } catch {
      /* ignore */
    }
  }, [user?.uid]);

  const handleCoursePlayerFinished = useCallback(
    (course: Course) => {
      try {
        recordCourseCompletion(course.id, user?.uid ?? null);
        if (user) {
          void markCourseCompletedTimestampInFirestore(course.id, user.uid);
          const certId = buildCertificateId(course.id, user.uid);
          const userName = user.displayName || user.email?.split('@')[0] || 'Learner';
          void persistCertificateToFirestore({
            courseId: course.id,
            userId: user.uid,
            userName,
            certificateId: certId,
          });
        }
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
    [user]
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

  const handleCloseCertificate = useCallback(() => {
    const wasPublic = certificateData?.isPublic === true;
    const snap = certificateReturnRef.current;
    certificateReturnRef.current = null;
    setCertificateData(null);

    if (wasPublic) {
      historySkipSyncRef.current = true;
      window.history.replaceState(
        { [APP_HISTORY_KEY]: { v: 1, view: 'catalog' } },
        '',
        `${window.location.pathname}#/catalog`
      );
      if (!snap) {
        setSelectedCourse(null);
        setInitialLesson(undefined);
        setCurrentView('catalog');
        scrollDocumentToTop();
        return;
      }
      if (snap.view === 'overview' && snap.courseId) {
        const c = catalogCoursesRef.current.find((x) => x.id === snap.courseId);
        if (c) {
          setSelectedCourse(c);
          setInitialLesson(undefined);
          setCurrentView('overview');
          const payload: AppHistoryPayload = { v: 1, view: 'overview', courseId: snap.courseId };
          window.history.replaceState({ [APP_HISTORY_KEY]: payload }, '', buildHistoryUrl(payload));
          scrollDocumentToTop();
          return;
        }
      }
      setSelectedCourse(null);
      setInitialLesson(undefined);
      setCurrentView(snap.view);
      const p: AppHistoryPayload = { v: 1, view: snap.view as AppHistoryPayload['view'] };
      window.history.replaceState({ [APP_HISTORY_KEY]: p }, '', buildHistoryUrl(p));
      scrollDocumentToTop();
      return;
    }

    historySkipSyncRef.current = true;

    if (!snap) {
      setSelectedCourse(null);
      setInitialLesson(undefined);
      setCurrentView('catalog');
      window.history.replaceState(
        { [APP_HISTORY_KEY]: { v: 1, view: 'catalog' } },
        '',
        buildHistoryUrl({ v: 1, view: 'catalog' })
      );
      scrollDocumentToTop();
      return;
    }

    if (snap.view === 'overview' && snap.courseId) {
      const c = catalogCoursesRef.current.find((x) => x.id === snap.courseId);
      if (c) {
        setSelectedCourse(c);
        setInitialLesson(undefined);
        setCurrentView('overview');
        const payload: AppHistoryPayload = { v: 1, view: 'overview', courseId: snap.courseId };
        window.history.replaceState({ [APP_HISTORY_KEY]: payload }, '', buildHistoryUrl(payload));
        scrollDocumentToTop();
        return;
      }
    }

    if (snap.view === 'overview' && !snap.courseId) {
      setSelectedCourse(null);
      setInitialLesson(undefined);
      setCurrentView('catalog');
      window.history.replaceState(
        { [APP_HISTORY_KEY]: { v: 1, view: 'catalog' } },
        '',
        buildHistoryUrl({ v: 1, view: 'catalog' })
      );
      scrollDocumentToTop();
      return;
    }

    if (snap.view === 'profile' || snap.view === 'settings') {
      historySkipSyncRef.current = true;
      // snap.courseId is the certificate's course, not the underlay (e.g. user on Python player
      // viewing Web Dev cert). Do not overwrite selectedCourse / initialLesson here.
      setCurrentView('profile');
      const returnPayload: AppHistoryPayload = { v: 1, view: 'profile' };
      window.history.replaceState({ [APP_HISTORY_KEY]: returnPayload }, '', buildHistoryUrl(returnPayload));
      scrollDocumentToTop();
      return;
    }

    setSelectedCourse(null);
    setInitialLesson(undefined);
    setCurrentView(snap.view);
    const returnPayload: AppHistoryPayload = { v: 1, view: snap.view as AppHistoryPayload['view'] };
    window.history.replaceState({ [APP_HISTORY_KEY]: returnPayload }, '', buildHistoryUrl(returnPayload));
    scrollDocumentToTop();
  }, [certificateData?.isPublic]);

  const handleShowCertificate = async (courseId: string, userName: string, date: string, certId: string) => {
    historyActionRef.current = 'replace';
    certificateReturnRef.current = {
      view: currentView,
      courseId,
    };
    setCertificateData({
      courseId,
      userName,
      date,
      certificateId: certId,
      isPublic: false
    });
    setCurrentView('certificate');

    if (user) {
      await persistCertificateToFirestore({
        courseId,
        userId: user.uid,
        userName,
        certificateId: certId,
      });
    }
  };

  const renderCertificate = () => {
    if (!certificateData) return null;
    const course = catalogCourses.find(c => c.id === certificateData.courseId);
    if (!course) return null;

    return (
      <div className="mx-auto max-w-7xl px-3 pb-16 pt-20 sm:px-6 sm:pb-20 sm:pt-24 md:px-12">
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

  const profileOverlayOpen = currentView === 'profile';
  const mainView: View = profileOverlayOpen ? (profileSettingsUnderlayView ?? 'catalog') : currentView;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] selection:bg-orange-500/30 transition-colors duration-300">
      {currentView !== 'certificate' && (
        <Navbar 
          onNavigate={handleNavigate} 
          activeView={
            mainView === 'overview' || mainView === 'player' || mainView === 'admin' ? 'catalog' : mainView
          }
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          onCategorySelect={handleCategorySelect}
          onPathSelect={handlePathSelect}
          onSkillSelect={handleSkillSelect}
          onClearFilters={clearFilters}
          theme={theme}
          onThemeToggle={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
          isAuthReady={isAuthReady}
          user={navUser}
          onLogin={() => void handleLogin().catch(() => {})}
          onLogout={handleLogout}
          notifications={navbarNotifications}
          setNotifications={setNotifications}
          onNotificationAction={handleNotificationAction}
          onDismissNotification={handleDismissNotification}
          onGuestClearNotifications={handleGuestClearNotifications}
          isAdmin={isAdminUser}
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

      <main className={profileOverlayOpen ? 'relative' : undefined}>
        <div
          className={
            profileOverlayOpen
              ? 'pointer-events-none select-none overflow-hidden max-h-[calc(100dvh-4rem)]'
              : undefined
          }
          aria-hidden={profileOverlayOpen || undefined}
        >
          {mainView === 'home' && renderHome()}
          {mainView === 'catalog' && renderCatalog()}
          {mainView === 'overview' &&
            (selectedCourseResolved ? (
              !liveCatalogHydrated ? (
                <CourseCatalogLoadingSkeleton variant="overview" />
              ) : (
                <CourseOverview
                  key={`${selectedCourseResolved.id}:${courseCurriculumSignature(selectedCourseResolved)}`}
                  course={selectedCourseResolved}
                  onStartCourse={(lesson) => {
                    setInitialLesson(lesson);
                    setCurrentView('player');
                  }}
                  user={navUser}
                  onLogin={handleLogin}
                  onShowCertificate={handleShowCertificate}
                  remoteDataVersion={remoteProfileDataVersion}
                  contentDeepLink={overviewContentDeepLink}
                  onContentDeepLinkConsumed={() => setOverviewContentDeepLink(null)}
                />
              )
            ) : deferredCourseRoute?.view === 'overview' ? (
              <CourseCatalogLoadingSkeleton variant="overview" />
            ) : null)}
          {mainView === 'player' &&
            (selectedCourseResolved ? (
              !liveCatalogHydrated ? (
                <CourseCatalogLoadingSkeleton variant="player" />
              ) : !isAuthReady ? (
                <div className="min-h-screen pt-28 flex items-center justify-center text-[var(--text-secondary)] text-sm">
                  Loading…
                </div>
              ) : user ? (
                <CoursePlayer
                  key={`${selectedCourseResolved.id}:${courseCurriculumSignature(selectedCourseResolved)}`}
                  course={selectedCourseResolved}
                  initialLesson={initialLesson}
                  onCourseFinished={handleCoursePlayerFinished}
                  user={user}
                  onLogin={handleLogin}
                  pauseForAppNavOverlay={profileOverlayOpen && mainView === 'player'}
                />
              ) : (
                <PlayerSignInGate
                  courseTitle={selectedCourseResolved.title}
                  onLogin={handleLogin}
                />
              )
            ) : deferredCourseRoute?.view === 'player' ? (
              <CourseCatalogLoadingSkeleton variant="player" />
            ) : null)}
          {mainView === 'certificate' && renderCertificate()}
          {mainView === 'about' && renderAbout()}
          {mainView === 'careers' && renderCareers()}
          {mainView === 'privacy' && renderPrivacy()}
          {mainView === 'help' && renderHelp()}
          {mainView === 'contact' && renderContact()}
          {mainView === 'status' && renderStatus()}
          {mainView === 'enterprise' && renderEnterprise()}
          {mainView === 'admin' && isAdminUser && (
            <AdminPage
              courses={catalogCourses}
              activeTab={adminTab}
              currentAdminUid={user?.uid}
              onTabChange={setAdminTab}
              onDismiss={() => handleNavigate('catalog', false)}
              onCatalogChanged={refreshCatalogCourses}
            />
          )}
          {mainView === 'admin' && isAuthReady && user && !adminAccessResolved && (
            <div className="min-h-screen pt-28 flex items-center justify-center text-[var(--text-secondary)] text-sm">
              Checking admin access…
            </div>
          )}
          {mainView === 'signup' && renderSignup()}
        </div>

        {currentView === 'profile' && (
          <div className="fixed inset-x-0 top-16 bottom-0 z-[45] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pb-12 pt-6 backdrop-blur-sm">
            <ProfilePage
              courses={catalogCourses}
              user={user}
              isAuthReady={isAuthReady}
              onLogin={() => void handleLogin().catch(() => {})}
              onShowCertificate={handleShowCertificate}
              openCompletedCoursesSignal={completedCoursesModalSignal}
              onDismiss={handleProfileDismiss}
              remoteProfileDataVersion={remoteProfileDataVersion}
              alertsMuted={alertsMuted}
              onAlertsMutedChange={handleToggleAlertsMuted}
              onDeleteAccount={handleDeleteAccount}
              accountDeletionBlockedMessage={accountDeletionBlockedMessage}
              accountDeletionBlockLoading={accountDeletionBlockLoading}
            />
          </div>
        )}
      </main>

      <DemoLearningAgent
        courses={catalogCourses}
        onOpenCourse={(course) => {
          setSelectedCourse(course);
          setInitialLesson(undefined);
          setCurrentView('overview');
          scrollDocumentToTop();
        }}
      />

      {currentView !== 'player' && currentView !== 'overview' && currentView !== 'admin' && (
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

