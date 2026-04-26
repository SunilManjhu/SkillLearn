import { useEffect, useState } from 'react';
import type { Course } from '../data/courses';
import {
  getStockThumbnailForCourse,
  placeholderThumbnailUrlForCourseId,
  shouldReplaceWithStockThumbnail,
} from '../utils/courseStockThumbnail';

export type UseCourseStockThumbnailResult = {
  /** URL to pass to `<img src={...} />` */
  imageUrl: string;
  /** Present when the image is from Pexels (for `title` / screen readers). */
  imageCreditTitle?: string;
};

/**
 * Placeholder thumbnails (`picsum`, empty, etc.): unique image per course via Picsum seed.
 * With `VITE_PEXELS_API_KEY`, also tries Pexels for a metadata-based stock photo (commit 9f2f1c4).
 */
export function useCourseStockThumbnail(course: Course): UseCourseStockThumbnailResult {
  const apiKey = import.meta.env.VITE_PEXELS_API_KEY as string | undefined;
  const replacePlaceholder = shouldReplaceWithStockThumbnail(course.thumbnail);
  const [imageUrl, setImageUrl] = useState(() =>
    replacePlaceholder ? placeholderThumbnailUrlForCourseId(course.id) : course.thumbnail
  );
  const [imageCreditTitle, setImageCreditTitle] = useState<string | undefined>(undefined);

  useEffect(() => {
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';

    if (!shouldReplaceWithStockThumbnail(course.thumbnail)) {
      setImageUrl(course.thumbnail);
      setImageCreditTitle(undefined);
      return;
    }

    setImageUrl(placeholderThumbnailUrlForCourseId(course.id));
    setImageCreditTitle(undefined);

    if (!key) {
      return;
    }

    let cancelled = false;
    void getStockThumbnailForCourse(key, {
      id: course.id,
      title: course.title,
      categories: course.categories,
      skills: course.skills,
    }).then((photo) => {
      if (cancelled) return;
      if (photo) {
        setImageUrl(photo.url);
        setImageCreditTitle(`Photo: ${photo.photographer} on Pexels (free to use)`);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    apiKey,
    course.id,
    course.thumbnail,
    course.title,
    course.categories.join('\0'),
    course.skills.join('\0'),
  ]);

  return { imageUrl, imageCreditTitle };
}
