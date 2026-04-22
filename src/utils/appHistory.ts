/** Serialized app location for History API + hash URLs (mobile-friendly, shareable). */

import type { Course, Lesson } from '../data/courses';
import { pickCourseRowForHistoryPayload, type CatalogCourseRow } from './learnerCatalogMerge';

export const APP_HISTORY_KEY = 'igoldenApp' as const;

export type AppHistoryView =
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
  | 'signin'
  | 'profile'
  | 'certificate'
  | 'admin'
  | 'creator';

export interface CertificateHistorySnapshot {
  courseId: string;
  userName: string;
  date: string;
  certificateId: string;
  isPublic: boolean;
}

/** Admin portal sub-routes (Content tab uses internal id `catalog`; Roles tab uses `roles`). */
export type AdminHistoryTab =
  | 'alerts'
  | 'ai'
  | 'catalog'
  | 'marketing'
  | 'moderation'
  | 'roles'
  | 'creators';

/** Horizontal sub-tabs inside Admin → Content (`AdminCourseCatalogSection`). */
export type AdminContentCatalogSubTab =
  | 'catalog'
  | 'paths'
  | 'taxonomy'
  | 'categories'
  | 'presets'
  | 'skillPresets';

const ADMIN_CONTENT_CATALOG_URL_SEGMENTS: Record<AdminContentCatalogSubTab, string> = {
  catalog: '',
  paths: 'paths',
  taxonomy: 'taxonomy',
  categories: 'categories',
  presets: 'presets',
  skillPresets: 'skill-presets',
};

export function adminContentCatalogSubTabToUrlSegment(tab: AdminContentCatalogSubTab): string {
  return ADMIN_CONTENT_CATALOG_URL_SEGMENTS[tab] ?? '';
}

export function parseAdminContentCatalogUrlSegment(raw: string): AdminContentCatalogSubTab | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s === 'paths') return 'paths';
  if (s === 'taxonomy' || s === 'categories-skills' || s === 'categories_skills') return 'taxonomy';
  if (s === 'categories') return 'categories';
  if (s === 'presets' || s === 'topic-presets' || s === 'topic_presets') return 'presets';
  if (s === 'skill-presets' || s === 'skill_presets' || s === 'skillpresets') return 'skillPresets';
  return null;
}

export interface AppHistoryPayload {
  v: 1;
  view: AppHistoryView;
  courseId?: string | null;
  lessonId?: string | null;
  certificate?: CertificateHistorySnapshot | null;
  adminTab?: AdminHistoryTab | null;
  /** Admin → Content horizontal sub-tab (hash `#/admin/content/...`). */
  adminContentCatalogSubTab?: AdminContentCatalogSubTab | null;
  /** Firestore learning path id when catalog is scoped to a path (shareable / survives reload). */
  learningPathId?: string | null;
  /**
   * When published and creator draft share the same path id, history state disambiguates which
   * row is active (hash URL has no draft bit; default = published).
   */
  learningPathFromCreatorDraft?: boolean | null;
  /** Admin inventory: previewing another creator’s `creatorLearningPaths` doc (same id as own draft possible). */
  learningPathAdminPreviewOwnerUid?: string | null;
  /**
   * Admin “Open overview” preview of another creator’s draft: disambiguates `#/course/:id/overview`
   * when a published course shares the same `courseId`.
   */
  adminPreviewCourseOwnerUid?: string | null;
  /**
   * When a published course and the signed-in user’s `creatorCourses` draft share the same `courseId`,
   * history + `#/course/.../overview/draft` disambiguate so reload opens the draft (taxonomy, modules, etc.).
   */
  courseFromCreatorDraft?: boolean | null;
}

const SIMPLE_VIEWS: AppHistoryView[] = [
  'home',
  'catalog',
  'about',
  'careers',
  'privacy',
  'help',
  'contact',
  'status',
  'enterprise',
  'signup',
  'signin',
  'profile',
  'admin',
  'creator',
];

function isSimpleView(s: string): s is AppHistoryView {
  return (SIMPLE_VIEWS as string[]).includes(s);
}

