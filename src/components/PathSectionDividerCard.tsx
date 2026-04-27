import React from 'react';
import { BookOpen } from 'lucide-react';

export type PathSectionDividerCardProps = {
  /** Learner: plain title string. Admin: can pass an `<input />` or other node. */
  title: React.ReactNode;
  /**
   * Small caps line above the title (e.g. product type). String default is “Section divider”.
   * Pass a node (e.g. controlled `<input />`) for admin editing. Omit or use `showEyebrow={false}` to hide.
   */
  eyebrow?: React.ReactNode;
  showEyebrow?: boolean;
  className?: string;
};

/**
 * Learner path + admin: “book block” card for a section divider (muted type line + bold title).
 */
export function PathSectionDividerCard({
  title,
  eyebrow = 'Section divider',
  showEyebrow = true,
  className = '',
}: PathSectionDividerCardProps) {
  const line =
    showEyebrow &&
    eyebrow != null &&
    eyebrow !== '' &&
    !(typeof eyebrow === 'string' && eyebrow.trim() === '');
  const ariaLabel = typeof title === 'string' ? `Section divider: ${title}` : undefined;
  return (
    <div
      className={`flex w-full min-w-0 flex-1 flex-nowrap items-center gap-3 overflow-hidden rounded-xl border border-[var(--border-light)]/55 bg-[var(--bg-secondary)] px-3 py-2.5 shadow-sm sm:gap-3.5 sm:px-4 sm:py-3 ${className}`.trim()}
      role="group"
      aria-label={ariaLabel}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border-light)]/50 bg-[var(--bg-primary)]/50 text-[var(--text-primary)] sm:h-11 sm:w-11"
        aria-hidden
      >
        <BookOpen className="h-[1.125rem] w-[1.125rem] sm:h-5 sm:w-5" strokeWidth={1.5} aria-hidden />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {line ? (
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)] sm:text-[11px]">
            {typeof eyebrow === 'string' ? (
              <p className="m-0 p-0 leading-snug [overflow-wrap:anywhere]">{eyebrow}</p>
            ) : (
              eyebrow
            )}
          </div>
        ) : null}
        <div className="min-w-0 text-base font-bold leading-snug tracking-tight text-[var(--text-primary)] sm:text-[1.0625rem] [overflow-wrap:anywhere]">
          {title}
        </div>
      </div>
    </div>
  );
}
