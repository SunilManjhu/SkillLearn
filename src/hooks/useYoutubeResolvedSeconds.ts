import { useCallback, useEffect, useState } from 'react';
import type { Course, Lesson } from '../data/courses';
import {
  fetchYoutubeVideoDurationsSeconds,
  getYoutubeDataApiKey,
  lessonDurationLabel as labelForLesson,
  listYoutubeLessonsInCourse,
} from '../utils/youtubeDataApi';

/**
 * Prefetches YouTube lesson lengths via Data API when VITE_YOUTUBE_DATA_API_KEY is set.
 * IFrame `getDuration` in CoursePlayer merges into the same map for fallback / custom URLs.
 */
export function useYoutubeResolvedSeconds(course: Course) {
  const [youtubeResolvedSeconds, setYoutubeResolvedSeconds] = useState<Record<string, number>>({});

  useEffect(() => {
    const apiKey = getYoutubeDataApiKey();
    const pairs = listYoutubeLessonsInCourse(course);
    if (!apiKey || pairs.length === 0) return;
    let cancelled = false;
    const videoIds = pairs.map((p) => p.videoId);
    fetchYoutubeVideoDurationsSeconds(videoIds, apiKey)
      .then((byVideoId) => {
        if (cancelled) return;
        const byLesson: Record<string, number> = {};
        for (const { lessonId, videoId } of pairs) {
          const sec = byVideoId[videoId];
          if (sec > 0) byLesson[lessonId] = sec;
        }
        setYoutubeResolvedSeconds((prev) => ({ ...prev, ...byLesson }));
      })
      .catch(() => {
        /* Player onReady still fills durations; API key may be missing or quota exceeded. */
      });
    return () => {
      cancelled = true;
    };
  }, [course]);

  const lessonDurationLabel = useCallback(
    (lesson: Lesson) => labelForLesson(lesson, youtubeResolvedSeconds),
    [youtubeResolvedSeconds]
  );

  return { youtubeResolvedSeconds, setYoutubeResolvedSeconds, lessonDurationLabel };
}