/** Hash path only, e.g. `#/catalog` */
export function payloadToHash(payload: AppHistoryPayload): string {
  const {
    view,
    courseId,
    lessonId,
    certificate: _c,
    adminTab,
    adminContentCatalogSubTab,
    learningPathId,
    adminPreviewCourseOwnerUid,
    courseFromCreatorDraft,
  } = payload;

  if (view === 'home') return '#/';
  if (view === 'catalog') {
    if (learningPathId && learningPathId.length > 0) {
      return `#/catalog/path/${encodeURIComponent(learningPathId)}`;
    }
    return '#/catalog';
  }

  if (view === 'overview' && courseId) {
    const preview =
      adminPreviewCourseOwnerUid && adminPreviewCourseOwnerUid.length > 0
        ? `/preview/${encodeURIComponent(adminPreviewCourseOwnerUid)}`
        : '';
    const draftSeg =
      courseFromCreatorDraft === true && !preview
        ? '/draft'
        : '';
    let out = `#/course/${encodeURIComponent(courseId)}/overview${preview}${draftSeg}`;
    if (learningPathId && learningPathId.length > 0) {
      out += `/path/${encodeURIComponent(learningPathId)}`;
    }
    return out;
  }
  if (view === 'player' && courseId) {
    let base = `#/course/${encodeURIComponent(courseId)}/player`;
    if (adminPreviewCourseOwnerUid && adminPreviewCourseOwnerUid.length > 0) {
      base += `/preview/${encodeURIComponent(adminPreviewCourseOwnerUid)}`;
    } else if (courseFromCreatorDraft === true) {
      base += '/draft';
    }
    if (learningPathId && learningPathId.length > 0) {
      const withPath = `${base}/path/${encodeURIComponent(learningPathId)}`;
      if (lessonId) return `${withPath}/${encodeURIComponent(lessonId)}`;
      return withPath;
    }
    if (lessonId) return `${base}/${encodeURIComponent(lessonId)}`;
    return base;
  }

  if (view === 'certificate') return '#/certificate';

  if (view === 'admin') {
    const tab = adminTab ?? 'alerts';
    if (tab === 'alerts') return '#/admin';
    if (tab === 'ai') return '#/admin/ai';
    if (tab === 'catalog') {
      const sub = adminContentCatalogSubTab ?? 'catalog';
      if (sub === 'catalog') return '#/admin/content';
      const seg = adminContentCatalogSubTabToUrlSegment(sub);
      if (!seg) return '#/admin/content';
      return `#/admin/content/${encodeURIComponent(seg)}`;
    }
    if (tab === 'marketing') return '#/admin/marketing';
    if (tab === 'moderation') return '#/admin/moderation';
    if (tab === 'creators') return '#/admin/creators';
    return '#/admin/roles';
  }

  if (view === 'creator') return '#/creator';

  if (isSimpleView(view)) return `#/${view}`;
  return '#/';
}

