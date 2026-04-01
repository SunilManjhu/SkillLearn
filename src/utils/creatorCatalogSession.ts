import type { Course } from '../data/courses';
import type { LearningPath } from '../data/learningPaths';

const CREATOR_KEY_PREFIX = 'skilllearn:resolvedCreatorCatalog:v1:';
const MERGED_PATHS_KEY = 'skilllearn:lastMergedCatalogPaths:v1';

export type CreatorCatalogBundle = { courses: Course[]; paths: LearningPath[] };

let lastCreatorInMemory: { ownerUid: string } & CreatorCatalogBundle | null = null;

function creatorSessionKey(ownerUid: string): string {
  return `${CREATOR_KEY_PREFIX}${ownerUid}`;
}

function validateCoursesJson(data: unknown): data is Course[] {
  if (!Array.isArray(data)) return false;
  for (const item of data) {
    if (!item || typeof item !== 'object') return false;
    const c = item as Record<string, unknown>;
    if (typeof c.id !== 'string' || !Array.isArray(c.modules)) return false;
    for (const mod of c.modules) {
      if (!mod || typeof mod !== 'object') return false;
      const mo = mod as Record<string, unknown>;
      if (!Array.isArray(mo.lessons)) return false;
    }
  }
  return true;
}

function validatePathsJson(data: unknown): data is LearningPath[] {
  if (!Array.isArray(data)) return false;
  for (const item of data) {
    if (!item || typeof item !== 'object') return false;
    const p = item as Record<string, unknown>;
    if (typeof p.id !== 'string' || typeof p.title !== 'string' || !Array.isArray(p.courseIds)) return false;
    for (const cid of p.courseIds) {
      if (typeof cid !== 'string') return false;
    }
  }
  return true;
}

function readCreatorBundleFromSession(ownerUid: string): CreatorCatalogBundle | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(creatorSessionKey(ownerUid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    if (!validateCoursesJson(o.courses) || !validatePathsJson(o.paths)) return null;
    return { courses: o.courses, paths: o.paths };
  } catch {
    return null;
  }
}

/** In-memory (Strict remount) then session: last Firestore creator snapshot for this owner. */
export function peekResolvedCreatorCatalog(ownerUid: string): CreatorCatalogBundle | null {
  if (lastCreatorInMemory?.ownerUid === ownerUid) {
    return { courses: lastCreatorInMemory.courses, paths: lastCreatorInMemory.paths };
  }
  return readCreatorBundleFromSession(ownerUid);
}

export function writeResolvedCreatorCatalog(
  ownerUid: string,
  courses: Course[],
  paths: LearningPath[]
): void {
  lastCreatorInMemory = { ownerUid, courses, paths };
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(creatorSessionKey(ownerUid), JSON.stringify({ courses, paths }));
  } catch {
    /* quota / private mode */
  }
}

type MergedPathsStored = { uid: string | null; paths: LearningPath[] };

function readMergedPathsPayload(): MergedPathsStored | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(MERGED_PATHS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    if (o.uid !== null && typeof o.uid !== 'string') return null;
    if (!validatePathsJson(o.paths)) return null;
    const uidStored: string | null = typeof o.uid === 'string' ? o.uid : null;
    return { uid: uidStored, paths: o.paths };
  } catch {
    return null;
  }
}

/**
 * Last merged navbar paths for this identity (signed-out → `null` uid).
 * Mismatch if account changed without a full reload of initial state.
 */
export function peekMergedCatalogLearningPaths(expectedUid: string | null): LearningPath[] | null {
  const m = readMergedPathsPayload();
  if (!m) return null;
  if (m.uid !== expectedUid) return null;
  return m.paths;
}

export function writeMergedCatalogLearningPaths(uid: string | null, paths: LearningPath[]): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(MERGED_PATHS_KEY, JSON.stringify({ uid, paths }));
  } catch {
    /* quota / private mode */
  }
}
