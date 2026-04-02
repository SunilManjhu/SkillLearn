import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { Navbar, type NavbarNotification } from './components/Navbar';
import { CourseCard } from './components/CourseCard';
import { CoursePlayer } from './components/CoursePlayer';
import { CourseOverview } from './components/CourseOverview';
import { CourseCatalogLoadingSkeleton } from './components/CourseCatalogLoadingSkeleton';
import { LearnerPathMindmapPanel } from './components/LearnerPathMindmapPanel';
import { CourseLibraryCategoryFilter } from './components/CourseLibraryCategoryFilter';
import { ProfilePage } from './components/ProfilePage';
import { Certificate } from './components/Certificate';
import { filterPathCourseIdsBySavedMindmap } from './data/pathMindmap';
import { useBodyScrollLock } from './hooks/useBodyScrollLock';
import { usePathMindmapOutlineChildren } from './hooks/usePathMindmapOutlineChildren';
import { useDialogKeyboard } from './hooks/useDialogKeyboard';
import { ContactForm } from './components/ContactForm';
import { DemoLearningAgent } from './components/DemoLearningAgent';
import { useLearningAssistantFabVisible } from './hooks/useLearningAssistantFabVisible';
import { useNotificationsSiteEnabled } from './hooks/useNotificationsSiteEnabled';
import { Course, Lesson } from './data/courses';
import type { LearningPath } from './data/learningPaths';
import { AdminPage } from './components/AdminPage';
import { CreatorPage } from './components/CreatorPage';
import {
  ensureUserProfile,
  fetchUserRole,
  countFirestoreAdminUsers,
  subscribeUserRole,
  deleteUserProfileDocument,
} from './utils/userProfileFirestore';
import { peekResolvedCatalogCourses, resolveCatalogCourses } from './utils/publishedCoursesFirestore';
import { loadLearningPathsFromFirestore } from './utils/learningPathsFirestore';
import { listCreatorCoursesForAdminByOwner, loadCreatorCoursesForOwner } from './utils/creatorCoursesFirestore';
import { loadCreatorLearningPathsForOwner } from './utils/creatorLearningPathsFirestore';
import {
  mergeOwnerPreviewCourseRows,
  mergeOwnerPreviewPathRows,
  pickCourseRowForHistoryPayload,
  pickLearningPathRowForSelection,
  pickPublishedFirstCourseRow,
  learningPathStripDraftFlag,
  type CatalogCourseRow,
  type CatalogLearningPathRow,
} from './utils/learnerCatalogMerge';
import {
  peekMergedCatalogLearningPaths,
  peekResolvedCreatorCatalog,
  writeMergedCatalogLearningPaths,
  writeResolvedCreatorCatalog,
} from './utils/creatorCatalogSession';
import { enrollUserInCourse, fetchEnrolledCourseIds } from './utils/enrollmentsFirestore';
import {
  fetchActiveAlertsForCourses,
  loadUserAlertState,
  markAlertDismissed,
  markAlertRead,
  reportNoticesFromQuerySnapshot,
} from './utils/alertsFirestore';
import {
  Play,
  TrendingUp,
  Award,
  Users,
  Globe,
  ChevronRight,
  X,
  CheckCircle,
  Mail,
  LifeBuoy,
  Briefcase,
  Shield,
  Info,
  Clock,
  LogIn,
  AlertTriangle,
  LayoutGrid,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
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
  mergeHashAndHistoryStatePayload,
  parseHashToPayload,
  shouldPushCourseOverviewBeforePlayer,
  readPayloadFromHistoryState,
  resolvePayloadForCourses,
} from './utils/appHistory';
import {
  CATALOG_CATEGORY_EXTRAS_CHANGED,
  readCatalogCategoryExtras,
} from './utils/catalogCategoryExtras';
import {
  CATALOG_SKILL_EXTRAS_CHANGED,
  readCatalogSkillExtras,
} from './utils/catalogSkillExtras';
import {
  CATALOG_SKILL_PRESETS_CHANGED,
  DEFAULT_CATALOG_SKILL_PRESETS,
  normalizeCatalogSkillPresets,
  type CatalogSkillPresetsState,
} from './utils/catalogSkillPresetsState';
import {
  CATALOG_CATEGORY_PRESETS_CHANGED,
  catalogCategoriesRowFromState,
  DEFAULT_CATALOG_CATEGORY_PRESETS,
  normalizeCatalogCategoryPresets,
  type CatalogCategoryPresetsState,
} from './utils/catalogCategoryPresets';
import { loadCatalogCategoryPresets } from './utils/catalogCategoryPresetsFirestore';
import { loadCatalogSkillPresets } from './utils/catalogSkillPresetsFirestore';
import { buildCatalogTaxonomy } from './utils/catalogTaxonomy';
import {
  courseMatchesLibraryFilters,
  toggleFilterTag,
  type LibraryFilterState,
} from './utils/courseTaxonomy';
import { PhoneMockupAdRail } from './components/PhoneMockupAdRail';
import { DEFAULT_HERO_PHONE_AD_SLIDES, type PhoneMockupAdSlide } from './utils/heroPhoneAdsShared';
import { subscribeHeroPhoneAdsForPublic } from './utils/heroPhoneAdsFirestore';

/** Bump when replacing `src/images/Mobile.png` so cached clients load the new file. */
const HERO_MOBILE_PNG_REV = 2;
const mobileHeroSrc = `${new URL('./images/Mobile.png', import.meta.url).href}?v=${HERO_MOBILE_PNG_REV}`;

type View =
  | 'home'
  | 'catalog'
  | 'player'
  | 'overview'
  | 'about'
  | 'careers'
  | 'privacy'
  | 'help'
  | 'contact'
  | 'status'
  | 'enterprise'
  | 'signup'
  | 'profile'
  | 'certificate'
  | 'admin'
  | 'creator';

type PendingAppAdminExit =
  | { mode: 'navigate'; view: View; shouldClear: boolean }
  | { mode: 'history'; payload: AppHistoryPayload }
  | { mode: 'previewCreatorCourse'; ownerUid: string; course: Course }
  | { mode: 'previewCreatorPath'; ownerUid: string; path: LearningPath };

const alertsMutedStorageKey = (uid: string) => `skilllearn-alerts-muted:${uid}`;

function readAlertsMutedFromStorage(uid: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(alertsMutedStorageKey(uid)) === '1';
  } catch {
    return false;
  }
}

type ModerationBellDismissed = { reports: boolean; suggestions: boolean; contact: boolean };

const moderationBellDismissedStorageKey = (uid: string) => `skillstream-moderation-bell-dismissed:${uid}`;

function readModerationBellDismissedFromStorage(uid: string): ModerationBellDismissed {
  if (typeof localStorage === 'undefined') {
    return { reports: false, suggestions: false, contact: false };
  }
  try {
    const raw = localStorage.getItem(moderationBellDismissedStorageKey(uid));
    if (!raw) return { reports: false, suggestions: false, contact: false };
    const p = JSON.parse(raw) as Partial<ModerationBellDismissed>;
    return {
      reports: !!p.reports,
      suggestions: !!p.suggestions,
      contact: !!p.contact,
    };
  } catch {
    return { reports: false, suggestions: false, contact: false };
  }
}