export function parseHashToPayload(hash: string): AppHistoryPayload | null {
  const raw = hash.replace(/^#/, '').trim();
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 0) {
    return { v: 1, view: 'home' };
  }

  const head = segments[0]!;

  if (head === 'catalog' && segments.length === 1) {
    return { v: 1, view: 'catalog' };
  }

  if (head === 'catalog' && segments.length === 3 && segments[1] === 'path') {
    const pathId = decodeURIComponent(segments[2]!);
    if (pathId.length > 0) {
      return { v: 1, view: 'catalog', learningPathId: pathId };
    }
    return { v: 1, view: 'catalog' };
  }

  if (head === 'course' && segments.length >= 3) {
    const courseId = decodeURIComponent(segments[1]!);
    const mode = segments[2];
    if (mode === 'overview') {
      let idx = 3;
      let adminPreviewCourseOwnerUid: string | undefined;
      if (segments[idx] === 'preview' && segments[idx + 1]) {
        adminPreviewCourseOwnerUid = decodeURIComponent(segments[idx + 1]!);
        idx += 2;
      }
      const courseFromCreatorDraftFlag = segments[idx] === 'draft';
      if (courseFromCreatorDraftFlag) idx += 1;
      const base: AppHistoryPayload = {
        v: 1,
        view: 'overview',
        courseId,
        courseFromCreatorDraft: courseFromCreatorDraftFlag,
        ...(adminPreviewCourseOwnerUid ? { adminPreviewCourseOwnerUid } : {}),
      };
      if (segments.length === idx) {
        return base;
      }
      if (segments.length >= idx + 2 && segments[idx] === 'path') {
        const pid = decodeURIComponent(segments[idx + 1]!);
        if (pid.length > 0) {
          return { ...base, learningPathId: pid };
        }
      }
      return base;
    }
    if (mode === 'player') {
      let i = 3;
      let adminPreviewCourseOwnerUid: string | undefined;
      if (segments[i] === 'preview' && segments[i + 1]) {
        adminPreviewCourseOwnerUid = decodeURIComponent(segments[i + 1]!);
        i += 2;
      }
      const courseFromCreatorDraftFlag = !adminPreviewCourseOwnerUid && segments[i] === 'draft';
      if (courseFromCreatorDraftFlag) i += 1;
      const withPreview = (): AppHistoryPayload => ({
        v: 1,
        view: 'player',
        courseId,
        courseFromCreatorDraft: courseFromCreatorDraftFlag,
        ...(adminPreviewCourseOwnerUid ? { adminPreviewCourseOwnerUid } : {}),
      });
      if (segments.length === i) {
        return withPreview();
      }
      if (segments[i] === 'path' && segments[i + 1]) {
        const pathId = decodeURIComponent(segments[i + 1]!);
        i += 2;
        if (pathId.length > 0) {
          const out: AppHistoryPayload = { ...withPreview(), learningPathId: pathId };
          if (segments.length > i) {
            out.lessonId = decodeURIComponent(segments[i]!);
          }
          return out;
        }
      }
      if (segments.length === i + 1) {
        return { ...withPreview(), lessonId: decodeURIComponent(segments[i]!) };
      }
      return withPreview();
    }
  }

  if (head === 'certificate' && segments.length === 1) {
    return { v: 1, view: 'certificate' };
  }

  /** Legacy `#/settings` → profile */
  if (head === 'settings' && segments.length === 1) {
    return { v: 1, view: 'profile' };
  }

  if (head === 'admin') {
    let adminTab: AdminHistoryTab = 'alerts';
    let adminContentCatalogSubTab: AdminContentCatalogSubTab = 'catalog';
    const sub = segments[1]?.toLowerCase();
    if (sub === 'content' || sub === 'courses' || sub === 'catalog') {
      adminTab = 'catalog';
      const contentSegRaw = segments[2];
      if (contentSegRaw) {
        const decoded = decodeURIComponent(contentSegRaw).toLowerCase();
        const mapped = parseAdminContentCatalogUrlSegment(decoded);
        if (mapped) adminContentCatalogSubTab = mapped;
      }
    } else if (sub === 'moderation') adminTab = 'moderation';
    else if (sub === 'roles' || sub === 'users') adminTab = 'roles';
    else if (sub === 'alerts') adminTab = 'alerts';
    else if (sub === 'ai' || sub === 'models' || sub === 'gemini') adminTab = 'ai';
    else if (sub === 'marketing' || sub === 'ads' || sub === 'hero') adminTab = 'marketing';
    else if (sub === 'creators') adminTab = 'creators';
    const out: AppHistoryPayload = { v: 1, view: 'admin', adminTab };
    if (adminTab === 'catalog') {
      out.adminContentCatalogSubTab = adminContentCatalogSubTab;
    }
    return out;
  }

  if (head === 'creator' && segments.length === 1) {
    return { v: 1, view: 'creator' };
  }

  if (segments.length === 1 && isSimpleView(head)) {
    return { v: 1, view: head };
  }

  return null;
}

/**
 * Combine hash (visible URL) with history.state from pushState. Hash wins for routing fields;
 * when the hash omits `learningPathId` (legacy links), keep it from state so back/forward restores
 * path-scoped catalog context.
 */
