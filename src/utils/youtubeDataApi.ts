/**
 * YouTube Data API v3 helpers for public video metadata (e.g. duration).
 * @see https://developers.google.com/youtube/v3/docs/videos
 */
import type { Course, Lesson } from '../data/courses';
import { youtubeVideoIdFromUrl } from './youtube';
import { isQuizLesson, isWebLesson } from './lessonContent';

/** `contentDetails.duration` ISO 8601 → seconds (e.g. PT15M33S, PT1H2M10S, P1DT2H3M4S). */
export function parseYoutubeIso8601Duration(iso: string | undefined): number {
  if (!iso || typeof iso !== 'string') return 0;
  const m = iso.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/
  );
  if (!m) return 0;
  const days = parseInt(m[1] || '0', 10);
  const hours = parseInt(m[2] || '0', 10);
  const minutes = parseInt(m[3] || '0', 10);
  const seconds = parseFloat(m[4] || '0');
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

/** Human-readable like existing course data: "1:05:02" or "23:45". */
export function formatSecondsAsLessonClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '—';
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function getYoutubeDataApiKey(): string | undefined {
  const k = import.meta.env.VITE_YOUTUBE_DATA_API_KEY;
  return typeof k === 'string' && k.trim() ? k.trim() : undefined;
}

export function listYoutubeLessonsInCourse(course: Course): { lessonId: string; videoId: string }[] {
  const out: { lessonId: string; videoId: string }[] = [];
  for (const mod of course.modules) {
    for (const lesson of mod.lessons) {
      if (isWebLesson(lesson) || isQuizLesson(lesson)) continue;
      const videoId = youtubeVideoIdFromUrl(lesson.videoUrl);
      if (videoId) out.push({ lessonId: lesson.id, videoId });
    }
  }
  return out;
}

/**
 * Returns map videoId → duration seconds. Batches up to 50 ids per request (API limit).
 */
export async function fetchYoutubeVideoDurationsSeconds(
  videoIds: string[],
  apiKey: string
): Promise<Record<string, number>> {
  const unique = [...new Set(videoIds.filter(Boolean))];
  const result: Record<string, number> = {};
  const chunkSize = 50;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'contentDetails');
    url.searchParams.set('id', chunk.join(','));
    url.searchParams.set('key', apiKey);
    const res = await fetch(url.toString());
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`YouTube Data API ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      items?: { id: string; contentDetails?: { duration?: string } }[];
    };
    for (const item of data.items ?? []) {
      const sec = parseYoutubeIso8601Duration(item.contentDetails?.duration);
      if (item.id && sec > 0) result[item.id] = sec;
    }
  }
  return result;
}

export function lessonDurationLabel(
  lesson: Lesson,
  youtubeResolvedSeconds: Record<string, number>
): string {
  if (lesson.contentKind === 'web') {
    if (lesson.duration?.trim()) return lesson.duration.trim();
    return 'Link';
  }
  if (lesson.contentKind === 'quiz') {
    if (lesson.duration?.trim()) return lesson.duration.trim();
    return 'Quiz';
  }
  const sec = youtubeResolvedSeconds[lesson.id];
  if (sec && sec > 0) return formatSecondsAsLessonClock(sec);
  if (lesson.duration) return lesson.duration;
  return youtubeVideoIdFromUrl(lesson.videoUrl) ? '…' : '—';
}