function writeModerationBellDismissedToStorage(uid: string, state: ModerationBellDismissed) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(moderationBellDismissedStorageKey(uid), JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

const ADMIN_DELETE_BLOCKED_MULTI_MSG =
  "Admin accounts can't be deleted. In Admin → Roles, set your role to user (or ask another admin), then return here to delete your account.";

const ADMIN_DELETE_BLOCKED_SOLE_MSG =
  "You're the only admin. Promote another account to admin in Admin → Roles first, then set your role to user — after that you can delete your account.";

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
type DeferredCourseRoute = {
  view: 'overview' | 'player';
  courseId: string;
  lessonId?: string;
  adminPreviewCourseOwnerUid?: string;
};

function getInitialRouteState(catalog: Course[] = []): {
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
        ...(parsed.adminPreviewCourseOwnerUid
          ? { adminPreviewCourseOwnerUid: parsed.adminPreviewCourseOwnerUid }
          : {}),
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

function readInitialLearningPathIdFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  return parseHashToPayload(window.location.hash)?.learningPathId ?? null;
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
    getInitialRouteState(peekResolvedCatalogCourses() ?? [])
  );
  const [currentView, setCurrentView] = useState<View>(initialRoute.view);
  /** Course player: hide global nav + full-bleed video while lesson is playing. */
  const [playerImmersiveNav, setPlayerImmersiveNav] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  /** In-app bell: hide course/admin alerts; certificates still show. Persisted per uid. */
  const [alertsMuted, setAlertsMuted] = useState(false);
  const { siteNotificationsEnabled } = useNotificationsSiteEnabled();
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(initialRoute.selectedCourse);
  /** Disambiguates catalog rows when the same `course.id` appears as published and creator draft. */
  const [selectedCourseIsCreatorDraft, setSelectedCourseIsCreatorDraft] = useState(false);
  /** Set when the selected draft row is an admin-injected preview of another creator’s course (`adminPreviewOwnerUid`). */
  const [selectedCourseAdminPreviewOwnerUid, setSelectedCourseAdminPreviewOwnerUid] = useState<string | null>(null);
  const [initialLesson, setInitialLesson] = useState<Lesson | undefined>(initialRoute.initialLesson);
  /** Current lesson id for player URLs (`#/course/.../player/.../lessonId`); reload restores this lesson. */
  const [playerLessonIdForUrl, setPlayerLessonIdForUrl] = useState<string | null>(() =>
    initialRoute.view === 'player' && initialRoute.initialLesson?.id ? initialRoute.initialLesson.id : null
  );
  const [adminTab, setAdminTab] = useState<AdminHistoryTab>(() => initialRoute.adminTab);
  /** One-shot sub-tab when opening Admin → Moderation from a navbar notification. */
  const [pendingModerationSubTab, setPendingModerationSubTab] = useState<
    'reports' | 'suggestions' | 'contact' | null
  >(null);
  const prevModerationCountsRef = useRef({ reports: 0, suggestions: 0, contact: 0 });
  /** After Clear All / dismiss, hide moderation bell rows until that queue grows (count bump). */
  const moderationBellDismissedRef = useRef({ reports: false, suggestions: false, contact: false });
  const runModerationInboxSyncRef = useRef<(() => void) | null>(null);
  const [deferredCourseRoute, setDeferredCourseRoute] = useState<DeferredCourseRoute | null>(
    () => initialRoute.deferredCourseRoute
  );
  /** When set, catalog lists only courses in this path's `courseIds` (from Firestore `learningPaths`). */
  const [selectedLearningPathId, setSelectedLearningPathId] = useState<string | null>(() =>
    readInitialLearningPathIdFromHash()
  );
  /** When published and creator draft share `selectedLearningPathId`, selects which row is active. */
  const [selectedLearningPathFromCreatorDraft, setSelectedLearningPathFromCreatorDraft] =
    useState(false);
  const [selectedLearningPathAdminPreviewOwnerUid, setSelectedLearningPathAdminPreviewOwnerUid] =
    useState<string | null>(null);
  const [catalogPathRows, setCatalogPathRows] = useState<CatalogLearningPathRow[]>(() =>
    peekMergedCatalogLearningPaths(readCachedAuthProfile()?.uid ?? null) ?? []
  );
  /** True once we have a merged paths snapshot (session) or after first Firestore load. */
  const [learningPathsFetched, setLearningPathsFetched] = useState(
    () => peekMergedCatalogLearningPaths(readCachedAuthProfile()?.uid ?? null) !== null
  );
  const [catalogPrivatePathIds, setCatalogPrivatePathIds] = useState<Set<string>>(() => {
    const uid = readCachedAuthProfile()?.uid ?? null;
    const paths = uid ? peekResolvedCreatorCatalog(uid)?.paths ?? [] : [];
    return new Set(paths.map((p) => p.id));
  });
  /** Admin Creators tab: injected path row(s) for “Open in catalog” preview (another creator’s draft path). */
  const [adminCreatorPreviewPathRows, setAdminCreatorPreviewPathRows] = useState<CatalogLearningPathRow[]>([]);
  const combinedCatalogPathRows = useMemo(
    () => [...catalogPathRows, ...adminCreatorPreviewPathRows],
    [catalogPathRows, adminCreatorPreviewPathRows]
  );
  const activeCatalogPathRow = useMemo((): CatalogLearningPathRow | null => {
    if (selectedLearningPathId == null) return null;
    return (
      pickLearningPathRowForSelection(
        combinedCatalogPathRows,
        selectedLearningPathId,
        selectedLearningPathFromCreatorDraft,
        selectedLearningPathAdminPreviewOwnerUid
      ) ?? null
    );
  }, [
    combinedCatalogPathRows,
    selectedLearningPathId,
    selectedLearningPathFromCreatorDraft,
    selectedLearningPathAdminPreviewOwnerUid,
  ]);

  const activeLearningPath = useMemo(
    () => (activeCatalogPathRow ? learningPathStripDraftFlag(activeCatalogPathRow) : null),
    [activeCatalogPathRow]
  );

  const { loading: pathMindmapOutlineLoading, children: pathMindmapOutlineChildren } =
    usePathMindmapOutlineChildren(selectedLearningPathId, {
      creatorDraftPathIds: catalogPrivatePathIds,
      useCreatorDraftMindmap:
        selectedLearningPathId != null
          ? (activeCatalogPathRow?.fromCreatorDraft ?? false)
          : undefined,
    });
  const [libraryFilters, setLibraryFilters] = useState<LibraryFilterState>({
    categoryTags: [],
    skillTags: [],
    level: null,
  });
  /** Navbar Browse → Skills / topic: narrows catalog without showing in Course filters pill. Cleared when Course filters change or clearFilters. */
  const [navCatalogSkillTag, setNavCatalogSkillTag] = useState<string | null>(null);
  const [navCatalogCategoryTag, setNavCatalogCategoryTag] = useState<string | null>(null);
  const [categoryPresets, setCategoryPresets] = useState<CatalogCategoryPresetsState>(() =>
    normalizeCatalogCategoryPresets(DEFAULT_CATALOG_CATEGORY_PRESETS)
  );
  const [skillPresets, setSkillPresets] = useState<CatalogSkillPresetsState>(() =>
    normalizeCatalogSkillPresets(DEFAULT_CATALOG_SKILL_PRESETS)
  );
  const [heroPhoneAdSlides, setHeroPhoneAdSlides] =
    useState<PhoneMockupAdSlide[]>(DEFAULT_HERO_PHONE_AD_SLIDES);
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
  const [catalogCourseRows, setCatalogCourseRows] = useState<CatalogCourseRow[]>(() => {
    const pub = peekResolvedCatalogCourses() ?? [];
    const uid = readCachedAuthProfile()?.uid ?? null;
    const drafts = uid ? peekResolvedCreatorCatalog(uid)?.courses ?? [] : [];
    return mergeOwnerPreviewCourseRows(pub, drafts);
  });
  /** Admin-only: extra catalog rows from Creator inventory “Open / Play” (other users’ `creatorCourses`). */
  const [adminCreatorPreviewRows, setAdminCreatorPreviewRows] = useState<CatalogCourseRow[]>([]);
  const combinedCatalogRows = useMemo(
    () => [...catalogCourseRows, ...adminCreatorPreviewRows],
    [catalogCourseRows, adminCreatorPreviewRows]
  );
  const catalogCourses = useMemo(
    () => combinedCatalogRows.map((r) => r.course),
    [combinedCatalogRows]
  );
  /**
   * False on cold load when neither published nor creator session snapshots exist — block
   * overview/player until Firestore catches up. Session caches avoid empty-then-pop-in.
   */
  const [liveCatalogHydrated, setLiveCatalogHydrated] = useState(() => {
    if (peekResolvedCatalogCourses() != null) return true;
    const uid = readCachedAuthProfile()?.uid ?? null;
    if (!uid) return false;
    const c = peekResolvedCreatorCatalog(uid);
    return (c?.courses?.length ?? 0) > 0 || (c?.paths?.length ?? 0) > 0;
  });
  const catalogCoursesRef = useRef<Course[]>(catalogCourses);
  catalogCoursesRef.current = catalogCourses;
  const catalogCourseRowsRef = useRef<CatalogCourseRow[]>(combinedCatalogRows);
  catalogCourseRowsRef.current = combinedCatalogRows;

  /** Prefer the live catalog row for this id + draft bit so overview/player stay in sync after refresh. */
  const selectedCourseResolved = useMemo((): Course | null => {
    if (!selectedCourse) return null;
    const row = combinedCatalogRows.find(
      (r) =>
        r.course.id === selectedCourse.id &&
        r.fromCreatorDraft === selectedCourseIsCreatorDraft &&
        (r.adminPreviewOwnerUid ?? null) === (selectedCourseAdminPreviewOwnerUid ?? null)
    );
    return row?.course ?? selectedCourse;
  }, [
    selectedCourse,
    selectedCourseIsCreatorDraft,
    selectedCourseAdminPreviewOwnerUid,
    combinedCatalogRows,
  ]);

  const clearCourseSelection = useCallback(() => {
    setSelectedCourse(null);
    setSelectedCourseIsCreatorDraft(false);
    setSelectedCourseAdminPreviewOwnerUid(null);
  }, []);

  const [isAdminUser, setIsAdminUser] = useState(false);
  const [isCreatorUser, setIsCreatorUser] = useState(false);
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
  /** Bumps when the catalog (with path outline) is shown so section progress bars re-read lesson progress. */
  const [pathProgressSnapshot, setPathProgressSnapshot] = useState(0);
  const [authBanner, setAuthBanner] = useState<string | null>(null);
  const [profileSettingsUnderlayView, setProfileSettingsUnderlayView] = useState<View | null>(null);
  const viewBeforeProfileOrSettingsRef = useRef<View>('catalog');
  /** Course id to restore when leaving profile overlay back to overview (survives certificate overlay). */
  const profileReturnCourseIdRef = useRef<string | null>(null);
  const currentViewRef = useRef<View>(currentView);
  currentViewRef.current = currentView;

  /** True while admin has unsaved Alerts or Content draft (ref for synchronous checks in navigation). */
  const adminPortalUnsavedRef = useRef(false);
  const [adminExitGuardOpen, setAdminExitGuardOpen] = useState(false);
  const pendingAppAdminExitRef = useRef<PendingAppAdminExit | null>(null);

  const handleAdminUnsavedWorkChange = useCallback((dirty: boolean) => {
    adminPortalUnsavedRef.current = dirty;
  }, []);

  const showLearningAssistantFab = useLearningAssistantFabVisible();

  const catalogCategoryFilterTriggerRef = useRef<HTMLInputElement | null>(null);
  /** Bumps when admin adds a custom category (localStorage + event). */
  const [categoryFilterRevision, setCategoryFilterRevision] = useState(0);
  const [skillFilterRevision, setSkillFilterRevision] = useState(0);
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
      p.courseId = selectedCourse?.id ?? deferredCourseRoute?.courseId ?? null;
      if (selectedCourseAdminPreviewOwnerUid) {
        p.adminPreviewCourseOwnerUid = selectedCourseAdminPreviewOwnerUid;
      }
    }
    if (currentView === 'player') {
      const lid = playerLessonIdForUrl ?? initialLesson?.id ?? null;
      if (lid) p.lessonId = lid;
    }
    if (currentView === 'certificate' && certificateData) {
      p.certificate = { ...certificateData };
    }
    if (currentView === 'admin') {
      p.adminTab = adminTab;
    }
    if (selectedLearningPathId) {
      p.learningPathId = selectedLearningPathId;
      if (selectedLearningPathFromCreatorDraft) {
        p.learningPathFromCreatorDraft = true;
      }
      if (selectedLearningPathAdminPreviewOwnerUid) {
        p.learningPathAdminPreviewOwnerUid = selectedLearningPathAdminPreviewOwnerUid;
      }
    }
    return p;
  }, [
    currentView,
    selectedCourse?.id,
    deferredCourseRoute,
    certificateData,
    adminTab,
    selectedLearningPathId,
    selectedLearningPathFromCreatorDraft,
    selectedLearningPathAdminPreviewOwnerUid,
    playerLessonIdForUrl,
    initialLesson?.id,
    selectedCourseAdminPreviewOwnerUid,
  ]);

  const applyHistoryPayload = useCallback(
    (raw: AppHistoryPayload) => {
      const resolved = resolvePayloadForCourses(raw, catalogCoursesRef.current, findLessonById);
      const view = resolved.view as View;

      if (currentViewRef.current === 'admin' && view !== 'admin' && adminPortalUnsavedRef.current) {
        pendingAppAdminExitRef.current = { mode: 'history', payload: raw };
        setAdminExitGuardOpen(true);
        historySkipSyncRef.current = true;
        const restore = buildHistoryPayload();
        window.history.replaceState({ [APP_HISTORY_KEY]: restore }, '', buildHistoryUrl(restore));
        return;
      }

      historySkipSyncRef.current = true;

      if (view === 'certificate' && !resolved.certificate) {
        setCertificateData(null);
        clearCourseSelection();
        setInitialLesson(undefined);
        setPlayerLessonIdForUrl(null);
        setSelectedLearningPathId(null);
        setSelectedLearningPathFromCreatorDraft(false);
        setSelectedLearningPathAdminPreviewOwnerUid(null);
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
        const row = resolved.courseId
          ? pickCourseRowForHistoryPayload(
              catalogCourseRowsRef.current,
              resolved.courseId,
              resolved.adminPreviewCourseOwnerUid
            )
          : undefined;
        const c = row?.course ?? null;
        setSelectedCourse(c);
        setSelectedCourseIsCreatorDraft(row?.fromCreatorDraft ?? false);
        setSelectedCourseAdminPreviewOwnerUid(row?.adminPreviewOwnerUid ?? null);
        if (view === 'overview') {
          setInitialLesson(undefined);
          setPlayerLessonIdForUrl(null);
        } else if (view === 'player' && c) {
          if (resolved.lessonId) {
            setInitialLesson(findLessonById(c, resolved.lessonId) ?? undefined);
            setPlayerLessonIdForUrl(resolved.lessonId);
          } else {
            const uid = readCachedAuthProfile()?.uid ?? null;
            const resume = getResumeOrStartLesson(c, loadLessonProgressMap(c.id, uid));
            setInitialLesson(resume ?? undefined);
            setPlayerLessonIdForUrl(resume?.id ?? null);
          }
        } else {
          setInitialLesson(undefined);
          setPlayerLessonIdForUrl(null);
        }
      } else {
        clearCourseSelection();
        setInitialLesson(undefined);
        setPlayerLessonIdForUrl(null);
      }

      if (view === 'admin') {
        setAdminTab(resolved.adminTab ?? 'alerts');
      }

      setSelectedLearningPathId(resolved.learningPathId ?? null);
      setSelectedLearningPathFromCreatorDraft(resolved.learningPathFromCreatorDraft === true);
      setSelectedLearningPathAdminPreviewOwnerUid(
        resolved.learningPathAdminPreviewOwnerUid?.trim() || null
      );
      setCurrentView(view);
      scrollDocumentToTop();
    },
    [buildHistoryPayload, clearCourseSelection]
  );

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
      /** Hash + state: URL wins for route; merge preserves learningPathId when legacy hash omitted it. */
      const fromHash = parseHashToPayload(window.location.hash);
      const fromState = readPayloadFromHistoryState(window.history.state);
      const raw = mergeHashAndHistoryStatePayload(fromHash, fromState);
      if (!raw) return;
      applyHistoryPayload(raw);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [applyHistoryPayload]);

  /** `#/catalog/path/...` edits: `popstate` does not fire for same-document hash changes. */
  useEffect(() => {
    const onHashChange = () => {
      const fromHash = parseHashToPayload(window.location.hash);
      const fromState = readPayloadFromHistoryState(window.history.state);
      const raw = mergeHashAndHistoryStatePayload(fromHash, fromState);
      if (!raw) return;
      const resolved = resolvePayloadForCourses(raw, catalogCoursesRef.current, findLessonById);
      window.history.replaceState({ [APP_HISTORY_KEY]: resolved }, '', buildHistoryUrl(resolved));
      historySkipSyncRef.current = true;
      applyHistoryPayload(raw);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [applyHistoryPayload]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('cert_id') && currentView === 'certificate' && certificateData?.isPublic) {
      return;
    }

    const payload = buildHistoryPayload();
    const prev = readPayloadFromHistoryState(window.history.state);

    /**
     * Skip one sync after popstate/hashchange so we do not duplicate pushState. If the ref is still
     * set but React already moved (e.g. overview → player), prev !== payload — do not skip or Back
     * can miss the player entry.
     */
    if (historySkipSyncRef.current) {
      historySkipSyncRef.current = false;
      if (historyPayloadsEqual(prev, payload)) {
        return;
      }
    }
    if (historyPayloadsEqual(prev, payload)) {
      if (historyActionRef.current === 'replace') {
        historyActionRef.current = 'push';
      }
      /** `history.state` can match while the visible hash lags (e.g. replaceState without hash update). Heal so Back matches the real route. */
      const expectedUrl = buildHistoryUrl(payload);
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const healed = currentUrl !== expectedUrl;
      if (healed) {
        window.history.replaceState({ [APP_HISTORY_KEY]: payload }, '', expectedUrl);
      }
      return;
    }

    const url = buildHistoryUrl(payload);
    const state = { [APP_HISTORY_KEY]: payload };

    /** Same player session, different lesson: replace so Back still returns to overview (not one step per lesson). */
    const playerOnlyLessonChanged =
      prev?.view === 'player' &&
      payload.view === 'player' &&
      (prev.courseId ?? null) === (payload.courseId ?? null) &&
      (prev.learningPathId ?? null) === (payload.learningPathId ?? null) &&
      (prev.learningPathFromCreatorDraft === true) === (payload.learningPathFromCreatorDraft === true) &&
      (prev.learningPathAdminPreviewOwnerUid ?? null) === (payload.learningPathAdminPreviewOwnerUid ?? null) &&
      (prev.adminPreviewCourseOwnerUid ?? null) === (payload.adminPreviewCourseOwnerUid ?? null) &&
      (prev.lessonId ?? null) !== (payload.lessonId ?? null);
    if (playerOnlyLessonChanged) {
      window.history.replaceState(state, '', url);
      return;
    }

    if (historyActionRef.current === 'replace') {
      historyActionRef.current = 'push';
      /** `replace` overwrites the current entry. Going player after overview must push so Back returns to the course. */
      const pushInsteadOfReplaceForPlayer =
        prev?.view === 'overview' &&
        payload.view === 'player' &&
        (prev.courseId ?? null) === (payload.courseId ?? null) &&
        (prev.adminPreviewCourseOwnerUid ?? null) === (payload.adminPreviewCourseOwnerUid ?? null);
      /** Stale `replace` (e.g. after course completion) must not replace catalog/path with overview — that drops the path from the stack. Push overview instead. */
      const pushInsteadOfReplaceForCatalogToOverview =
        prev?.view === 'catalog' && payload.view === 'overview';
      const pushInsteadOfReplaceForAdminToOverview =
        prev?.view === 'admin' && payload.view === 'overview';
      const willPush =
        pushInsteadOfReplaceForPlayer ||
        pushInsteadOfReplaceForCatalogToOverview ||
        pushInsteadOfReplaceForAdminToOverview;
      if (willPush) {
        window.history.pushState(state, '', url);
      } else {
        window.history.replaceState(state, '', url);
      }
      return;
    }

    window.history.pushState(state, '', url);
  }, [
    buildHistoryPayload,
    currentView,
    selectedCourse?.id,
    deferredCourseRoute,
    certificateData,
    adminTab,
    selectedLearningPathId,
    selectedLearningPathFromCreatorDraft,
    selectedLearningPathAdminPreviewOwnerUid,
    selectedCourseAdminPreviewOwnerUid,
  ]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      if (!nextUser) {
        setUser(null);
        setIsAuthReady(true);
        clearCachedAuthProfile();
        setAuthSnapshot(null);
        setAdminCreatorPreviewRows([]);
        setAdminCreatorPreviewPathRows([]);
        setSelectedCourseAdminPreviewOwnerUid(null);
        setSelectedLearningPathAdminPreviewOwnerUid(null);
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

  const fetchCatalogSnapshot = useCallback(async () => {
    const uid = user?.uid ?? null;
    /** `onAuthStateChanged` fires `getIdToken()` without awaiting; Firestore can run before the token is attached → empty creator reads. Prime token first, and only query when `currentUser` matches React `user`. */
    let privateFirestoreUid: string | null = null;
    if (uid) {
      const cu = auth.currentUser;
      if (cu?.uid === uid) {
        await cu.getIdToken();
        privateFirestoreUid = uid;
      }
    }
    /** Load creator drafts in parallel with published; rules use `ownerUid`, not `users.role`. */
    const [published, pubPaths, draftCourses, draftPaths] = await Promise.all([
      resolveCatalogCourses(),
      loadLearningPathsFromFirestore(),
      privateFirestoreUid ? loadCreatorCoursesForOwner(privateFirestoreUid) : Promise.resolve([] as Course[]),
      privateFirestoreUid
        ? loadCreatorLearningPathsForOwner(privateFirestoreUid)
        : Promise.resolve([] as LearningPath[]),
    ]);
    const includePrivate =
      !!uid && (!adminAccessResolved || isCreatorUser || isAdminUser);
    if (!includePrivate) {
      const courseRows: CatalogCourseRow[] = published.map((course) => ({
        course,
        fromCreatorDraft: false,
      }));
      const pubRows = pubPaths.map((p) => ({ ...p, fromCreatorDraft: false as const }));
      writeMergedCatalogLearningPaths(uid, pubRows);
      return {
        courseRows,
        paths: pubRows,
        privatePathIds: new Set<string>(),
      };
    }
    const courseRows = mergeOwnerPreviewCourseRows(published, draftCourses);
    const mergedPaths = mergeOwnerPreviewPathRows(pubPaths, draftPaths);
    const privatePathIds = new Set(draftPaths.map((p) => p.id));
    if (privateFirestoreUid) {
      writeResolvedCreatorCatalog(privateFirestoreUid, draftCourses, draftPaths);
    }
    writeMergedCatalogLearningPaths(uid, mergedPaths);
    return {
      courseRows,
      paths: mergedPaths,
      privatePathIds,
    };
  }, [user?.uid, adminAccessResolved, isCreatorUser, isAdminUser]);

  useEffect(() => {
    /** Avoid fetching before Firebase delivers the first auth state; otherwise `user` is still null and creator Firestore arms run empty while published/paths still cost ~1s (duplicate work + missing drafts until the next run). */
    if (!isAuthReady) return;
    let cancelled = false;
    void (async () => {
      const uid = user?.uid ?? null;
      let privateFirestoreUid: string | null = null;
      if (uid) {
        const cu = auth.currentUser;
        if (cu?.uid === uid) {
          await cu.getIdToken();
          privateFirestoreUid = uid;
        }
      }
      const includePrivate =
        !!uid && (!adminAccessResolved || isCreatorUser || isAdminUser);

      const publishedP = resolveCatalogCourses();
      const pathsP = loadLearningPathsFromFirestore();
      /** Start in parallel with published so drafts finish ASAP; UI still paints published first (below) so the grid is not blocked on the slower creator queries. */
      const draftCoursesP =
        includePrivate && privateFirestoreUid
          ? loadCreatorCoursesForOwner(privateFirestoreUid)
          : Promise.resolve([] as Course[]);
      const draftPathsP =
        includePrivate && privateFirestoreUid
          ? loadCreatorLearningPathsForOwner(privateFirestoreUid)
          : Promise.resolve([] as LearningPath[]);

      const [published, pubPaths] = await Promise.all([publishedP, pathsP]);
      if (cancelled) return;

      if (!includePrivate) {
        setCatalogCourseRows(
          published.map((course) => ({ course, fromCreatorDraft: false as const }))
        );
        const pubOnlyRows = pubPaths.map((p) => ({ ...p, fromCreatorDraft: false as const }));
        setCatalogPathRows(pubOnlyRows);
        setCatalogPrivatePathIds(new Set());
        writeMergedCatalogLearningPaths(uid, pubOnlyRows);
        setLiveCatalogHydrated(true);
        setLearningPathsFetched(true);
        return;
      }

      const cached =
        privateFirestoreUid != null ? peekResolvedCreatorCatalog(privateFirestoreUid) : null;
      const draftFirst = cached?.courses ?? [];
      const draftPathsFirst = cached?.paths ?? [];
      setCatalogCourseRows(mergeOwnerPreviewCourseRows(published, draftFirst));
      setCatalogPathRows(mergeOwnerPreviewPathRows(pubPaths, draftPathsFirst));
      setCatalogPrivatePathIds(new Set(draftPathsFirst.map((p) => p.id)));
      writeMergedCatalogLearningPaths(uid, mergeOwnerPreviewPathRows(pubPaths, draftPathsFirst));
      setLiveCatalogHydrated(true);
      setLearningPathsFetched(true);

      const [draftCourses, draftPaths] = await Promise.all([draftCoursesP, draftPathsP]);
      if (cancelled) return;

      if (privateFirestoreUid) {
        writeResolvedCreatorCatalog(privateFirestoreUid, draftCourses, draftPaths);
      }
      const mergedPathsLive = mergeOwnerPreviewPathRows(pubPaths, draftPaths);
      writeMergedCatalogLearningPaths(uid, mergedPathsLive);
      setCatalogCourseRows(mergeOwnerPreviewCourseRows(published, draftCourses));
      setCatalogPathRows(mergedPathsLive);
      setCatalogPrivatePathIds(new Set(draftPaths.map((p) => p.id)));
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isAuthReady,
    user?.uid,
    adminAccessResolved,
    isCreatorUser,
    isAdminUser,
  ]);

  const refreshCatalogCourses = useCallback(async () => {
    const snap = await fetchCatalogSnapshot();
    setCatalogCourseRows(snap.courseRows);
    setCatalogPathRows(snap.paths);
    setCatalogPrivatePathIds(snap.privatePathIds);
    setLiveCatalogHydrated(true);
    setLearningPathsFetched(true);
  }, [fetchCatalogSnapshot]);

  /**
   * Re-bind overview/player to the live catalog when it loads (or refreshes).
   * useLayoutEffect: apply before paint so we don’t flash bundled lesson counts, then swap.
   * Prefer URL hash over history.state so the visible deep link wins if they diverge.
   */
  useLayoutEffect(() => {
    const view = currentViewRef.current;
    if (view !== 'overview' && view !== 'player') return;
    const fromHash = parseHashToPayload(window.location.hash);
    const fromState = readPayloadFromHistoryState(window.history.state);
    const raw = mergeHashAndHistoryStatePayload(fromHash, fromState);
    if (!raw || (raw.view !== 'overview' && raw.view !== 'player')) return;
    const resolved = resolvePayloadForCourses(raw, catalogCourses, findLessonById);
    if ((resolved.view !== 'overview' && resolved.view !== 'player') || !resolved.courseId) return;
    const freshRow = pickCourseRowForHistoryPayload(
      combinedCatalogRows,
      resolved.courseId,
      resolved.adminPreviewCourseOwnerUid
    );
    if (!freshRow) return;
    const fresh = freshRow.course;
    setSelectedCourse(fresh);
    setSelectedCourseIsCreatorDraft(freshRow.fromCreatorDraft);
    setSelectedCourseAdminPreviewOwnerUid(freshRow.adminPreviewOwnerUid ?? null);
    if (resolved.view === 'player') {
      if (resolved.lessonId) {
        setInitialLesson(findLessonById(fresh, resolved.lessonId) ?? undefined);
        setPlayerLessonIdForUrl(resolved.lessonId);
      } else {
        const uid = user?.uid ?? readCachedAuthProfile()?.uid ?? null;
        const resume = getResumeOrStartLesson(fresh, loadLessonProgressMap(fresh.id, uid));
        setInitialLesson(resume ?? undefined);
        setPlayerLessonIdForUrl(resume?.id ?? null);
      }
    } else if (resolved.view === 'overview') {
      setInitialLesson(undefined);
    }
    /** Deps: catalog/user only — do not depend on `currentView`. After overview→player the URL updates in a later effect; running on view change read a stale hash as "overview" and cleared the active lesson. */
  }, [catalogCourses, combinedCatalogRows, user?.uid]);

  /** Apply deep link once the live catalog contains a course that was missing on first paint (cold refresh). */
  useLayoutEffect(() => {
    if (!deferredCourseRoute) return;
    const freshRow = pickCourseRowForHistoryPayload(
      combinedCatalogRows,
      deferredCourseRoute.courseId,
      deferredCourseRoute.adminPreviewCourseOwnerUid
    );
    if (freshRow) {
      const fresh = freshRow.course;
      setSelectedCourse(fresh);
      setSelectedCourseIsCreatorDraft(freshRow.fromCreatorDraft);
      setSelectedCourseAdminPreviewOwnerUid(freshRow.adminPreviewOwnerUid ?? null);
      if (deferredCourseRoute.view === 'player') {
        if (deferredCourseRoute.lessonId) {
          setInitialLesson(findLessonById(fresh, deferredCourseRoute.lessonId) ?? undefined);
          setPlayerLessonIdForUrl(deferredCourseRoute.lessonId);
        } else {
          const uid = user?.uid ?? readCachedAuthProfile()?.uid ?? null;
          const resume = getResumeOrStartLesson(fresh, loadLessonProgressMap(fresh.id, uid));
          setInitialLesson(resume ?? undefined);
          setPlayerLessonIdForUrl(resume?.id ?? null);
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
    clearCourseSelection();
    setInitialLesson(undefined);
  }, [combinedCatalogRows, deferredCourseRoute, liveCatalogHydrated, user?.uid, clearCourseSelection]);

  useEffect(() => {
    if (!isAuthReady) {
      setAdminAccessResolved(false);
      setIsCreatorUser(false);
      return;
    }
    if (!user) {
      setIsAdminUser(false);
      setIsCreatorUser(false);
      setAdminAccessResolved(true);
      return;
    }
    setAdminAccessResolved(false);
    let cancelled = false;
    let unsub: (() => void) | null = null;

    void (async () => {
      await ensureUserProfile(user);
      if (cancelled) return;
      unsub = subscribeUserRole(
        user.uid,
        (role) => {
          if (cancelled) return;
          setIsAdminUser(role === 'admin');
          setIsCreatorUser(role === 'creator');
          setAdminAccessResolved(true);
        },
        () => {
          if (cancelled) return;
          setIsAdminUser(false);
          setIsCreatorUser(false);
          setAdminAccessResolved(true);
        }
      );
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [isAuthReady, user]);

  useEffect(() => {
    if (currentView !== 'creator') return;
    if (!isAuthReady || !adminAccessResolved) return;
    if (user && (isCreatorUser || isAdminUser)) return;
    const payload: AppHistoryPayload = { v: 1, view: 'catalog' };
    historyActionRef.current = 'replace';
    window.history.replaceState({ [APP_HISTORY_KEY]: payload }, '', buildHistoryUrl(payload));
    setCurrentView('catalog');
    scrollDocumentToTop();
  }, [currentView, isAuthReady, adminAccessResolved, user, isCreatorUser, isAdminUser]);

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
          // Do not preserve admin-moderation-* here — that reintroduces rows after Clear All when
          // this async merge runs after reportNotices / course alerts refresh.
          const certs = prev.filter((n) => n.kind === 'certificate');
          return [...rows, ...certs];
        });
        // Re-apply moderation inbox rows from the admin listener (respects dismiss + counts).
        queueMicrotask(() => {
          runModerationInboxSyncRef.current?.();
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
      prevModerationCountsRef.current = { reports: 0, suggestions: 0, contact: 0 };
      moderationBellDismissedRef.current = { reports: false, suggestions: false, contact: false };
      runModerationInboxSyncRef.current = null;
      return;
    }

    const uid = user.uid;
    moderationBellDismissedRef.current = readModerationBellDismissedFromStorage(uid);

    let reportCount = 0;
    let suggestionCount = 0;
    let contactCount = 0;
    let cancelled = false;
    /** Skip unread bump on the first snapshot per listener (avoid marking existing backlog as new). */
    const skipFirstSnapshot = { reports: true, suggestions: true, contact: true };
    let bumpedReports = false;
    let bumpedSuggestions = false;
    let bumpedContact = false;

    const syncAdminInboxNotifications = () => {
      if (cancelled) return;
      const br = bumpedReports;
      const bs = bumpedSuggestions;
      const bc = bumpedContact;
      bumpedReports = false;
      bumpedSuggestions = false;
      bumpedContact = false;
      setNotifications((prev) => {
        const byId = new Map<string, NavbarNotification>(prev.map((n) => [n.id, n]));
        const nonAdminRows = prev.filter((n) => !n.id.startsWith('admin-moderation-'));
        const adminRows: NavbarNotification[] = [];
        if (reportCount > 0) {
          const suppress = moderationBellDismissedRef.current.reports && !br;
          if (!suppress) {
            if (br) moderationBellDismissedRef.current.reports = false;
            const id = 'admin-moderation-reports';
            adminRows.push({
              id,
              kind: 'generic',
              actionView: 'admin',
              adminTab: 'moderation',
              adminModerationSubTab: 'reports',
              actionLabel: 'Open moderation',
              message: `Moderation inbox: Reports (${reportCount}) need review.`,
              time: 'Now',
              read: br ? false : (byId.get(id)?.read ?? false),
            });
          }
        }
        if (suggestionCount > 0) {
          const suppress = moderationBellDismissedRef.current.suggestions && !bs;
          if (!suppress) {
            if (bs) moderationBellDismissedRef.current.suggestions = false;
            const id = 'admin-moderation-suggestions';
            adminRows.push({
              id,
              kind: 'generic',
              actionView: 'admin',
              adminTab: 'moderation',
              adminModerationSubTab: 'suggestions',
              actionLabel: 'Open moderation',
              message: `Moderation inbox: URL suggestions (${suggestionCount}) need review.`,
              time: 'Now',
              read: bs ? false : (byId.get(id)?.read ?? false),
            });
          }
        }
        if (contactCount > 0) {
          const suppress = moderationBellDismissedRef.current.contact && !bc;
          if (!suppress) {
            if (bc) moderationBellDismissedRef.current.contact = false;
            const id = 'admin-moderation-contact';
            adminRows.push({
              id,
              kind: 'generic',
              actionView: 'admin',
              adminTab: 'moderation',
              adminModerationSubTab: 'contact',
              actionLabel: 'Open moderation',
              message: `Moderation inbox: Contact messages (${contactCount}) need review.`,
              time: 'Now',
              read: bc ? false : (byId.get(id)?.read ?? false),
            });
          }
        }
        writeModerationBellDismissedToStorage(uid, {
          reports: moderationBellDismissedRef.current.reports,
          suggestions: moderationBellDismissedRef.current.suggestions,
          contact: moderationBellDismissedRef.current.contact,
        });
        return [...adminRows, ...nonAdminRows];
      });
    };

    runModerationInboxSyncRef.current = syncAdminInboxNotifications;

    const unsubReports = onSnapshot(collection(db, 'reports'), (snap) => {
      const size = snap.size;
      if (!skipFirstSnapshot.reports) {
        if (size > prevModerationCountsRef.current.reports) bumpedReports = true;
      } else {
        skipFirstSnapshot.reports = false;
      }
      prevModerationCountsRef.current.reports = size;
      reportCount = size;
      syncAdminInboxNotifications();
    });
    const unsubSuggestions = onSnapshot(collection(db, 'suggestions'), (snap) => {
      const size = snap.size;
      if (!skipFirstSnapshot.suggestions) {
        if (size > prevModerationCountsRef.current.suggestions) bumpedSuggestions = true;
      } else {
        skipFirstSnapshot.suggestions = false;
      }
      prevModerationCountsRef.current.suggestions = size;
      suggestionCount = size;
      syncAdminInboxNotifications();
    });
    const unsubContact = onSnapshot(collection(db, 'contactMessages'), (snap) => {
      const size = snap.size;
      if (!skipFirstSnapshot.contact) {
        if (size > prevModerationCountsRef.current.contact) bumpedContact = true;
      } else {
        skipFirstSnapshot.contact = false;
      }
      prevModerationCountsRef.current.contact = size;
      contactCount = size;
      syncAdminInboxNotifications();
    });

    return () => {
      cancelled = true;
      runModerationInboxSyncRef.current = null;
      unsubReports();
      unsubSuggestions();
      unsubContact();
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
      const payload: AppHistoryPayload = { v: 1, view: 'catalog' };
      historyActionRef.current = 'replace';
      window.history.replaceState({ [APP_HISTORY_KEY]: payload }, '', buildHistoryUrl(payload));
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
    const row = payload.courseId
      ? pickPublishedFirstCourseRow(catalogCourseRowsRef.current, payload.courseId)
      : undefined;
    const course = row?.course;

    if (payload.view === 'overview' && course) {
      setSelectedCourse(course);
      setSelectedCourseIsCreatorDraft(row?.fromCreatorDraft ?? false);
      setSelectedCourseAdminPreviewOwnerUid(row?.adminPreviewOwnerUid ?? null);
      setInitialLesson(undefined);
      setCurrentView('overview');
      scrollDocumentToTop();
      return;
    }
    if (payload.view === 'player' && course) {
      setSelectedCourse(course);
      setSelectedCourseIsCreatorDraft(row?.fromCreatorDraft ?? false);
      setSelectedCourseAdminPreviewOwnerUid(row?.adminPreviewOwnerUid ?? null);
      const explicit = payload.initialLessonId ? findLessonById(course, payload.initialLessonId) : undefined;
      const uid = auth.currentUser?.uid ?? null;
      const resume = getResumeOrStartLesson(course, loadLessonProgressMap(course.id, uid));
      const lesson = explicit ?? resume ?? undefined;
      setInitialLesson(lesson);
      setPlayerLessonIdForUrl(lesson?.id ?? null);
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
      if (course) {
        setSelectedCourse(course);
        setSelectedCourseIsCreatorDraft(row?.fromCreatorDraft ?? false);
        setSelectedCourseAdminPreviewOwnerUid(row?.adminPreviewOwnerUid ?? null);
      }
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

  const handleDeleteAccount = useCallback(async (): Promise<
    { ok: true } | { ok: false; error?: string }
  > => {
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
    const firestoreDelete = await deleteUserProfileDocument(uid);
    if (firestoreDelete.ok === false) {
      return {
        ok: false,
        error:
          firestoreDelete.message ||
          'Could not remove your profile from the database. Deploy the latest Firestore rules if this persists.',
      };
    }
    const result = await deleteCurrentUserAccount();
    if (result.ok === false) {
      if (result.code === 'redirecting') {
        return { ok: false };
      }
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
    clearCourseSelection();
    setInitialLesson(undefined);
    setNotifications([]);
    return { ok: true };
  }, [clearCourseSelection]);

  const navbarNotifications = useMemo(() => {
    if (!siteNotificationsEnabled) {
      return notifications.filter((n) => n.kind === 'certificate');
    }
    if (user?.uid && alertsMuted) {
      return notifications.filter(
        (n) => n.kind === 'certificate' || n.id.startsWith('admin-moderation-')
      );
    }
    return notifications;
  }, [siteNotificationsEnabled, user?.uid, alertsMuted, notifications]);

  const accountDeletionBlockLoading =
    isAdminUser && adminAccessResolved && firestoreAdminCount === null;
  const accountDeletionBlockedMessage = !isAdminUser
    ? null
    : accountDeletionBlockLoading
      ? null
      : firestoreAdminCount === 1
        ? ADMIN_DELETE_BLOCKED_SOLE_MSG
        : ADMIN_DELETE_BLOCKED_MULTI_MSG;

  const moreCategories = useMemo(() => {
    // Derived via shared taxonomy builder (presets + extras + discovered-from-courses), excluding main.
    const t = buildCatalogTaxonomy({ courses: catalogCourses, topicPresets: categoryPresets, skillPresets });
    return t.topics.more;
  }, [catalogCourses, categoryFilterRevision, categoryPresets, skillPresets]);

  /** Browse menu categories — same sources as Course Library (main pills + More), excluding “All”. */
  const catalogBrowseCategories = useMemo(
    () => [...categoryPresets.mainPills, ...moreCategories],
    [categoryPresets.mainPills, moreCategories]
  );

  const moreSkills = useMemo(() => {
    const t = buildCatalogTaxonomy({ courses: catalogCourses, topicPresets: categoryPresets, skillPresets });
    return t.skills.more;
  }, [catalogCourses, categoryPresets, skillFilterRevision, skillPresets]);

  const catalogBrowseSkills = useMemo(
    () => [...skillPresets.mainPills, ...moreSkills],
    [skillPresets.mainPills, moreSkills]
  );

  const filteredCatalogRows = useMemo(
    () =>
      combinedCatalogRows.filter((row) => {
        const course = row.course;
        const rawPathCourseIds =
          selectedLearningPathId != null ? activeLearningPath?.courseIds : null;
        const pathCourseIds =
          rawPathCourseIds != null
            ? filterPathCourseIdsBySavedMindmap(rawPathCourseIds, pathMindmapOutlineChildren)
            : null;
        const matchesPath =
          selectedLearningPathId == null ||
          (pathCourseIds != null && pathCourseIds.includes(course.id));

        if (!matchesPath) return false;

        if (navCatalogSkillTag) {
          const k = navCatalogSkillTag.trim().toLowerCase();
          const ss = course.skills.map((s) => s.trim().toLowerCase());
          if (!ss.includes(k)) return false;
        }
        if (navCatalogCategoryTag) {
          const k = navCatalogCategoryTag.trim().toLowerCase();
          const cc = course.categories.map((c) => c.trim().toLowerCase());
          if (!cc.includes(k)) return false;
        }

        return courseMatchesLibraryFilters(course, libraryFilters);
      }),
    [
      combinedCatalogRows,
      selectedLearningPathId,
      activeLearningPath,
      pathMindmapOutlineChildren,
      navCatalogSkillTag,
      navCatalogCategoryTag,
      libraryFilters,
    ]
  );

  const filteredCourses = useMemo(
    () => filteredCatalogRows.map((r) => r.course),
    [filteredCatalogRows]
  );

  const handleCourseRowClick = (row: CatalogCourseRow, focusIndex?: number) => {
    if (focusIndex !== undefined) {
      setFocusedCourseIndex(focusIndex);
    }
    if (user?.uid) {
      void enrollUserInCourse(user.uid, row.course.id);
    }
    setSelectedCourse(row.course);
    setSelectedCourseIsCreatorDraft(row.fromCreatorDraft);
    setSelectedCourseAdminPreviewOwnerUid(row.adminPreviewOwnerUid ?? null);
    setInitialLesson(undefined);
    setCurrentView('overview');
  };

  const handleCourseClick = (course: Course, index?: number) => {
    if (index !== undefined) {
      const row = filteredCatalogRows[index];
      if (row && row.course.id === course.id) {
        handleCourseRowClick(row, index);
        return;
      }
    }
    const byRef = combinedCatalogRows.find((r) => r.course === course);
    if (byRef) {
      handleCourseRowClick(byRef);
      return;
    }
    const row = pickPublishedFirstCourseRow(combinedCatalogRows, course.id);
    if (row) handleCourseRowClick(row);
  };

  const resolveCatalogRowForPathCourse = useCallback(
    (courseId: string): CatalogCourseRow | undefined => {
      const pathIsDraft =
        selectedLearningPathId != null && activeCatalogPathRow?.fromCreatorDraft === true;
      const pathPreviewUid = activeCatalogPathRow?.adminPreviewOwnerUid?.trim();
      if (pathIsDraft && pathPreviewUid) {
        return (
          combinedCatalogRows.find(
            (r) =>
              r.course.id === courseId &&
              r.fromCreatorDraft &&
              r.adminPreviewOwnerUid === pathPreviewUid
          ) ??
          combinedCatalogRows.find((r) => r.course.id === courseId && r.fromCreatorDraft) ??
          pickPublishedFirstCourseRow(combinedCatalogRows, courseId)
        );
      }
      if (pathIsDraft) {
        return (
          combinedCatalogRows.find((r) => r.course.id === courseId && r.fromCreatorDraft) ??
          pickPublishedFirstCourseRow(combinedCatalogRows, courseId)
        );
      }
      return pickPublishedFirstCourseRow(combinedCatalogRows, courseId);
    },
    [
      selectedLearningPathId,
      activeCatalogPathRow?.fromCreatorDraft,
      activeCatalogPathRow?.adminPreviewOwnerUid,
      combinedCatalogRows,
    ]
  );

  const clearFilters = () => {
    setSelectedLearningPathId(null);
    setSelectedLearningPathFromCreatorDraft(false);
    setSelectedLearningPathAdminPreviewOwnerUid(null);
    setAdminCreatorPreviewPathRows([]);
    setAdminCreatorPreviewRows([]);
    if (selectedCourseAdminPreviewOwnerUid != null) {
      clearCourseSelection();
    }
    setLibraryFilters({ categoryTags: [], skillTags: [], level: null });
    setNavCatalogSkillTag(null);
    setNavCatalogCategoryTag(null);
  };

  const handleCourseLibraryFiltersChange = useCallback((next: LibraryFilterState) => {
    setNavCatalogSkillTag(null);
    setNavCatalogCategoryTag(null);
    setLibraryFilters(next);
  }, []);

  useEffect(() => {
    const onExtras = () => setCategoryFilterRevision((r) => r + 1);
    window.addEventListener(CATALOG_CATEGORY_EXTRAS_CHANGED, onExtras);
    return () => window.removeEventListener(CATALOG_CATEGORY_EXTRAS_CHANGED, onExtras);
  }, []);

  useEffect(() => {
    void loadCatalogCategoryPresets().then(setCategoryPresets);
  }, []);

  useEffect(() => {
    void loadCatalogSkillPresets().then(setSkillPresets);
  }, []);

  useEffect(() => {
    const unsub = subscribeHeroPhoneAdsForPublic(setHeroPhoneAdSlides);
    return unsub;
  }, []);

  useEffect(() => {
    const onPresets = () => void loadCatalogCategoryPresets().then(setCategoryPresets);
    window.addEventListener(CATALOG_CATEGORY_PRESETS_CHANGED, onPresets);
    return () => window.removeEventListener(CATALOG_CATEGORY_PRESETS_CHANGED, onPresets);
  }, []);

  useEffect(() => {
    const onPresets = () => void loadCatalogSkillPresets().then(setSkillPresets);
    window.addEventListener(CATALOG_SKILL_PRESETS_CHANGED, onPresets);
    return () => window.removeEventListener(CATALOG_SKILL_PRESETS_CHANGED, onPresets);
  }, []);

  useEffect(() => {
    const onSkillExtras = () => setSkillFilterRevision((r) => r + 1);
    window.addEventListener(CATALOG_SKILL_EXTRAS_CHANGED, onSkillExtras);
    return () => window.removeEventListener(CATALOG_SKILL_EXTRAS_CHANGED, onSkillExtras);
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
    if (currentView !== 'player') setPlayerImmersiveNav(false);
  }, [currentView]);

  useEffect(() => {
    if (currentView !== 'profile' && currentView !== 'certificate') {
      setProfileSettingsUnderlayView(null);
    }
  }, [currentView]);

  useEffect(() => {
    if (currentView !== 'catalog') return;
    setPathProgressSnapshot((n) => n + 1);
  }, [currentView, selectedLearningPathId]);

  useLayoutEffect(() => {
    if (currentView === 'profile' && profileSettingsUnderlayView === null) {
      viewBeforeProfileOrSettingsRef.current = 'catalog';
      setProfileSettingsUnderlayView('catalog');
    }
  }, [currentView, profileSettingsUnderlayView]);

  const closeAppAdminExitGuard = useCallback(() => {
    pendingAppAdminExitRef.current = null;
    setAdminExitGuardOpen(false);
  }, []);

  useBodyScrollLock(currentView === 'profile');
  useBodyScrollLock(adminExitGuardOpen);

  useDialogKeyboard({
    open: adminExitGuardOpen,
    onClose: closeAppAdminExitGuard,
  });

  /** Full-width views that replace the main column; reset document scroll so content isn’t off-screen. */
  useLayoutEffect(() => {
    if (
      currentView === 'overview' ||
      currentView === 'player' ||
      currentView === 'certificate' ||
      currentView === 'admin' ||
      currentView === 'creator'
    ) {
      scrollDocumentToTop();
    }
  }, [currentView, selectedCourse?.id]);

  const applyNavigate = (view: View, shouldClear = true) => {
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
      setFocusedFooterIndex(-1);
    }
    if (view === 'admin') {
      setAdminTab('alerts');
    }
    setCurrentView(view);
    scrollDocumentToTop();
  };

  const applyAdminCreatorPreview = useCallback(
    (ownerUid: string, course: Course) => {
      const previewRow: CatalogCourseRow = {
        course,
        fromCreatorDraft: true,
        adminPreviewOwnerUid: ownerUid,
      };
      setAdminCreatorPreviewRows((prev) => {
        const without = prev.filter(
          (r) => !(r.adminPreviewOwnerUid === ownerUid && r.course.id === course.id)
        );
        return [...without, previewRow];
      });
      if (user?.uid) {
        void enrollUserInCourse(user.uid, course.id);
      }
      setSelectedCourse(course);
      setSelectedCourseIsCreatorDraft(true);
      setSelectedCourseAdminPreviewOwnerUid(ownerUid);
      /** Push so browser Back returns to Admin (e.g. Creators tab); replace would drop admin from the stack. */
      historyActionRef.current = 'push';
      setInitialLesson(undefined);
      setPlayerLessonIdForUrl(null);
      setCurrentView('overview');
      scrollDocumentToTop();
    },
    [user?.uid]
  );

  const applyAdminCreatorPreviewPath = useCallback(
    (ownerUid: string, path: LearningPath) => {
      const pathRow: CatalogLearningPathRow = {
        ...path,
        fromCreatorDraft: true,
        adminPreviewOwnerUid: ownerUid,
      };
      setAdminCreatorPreviewPathRows([pathRow]);
      const courseIdSet = new Set(path.courseIds);
      void listCreatorCoursesForAdminByOwner(ownerUid).then((courses) => {
        const additions = courses
          .filter((c) => courseIdSet.has(c.id))
          .map(
            (course): CatalogCourseRow => ({
              course,
              fromCreatorDraft: true,
              adminPreviewOwnerUid: ownerUid,
            })
          );
        setAdminCreatorPreviewRows((prev) => {
          const rest = prev.filter((r) => r.adminPreviewOwnerUid !== ownerUid);
          return [...rest, ...additions];
        });
      });
      setSelectedLearningPathId(path.id);
      setSelectedLearningPathFromCreatorDraft(true);
      setSelectedLearningPathAdminPreviewOwnerUid(ownerUid);
      historyActionRef.current = 'push';
      setCurrentView('catalog');
      scrollDocumentToTop();
    },
    []
  );

  const handleAdminPreviewCreatorCourse = useCallback(
    (ownerUid: string, course: Course) => {
      if (currentViewRef.current === 'admin' && adminPortalUnsavedRef.current) {
        pendingAppAdminExitRef.current = {
          mode: 'previewCreatorCourse',
          ownerUid,
          course,
        };
        setAdminExitGuardOpen(true);
        return;
      }
      applyAdminCreatorPreview(ownerUid, course);
    },
    [applyAdminCreatorPreview]
  );

  const handleAdminPreviewCreatorPath = useCallback(
    (ownerUid: string, path: LearningPath) => {
      if (currentViewRef.current === 'admin' && adminPortalUnsavedRef.current) {
        pendingAppAdminExitRef.current = { mode: 'previewCreatorPath', ownerUid, path };
        setAdminExitGuardOpen(true);
        return;
      }
      applyAdminCreatorPreviewPath(ownerUid, path);
    },
    [applyAdminCreatorPreviewPath]
  );

  const handleNavigate = (view: View, shouldClear = true) => {
    if (currentViewRef.current === 'admin' && view !== 'admin' && adminPortalUnsavedRef.current) {
      pendingAppAdminExitRef.current = { mode: 'navigate', view, shouldClear };
      setAdminExitGuardOpen(true);
      return;
    }
    applyNavigate(view, shouldClear);
  };

  const confirmAppAdminExit = () => {
    const pending = pendingAppAdminExitRef.current;
    pendingAppAdminExitRef.current = null;
    setAdminExitGuardOpen(false);
    if (!pending) return;
    adminPortalUnsavedRef.current = false;
    if (pending.mode === 'navigate') {
      applyNavigate(pending.view, pending.shouldClear);
    } else if (pending.mode === 'history') {
      applyHistoryPayload(pending.payload);
    } else if (pending.mode === 'previewCreatorPath') {
      applyAdminCreatorPreviewPath(pending.ownerUid, pending.path);
    } else {
      applyAdminCreatorPreview(pending.ownerUid, pending.course);
    }
  };

  /** Restore course context when leaving profile overlay to overview or player (e.g. cert overlay touched selection). */
  const handleProfileDismiss = () => {
    const v = viewBeforeProfileOrSettingsRef.current;
    if ((v === 'overview' || v === 'player') && profileReturnCourseIdRef.current) {
      const row = pickPublishedFirstCourseRow(combinedCatalogRows, profileReturnCourseIdRef.current);
      if (row) {
        setSelectedCourse(row.course);
        setSelectedCourseIsCreatorDraft(row.fromCreatorDraft);
        setSelectedCourseAdminPreviewOwnerUid(row.adminPreviewOwnerUid ?? null);
        if (v === 'overview') {
          setInitialLesson(undefined);
        }
      }
    }
    handleNavigate(v, false);
  };

  /**
   * Before opening the player from course overview, ensure the history stack has an entry for this
   * overview. Prefer the visible hash over merged state: state can match overview while the URL
   * still shows catalog, so the sync effect skipped pushing and Back goes path → player.
   *
   * Do **not** push when `shouldPushCourseOverviewBeforePlayer` is false: always pushing in that
   * case duplicated the same overview URL and required an extra Back on the same overview.
   */
  const handleStartCourseFromOverview = useCallback(
    (lesson?: Lesson) => {
      /** Stale `replace` skips resetting the ref when sync early-returns; next nav would replaceState over overview. */
      historyActionRef.current = 'push';
      const onOverview =
        currentView === 'overview' || currentViewRef.current === 'overview';
      if (onOverview && selectedCourseResolved) {
        const overviewPayload = buildHistoryPayload();
        if (overviewPayload.view === 'overview' && overviewPayload.courseId) {
          const h = parseHashToPayload(window.location.hash);
          const fromState = readPayloadFromHistoryState(window.history.state);
          const shouldPushHeuristic = shouldPushCourseOverviewBeforePlayer(h, fromState, overviewPayload);
          if (shouldPushHeuristic) {
            window.history.pushState(
              { [APP_HISTORY_KEY]: overviewPayload },
              '',
              buildHistoryUrl(overviewPayload)
            );
          }
        }
      }
      setPlayerLessonIdForUrl(lesson?.id ?? null);
      setInitialLesson(lesson);
      setCurrentView('player');
    },
    [buildHistoryPayload, currentView, selectedCourseResolved]
  );

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

  const clearPendingModerationSubTab = useCallback(() => setPendingModerationSubTab(null), []);

  const handleClearAllNotifications = useCallback(() => {
    if (!user?.uid) return;
    moderationBellDismissedRef.current = { reports: true, suggestions: true, contact: true };
    writeModerationBellDismissedToStorage(user.uid, moderationBellDismissedRef.current);
    runModerationInboxSyncRef.current?.();
  }, [user?.uid]);

  /** Drop player lesson id from URL state when leaving the player (history sync uses buildHistoryPayload). */
  useEffect(() => {
    if (currentView !== 'player') {
      setPlayerLessonIdForUrl(null);
    }
  }, [currentView]);

  const handlePlayerActiveLessonIdChange = useCallback((lessonId: string) => {
    setPlayerLessonIdForUrl(lessonId);
  }, []);

  const handleNotificationAction = useCallback(
    (n: NavbarNotification) => {
      if (n.kind === 'certificate') {
        handleCertificateNotificationClick();
        return;
      }
      if (n.kind === 'generic' && n.actionView) {
        if (n.actionView === 'admin' && n.adminTab) {
          setAdminTab(n.adminTab);
          if (n.adminTab === 'moderation' && n.adminModerationSubTab) {
            setPendingModerationSubTab(n.adminModerationSubTab);
          } else {
            setPendingModerationSubTab(null);
          }
          setCurrentView('admin');
          scrollDocumentToTop();
          return;
        }
        handleNavigate(n.actionView);
        return;
      }
      if (n.kind === 'broadcast' && n.courseId && user?.uid) {
        if (n.alertId) void markAlertRead(user.uid, n.alertId);
        const row = pickPublishedFirstCourseRow(catalogCourseRowsRef.current, n.courseId);
        if (!row) return;
        const course = row.course;
        setSelectedCourse(course);
        setSelectedCourseIsCreatorDraft(row.fromCreatorDraft);
        setSelectedCourseAdminPreviewOwnerUid(row.adminPreviewOwnerUid ?? null);
        const lesson = n.lessonId ? findLessonById(course, n.lessonId) : undefined;
        if (lesson) {
          setPlayerLessonIdForUrl(lesson.id);
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
    [handleCertificateNotificationClick, handleNavigate, user?.uid]
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
      if (n.id === 'admin-moderation-reports') moderationBellDismissedRef.current.reports = true;
      else if (n.id === 'admin-moderation-suggestions') moderationBellDismissedRef.current.suggestions = true;
      else if (n.id === 'admin-moderation-contact') moderationBellDismissedRef.current.contact = true;
      if (n.id.startsWith('admin-moderation-') && user?.uid) {
        writeModerationBellDismissedToStorage(user.uid, moderationBellDismissedRef.current);
        runModerationInboxSyncRef.current?.();
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
        setPlayerLessonIdForUrl(null);
        setCurrentView('overview');
        scrollDocumentToTop();
      }
    },
    [user]
  );

  const handleCategorySelect = (category: string) => {
    setSelectedLearningPathId(null);
    setSelectedLearningPathFromCreatorDraft(false);
    setSelectedLearningPathAdminPreviewOwnerUid(null);
    setAdminCreatorPreviewPathRows([]);
    setAdminCreatorPreviewRows([]);
    if (selectedCourseAdminPreviewOwnerUid != null) {
      clearCourseSelection();
    }
    setLibraryFilters({ categoryTags: [], skillTags: [], level: null });
    const tags = toggleFilterTag([], category, catalogBrowseCategories);
    setNavCatalogCategoryTag(tags[0] ?? null);
    setNavCatalogSkillTag(null);
    handleNavigate('catalog', false);
  };

  const handlePathSelect = (
    pathId: string,
    fromCreatorDraft?: boolean,
    adminPreviewOwnerUid?: string
  ) => {
    setAdminCreatorPreviewRows([]);
    if (selectedCourseAdminPreviewOwnerUid != null) {
      clearCourseSelection();
    }
    setSelectedLearningPathId(pathId);
    setSelectedLearningPathFromCreatorDraft(fromCreatorDraft === true);
    setSelectedLearningPathAdminPreviewOwnerUid(adminPreviewOwnerUid?.trim() || null);
    setLibraryFilters({ categoryTags: [], skillTags: [], level: null });
    setNavCatalogSkillTag(null);
    setNavCatalogCategoryTag(null);
    handleNavigate('catalog', false);
  };

  /** Navbar Skills: narrow catalog by skill without syncing to Course filters pill. */
  const handleSkillSelect = (skill: string) => {
    setSelectedLearningPathId(null);
    setSelectedLearningPathFromCreatorDraft(false);
    setSelectedLearningPathAdminPreviewOwnerUid(null);
    setAdminCreatorPreviewPathRows([]);
    setAdminCreatorPreviewRows([]);
    if (selectedCourseAdminPreviewOwnerUid != null) {
      clearCourseSelection();
    }
    setLibraryFilters({ categoryTags: [], skillTags: [], level: null });
    const tags = toggleFilterTag([], skill, catalogBrowseSkills);
    setNavCatalogSkillTag(tags[0] ?? null);
    setNavCatalogCategoryTag(null);
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
    if (currentView !== 'catalog') return;
    // Only move focus to a course card — do not focus the filter trigger on load (avoids a visible focus ring on reload).
    if (focusedCourseIndex < 0) return;
    const timer = setTimeout(() => {
      courseRefs.current[focusedCourseIndex]?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [currentView, focusedCourseIndex]);

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
        catalogCategoryFilterTriggerRef.current?.focus();
      } else {
        const prevIndex = index - cols;
        setFocusedCourseIndex(prevIndex);
        courseRefs.current[prevIndex]?.focus();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = filteredCatalogRows[index];
      if (row) handleCourseRowClick(row, index);
    }
  };

  const handleFooterKeyDown = (e: React.KeyboardEvent, index: number) => {
    const footerLinksCount = 6; // Focusable footer links (Solutions rows are static)
    /** Contact Us is hidden below md — hamburger-only entry on narrow viewports. */
    const skipContactIndex =
      typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches;
    const stepFooterIndex = (from: number, delta: number) => {
      let i = from;
      for (let n = 0; n < footerLinksCount; n++) {
        i = (i + delta + footerLinksCount) % footerLinksCount;
        if (i === 1 && skipContactIndex) continue;
        return i;
      }
      return from;
    };
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = stepFooterIndex(index, 1);
      setFocusedFooterIndex(nextIndex);
      footerRefs.current[nextIndex]?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = stepFooterIndex(index, -1);
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
        clearCourseSelection();
        setInitialLesson(undefined);
        setCurrentView('catalog');
        scrollDocumentToTop();
        return;
      }
      if (snap.view === 'overview' && snap.courseId) {
        const row = pickPublishedFirstCourseRow(catalogCourseRowsRef.current, snap.courseId);
        if (row) {
          setSelectedCourse(row.course);
          setSelectedCourseIsCreatorDraft(row.fromCreatorDraft);
          setSelectedCourseAdminPreviewOwnerUid(row.adminPreviewOwnerUid ?? null);
          setInitialLesson(undefined);
          setCurrentView('overview');
          const payload: AppHistoryPayload = { v: 1, view: 'overview', courseId: snap.courseId };
          window.history.replaceState({ [APP_HISTORY_KEY]: payload }, '', buildHistoryUrl(payload));
          scrollDocumentToTop();
          return;
        }
      }
      clearCourseSelection();
      setInitialLesson(undefined);
      setCurrentView(snap.view);
      const p: AppHistoryPayload = { v: 1, view: snap.view as AppHistoryPayload['view'] };
      window.history.replaceState({ [APP_HISTORY_KEY]: p }, '', buildHistoryUrl(p));
      scrollDocumentToTop();
      return;
    }

    historySkipSyncRef.current = true;

    if (!snap) {
      clearCourseSelection();
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
      const row = pickPublishedFirstCourseRow(catalogCourseRowsRef.current, snap.courseId);
      if (row) {
        setSelectedCourse(row.course);
        setSelectedCourseIsCreatorDraft(row.fromCreatorDraft);
        setSelectedCourseAdminPreviewOwnerUid(row.adminPreviewOwnerUid ?? null);
        setInitialLesson(undefined);
        setCurrentView('overview');
        const payload: AppHistoryPayload = { v: 1, view: 'overview', courseId: snap.courseId };
        window.history.replaceState({ [APP_HISTORY_KEY]: payload }, '', buildHistoryUrl(payload));
        scrollDocumentToTop();
        return;
      }
    }

    if (snap.view === 'overview' && !snap.courseId) {
      clearCourseSelection();
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

    clearCourseSelection();
    setInitialLesson(undefined);
    setCurrentView(snap.view);
    const returnPayload: AppHistoryPayload = { v: 1, view: snap.view as AppHistoryPayload['view'] };
    window.history.replaceState({ [APP_HISTORY_KEY]: returnPayload }, '', buildHistoryUrl(returnPayload));
    scrollDocumentToTop();
  }, [certificateData?.isPublic, clearCourseSelection]);

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
    const course = pickPublishedFirstCourseRow(combinedCatalogRows, certificateData.courseId)?.course;
    if (!course) return null;

    return (
      <div className="mx-auto max-w-7xl px-3 pb-[max(4rem,env(safe-area-inset-bottom))] pt-20 sm:px-6 sm:pb-20 sm:pt-24 md:px-12">
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
    <div className="pt-14 sm:pt-16">
      {/* Hero Section — tighter vertical rhythm + lg:items-start so phone tab bars stay in view (min-h + center was pushing mockup down). */}
      <section className="relative overflow-x-hidden border-b border-[var(--border-color)] bg-[var(--bg-primary)] px-0 pb-10 pt-6 sm:pb-12 sm:pt-8 md:pb-12 md:pt-10 lg:pb-14 lg:pt-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 sm:gap-8 lg:flex-row lg:items-start lg:justify-between lg:gap-14">
          <div className="relative z-10 mt-4 w-full min-w-0 max-w-2xl sm:mt-5">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-3 inline-flex items-center gap-2 rounded-full bg-orange-500/20 px-3 py-1 text-xs font-bold uppercase tracking-widest text-orange-500 sm:mb-6"
            >
              <TrendingUp size={14} />
              Trending in Software Development
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="mb-3 text-4xl font-bold leading-tight text-[var(--text-primary)] sm:mb-6 sm:text-5xl lg:text-6xl xl:text-7xl"
            >
              Build your <span className="text-orange-500">future</span> with SkillStream.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mb-5 text-lg text-[var(--text-secondary)] sm:mb-8 sm:text-xl"
            >
              The technology learning platform to build tomorrow&apos;s skills today. Get access to 7,000+ courses from
              industry experts.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-wrap items-stretch gap-4"
            >
              {isAuthReady && !user && (
                <button
                  type="button"
                  onClick={() => void handleLogin().catch(() => {})}
                  className="flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md bg-orange-500 px-6 py-4 text-white transition-colors hover:bg-orange-600 sm:flex-initial sm:px-8"
                >
                  <span className="flex items-center gap-2 font-bold">
                    Learn for free
                    <ChevronRight size={20} />
                  </span>
                  <span className="text-sm font-medium text-white/90">Sign in with Google</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => handleNavigate('contact')}
                className="hidden min-h-11 min-w-0 items-center justify-center rounded-md bg-[var(--hover-bg)] px-6 py-4 font-bold text-[var(--text-primary)] transition-colors hover:bg-[var(--hover-bg)]/80 md:inline-flex md:px-8"
              >
                Contact Us
              </button>
            </motion.div>
          </div>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.45 }}
            className="relative z-10 flex w-full shrink-0 justify-center lg:w-[min(100%,380px)] lg:min-w-[min(100%,380px)] lg:justify-end lg:self-start"
          >
            <PhoneMockupAdRail
              imageSrc={mobileHeroSrc}
              imageAlt="SkillStream mobile experience"
              slides={heroPhoneAdSlides}
            />
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
          {filteredCatalogRows.slice(0, 4).map((row) => (
            <CourseCard
              key={
                row.fromCreatorDraft
                  ? `d:${row.course.id}:${row.adminPreviewOwnerUid ?? 'self'}`
                  : `p:${row.course.id}`
              }
              course={row.course}
              onClick={() => handleCourseRowClick(row)}
              showPrivateDraftBadge={row.fromCreatorDraft}
              draftBadgeLabel={row.adminPreviewOwnerUid ? 'Creator preview' : undefined}
            />
          ))}
        </div>
      </section>
    </div>
  );

  const renderCatalog = () => {
    const catalogHeading = selectedLearningPathId == null ? 'Course Library' : null;
    /** Avoid flashing the raw path id (e.g. P1) before Firestore returns `learningPaths`. */
    const pathTitleLoading = selectedLearningPathId != null && !learningPathsFetched;
    const pathHeroTitle =
      selectedLearningPathId == null
        ? null
        : learningPathsFetched
          ? activeLearningPath?.title?.trim() || selectedLearningPathId
          : null;
    const pathUnknown =
      selectedLearningPathId != null && learningPathsFetched && activeLearningPath == null;
    return (
      <div className="mx-auto min-w-0 max-w-7xl px-4 pb-12 pt-[max(5.5rem,calc(4rem+env(safe-area-inset-top,0px)))] sm:px-6 sm:pb-20 sm:pt-24">
        <div className="sticky top-16 z-30 -mx-4 mb-6 border-b border-[var(--border-color)]/80 bg-[var(--bg-primary)] px-4 pb-4 sm:static sm:z-auto sm:mx-0 sm:mb-10 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0">
          {catalogHeading != null ? (
            <div className="mb-4 sm:mb-4">
              <h1 className="min-w-0 break-words text-2xl font-bold leading-tight text-[var(--text-primary)] sm:text-3xl md:text-4xl">
                {catalogHeading}
              </h1>
            </div>
          ) : selectedLearningPathId != null && (pathTitleLoading || pathHeroTitle != null) ? (
            <div className="mb-2 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 sm:mb-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 gap-3">
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-orange-500/35 bg-orange-500/10 text-orange-500"
                    aria-hidden
                  >
                    <LayoutGrid size={22} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-500 sm:text-xs">
                      Learning path
                    </p>
                    <h1
                      className="mt-1 min-w-0 break-words text-xl font-bold leading-snug text-[var(--text-primary)] sm:text-2xl md:text-3xl"
                      aria-busy={pathTitleLoading}
                    >
                      {pathTitleLoading ? (
                        <>
                          <span className="sr-only">Loading learning path title</span>
                          <span
                            className="inline-block h-8 w-[min(100%,12rem)] max-w-full animate-pulse rounded-md bg-[var(--hover-bg)] sm:h-9 md:h-10"
                            aria-hidden
                          />
                        </>
                      ) : (
                        pathHeroTitle
                      )}
                    </h1>
                    <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
                      Everything you need, in the right order. Go at your own pace.
                    </p>
                    {selectedLearningPathId != null &&
                    activeCatalogPathRow?.adminPreviewOwnerUid &&
                    !pathUnknown ? (
                      <p className="mt-2 text-xs font-medium text-orange-500 sm:text-sm">
                        Creator preview — you’re viewing this path as it exists in another creator’s private
                        studio.
                      </p>
                    ) : null}
                    {selectedLearningPathId != null &&
                    activeCatalogPathRow?.fromCreatorDraft === true &&
                    !activeCatalogPathRow?.adminPreviewOwnerUid &&
                    !pathUnknown ? (
                      <p className="mt-2 text-xs font-medium text-orange-500 sm:text-sm">
                        Draft path — only you see this in Browse Catalog until an admin publishes it.
                      </p>
                    ) : null}
                    {pathUnknown ? (
                      <p className="mt-2 text-sm font-medium text-amber-600 dark:text-amber-400">
                        We couldn’t find this learning path. It may have been renamed, removed, or the link may be
                        outdated. Choose another path from the menu, or browse the full catalog.
                      </p>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleNavigate('catalog')}
                  className="shrink-0 rounded-xl border border-[var(--border-color)] bg-[var(--hover-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-orange-500/40 hover:text-orange-500"
                >
                  Browse all courses
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {selectedLearningPathId != null ? (
          <div className="mb-4 min-w-0 max-w-full sm:mb-6">
            <LearnerPathMindmapPanel
              pathId={selectedLearningPathId}
              pathTitle={pathHeroTitle ?? (pathTitleLoading ? 'Learning path' : selectedLearningPathId)}
              catalogCourses={catalogCourses}
              progressUserId={user?.uid ?? null}
              progressSnapshotVersion={pathProgressSnapshot + remoteProfileDataVersion}
              viewerIsAdmin={isAdminUser}
              suppressPathHeader
              mindmapOutlineChildren={pathMindmapOutlineChildren}
              mindmapOutlineLoading={pathMindmapOutlineLoading}
              pathCourseIds={activeLearningPath?.courseIds ?? []}
              onOpenCourse={(courseId) => {
                const row = resolveCatalogRowForPathCourse(courseId);
                if (row) handleCourseRowClick(row);
              }}
              onOpenLesson={(courseId, lessonId) => {
                const row = resolveCatalogRowForPathCourse(courseId);
                if (!row) return;
                const c = row.course;
                const lesson = findLessonById(c, lessonId);
                if (!lesson) return;
                historyActionRef.current = 'push';
                if (user?.uid) {
                  void enrollUserInCourse(user.uid, c.id);
                }
                setSelectedCourse(c);
                setSelectedCourseIsCreatorDraft(row.fromCreatorDraft);
                setSelectedCourseAdminPreviewOwnerUid(row.adminPreviewOwnerUid ?? null);
                const overviewPayload: AppHistoryPayload = {
                  v: 1,
                  view: 'overview',
                  courseId: c.id,
                  ...(selectedLearningPathId != null ? { learningPathId: selectedLearningPathId } : {}),
                  ...(selectedLearningPathFromCreatorDraft ? { learningPathFromCreatorDraft: true } : {}),
                  ...(selectedLearningPathAdminPreviewOwnerUid
                    ? { learningPathAdminPreviewOwnerUid: selectedLearningPathAdminPreviewOwnerUid }
                    : {}),
                  ...(row.adminPreviewOwnerUid
                    ? { adminPreviewCourseOwnerUid: row.adminPreviewOwnerUid }
                    : {}),
                };
                const h = parseHashToPayload(window.location.hash);
                const fromState = readPayloadFromHistoryState(window.history.state);
                if (shouldPushCourseOverviewBeforePlayer(h, fromState, overviewPayload)) {
                  window.history.pushState(
                    { [APP_HISTORY_KEY]: overviewPayload },
                    '',
                    buildHistoryUrl(overviewPayload)
                  );
                }
                setPlayerLessonIdForUrl(lesson.id);
                setInitialLesson(lesson);
                setCurrentView('player');
                scrollDocumentToTop();
              }}
            />
          </div>
        ) : null}

        {selectedLearningPathId == null ? (
          <>
            <div className="relative z-0 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
              {filteredCatalogRows.map((row, index) => (
                <CourseCard
                  key={
                    row.fromCreatorDraft
                      ? `d:${row.course.id}:${row.adminPreviewOwnerUid ?? 'self'}`
                      : `p:${row.course.id}`
                  }
                  ref={(el) => (courseRefs.current[index] = el)}
                  course={row.course}
                  onClick={() => handleCourseRowClick(row, index)}
                  tabIndex={focusedCourseIndex === index || (focusedCourseIndex === -1 && index === 0) ? 0 : -1}
                  onKeyDown={(e) => handleCourseKeyDown(e, index)}
                  isFocused={focusedCourseIndex === index}
                  showPrivateDraftBadge={row.fromCreatorDraft}
                  draftBadgeLabel={row.adminPreviewOwnerUid ? 'Creator preview' : undefined}
                />
              ))}
            </div>
            {filteredCourses.length === 0 && (
              <div className="px-2 py-12 text-center sm:py-20">
                <p className="text-base text-[var(--text-muted)] sm:text-lg">
                  No courses match these filters.
                </p>
              </div>
            )}
          </>
        ) : null}
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
                  Sign in and use the form — we&apos;ll reply to the email on your account.
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
          <ContactForm user={user} onLogin={() => void handleLogin().catch(() => {})} />
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
            mainView === 'overview' || mainView === 'player' || mainView === 'admin'
              ? 'catalog'
              : mainView
          }
          catalogNavFilter={
            currentView === 'catalog' && selectedLearningPathId == null ? (
              <CourseLibraryCategoryFilter
                ref={catalogCategoryFilterTriggerRef}
                mainTopics={categoryPresets.mainPills}
                moreTopics={moreCategories}
                mainSkills={skillPresets.mainPills}
                moreSkills={moreSkills}
                filters={libraryFilters}
                onFiltersChange={handleCourseLibraryFiltersChange}
              />
            ) : undefined
          }
          onCategorySelect={handleCategorySelect}
          catalogBrowseCategories={catalogBrowseCategories}
          catalogBrowseSkills={catalogBrowseSkills}
          catalogActiveCategoryTags={
            navCatalogCategoryTag ? [navCatalogCategoryTag] : libraryFilters.categoryTags
          }
          catalogActiveSkillTags={navCatalogSkillTag ? [navCatalogSkillTag] : libraryFilters.skillTags}
          learningPaths={combinedCatalogPathRows.map((r) => ({
            id: r.id,
            title: r.title,
            fromCreatorDraft: r.fromCreatorDraft,
            adminPreviewOwnerUid: r.adminPreviewOwnerUid,
          }))}
          privatePathIds={catalogPrivatePathIds}
          onPathSelect={handlePathSelect}
          onSkillSelect={handleSkillSelect}
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
          onClearAllNotifications={handleClearAllNotifications}
          onGuestClearNotifications={handleGuestClearNotifications}
          isAdmin={isAdminUser}
          isCreator={!!user && adminAccessResolved && (isCreatorUser || isAdminUser)}
          immersiveHidden={playerImmersiveNav && currentView === 'player'}
        />
      )}
      {authBanner && currentView !== 'certificate' && !(playerImmersiveNav && currentView === 'player') && (
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
                  onStartCourse={handleStartCourseFromOverview}
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
                  onActiveLessonIdChange={handlePlayerActiveLessonIdChange}
                  onCourseFinished={handleCoursePlayerFinished}
                  user={user}
                  onLogin={handleLogin}
                  pauseForAppNavOverlay={profileOverlayOpen && mainView === 'player'}
                  immersiveLayout={playerImmersiveNav}
                  onImmersivePlaybackChange={setPlayerImmersiveNav}
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
              moderationInitialSubTab={pendingModerationSubTab}
              onModerationInitialSubTabConsumed={clearPendingModerationSubTab}
              onTabChange={setAdminTab}
              onDismiss={() => handleNavigate('catalog', false)}
              onCatalogChanged={refreshCatalogCourses}
              heroPhoneMockupSrc={mobileHeroSrc}
              onUnsavedWorkChange={handleAdminUnsavedWorkChange}
              alertsMuted={alertsMuted}
              onAlertsMutedChange={handleToggleAlertsMuted}
              onAdminPreviewCreatorCourse={handleAdminPreviewCreatorCourse}
              onAdminPreviewCreatorPath={handleAdminPreviewCreatorPath}
            />
          )}
          {mainView === 'admin' && isAuthReady && user && !adminAccessResolved && (
            <div className="min-h-screen pt-28 flex items-center justify-center text-[var(--text-secondary)] text-sm">
              Checking admin access…
            </div>
          )}
          {mainView === 'creator' && isAuthReady && user && !adminAccessResolved && (
            <div className="min-h-screen pt-28 flex items-center justify-center text-[var(--text-secondary)] text-sm">
              Checking access…
            </div>
          )}
          {mainView === 'creator' &&
            isAuthReady &&
            user &&
            adminAccessResolved &&
            (isCreatorUser || isAdminUser) && (
              <CreatorPage
                user={user}
                onDismiss={() => handleNavigate('catalog', false)}
                onCatalogChanged={refreshCatalogCourses}
              />
            )}
          {mainView === 'signup' && renderSignup()}
        </div>

        {currentView === 'profile' && (
          <div className="fixed inset-x-0 top-16 bottom-0 z-[45] flex items-start justify-center overflow-y-auto overflow-x-hidden bg-black/60 px-3 pt-4 pb-[max(3rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:px-4 sm:pb-12 sm:pt-6">
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

        <AnimatePresence>
          {adminExitGuardOpen && (
            <div
              className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
              aria-labelledby="app-admin-exit-guard-title"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="w-full max-w-lg overflow-hidden rounded-3xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
              >
                <div className="flex items-center justify-between gap-4 border-b border-[var(--border-color)] p-6">
                  <h2
                    id="app-admin-exit-guard-title"
                    className="text-xl font-bold text-[var(--text-primary)]"
                  >
                    Leave without saving?
                  </h2>
                  <button
                    type="button"
                    onClick={closeAppAdminExitGuard}
                    className="shrink-0 rounded-full p-2 transition-colors hover:bg-[var(--hover-bg)]"
                    aria-label="Close"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="space-y-4 p-6">
                  <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                    You have unsaved changes. If you leave the admin portal now, that work will be lost.
                  </p>
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      autoFocus
                      onClick={closeAppAdminExitGuard}
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-5 py-3 text-sm font-bold text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] sm:w-auto"
                    >
                      Keep editing
                    </button>
                    <button
                      type="button"
                      onClick={confirmAppAdminExit}
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
      </main>

      {!(playerImmersiveNav && currentView === 'player') && showLearningAssistantFab && (
        <DemoLearningAgent
          courses={catalogCourses}
          onOpenCourse={(course) => {
            const row = pickPublishedFirstCourseRow(combinedCatalogRows, course.id);
            if (row) {
              setSelectedCourse(row.course);
              setSelectedCourseIsCreatorDraft(row.fromCreatorDraft);
              setSelectedCourseAdminPreviewOwnerUid(row.adminPreviewOwnerUid ?? null);
            } else {
              setSelectedCourse(course);
              setSelectedCourseIsCreatorDraft(false);
              setSelectedCourseAdminPreviewOwnerUid(null);
            }
            setInitialLesson(undefined);
            setCurrentView('overview');
            scrollDocumentToTop();
          }}
        />
      )}

      {currentView !== 'player' && currentView !== 'overview' && currentView !== 'admin' && (
        <footer className="bg-[var(--bg-secondary)] border-t border-[var(--border-color)] py-12 px-6 transition-colors duration-300">
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-10 md:gap-12">
            <div className="col-span-1 md:col-span-1">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 bg-orange-500 rounded-sm flex items-center justify-center font-bold text-white">S</div>
                <span className="text-xl font-bold tracking-tighter text-[var(--text-primary)]">SKILLSTREAM</span>
              </div>
              <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
                Empowering technology teams and individuals to build the future through expert-led content and skill assessments.
              </p>
            </div>
            <div className="md:col-span-3 grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-10 md:gap-12">
            <div>
              <h4 className="text-[var(--text-primary)] font-bold mb-4 md:mb-6">Solutions</h4>
              <ul className="space-y-4 text-sm text-[var(--text-secondary)]">
                <li className="text-[var(--text-secondary)]">For Individuals</li>
                <li className="text-[var(--text-secondary)]">For Teams</li>
                <li className="text-[var(--text-secondary)]">For Enterprise</li>
              </ul>
            </div>
            <div>
              <h4 className="text-[var(--text-primary)] font-bold mb-4 md:mb-6">Support</h4>
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
                  className="max-md:hidden hover:text-orange-500 cursor-pointer focus:outline-none focus:text-orange-500"
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
            <div className="col-span-2 md:col-span-1">
              <h4 className="text-[var(--text-primary)] font-bold mb-4 md:mb-6">Company</h4>
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
          </div>
          <div className="max-w-7xl mx-auto mt-12 pt-8 border-t border-[var(--border-color)] text-center text-[var(--text-secondary)] text-xs">
            © 2026 SkillStream Inc. All rights reserved.
          </div>
        </footer>
      )}
    </div>
  );
}

