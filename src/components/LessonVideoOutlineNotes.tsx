import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ListVideo } from 'lucide-react';
import {
  formatSecondsAsMmSs,
  isPlaybackInVideoOutlineLine,
  parseVideoOutlineNotes,
  type VideoOutlineLine,
} from '../utils/videoOutlineNotes';

export type LessonVideoOutlineNotesProps = {
  text: string;
  onSeekSeconds: (seconds: number) => void;
  /** When false, timestamp lines render as static text (no seek). */
  seekEnabled: boolean;
  /** Current video time for highlighting while a line’s range is active; `null` disables. */
  playbackSeconds?: number | null;
  /** Fired when the outline disclosure opens or closes (mobile lesson meta visibility). */
  onOpenChange?: (open: boolean) => void;
  /**
   * Desktop (lg+): controlled disclosure + accordion with Write notes (see `CoursePlayerSidebarPanels`).
   */
  desktopOpen?: boolean;
  onDesktopUserSetOpen?: (open: boolean) => void;
  /** Playback highlight: expand outline without closing Write notes. */
  onDesktopAutoExpandOutline?: () => void;
  /** Desktop: outline block grows with available sidebar height when open. */
  desktopFillColumn?: boolean;
};

function OutlineRow({
  line,
  seekEnabled,
  onSeekSeconds,
  playbackSeconds,
}: {
  line: VideoOutlineLine;
  seekEnabled: boolean;
  onSeekSeconds: (seconds: number) => void;
  playbackSeconds: number | null;
}) {
  const inRange = isPlaybackInVideoOutlineLine(playbackSeconds, line);
  const activeRing = inRange ? ' ring-1 ring-brand-400/50 ring-inset' : '';
  const activeText =
    inRange && line.highlight
      ? ' font-medium text-brand-600 dark:text-brand-400'
      : '';

  const canSeek = seekEnabled && line.seekStartSeconds !== null;
  if (canSeek && line.seekStartSeconds !== null) {
    const sec = line.seekStartSeconds;
    return (
      <li className="list-none scroll-my-2">
        <button
          type="button"
          onClick={() => onSeekSeconds(sec)}
          aria-current={inRange ? 'true' : undefined}
          data-outline-active={inRange ? 'true' : undefined}
          className={`w-full min-h-11 touch-manipulation rounded-lg px-2 py-2 text-left text-sm leading-snug text-[var(--text-primary)] transition-colors hover:bg-[var(--hover-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70 sm:min-h-10 sm:px-2.5${activeRing}${activeText}`}
          aria-label={`Jump to ${formatSecondsAsMmSs(sec)}: ${line.visibleText}`}
        >
          {line.visibleText}
        </button>
      </li>
    );
  }
  return (
    <li
      className={`list-none scroll-my-2 px-2 py-2 text-sm leading-snug text-[var(--text-secondary)] sm:px-2.5${activeText}`}
      aria-current={inRange ? 'true' : undefined}
      data-outline-active={inRange ? 'true' : undefined}
    >
      {line.visibleText}
    </li>
  );
}

/**
 * Instructor-authored outline: timestamps are hidden; lines with a timestamp are tappable to seek.
 */
