import type { Course } from '../data/courses';

const SESSION_PREFIX = 'skilllearn.pexelsThumb.v2:';
const MEMORY_CACHE = new Map<string, CachedStockPhoto>();
const IN_FLIGHT = new Map<string, Promise<CachedStockPhoto | null>>();

export type CachedStockPhoto = {
  url: string;
  /** For `title` / accessibility; Pexels asks for attribution when practical. */
  photographer: string;
};

type PexelsSearchResponse = {
  photos?: Array<{
    src?: { large?: string; medium?: string; portrait?: string };
    photographer?: string;
  }>;
};

/**
 * Stable unique placeholder image per course when Pexels is unavailable or returns nothing.
 * Uses Picsum `seed` so the same course id always maps to the same image (cache-friendly).
 */
export function placeholderThumbnailUrlForCourseId(courseId: string): string {
  const safe = courseId.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'course';
  const seed = safe.length > 48 ? safe.slice(0, 48) : safe;
  return `https://picsum.photos/seed/${seed}/800/450`;
}

/** True when the stored URL is a placeholder we should try to replace with a stock search. */
export function shouldReplaceWithStockThumbnail(thumbnail: string): boolean {
  const t = thumbnail.trim().toLowerCase();
  if (!t) return true;
  if (t.includes('picsum.photos')) return true;
  if (t.includes('placeholder')) return true;
  if (t.includes('via.placeholder')) return true;
  return false;
}

/** Build a short English search query from course metadata (Pexels works best with concrete nouns). */
export function buildStockThumbnailSearchQuery(course: Pick<Course, 'title' | 'categories' | 'skills'>): string {
  const stop = new Set([
    'a',
    'an',
    'the',
    'and',
    'or',
    'for',
    'to',
    'of',
    'in',
    'on',
    'with',
    'your',
    'how',
    'introduction',
    'intro',
    'course',
    'learn',
    'learning',
    'basics',
    'beginner',
    'advanced',
  ]);

  const words: string[] = [];
  const pushFrom = (s: string) => {
    for (const raw of s.toLowerCase().split(/[^a-z0-9+.#]+/i)) {
      const w = raw.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
      if (w.length < 2 || stop.has(w)) continue;
      words.push(w);
    }
  };

  pushFrom(course.title);
  if (course.categories[0]) pushFrom(course.categories[0]);
  for (const sk of course.skills.slice(0, 2)) pushFrom(sk);

  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    uniq.push(w);
    if (uniq.length >= 6) break;
  }

  let q = uniq.join(' ').trim();
  if (!q) q = 'education learning';
  if (q.length > 80) q = q.slice(0, 80).trim();
  return q;
}

function cacheKey(courseId: string, query: string): string {
  return `${courseId}\n${query}`;
}

function readSession(key: string): CachedStockPhoto | null {
  try {
    const raw = sessionStorage.getItem(SESSION_PREFIX + key);
    if (!raw) return null;
    const j = JSON.parse(raw) as CachedStockPhoto;
    if (j && typeof j.url === 'string' && j.url.startsWith('https://')) return j;
  } catch {
    /* ignore */
  }
  return null;
}

function writeSession(key: string, value: CachedStockPhoto): void {
  try {
    sessionStorage.setItem(SESSION_PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

async function fetchPexelsPhoto(
  apiKey: string,
  query: string,
  /** Distinct per course so shared search text (e.g. similar titles) does not always pick the same hit. */
  pickSalt: string
): Promise<CachedStockPhoto | null> {
  const url = new URL('https://api.pexels.com/v1/search');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', '8');
  url.searchParams.set('orientation', 'landscape');

  const res = await fetch(url.toString(), {
    headers: { Authorization: apiKey },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as PexelsSearchResponse;
  const photos = data.photos;
  if (!photos?.length) return null;

  let pick = photos[0]!;
  if (photos.length > 1) {
    let h = 0;
    const s = `${query}\0${pickSalt}`;
    for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
    pick = photos[Math.abs(h) % photos.length]!;
  }

  const src =
    pick.src?.large ?? pick.src?.portrait ?? pick.src?.medium ?? '';
  if (!src.startsWith('https://')) return null;

  return {
    url: src,
    photographer: pick.photographer?.trim() || 'Pexels photographer',
  };
}

/**
 * Returns a royalty-free photo URL from Pexels (requires `VITE_PEXELS_API_KEY`), or `null` on failure.
 * Results are cached in memory and sessionStorage per course + query.
 */
export async function getStockThumbnailForCourse(
  apiKey: string,
  course: Pick<Course, 'id' | 'title' | 'categories' | 'skills'>
): Promise<CachedStockPhoto | null> {
  const query = buildStockThumbnailSearchQuery(course);
  const key = cacheKey(course.id, query);

  const mem = MEMORY_CACHE.get(key);
  if (mem) return mem;

  const sess = readSession(key);
  if (sess) {
    MEMORY_CACHE.set(key, sess);
    return sess;
  }

  let p = IN_FLIGHT.get(key);
  if (!p) {
    p = fetchPexelsPhoto(apiKey.trim(), query, course.id).then((photo) => {
      IN_FLIGHT.delete(key);
      if (photo) {
        MEMORY_CACHE.set(key, photo);
        writeSession(key, photo);
      }
      return photo;
    });
    IN_FLIGHT.set(key, p);
  }

  return p;
}
