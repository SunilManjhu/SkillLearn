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
  | 'settings'
  | 'certificate'
  | 'admin';

export interface CertificateHistorySnapshot {
  courseId: string;
  userName: string;
  date: string;
  certificateId: string;
  isPublic: boolean;
}

/** Admin portal sub-routes (Courses tab uses internal id `catalog`). */
export type AdminHistoryTab = 'alerts' | 'catalog' | 'moderation';

export interface AppHistoryPayload {
  v: 1;
  view: AppHistoryView;
  courseId?: string | null;
  lessonId?: string | null;
  certificate?: CertificateHistorySnapshot | null;
  adminTab?: AdminHistoryTab | null;
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
  'settings',
  'admin',
];

function isSimpleView(s: string): s is AppHistoryView {
  return (SIMPLE_VIEWS as string[]).includes(s);
}

/** Hash path only, e.g. `#/catalog` */
export function payloadToHash(payload: AppHistoryPayload): string {
  const { view, courseId, lessonId, certificate: _c, adminTab } = payload;

  if (view === 'home') return '#/';
  if (view === 'catalog') return '#/catalog';

  if (view === 'overview' && courseId) {
    return `#/course/${encodeURIComponent(courseId)}/overview`;
  }
  if (view === 'player' && courseId) {
    const base = `#/course/${encodeURIComponent(courseId)}/player`;
    if (lessonId) return `${base}/${encodeURIComponent(lessonId)}`;
    return base;
  }

  if (view === 'certificate') return '#/certificate';

  if (view === 'admin') {
    const tab = adminTab ?? 'alerts';
    if (tab === 'alerts') return '#/admin';
    if (tab === 'catalog') return '#/admin/courses';
    return '#/admin/moderation';
  }

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

  if (head === 'course' && segments.length >= 3) {
    const courseId = decodeURIComponent(segments[1]!);
    const mode = segments[2];
    if (mode === 'overview' && segments.length === 3) {
      return { v: 1, view: 'overview', courseId };
    }
    if (mode === 'player') {
      if (segments.length === 3) {
        return { v: 1, view: 'player', courseId };
      }
      if (segments.length === 4) {
        return { v: 1, view: 'player', courseId, lessonId: decodeURIComponent(segments[3]!) };
      }
    }
  }

  if (head === 'certificate' && segments.length === 1) {
    return { v: 1, view: 'certificate' };
  }

  if (head === 'admin') {
    let adminTab: AdminHistoryTab = 'alerts';
    const sub = segments[1]?.toLowerCase();
    if (sub === 'courses' || sub === 'catalog') adminTab = 'catalog';
    else if (sub === 'moderation') adminTab = 'moderation';
    else if (sub === 'alerts') adminTab = 'alerts';
    return { v: 1, view: 'admin', adminTab };
  }

  if (segments.length === 1 && isSimpleView(head)) {
    return { v: 1, view: head };
  }

  return null;
}

export function readPayloadFromHistoryState(state: unknown): AppHistoryPayload | null {
  if (!state || typeof state !== 'object') return null;
  const raw = (state as Record<string, unknown>)[APP_HISTORY_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as AppHistoryPayload;
  if (p.v !== 1 || typeof p.view !== 'string') return null;
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
    return { v: 1, view: 'catalog' };
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
