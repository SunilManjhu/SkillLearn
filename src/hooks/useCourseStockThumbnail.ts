import { useEffect, useState } from 'react';
import type { Course } from '../data/courses';
import {
  getStockThumbnailForCourse,
  shouldReplaceWithStockThumbnail,
} from '../utils/courseStockThumbnail';

export type UseCourseStockThumbnailResult = {
  /** URL to pass to `<img src={...} />` */
  imageUrl: string;
  /** Present when the image is from Pexels (for `title` / screen readers). */
  imageCreditTitle?: string;
};

/**
 * When `VITE_PEXELS_API_KEY` is set and the course uses a placeholder thumbnail, fetches a
 * royalty-free landscape photo from Pexels based on title, category, and skills.
 */
export function useCourseStockThumbnail(course: Course): UseCourseStockThumbnailResult {
  const apiKey = import.meta.env.VITE_PEXELS_API_KEY as string | undefined;
  const [imageUrl, setImageUrl] = useState(course.thumbnail);
  const [imageCreditTitle, setImageCreditTitle] = useState<string | undefined>(undefined);

  useEffect(() => {
    setImageUrl(course.thumbnail);
    setImageCreditTitle(undefined);

    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!key || !shouldReplaceWithStockThumbnail(course.thumbnail)) {
      return;
    }

    let cancelled = false;
    void getStockThumbnailForCourse(key, {
      id: course.id,
      title: course.title,
      categories: course.categories,
      skills: course.skills,
    }).then((photo) => {
      if (cancelled || !photo) return;
      setImageUrl(photo.url);
      setImageCreditTitle(`Photo: ${photo.photographer} on Pexels (free to use)`);
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
