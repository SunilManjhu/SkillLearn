/** Serialized app location for History API + hash URLs (mobile-friendly, shareable). */

import type { Course, Lesson } from '../data/courses';

export const APP_HISTORY_KEY = 'skillstreamApp' as const;

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

export interface AppHistoryPayload {
  v: 1;
  view: AppHistoryView;
  courseId?: string | null;
  lessonId?: string | null;
  certificate?: CertificateHistorySnapshot | null;
  adminTab?: AdminHistoryTab | null;
  /** Firestore learning path id when catalog is scoped to a path (shareable / survives reload). */
  learningPathId?: string | null;
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
  'profile',
  'admin',
  'creator',
];

function isSimpleView(s: string): s is AppHistoryView {
  return (SIMPLE_VIEWS as string[]).includes(s);
}

/** Hash path only, e.g. `#/catalog` */
export function payloadToHash(payload: AppHistoryPayload): string {
  const { view, courseId, lessonId, certificate: _c, adminTab, learningPathId } = payload;

  if (view === 'home') return '#/';
  if (view === 'catalog') {
    if (learningPathId && learningPathId.length > 0) {
      return `#/catalog/path/${encodeURIComponent(learningPathId)}`;
    }
    return '#/catalog';
  }

  if (view === 'overview' && courseId) {
    const base = `#/course/${encodeURIComponent(courseId)}/overview`;
    if (learningPathId && learningPathId.length > 0) {
      return `${base}/path/${encodeURIComponent(learningPathId)}`;
    }
    return base;
  }
  if (view === 'player' && courseId) {
    const base = `#/course/${encodeURIComponent(courseId)}/player`;
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
    if (tab === 'catalog') return '#/admin/content';
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
      if (segments.length === 3) {
        return { v: 1, view: 'overview', courseId };
      }
      if (segments.length === 5 && segments[3] === 'path') {
        const pid = decodeURIComponent(segments[4]!);
        if (pid.length > 0) {
          return { v: 1, view: 'overview', courseId, learningPathId: pid };
        }
      }
    }
    if (mode === 'player') {
      if (segments.length === 3) {
        return { v: 1, view: 'player', courseId };
      }
      if (segments.length >= 5 && segments[3] === 'path') {
        const pathId = decodeURIComponent(segments[4]!);
        if (pathId.length > 0) {
          const out: AppHistoryPayload = { v: 1, view: 'player', courseId, learningPathId: pathId };
          if (segments.length >= 6) {
            out.lessonId = decodeURIComponent(segments[5]!);
          }
          return out;
        }
      }
      if (segments.length === 4) {
        return { v: 1, view: 'player', courseId, lessonId: decodeURIComponent(segments[3]!) };
      }
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
    const sub = segments[1]?.toLowerCase();
    if (sub === 'content' || sub === 'courses' || sub === 'catalog') adminTab = 'catalog';
    else if (sub === 'moderation') adminTab = 'moderation';
    else if (sub === 'roles' || sub === 'users') adminTab = 'roles';
    else if (sub === 'alerts') adminTab = 'alerts';
    else if (sub === 'ai' || sub === 'models' || sub === 'gemini') adminTab = 'ai';
    else if (sub === 'marketing' || sub === 'ads' || sub === 'hero') adminTab = 'marketing';
    else if (sub === 'creators') adminTab = 'creators';
    return { v: 1, view: 'admin', adminTab };
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
  if (merged.learningPathId == null && fromState.learningPathId != null) {
    merged.learningPathId = fromState.learningPathId;
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

  if (historyStatePayload != null) {
    const s = historyStatePayload;
    const stackIsThisOverview =
      s.view === 'overview' &&
      s.courseId === overviewPayload.courseId &&
      (s.learningPathId ?? null) === (overviewPayload.learningPathId ?? null);
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
  }
  if ((a.learningPathId ?? null) !== (b.learningPathId ?? null)) return false;
  return true;
}

export function resolvePayloadForCourses(
  payload: AppHistoryPayload,
  courses: Course[],
  findLessonById: (course: Course, lessonId: string) => Lesson | undefined
): AppHistoryPayload {
  const next: AppHistoryPayload = { ...payload, v: 1 };
  const needsCourse = next.view === 'overview' || next.view === 'player';
  if (!needsCourse) return next;

  const course = next.courseId ? courses.find((c) => c.id === next.courseId) : undefined;
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