export function mergeHashAndHistoryStatePayload(
  fromHash: AppHistoryPayload | null,
  fromState: AppHistoryPayload | null
): AppHistoryPayload | null {
  if (!fromHash && !fromState) return null;
  if (!fromHash) return fromState;
  if (!fromState) return fromHash;
  const merged: AppHistoryPayload = { ...fromState, ...fromHash, v: 1 };
  if (merged.adminTab !== 'catalog') {
    merged.adminContentCatalogSubTab = null;
  }
  if (merged.learningPathId == null && fromState.learningPathId != null) {
    merged.learningPathId = fromState.learningPathId;
  }
  if (
    (merged.adminPreviewCourseOwnerUid == null || merged.adminPreviewCourseOwnerUid === '') &&
    fromState?.adminPreviewCourseOwnerUid != null &&
    String(fromState.adminPreviewCourseOwnerUid).length > 0
  ) {
    merged.adminPreviewCourseOwnerUid = fromState.adminPreviewCourseOwnerUid;
  }
  /** Hash is only `#/certificate`; certificate payload lives on `history.state`. */
  if (merged.view === 'certificate' && merged.certificate == null && fromState?.certificate != null) {
    merged.certificate = fromState.certificate;
  }
  return merged;
}

/**
 * Before opening the player from course overview, decide if we must push an overview history entry.
 * The visible hash can already show `#/course/.../overview` while `history.state` on the stack top
 * still reflects catalog/path (e.g. timing or replaceState). If we skip pushing because the hash
 * matches, the next sync can push player on top of catalog and Back returns to the path, not the course.
 */
export function shouldPushCourseOverviewBeforePlayer(
  hashPayload: AppHistoryPayload | null,
  historyStatePayload: AppHistoryPayload | null,
  overviewPayload: AppHistoryPayload
): boolean {
  if (overviewPayload.view !== 'overview' || !overviewPayload.courseId) return false;
  if (!hashPayload) return true;
  if (hashPayload.view !== 'overview') return true;
  if (hashPayload.courseId !== overviewPayload.courseId) return true;
  if ((hashPayload.learningPathId ?? null) !== (overviewPayload.learningPathId ?? null)) return true;
  if (
    (hashPayload.learningPathFromCreatorDraft === true) !==
    (overviewPayload.learningPathFromCreatorDraft === true)
  ) {
    return true;
  }
  if (
    (hashPayload.learningPathAdminPreviewOwnerUid ?? null) !==
    (overviewPayload.learningPathAdminPreviewOwnerUid ?? null)
  ) {
    return true;
  }
  if ((hashPayload.adminPreviewCourseOwnerUid ?? null) !== (overviewPayload.adminPreviewCourseOwnerUid ?? null))
    return true;
  if (
    (hashPayload.courseFromCreatorDraft === true) !== (overviewPayload.courseFromCreatorDraft === true)
  ) {
    return true;
  }

  if (historyStatePayload != null) {
    const s = historyStatePayload;
    const stackIsThisOverview =
      s.view === 'overview' &&
      s.courseId === overviewPayload.courseId &&
      (s.learningPathId ?? null) === (overviewPayload.learningPathId ?? null) &&
      (s.learningPathFromCreatorDraft === true) ===
        (overviewPayload.learningPathFromCreatorDraft === true) &&
      (s.learningPathAdminPreviewOwnerUid ?? null) ===
        (overviewPayload.learningPathAdminPreviewOwnerUid ?? null) &&
      (s.adminPreviewCourseOwnerUid ?? null) === (overviewPayload.adminPreviewCourseOwnerUid ?? null) &&
      (s.courseFromCreatorDraft === true) === (overviewPayload.courseFromCreatorDraft === true);
    if (!stackIsThisOverview) return true;
  } else {
    // Hash can show overview while the stack top has no payload (initial visit, or entry without our key).
    // Without a matching state we cannot skip pushing — otherwise sync pushes player on the wrong entry.
    return true;
  }
  return false;
}

