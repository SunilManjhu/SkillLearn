import React, { forwardRef } from 'react';
import { Star, Clock } from 'lucide-react';
import type { Course } from '../data/courses';
import { useCourseStockThumbnail } from '../hooks/useCourseStockThumbnail';
import { CourseCardCategories } from './CourseCardCategories';

export interface CourseCardProps {
  course: Course;
  onClick: (course: Course) => void;
  tabIndex?: number;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  isFocused?: boolean;
  /** Creator draft shown only to the author in Browse Catalog until published. */
  showPrivateDraftBadge?: boolean;
  /** Overrides default “Draft · only you” when `showPrivateDraftBadge` (e.g. admin creator preview). */
  draftBadgeLabel?: string;
}

export const CourseCard = forwardRef<HTMLDivElement, CourseCardProps>(
  (
    { course, onClick, tabIndex = 0, onKeyDown, isFocused, showPrivateDraftBadge = false, draftBadgeLabel },
    ref
  ) => {
    const { imageUrl, imageCreditTitle } = useCourseStockThumbnail(course);

    const handleKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
      onKeyDown?.(e);
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick(course);
      }
    };

    return (
      <div
        ref={ref}
        role="button"
        tabIndex={tabIndex}
        onKeyDown={handleKeyDown}
        onClick={() => onClick(course)}
        className={`group flex flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] text-left cursor-pointer transition-all hover:border-brand-500/30 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
          isFocused ? 'ring-2 ring-brand-500/50' : ''
        }`}
      >
        <div className="aspect-video overflow-hidden bg-black/20">
          <img
            src={imageUrl}
            alt=""
            title={imageCreditTitle}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        </div>
        <div className="flex flex-1 flex-col gap-2 p-3 sm:p-4 min-w-0">
          <div className="flex min-w-0 flex-col gap-1">
            <CourseCardCategories categories={course.categories} />
            {course.skills.length > 0 && (
              <div className="flex min-w-0 flex-wrap gap-1">
                {course.skills.slice(0, 3).map((s) => (
                  <span
                    key={s}
                    title={s}
                    className="inline-block min-w-0 max-w-full break-words rounded bg-[var(--hover-bg)] px-1.5 py-0.5 text-left text-[9px] font-medium text-[color:var(--skill-chip-fg)]"
                  >
                    {s}
                  </span>
                ))}
                {course.skills.length > 3 && (
                  <span className="self-center text-[9px] text-[var(--text-muted)]">
                    +{course.skills.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
          <h3 className="line-clamp-2 text-[15px] font-bold leading-snug text-[var(--text-primary)] sm:text-base">
            {course.title}
          </h3>
          {showPrivateDraftBadge ? (
            <span className="inline-flex w-fit rounded-md border border-brand-500/35 bg-brand-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-500">
              {draftBadgeLabel ?? 'Draft · only you'}
            </span>
          ) : null}
          <p className="text-sm text-[var(--text-secondary)]">{course.author}</p>
          <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-xs text-[var(--text-muted)]">
            <span className="flex items-center gap-1 shrink-0">
              <Star size={12} className="fill-brand-500 text-brand-500" />
              {course.rating.toFixed(1)}
            </span>
            <span className="flex items-center gap-1 shrink-0">
              <Clock size={12} className="shrink-0 text-brand-500" />
              {course.duration}
            </span>
            <span className="rounded-md bg-[var(--hover-bg)] px-2 py-0.5 text-[var(--text-secondary)] shrink-0">
              {course.level}
            </span>
          </div>
        </div>
      </div>
    );
  }
);

CourseCard.displayName = 'CourseCard';