export function LessonVideoOutlineNotes({
  text,
  onSeekSeconds,
  seekEnabled,
  playbackSeconds = null,
  onOpenChange,
  desktopOpen,
  onDesktopUserSetOpen,
  onDesktopAutoExpandOutline,
  desktopFillColumn = false,
}: LessonVideoOutlineNotesProps) {
  const lines = useMemo(() => parseVideoOutlineNotes(text), [text]);
  const listRef = useRef<HTMLUListElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  /** Start collapsed on all breakpoints so lesson meta stays visible until the learner opens the outline. */
  const [internalOpen, setInternalOpen] = useState(false);

  const desktopControlled = typeof onDesktopUserSetOpen === 'function' && typeof desktopOpen === 'boolean';
  const outlineOpen = desktopControlled ? desktopOpen : internalOpen;

  const pb = Number.isFinite(playbackSeconds) && playbackSeconds >= 0 ? playbackSeconds : null;

  const activeLineIndex = useMemo(() => {
    if (pb === null) return -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (isPlaybackInVideoOutlineLine(pb, lines[i]!)) return i;
    }
    return -1;
  }, [lines, pb]);

  useEffect(() => {
    onOpenChange?.(outlineOpen);
  }, [outlineOpen, onOpenChange]);

  /** Keep native `<details>` in sync with React `open` (desktop controlled); avoids toggle fighting the browser. */
  useLayoutEffect(() => {
    const el = detailsRef.current;
    if (!el || !desktopControlled) return;
    if (el.open !== outlineOpen) el.open = outlineOpen;
  }, [outlineOpen, desktopControlled]);

  const prevActiveLineIndexRef = useRef<number>(-1);

  useEffect(() => {
    if (activeLineIndex < 0) {
      prevActiveLineIndexRef.current = -1;
      return;
    }
    if (desktopControlled) {
      onDesktopAutoExpandOutline?.();
    } else {
      setInternalOpen(true);
    }
    const root = listRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>('[data-outline-active="true"]');
    if (!el) return;
    const lineChanged = prevActiveLineIndexRef.current !== activeLineIndex;
    prevActiveLineIndexRef.current = activeLineIndex;
    if (!lineChanged) return;
    el.scrollIntoView({ block: 'nearest', behavior: desktopControlled ? 'auto' : 'smooth' });
  }, [activeLineIndex, desktopControlled, onDesktopAutoExpandOutline]);

  const onDetailsToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (desktopControlled) return;
    setInternalOpen(e.currentTarget.open);
  };

  const onDesktopSummaryClick = (e: React.MouseEvent) => {
    if (!desktopControlled) return;
    e.preventDefault();
    onDesktopUserSetOpen?.(!outlineOpen);
  };

  if (lines.length === 0) return null;

  return (
    <div
      className={`relative overflow-visible border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/80 max-lg:z-20 max-lg:shrink-0 ${
        desktopFillColumn
          ? 'lg:flex lg:h-0 lg:min-h-0 lg:flex-1 lg:flex-col'
          : 'shrink-0 lg:shrink-0'
      }`}
    >
      <details
        ref={detailsRef}
        className={`group relative overflow-visible max-lg:z-20 ${
          desktopFillColumn
            ? 'lg:grid lg:h-full lg:min-h-0 lg:flex-1 lg:overflow-hidden lg:grid-rows-[auto_minmax(0,1fr)] lg:w-full'
            : ''
        }`}
        open={outlineOpen}
        onToggle={onDetailsToggle}
      >
        <summary
          className="flex min-h-11 shrink-0 cursor-pointer list-none items-center justify-between gap-2 bg-[var(--bg-secondary)]/80 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] touch-manipulation sm:min-h-10 sm:px-4 lg:shrink-0 [&::-webkit-details-marker]:hidden"
          onClick={onDesktopSummaryClick}
        >
          <span className="flex min-w-0 items-center gap-2">
            <ListVideo size={14} className="shrink-0 opacity-80" aria-hidden />
            <span>Video outline</span>
          </span>
          <ChevronDown
            size={18}
            className="shrink-0 text-[var(--text-muted)] transition-transform duration-200 group-open:rotate-180"
            aria-hidden
          />
        </summary>
      <ul
        ref={listRef}
        className={`space-y-0 px-1 pb-2 pt-0.5 max-lg:max-h-[min(55dvh,22rem)] max-lg:min-h-0 max-lg:overflow-y-auto max-lg:portrait:overscroll-y-auto max-lg:landscape:overscroll-y-contain max-lg:rounded-b-xl max-lg:border-x max-lg:border-b max-lg:border-[var(--border-color)] max-lg:bg-[var(--bg-secondary)] lg:relative lg:overflow-y-auto lg:overscroll-y-contain lg:rounded-none lg:border-0 lg:shadow-none ${
          desktopFillColumn
            ? 'lg:row-start-2 lg:h-full lg:min-h-0 lg:max-h-full lg:overflow-y-auto'
            : 'lg:max-h-[min(42vh,14rem)]'
        }`}
      >
        {lines.map((line, i) => (
          <OutlineRow
            key={i}
            line={line}
            seekEnabled={seekEnabled}
            onSeekSeconds={onSeekSeconds}
            playbackSeconds={pb}
          />
        ))}
      </ul>
      </details>
    </div>
  );
}