export function readPayloadFromHistoryState(state: unknown): AppHistoryPayload | null {
  if (!state || typeof state !== 'object') return null;
  const raw = (state as Record<string, unknown>)[APP_HISTORY_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as AppHistoryPayload;
  if (p.v !== 1 || typeof p.view !== 'string') return null;
  /** Legacy history entries used `settings`; map to profile. */
  if ((p.view as string) === 'settings') {
    return { ...p, v: 1, view: 'profile' };
  }
  /** Admin tab was renamed `users` → `roles` (URL `#/admin/roles`). */
  if (p.view === 'admin' && (p.adminTab as string | undefined) === 'users') {
    return { ...p, v: 1, view: 'admin', adminTab: 'roles' };
  }
  return p;
}

export function buildHistoryUrl(payload: AppHistoryPayload): string {
  const hash = payloadToHash(payload);
  if (typeof window === 'undefined') return hash;
  return `${window.location.pathname}${window.location.search}${hash}`;
}

/**
 * Prefer the real history stack (system back / browser back on mobile). Some WebViews
 * report unreliable `history.length`; if `history.back()` does not fire `popstate`,
 * `fallback` runs once after a short delay.
 */
export function historyBackOrFallback(fallback: () => void, options?: { timeoutMs?: number }): void {
  if (typeof window === 'undefined') {
    fallback();
    return;
  }
  const timeoutMs = options?.timeoutMs ?? 450;
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    window.removeEventListener('popstate', onPop);
    window.clearTimeout(tid);
  };
  const onPop = () => {
    finish();
  };
  window.addEventListener('popstate', onPop);
  const tid = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    window.removeEventListener('popstate', onPop);
    fallback();
  }, timeoutMs);
  window.history.back();
}

export function historyPayloadsEqual(a: AppHistoryPayload | null, b: AppHistoryPayload | null): boolean {
  if (!a || !b) return a === b;
  if (a.view !== b.view) return false;
  if ((a.courseId ?? null) !== (b.courseId ?? null)) return false;
  if ((a.lessonId ?? null) !== (b.lessonId ?? null)) return false;
  const ac = a.certificate;
  const bc = b.certificate;
  if (!!ac !== !!bc) return false;
  if (ac && bc && ac.certificateId !== bc.certificateId) return false;
  if (a.view === 'admin' && b.view === 'admin') {
    if ((a.adminTab ?? 'alerts') !== (b.adminTab ?? 'alerts')) return false;
    if (a.adminTab === 'catalog' && b.adminTab === 'catalog') {
      if ((a.adminContentCatalogSubTab ?? 'catalog') !== (b.adminContentCatalogSubTab ?? 'catalog')) return false;
    }
  }
  if ((a.learningPathId ?? null) !== (b.learningPathId ?? null)) return false;
  if ((a.learningPathFromCreatorDraft === true) !== (b.learningPathFromCreatorDraft === true)) return false;
  if ((a.learningPathAdminPreviewOwnerUid ?? null) !== (b.learningPathAdminPreviewOwnerUid ?? null)) return false;
  if ((a.adminPreviewCourseOwnerUid ?? null) !== (b.adminPreviewCourseOwnerUid ?? null)) return false;
  if ((a.courseFromCreatorDraft === true) !== (b.courseFromCreatorDraft === true)) return false;
  return true;
}

export function resolvePayloadForCourses(
  payload: AppHistoryPayload,
  catalogRows: readonly CatalogCourseRow[],
  findLessonById: (course: Course, lessonId: string) => Lesson | undefined
): AppHistoryPayload {
  const next: AppHistoryPayload = { ...payload, v: 1 };
  const needsCourse = next.view === 'overview' || next.view === 'player';
  if (!needsCourse) return next;

  const row = next.courseId
    ? pickCourseRowForHistoryPayload(
        catalogRows,
        next.courseId,
        next.adminPreviewCourseOwnerUid,
        next.courseFromCreatorDraft
      )
    : undefined;
  const course = row?.course;
  if (!course) {
    return { v: 1, view: 'catalog', learningPathId: payload.learningPathId };
  }
  if (next.view === 'player' && next.lessonId) {
    const lesson = findLessonById(course, next.lessonId);
    if (!lesson) {
      const { lessonId: _drop, ...rest } = next;
      return { ...rest, v: 1, view: 'player', courseId: course.id };
    }
  }
  return { ...next, courseId: course.id };
}
